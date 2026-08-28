import { Router } from "express";
import { config } from "../config.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import { safeError } from "../middleware/errorHandler.js";
import * as sellauth from "../services/sellauth.js";
import { loadFallbackProducts, loadFallbackShop } from "../utils/fallback.js";
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

async function getProductsWithCategories() {
  const [rawList, categories] = await Promise.all([
    sellauth.getProducts(),
    sellauth.getCategories(),
  ]);
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
    console.error("handleGetProducts error:", e);
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

    res.json({ ok: true, data: { product: mapProductToStandard(p) } });
  } catch (e) {
    console.error("handleGetSingleProduct error:", e);
    res.status(500).json({ ok: false, error: "Unable to retrieve product" });
  }
}

async function handleGetShop(req: any, res: any) {
  try {
    let shopObj: any = null;
    try {
      shopObj = await sellauth.getShop();
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
      shopObj.privacyPolicy = shopObj.privacy_policy || shopObj.privacyPolicy;
      shopObj.refundPolicy = shopObj.refund_policy || shopObj.refundPolicy;
      shopObj.termsOfService = shopObj.terms || shopObj.termsOfService;
    }
    res.json({ ok: true, data: { shop: shopObj } });
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
    let list: any[] = [];
    try {
      list = await sellauth.getFeedbacks();
    } catch {
      list = [];
    }
    if (list.length > 0) {
      const mapped = list.map((f: any, idx: number) => ({
        id: f.id || idx + 1,
        rating: f.rating || 5,
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
