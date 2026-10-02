import { Router } from "express";
import { config } from "../config.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import { safeError } from "../middleware/errorHandler.js";
import { getDiscordVouches } from "../services/discord-vouch.js";
import * as sellauth from "../services/sellauth.js";
import { loadFallbackProducts, loadFallbackShop } from "../utils/fallback.js";
import { legalPolicies } from "../utils/legal.js";
import {
  mapProductToStandard,
  parseSellAuthStatus,
  sanitizeShopData,
  defaultReviews,
} from "../utils/shop.js";

/**
 * Public storefront routes (canonical namespace: /api/outplayed/*).
 *
 * Products list: one SellAuth products call + one categories call, no
 * per-product enrichment (the list endpoint already returns variants, images
 * and category data). Results are cached server-side for 30-60s.
 */

const router = Router();
const legacyAliasRouter = Router();

async function loadPublicLegalPage(shopUrl: string, slug: string): Promise<string | null> {
  try {
    const response = await fetch(`${shopUrl.replace(/\/$/, "")}/${slug}`, {
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: `${shopUrl.replace(/\/$/, "")}/`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
    const content = main
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .trim();
    return content || null;
  } catch {
    return null;
  }
}

async function getProductsWithCategories() {
  // Catalog pages must remain usable when SellAuth is unavailable (for
  // example, when a local environment has no API key or a key has expired).
  // Fetch each resource independently so one rejected request does not turn
  // the whole response into an error and does not produce a stack trace for a
  // normal fallback condition.
  const [productsResult, categoriesResult] = await Promise.allSettled([
    sellauth.getProducts(),
    sellauth.getCategories(),
  ]);

  const rawList = productsResult.status === "fulfilled" ? productsResult.value : [];
  const categories = categoriesResult.status === "fulfilled" ? categoriesResult.value : [];

  const categoriesMap = new Map(categories.map((c: any) => [c.id, { id: c.id, name: c.name }]));
  return { rawList, categoriesMap };
}

async function handleGetProducts(req: any, res: any) {
  try {
    let { rawList, categoriesMap } = await getProductsWithCategories();
    if (!rawList.length) rawList = loadFallbackProducts();
    const products = rawList.map((p: any) => mapProductToStandard(p, categoriesMap));
    res.json({ ok: true, data: { products } });
  } catch (e) {
    // The route has a local catalog fallback by design. Keep upstream auth or
    // availability failures out of normal server logs; the fallback response
    // is still returned below.
    const products = loadFallbackProducts().map((p: any) => mapProductToStandard(p));
    res.json({ ok: true, data: { products } });
  }
}

async function handleGetSingleProduct(req: any, res: any) {
  try {
    const productId = req.params.id;
    if (!productId || productId.length > 100) {
      return res.status(400).json({ ok: false, error: "Invalid product identifier" });
    }

    let p: any = null;
    try {
      p = await sellauth.getProduct(productId);
    } catch {
      // Fall back to the (cached) list, then local data.
      try {
        const list = await sellauth.getProducts();
        p = list.find((item: any) => String(item.id) === String(productId) || item.path === productId);
      } catch {
        p = null;
      }
    }

    if (!p || !p.id) {
      const localList = loadFallbackProducts();
      p = localList.find((item: any) => String(item.id) === String(productId) || item.path === productId);
    }

    if (!p || !p.id) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }

    // The SellAuth single-product payload doesn't include the category relation,
    // so mapProductToStandard would fall back to a generic "General" entry. Enrich
    // it from the categories endpoint so the client sees the real category name.
    let categoriesMap: Map<any, any> | undefined;
    const rawCatName = String(p.category?.name ?? "").trim();
    if (!rawCatName || /^general$/i.test(rawCatName)) {
      try {
        const categories = await sellauth.getCategories();
        categoriesMap = new Map(categories.map((c: any) => [c.id, { id: c.id, name: c.name }]));
      } catch (e) {
        console.error("Category enrichment failed:", e);
      }
    }

    res.json({ ok: true, data: { product: mapProductToStandard(p, categoriesMap) } });
  } catch (e) {
    console.error("handleGetSingleProduct error:", e);
    res.status(500).json({ ok: false, error: "Unable to retrieve product" });
  }
}

function firstNonNegativeNumber(...values: any[]): number {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function calculateReviewMetrics(reviews: any[]): { totalFeedbacks: number; avgRating: number } {
  const ratings = reviews
    .map((review) => {
      const rawRating = review?.rating;
      if (rawRating === undefined || rawRating === null || rawRating === "") return 5;
      const rating = Number(rawRating);
      return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
    })
    .filter((rating): rating is number => rating !== null);

  if (!ratings.length) return { totalFeedbacks: 0, avgRating: 0 };

  const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  return { totalFeedbacks: ratings.length, avgRating: Number(average.toFixed(2)) };
}

async function getLanderReviews(): Promise<any[]> {
  try {
    const vouches = await getDiscordVouches(100);
    if (vouches.length) return vouches;
  } catch (error) {
    console.error("Discord vouches unavailable for shop metrics:", error);
  }

  try {
    const feedbacks = await sellauth.getFeedbacks();
    return feedbacks.length ? feedbacks : defaultReviews;
  } catch {
    return defaultReviews;
  }
}

async function handleGetShop(req: any, res: any) {
  try {
    let shopObj: any = null;
    let loadedFromSellAuth = false;
    try {
      shopObj = await sellauth.getShop();
      loadedFromSellAuth = Boolean(shopObj && typeof shopObj === "object");
    } catch {
      shopObj = null;
    }

    if (!shopObj || typeof shopObj !== "object") {
      shopObj = loadFallbackShop();
    }

    if (shopObj && typeof shopObj === "object") {
      shopObj = sanitizeShopData(shopObj);
      shopObj.discord_url = config.discordInviteUrl;
      shopObj.discordUrl = config.discordInviteUrl;
      shopObj.name = shopObj.name || "Outplayed";
      const logo =
        shopObj.logo_image_url ||
        (shopObj.logo_image && shopObj.logo_image.url) ||
        "https://api.sellauth.com/storage/images/1088445.webp";
      shopObj.logo = logo;
      shopObj.image = logo;
      shopObj.logo_image_url = logo;
      shopObj.favicon = logo;
      const policies = shopObj.policies || shopObj.legal || shopObj.legal_pages || {};
      const policyValue = (...values: any[]) => {
        const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== "");
        if (value && typeof value === "object") {
          return value.html ?? value.content ?? value.value ?? value.text ?? null;
        }
        return value ?? null;
      };

      shopObj.privacyPolicy = policyValue(
        shopObj.privacyPolicy,
        shopObj.privacy_policy,
        shopObj.privacy_policy_text,
        policies.privacyPolicy,
        policies.privacy_policy,
        policies.privacy,
      );
      shopObj.refundPolicy = policyValue(
        shopObj.refundPolicy,
        shopObj.refund_policy,
        shopObj.refund_policy_text,
        policies.refundPolicy,
        policies.refund_policy,
        policies.refund,
      );
      // SellAuth has returned both the short and snake_case policy names
      // across API versions. Normalize every variant before sending the shop
      // object to the client, whose legal pages use the camelCase names.
      const terms =
        shopObj.termsOfService ||
        shopObj.terms_of_service ||
        shopObj.terms ||
        shopObj.terms_text ||
        policyValue(policies.termsOfService, policies.terms_of_service, policies.terms);
      const privacy =
        shopObj.privacyPolicy ||
        shopObj.privacy_policy ||
        shopObj.privacy_policy_text;
      const refund =
        shopObj.refundPolicy ||
        shopObj.refund_policy ||
        shopObj.refund_policy_text;

      if (terms) {
        shopObj.terms = terms;
        shopObj.termsOfService = terms;
      }
      if (privacy) {
        shopObj.privacy_policy = privacy;
        shopObj.privacyPolicy = privacy;
      }
      if (refund) {
        shopObj.refund_policy = refund;
        shopObj.refundPolicy = refund;
      }

      // The SellAuth API shop payload does not include the legal document
      // bodies. They are rendered by the public storefront instead.
      if (shopObj.url && (!shopObj.termsOfService || !shopObj.privacyPolicy || !shopObj.refundPolicy)) {
        const [terms, privacy, refund] = await Promise.all([
          shopObj.termsOfService ? Promise.resolve(null) : loadPublicLegalPage(shopObj.url, "terms-of-service"),
          shopObj.privacyPolicy ? Promise.resolve(null) : loadPublicLegalPage(shopObj.url, "privacy-policy"),
          shopObj.refundPolicy ? Promise.resolve(null) : loadPublicLegalPage(shopObj.url, "refund-policy"),
        ]);
        if (terms) shopObj.terms = shopObj.termsOfService = terms;
        if (privacy) shopObj.privacy_policy = shopObj.privacyPolicy = privacy;
        if (refund) shopObj.refund_policy = shopObj.refundPolicy = refund;

        // SellAuth may serve an anti-bot page to server-side requests. Keep
        // the legal pages useful in that case by linking to the authoritative
        // public documents rather than showing an empty-content placeholder.
        if (!shopObj.termsOfService) shopObj.terms = shopObj.termsOfService = legalPolicies.terms;
        if (!shopObj.privacyPolicy) shopObj.privacy_policy = shopObj.privacyPolicy = legalPolicies.privacy;
        if (!shopObj.refundPolicy) shopObj.refund_policy = shopObj.refundPolicy = legalPolicies.refund;
      }
    }

    const reviews = await getLanderReviews();
    const reviewMetrics = calculateReviewMetrics(reviews);
    // The storefront's sales figure represents completed invoices, not units
    // sold or any other SellAuth counter.
    const totalSales = loadedFromSellAuth
      ? firstNonNegativeNumber(shopObj?.total_completed_invoices)
      : 0;

    res.json({
      ok: true,
      data: {
        shop: shopObj,
        metrics: { totalSales, ...reviewMetrics },
      },
    });
  } catch (e) {
    console.error("handleGetShop error:", e);
    res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve shop configuration") });
  }
}

async function handleGetCategories(req: any, res: any) {
  try {
    let catList: any[] = [];
    let prodList: any[] = [];
    try {
      [catList, prodList] = await Promise.all([sellauth.getCategories(), sellauth.getProducts()]);
    } catch {
      catList = [];
      prodList = [];
    }

    if (!prodList.length) prodList = loadFallbackProducts();

    const productsByCat = new Map<any, any[]>();
    prodList.forEach((p: any) => {
      const catId = p.category_id || p.category?.id || 1;
      if (!productsByCat.has(catId)) productsByCat.set(catId, []);
      let stock = 0;
      if (p.variants) {
        stock = p.variants.reduce((acc: number, v: any) => acc + (v.stock || 0), 0);
      } else if (p.plans) {
        stock = p.plans.reduce((acc: number, v: any) => acc + (v.stock || 0), 0);
      } else {
        stock = p.stock || 0;
      }
      productsByCat.get(catId)!.push({ id: p.id, name: p.name, stock });
    });

    if (!catList.length) {
      const seenCats = new Map<any, any>();
      prodList.forEach((p: any) => {
        const c = p.category || { id: p.category_id || 1, name: "General" };
        if (!seenCats.has(c.id)) {
          seenCats.set(c.id, {
            id: c.id,
            name: c.name || "General",
            visibility: "public",
            badge: { text: null, color: null },
            products: productsByCat.get(c.id) || [],
            imageUrl: c.image_id ? `https://api.sellauth.com/storage/images/${c.image_id}.webp` : null,
          });
        }
      });
      catList = Array.from(seenCats.values());
    } else {
      catList = catList.map((c: any) => ({
        id: c.id,
        name: c.name,
        visibility: "public",
        badge: c.badge || { text: c.badge_text || null, color: c.badge_color || null },
        products: productsByCat.get(c.id) || [],
        imageUrl: `https://api.sellauth.com/storage/images/${c.image_id}.webp`,
      }));
    }

    res.json({ ok: true, data: catList });
  } catch (e) {
    console.error("handleGetCategories error:", e);
    res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve categories") });
  }
}

async function handleGetStatus(req: any, res: any) {
  try {
    let products: any[] = [];
    try {
      products = await sellauth.getProducts();
    } catch {
      products = [];
    }
    // Status is limited to currently public SellAuth products. Private, deleted,
    // and terminated products must never appear on the public status page.
    const publicProducts = products.filter((p: any) => {
      const visibility = String(p.visibility || "").toLowerCase();
      return visibility === "public" && !p.deleted_at && !p.terminated_at;
    });
    const statuses = publicProducts.map((p: any) => ({
      id: p.id,
      name: p.name,
      productName: p.name,
      path: p.path,
      category: p.category?.name || "General",
      status: parseSellAuthStatus(p),
      status_text: p.status_text,
      status_color: p.status_color,
      updated_at: p.updated_at,
    }));
    res.json({ ok: true, data: { statuses } });
  } catch (e) {
    console.error("handleGetStatus error:", e);
    res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve status") });
  }
}

async function handleGetReviews(req: any, res: any) {
  try {
    try {
      const refreshImages = String(req.query?.refreshImages || "") === "1";
      const vouches = await getDiscordVouches(100, { refresh: refreshImages });
      if (vouches.length) {
        return res.json({
          ok: true,
          data: {
            reviews: vouches.map((vouch) => ({
              id: vouch.id,
              rating: vouch.rating,
              message: vouch.message,
              author: { name: vouch.author.name, avatarUrl: vouch.author.avatarUrl },
              createdAt: vouch.createdAt,
              images: vouch.images,
            })),
          },
        });
      }
    } catch (error) {
      console.error("Discord vouches unavailable:", error);
    }

    let list: any[] = [];
    try {
      list = await sellauth.getFeedbacks();
    } catch {
      list = [];
    }
    if (list.length > 0) {
      const mapped = list.map((f: any, idx: number) => ({
        id: f.id || idx + 1,
        rating: f.rating ?? 5,
        message: f.message || f.feedback || f.comment || "Amazing product and fast delivery!",
        author: {
          name: f.author_name || f.customer_email?.split("@")[0] || f.username || "Verified Customer",
        },
        createdAt: f.created_at ? new Date(f.created_at).getTime() : Date.now(),
      }));
      return res.json({ ok: true, data: { reviews: mapped } });
    }
    return res.json({ ok: true, data: { reviews: defaultReviews } });
  } catch {
    return res.json({ ok: true, data: { reviews: defaultReviews } });
  }
}

/**
 * Shared route definitions: registered on the canonical /api/outplayed router
 * and on the legacy /api/sellauth + /api aliases so old links keep working
 * without duplicating any handler code.
 */
const publicRoutes: Array<{ method: "get"; path: string; handler: (req: any, res: any) => Promise<void> }> = [
  { method: "get", path: "/products", handler: handleGetProducts },
  { method: "get", path: "/products/:id", handler: handleGetSingleProduct },
  { method: "get", path: "/shop", handler: handleGetShop },
  { method: "get", path: "/categories", handler: handleGetCategories },
  { method: "get", path: "/status", handler: handleGetStatus },
  { method: "get", path: "/reviews", handler: handleGetReviews },
];

for (const route of publicRoutes) {
  const handlers = [rateLimiter(120, 60_000), route.handler];
  router.get(route.path, ...handlers);
  legacyAliasRouter.get(route.path, ...handlers);
}

export { router as publicRouter, legacyAliasRouter };
