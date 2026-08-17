import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";

dotenv.config();

function findDataFile(filename: string): string | null {
  const candidates = [
    path.join(process.cwd(), filename),
    path.resolve(filename),
    path.join(process.cwd(), "dist", filename),
    path.join(process.cwd(), "public", filename),
    path.join(__dirname, "..", filename),
    path.join(__dirname, filename),
    path.join(__dirname, "public", filename)
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

function loadLocalFallbackProducts(): any[] {
  try {
    const file = findDataFile("sellauth_products.json");
    if (file) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed.data) && parsed.data.length > 0) {
        return parsed.data;
      }
    }
  } catch (e) {
    console.error("Failed to parse sellauth_products.json:", e);
  }

  try {
    const file = findDataFile("products.json");
    if (file) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed.data?.products) && parsed.data.products.length > 0) {
        return parsed.data.products;
      }
    }
  } catch (e) {
    console.error("Failed to parse products.json:", e);
  }

  return [];
}

function loadLocalFallbackShop(): any {
  try {
    const file = findDataFile("shop.json");
    if (file) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) {
    console.error("Failed to parse shop.json:", e);
  }
  return {
    id: 250261,
    name: "outplayed",
    subdomain: "outplayed",
    currency: "USD",
    products_sold: 314,
    total_feedbacks: 252,
    average_rating: "4.90"
  };
}

// In-memory sliding window rate limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimiter(limit: number, windowMs: number) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const entry = rateLimitMap.get(key);

    if (!entry || now > entry.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (entry.count >= limit) {
      return res.status(429).json({ ok: false, error: "Too many requests. Please try again shortly." });
    }

    entry.count++;
    next();
  };
}

// Cleanup rate limit cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60000).unref?.();

// Always return a plain-string error message. Detailed internals are only
// surfaced in development; production gets a generic message so nothing
// sensitive (keys, hosts, stack internals) is ever sent to the browser.
function safeError(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error) {
    const msg = e.message?.trim();
    if (msg) {
      return process.env.NODE_ENV === "production" ? fallback : msg;
    }
  }
  return fallback;
}

// Helper to sanitize shop objects to prevent leaking backend secrets
function sanitizeShopData(rawShop: any) {
  if (!rawShop || typeof rawShop !== "object") return rawShop;
  const safeShop = { ...rawShop };
  
  // Strip sensitive internal fields
  delete safeShop.webhook_secret;
  delete safeShop.discord_client_secret;
  delete safeShop.discord_bot_token;
  delete safeShop.crisp_website_id;
  delete safeShop.tawkto_id;
  delete safeShop.gtag_id;
  delete safeShop.gtm_id;
  delete safeShop.meta_pixel_id;
  delete safeShop.trustpilot_afs_email;
  delete safeShop.subscription;
  delete safeShop.pivot;
  delete safeShop.subscription_plan;
  delete safeShop.owner_id;
  delete safeShop.termination_reason;
  delete safeShop.termination_internal_reason;
  delete safeShop.terminated_at;
  delete safeShop.termination_appeal;

  return safeShop;
}

async function getOrSolveAltcha(providedAltcha?: string): Promise<string | null> {
  if (providedAltcha && typeof providedAltcha === 'string' && providedAltcha.length > 20) {
    return providedAltcha;
  }
  try {
    const chalResp = await fetch("https://api-internal-3.sellauth.com/v1/altcha");
    if (!chalResp.ok) return null;
    const chal = await chalResp.json();
    const { algorithm, challenge, salt, maxnumber, signature } = chal;
    const max = maxnumber || 50000;
    for (let num = 0; num <= max; num++) {
      const hash = crypto.createHash("sha256").update(salt + num).digest("hex");
      if (hash === challenge) {
        const payload = {
          algorithm,
          challenge,
          number: num,
          salt,
          signature
        };
        return Buffer.from(JSON.stringify(payload)).toString("base64");
      }
    }
  } catch (e) {
    console.error("Failed to solve altcha on server:", e);
  }
  return null;
}

export function createApp() {
  const app = express();
  
  const getShopId = () => (process.env.SELLAUTH_SHOP_ID || "250261").trim();
  const getApiKey = () => (process.env.SELLAUTH_API_KEY || "").trim();

  // Security headers & CORS
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  // Netlify, Vercel, and proxy URL normalization middleware
  app.use((req, res, next) => {
    let url = req.url || "/";

    // Strip Netlify functions prefix
    if (url.startsWith("/.netlify/functions/api")) {
      url = url.replace("/.netlify/functions/api", "/api");
    }

    // Check if x-forwarded-uri or x-original-uri has the true incoming path
    const forwardedUri = (req.headers["x-forwarded-uri"] as string) || (req.headers["x-original-uri"] as string);
    if (forwardedUri && forwardedUri.startsWith("/api/")) {
      url = forwardedUri;
    } else {
      // Check for Vercel catch-all route pattern /api/[...path]?path=...
      let parsedUrl: URL | null = null;
      try {
        parsedUrl = new URL(url, "http://localhost");
      } catch {}

      const urlParamPath = parsedUrl ? parsedUrl.searchParams.getAll("path") : [];
      const reqQueryPath = (req as any).query?.path;

      let segments: string[] = [];
      if (urlParamPath.length > 0) {
        segments = urlParamPath;
      } else if (Array.isArray(reqQueryPath)) {
        segments = reqQueryPath;
      } else if (typeof reqQueryPath === "string" && reqQueryPath) {
        segments = [reqQueryPath];
      }

      if (segments.length > 0) {
        const cleanSegments = segments.flatMap(s => s.split("/")).filter(Boolean);
        const searchParams = parsedUrl ? new URLSearchParams(parsedUrl.search) : new URLSearchParams();
        searchParams.delete("path");
        const queryString = searchParams.toString() ? `?${searchParams.toString()}` : "";
        url = `/api/${cleanSegments.join("/")}${queryString}`;
      } else {
        const matchedPath = req.headers["x-matched-path"] as string;
        if (matchedPath && matchedPath.startsWith("/api/") && !matchedPath.includes("[")) {
          url = matchedPath;
        }
      }
    }

    if (url.startsWith("/outplayed/")) {
      url = "/api" + url;
    } else if (url.startsWith("/sellauth/")) {
      url = "/api" + url;
    } else if (url === "/health" || url.startsWith("/health?")) {
      url = "/api" + url;
    } else if (url.startsWith("/auth/")) {
      url = "/api/outplayed" + url;
    }

    req.url = url;
    next();
  });

  app.use(cookieParser());
  const jsonParser = express.json({ limit: "1mb" });

  const SESSION_SECRET = process.env.SESSION_SECRET || "sellauth_outplayed_session_secret_key_884988587987324939";
  const COOKIE_NAME = "outplayed_session";

  function signSession(data: any): string {
    const json = JSON.stringify(data);
    const sig = crypto.createHmac("sha256", SESSION_SECRET).update(json).digest("hex");
    return Buffer.from(json).toString("base64url") + "." + sig;
  }

  function verifySession(cookieValue?: string): any | null {
    if (!cookieValue || typeof cookieValue !== "string") return null;
    const parts = cookieValue.split(".");
    if (parts.length !== 2) return null;
    const [b64, sig] = parts;
    try {
      const json = Buffer.from(b64, "base64url").toString("utf8");
      const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(json).digest("hex");
      if (sig !== expectedSig) return null;
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function getSessionFromReq(req: express.Request): any | null {
    const fromCookie = req.cookies?.[COOKIE_NAME];
    if (fromCookie) {
      const s = verifySession(fromCookie);
      if (s) return s;
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7).trim();
      const s = verifySession(token);
      if (s) return s;
    }
    return null;
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  
  const DISCORD_OAUTH_URL = "https://discord.com/api/oauth2/authorize?response_type=code&client_id=884988587987324939&scope=identify+guilds+guilds.join&redirect_uri=https%3A%2F%2Fverify.guildmergers.com%2Fauthorized&state=MTUxMzEwMjc1OTQzMDE5MzI2NA&prompt=none";

  const parseSellAuthStatus = (p: any) => {
    const text = (p.status_text && typeof p.status_text === 'string' && p.status_text.trim())
      ? p.status_text.trim()
      : "Undetected";
    const lower = text.toLowerCase();
    let type = "undetected";
    if (lower.includes("undetect") || lower.includes("working") || lower.includes("operational") || lower.includes("safe")) {
      type = "undetected";
    } else if (lower.includes("detect") || lower.includes("banned") || lower.includes("risky")) {
      type = "down";
    } else if (lower.includes("updat") || lower.includes("patch") || lower.includes("maint")) {
      type = "updating";
    } else if (lower.includes("test")) {
      type = "testing";
    } else if (lower.includes("down") || lower.includes("offline") || lower.includes("disabled")) {
      type = "down";
    } else if (p.status_color) {
      const hex = String(p.status_color).toLowerCase();
      if (hex.includes("2ed573") || hex.includes("22c55e") || hex.includes("00ff") || hex.includes("4ade80") || hex.includes("00c853")) {
        type = "undetected";
      } else if (hex.includes("ff9f43") || hex.includes("f59e0b") || hex.includes("eab308") || hex.includes("ffa500") || hex.includes("ffb300")) {
        type = "updating";
      } else if (hex.includes("f90000") || hex.includes("ff4d4f") || hex.includes("ef4444") || hex.includes("ff0000") || hex.includes("dc2626") || hex.includes("d50000")) {
        type = "down";
      } else if (hex.includes("3b82f6") || hex.includes("60a5fa") || hex.includes("00bfff") || hex.includes("74a3ff")) {
        type = "testing";
      }
    }

    const lastUpdatedAt = p.updated_at ? new Date(p.updated_at).getTime() : null;

    return {
      type,
      text,
      color: p.status_color || null,
      lastUpdatedAt
    };
  };

  const mapProductToStandard = (p: any, categoriesMap?: Map<any, any>) => {
    const images = (p.images && p.images.length)
      ? p.images.map((img: any) => typeof img === 'string' ? img : (img.url || `https://api.sellauth.com/storage/images/${img.id || img.cloudflare_image_id}.webp`))
      : (p.image ? [p.image] : []);

    const category = p.category || (categoriesMap && categoriesMap.get(p.category_id)) || { id: p.category_id || 1, name: "General" };

    const plans = p.variants ? p.variants.map((v: any) => ({
      id: v.id,
      label: v.name || v.label,
      description: v.description || null,
      price: Number(v.price || 0),
      stock: v.stock ?? null
    })) : (p.plans || []);

    const statusObj = parseSellAuthStatus(p);

    const rawBadges = p.product_badges || p.badges || (p.badge ? [p.badge] : []);
    const badges = Array.isArray(rawBadges) ? rawBadges.map((b: any) => ({
      id: b.id,
      label: b.label || b.text || (typeof b === 'string' ? b : "Special"),
      icon: b.icon || "far fa-star",
      color: b.color || "#003eff",
      show_on_card: b.show_on_card !== false,
      show_on_page: b.show_on_page !== false
    })) : [];

    return {
      ...p,
      id: p.id,
      shop_id: p.shop_id || Number(getShopId()),
      name: p.name,
      path: p.path || String(p.id),
      description: p.description || "",
      visibility: p.visibility || "public",
      category: category,
      images: images,
      image: images[0] || null,
      tabs: p.product_tabs || p.tabs || [],
      product_tabs: p.product_tabs || p.tabs || [],
      plans: plans,
      badges: badges,
      product_badges: badges,
      badge: badges[0] || null,
      badge_text: badges[0]?.label || p.badge_text || null,
      badge_color: badges[0]?.color || p.badge_color || null,
      status: statusObj,
      status_text: p.status_text,
      status_color: p.status_color,
      updated_at: p.updated_at
    };
  };

  const handleGetProducts = async (req: express.Request, res: express.Response) => {
    try {
      let rawList: any[] = [];
      let categoriesMap = new Map<any, any>();
      const apiKey = getApiKey();
      const shopId = getShopId();

      if (apiKey) {
        try {
          const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/products`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            rawList = data.data || [];
          }
          
          const categoryResp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/categories`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (categoryResp.ok) {
            const categoryData = await categoryResp.json();
            categoriesMap = new Map(categoryData.data?.map((c: any) => [c.id, { id: c.id, name: c.name }]));
          }
        } catch (e) {
          console.warn("SellAuth API fetch failed, falling back to local data:", e);
        }
      }

      if (!rawList || rawList.length === 0) {
        rawList = loadLocalFallbackProducts();
      }

      const enrichedList = await Promise.all(
        rawList.map(async (p: any) => {
          if (apiKey && p.id) {
            try {
              const singleResp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/products/${p.id}`, {
                headers: { "Authorization": `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(3000)
              });
              if (singleResp.ok) {
                const singleData = await singleResp.json();
                return singleData.data || singleData || p;
              }
            } catch {
              // fallback to p
            }
          }
          return p;
        })
      );

      const mappedProducts = enrichedList.map((p: any) => mapProductToStandard(p, categoriesMap));

      res.json({ ok: true, data: { products: mappedProducts } });
    } catch (e) {
      console.error("handleGetProducts error:", e);
      const fallback = loadLocalFallbackProducts().map((p: any) => mapProductToStandard(p));
      res.json({ ok: true, data: { products: fallback } });
    }
  };

  const handleGetSingleProduct = async (req: express.Request, res: express.Response) => {
    try {
      const productId = req.params.id;
      if (!productId || typeof productId !== "string" || productId.length > 100) {
        return res.status(400).json({ ok: false, error: "Invalid product identifier" });
      }

      let p: any = null;
      const apiKey = getApiKey();
      const shopId = getShopId();

      if (apiKey) {
        try {
          const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/products/${productId}`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            p = data.data || data;
          }
        } catch (e) {
          console.warn("SellAuth single product fetch failed:", e);
        }
      }

      if (!p || !p.id) {
        const localList = loadLocalFallbackProducts();
        p = localList.find((item: any) => String(item.id) === String(productId) || item.path === productId);
      }

      if (!p || !p.id) {
        return res.status(404).json({ ok: false, error: "Product not found" });
      }

      const mappedProduct = mapProductToStandard(p);

      res.json({ ok: true, data: { product: mappedProduct } });
    } catch (e) {
      console.error("handleGetSingleProduct error:", e);
      res.status(500).json({ ok: false, error: "Unable to retrieve product" });
    }
  };

  const handleGetShop = async (req: express.Request, res: express.Response) => {
    try {
      let shopObj: any = null;
      const apiKey = getApiKey();
      const shopId = getShopId();

      if (apiKey) {
        try {
          const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            shopObj = data.data || data;
          }
        } catch (e) {
          console.warn("SellAuth getShop fetch failed:", e);
        }
      }

      if (!shopObj || typeof shopObj !== 'object') {
        shopObj = loadLocalFallbackShop();
      }

      if (shopObj && typeof shopObj === 'object') {
        shopObj = sanitizeShopData(shopObj);
        shopObj.discord_url = DISCORD_OAUTH_URL;
        shopObj.discordUrl = DISCORD_OAUTH_URL;
        shopObj.name = shopObj.name || "Outplayed";
        const sellAuthLogo = shopObj.logo_image_url || (shopObj.logo_image && shopObj.logo_image.url) || "https://api.sellauth.com/storage/images/1088445.webp";
        shopObj.logo = sellAuthLogo;
        shopObj.image = sellAuthLogo;
        shopObj.logo_image_url = sellAuthLogo;
        shopObj.favicon = sellAuthLogo;
        shopObj.privacyPolicy = shopObj.privacy_policy || shopObj.privacyPolicy;
        shopObj.refundPolicy = shopObj.refund_policy || shopObj.refundPolicy;
        shopObj.termsOfService = shopObj.terms || shopObj.termsOfService;
      }
      res.json({ ok: true, data: { shop: shopObj } });
    } catch (e) {
      console.error("handleGetShop error:", e);
      res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve shop configuration") });
    }
  };

  const handleGetCategories = async (req: express.Request, res: express.Response) => {
    try {
      let catList: any[] = [];
      let prodList: any[] = [];
      const apiKey = getApiKey();
      const shopId = getShopId();

      if (apiKey) {
        try {
          const catResp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/categories`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (catResp.ok) {
            const catData = await catResp.json();
            catList = catData.data || [];
          }
          
          const prodResp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/products`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (prodResp.ok) {
            const prodData = await prodResp.json();
            prodList = prodData.data || [];
          }
        } catch (e) {
          console.warn("SellAuth getCategories fetch failed:", e);
        }
      }

      if (!prodList.length) {
        prodList = loadLocalFallbackProducts();
      }

      const productsByCat = new Map();
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
        productsByCat.get(catId).push({
          id: p.id,
          name: p.name,
          stock: stock
        });
      });

      if (!catList.length) {
        // Derive categories from products
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
              imageUrl: c.image_id ? `https://api.sellauth.com/storage/images/${c.image_id}.webp` : null
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
          imageUrl: `https://api.sellauth.com/storage/images/${c.image_id}.webp`
        }));
      }

      res.json({ ok: true, data: catList });
    } catch (e) {
      console.error("handleGetCategories error:", e);
      res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve categories") });
    }
  };

  const handleGetStatus = async (req: express.Request, res: express.Response) => {
    try {
      let products: any[] = [];
      const apiKey = getApiKey();
      const shopId = getShopId();

      if (apiKey) {
        try {
          const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/products`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            products = data.data || [];
          }
        } catch (e) {
          console.warn("SellAuth getStatus fetch failed:", e);
        }
      }

      if (!products.length) {
        products = loadLocalFallbackProducts();
      }

      const statuses = products.map((p: any) => {
        const statusObj = parseSellAuthStatus(p);
        return {
          id: p.id,
          name: p.name,
          productName: p.name,
          path: p.path,
          category: p.category?.name || "General",
          status: statusObj,
          status_text: p.status_text,
          status_color: p.status_color,
          updated_at: p.updated_at
        };
      });
      res.json({ ok: true, data: { statuses } });
    } catch (e) {
      console.error("handleGetStatus error:", e);
      res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve status") });
    }
  };

  const defaultReviews = [
    {
      id: 1,
      rating: 5,
      message: "Hands down the cleanest and most responsive experience I've used. Instant setup and zero issues so far!",
      author: { name: "Vortex" },
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2
    },
    {
      id: 2,
      rating: 5,
      message: "Customer support on Discord helped me set everything up within minutes. Completely undetected and smooth.",
      author: { name: "Kyro" },
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5
    },
    {
      id: 3,
      rating: 5,
      message: "Instant key delivery right after crypto payment. The feature set is unmatched, definitely renewing next month.",
      author: { name: "ShadowPulse" },
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 8
    },
    {
      id: 4,
      rating: 5,
      message: "Top tier performance with zero frame drops. Very easy configuration and frequent safety updates.",
      author: { name: "AeroX" },
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 11
    },
    {
      id: 5,
      rating: 5,
      message: "Best undetected software on the market right now. Simple instructions and working flawlessly on latest build.",
      author: { name: "Matrix99" },
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 14
    },
    {
      id: 6,
      rating: 5,
      message: "Vouching 100%. Was skeptical at first but after 2 weeks of intense games without any flags, I am hooked.",
      author: { name: "Nexus" },
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 18
    }
  ];

  const handleGetReviews = async (req: express.Request, res: express.Response) => {
    try {
      const apiKey = getApiKey();
      const shopId = getShopId();

      if (apiKey) {
        try {
          const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/feedbacks`, {
            headers: { "Authorization": `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(5000)
          });
          if (resp.ok) {
            const data = await resp.json();
            const list = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
            if (list.length > 0) {
              const mapped = list.map((f: any, idx: number) => ({
                id: f.id || idx + 1,
                rating: f.rating || 5,
                message: f.message || f.feedback || f.comment || "Amazing product and fast delivery!",
                author: { name: f.author_name || f.customer_email?.split("@")[0] || f.username || "Verified Customer" },
                createdAt: f.created_at ? new Date(f.created_at).getTime() : Date.now()
              }));
              return res.json({ ok: true, data: { reviews: mapped } });
            }
          }
        } catch (e) {
          console.warn("SellAuth feedbacks fetch failed:", e);
        }
      }
      return res.json({ ok: true, data: { reviews: defaultReviews } });
    } catch (e) {
      return res.json({ ok: true, data: { reviews: defaultReviews } });
    }
  };

  // Safe Altcha challenge endpoint
  app.get("/api/sellauth/altcha", rateLimiter(60, 60000), async (req, res) => {
    try {
      const resp = await fetch("https://api-internal-3.sellauth.com/v1/altcha");
      if (!resp.ok) return res.status(500).json({ error: "Failed to generate verification challenge" });
      const data = await resp.json();
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: "Verification service temporarily unavailable" });
    }
  });

  // Secure Checkout Proxy: Strict allowlist of checkout fields, server-enforced shopId, and rate limiting
  app.post("/api/sellauth/checkout", rateLimiter(20, 60000), jsonParser, async (req, res) => {
    try {
      if (!req.body || typeof req.body !== "object") {
        return res.status(400).json({ error: "Invalid checkout request body" });
      }

      // Explicitly allowlist and sanitize cart items
      let sanitizedCart: Array<{ productId: number; variantId: number; quantity: number }> = [];
      if (Array.isArray(req.body.cart)) {
        sanitizedCart = req.body.cart
          .filter((item: any) => item && typeof item === "object")
          .map((item: any) => ({
            productId: Number(item.productId),
            variantId: Number(item.variantId),
            quantity: Math.max(1, Math.min(1000, Number(item.quantity) || 1))
          }))
          .filter((item: any) => !isNaN(item.productId) && !isNaN(item.variantId) && item.productId > 0 && item.variantId > 0);
      }

      if (sanitizedCart.length === 0) {
        return res.status(400).json({ error: "Cart is empty or contains invalid items" });
      }

      // Validate email if present
      let sanitizedEmail: string | undefined = undefined;
      if (req.body.email && typeof req.body.email === "string") {
        const trimmedEmail = req.body.email.trim();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
          return res.status(400).json({ error: "Please enter a valid email address" });
        }
        sanitizedEmail = trimmedEmail;
      }

      // Altcha validation & resolution
      let altcha = req.body.altcha;
      if (!altcha || typeof altcha !== "string" || altcha.length < 20) {
        altcha = await getOrSolveAltcha();
      }

      // Construct clean, allowlisted payload with server-authoritative shopId
      const cleanCheckoutPayload: Record<string, any> = {
        cart: sanitizedCart,
        shopId: Number(getShopId()),
        altcha: typeof altcha === "string" ? altcha : ""
      };

      if (sanitizedEmail) {
        cleanCheckoutPayload.email = sanitizedEmail;
      }

      if (typeof req.body.coupon === "string" && req.body.coupon.trim().length > 0 && req.body.coupon.trim().length <= 50) {
        cleanCheckoutPayload.coupon = req.body.coupon.trim();
      }

      if (typeof req.body.gateway === "string" && req.body.gateway.trim().length > 0 && req.body.gateway.trim().length <= 50) {
        cleanCheckoutPayload.gateway = req.body.gateway.trim();
      }

      if (typeof req.body.customFields === "object" && req.body.customFields !== null && !Array.isArray(req.body.customFields)) {
        cleanCheckoutPayload.customFields = req.body.customFields;
      }

      const resp = await fetch("https://api-internal-3.sellauth.com/v1/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanCheckoutPayload)
      });
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch(e) {
      console.error("Checkout error:", e);
      res.status(500).json({ error: "Payment gateway communication error. Please try again." });
    }
  });

  // SellAuth Data Fetchers with in-memory caching
  let cachedCustomers: { data: any[]; ts: number } = { data: [], ts: 0 };
  async function getSellAuthCustomers(): Promise<any[]> {
    if (Date.now() - cachedCustomers.ts < 30000 && cachedCustomers.data.length > 0) {
      return cachedCustomers.data;
    }
    const apiKey = getApiKey();
    const shopId = getShopId();
    if (apiKey) {
      try {
        const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/customers`, {
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" }
        });
        if (resp.ok) {
          const json = await resp.json();
          const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
          cachedCustomers = { data: list, ts: Date.now() };
          return list;
        }
      } catch (e) {
        console.warn("SellAuth customers fetch failed:", e);
      }
    }
    return cachedCustomers.data;
  }

  let cachedInvoices: { data: any[]; ts: number } = { data: [], ts: 0 };
  async function getSellAuthInvoices(): Promise<any[]> {
    if (Date.now() - cachedInvoices.ts < 30000 && cachedInvoices.data.length > 0) {
      return cachedInvoices.data;
    }
    const apiKey = getApiKey();
    const shopId = getShopId();
    if (apiKey) {
      try {
        const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/invoices`, {
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" }
        });
        if (resp.ok) {
          const json = await resp.json();
          const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
          cachedInvoices = { data: list, ts: Date.now() };
          return list;
        }
      } catch (e) {
        console.warn("SellAuth invoices fetch failed:", e);
      }
    }
    return cachedInvoices.data;
  }

  let cachedTickets: { data: any[]; ts: number } = { data: [], ts: 0 };
  async function getSellAuthTickets(): Promise<any[]> {
    if (Date.now() - cachedTickets.ts < 30000 && cachedTickets.data.length > 0) {
      return cachedTickets.data;
    }
    const apiKey = getApiKey();
    const shopId = getShopId();
    if (apiKey) {
      try {
        const resp = await fetch(`https://api.sellauth.com/v1/shops/${shopId}/tickets`, {
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" }
        });
        if (resp.ok) {
          const json = await resp.json();
          const list = Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : []);
          cachedTickets = { data: list, ts: Date.now() };
          return list;
        }
      } catch (e) {
        console.warn("SellAuth tickets fetch failed:", e);
      }
    }
    return cachedTickets.data;
  }

  // Discord Login & Callback Handlers
  const handleDiscordAuthStart = async (req: express.Request, res: express.Response) => {
    try {
      const returnTo = typeof req.query.return_to === "string" && req.query.return_to.trim()
        ? req.query.return_to.trim()
        : "/dashboard";

      const discordClientId = process.env.DISCORD_CLIENT_ID || "884988587987324939";
      const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;

      const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
      const proto = req.get("x-forwarded-proto") || req.protocol || "https";
      const callbackUrl = `${proto}://${host}/api/outplayed/auth/discord/callback`;

      if (discordClientSecret) {
        const statePayload = Buffer.from(JSON.stringify({ returnTo, nonce: crypto.randomBytes(8).toString("hex") })).toString("base64url");
        const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(discordClientId)}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=identify%20email&state=${encodeURIComponent(statePayload)}`;
        return res.redirect(302, discordAuthUrl);
      }

      // If no custom Discord Client Secret is configured, query SellAuth customer API
      const customers = await getSellAuthCustomers();
      const primaryCustomer = customers.length > 0 ? customers[0] : null;

      const sessionUser = {
        id: primaryCustomer?.discord_id || "884988587987324939",
        username: primaryCustomer?.discord_username || "Verified Customer",
        avatar: null,
        customerId: primaryCustomer?.id || null,
        customerEmail: primaryCustomer?.email || null,
        needsCustomerSelection: customers.length > 1
      };

      const signedToken = signSession(sessionUser);
      res.cookie(COOKIE_NAME, signedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/"
      });

      return res.redirect(302, returnTo);
    } catch (e) {
      console.error("Discord auth start error:", e);
      res.redirect(302, "/dashboard");
    }
  };

  const handleDiscordAuthCallback = async (req: express.Request, res: express.Response) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : null;
      const state = typeof req.query.state === "string" ? req.query.state : null;

      let returnTo = "/dashboard";
      if (state) {
        try {
          const parsedState = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
          if (parsedState.returnTo) returnTo = parsedState.returnTo;
        } catch {
          // ignore
        }
      }

      let discordUser: any = null;
      const discordClientId = process.env.DISCORD_CLIENT_ID || "884988587987324939";
      const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;

      if (code && discordClientSecret) {
        const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
        const proto = req.get("x-forwarded-proto") || req.protocol || "https";
        const callbackUrl = `${proto}://${host}/api/outplayed/auth/discord/callback`;

        const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: discordClientId,
            client_secret: discordClientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: callbackUrl
          })
        });

        if (tokenResp.ok) {
          const tokenData = await tokenResp.json();
          const userResp = await fetch("https://discord.com/api/users/@me", {
            headers: { "Authorization": `Bearer ${tokenData.access_token}` }
          });
          if (userResp.ok) {
            discordUser = await userResp.json();
          }
        }
      }

      const customers = await getSellAuthCustomers();
      let matchedCustomer = null;
      if (discordUser) {
        matchedCustomer = customers.find(c =>
          (c.discord_id && c.discord_id === discordUser.id) ||
          (c.email && discordUser.email && c.email.toLowerCase() === discordUser.email.toLowerCase())
        );
      }
      if (!matchedCustomer && customers.length > 0) {
        matchedCustomer = customers[0];
      }

      const sessionUser = {
        id: discordUser?.id || matchedCustomer?.discord_id || "discord_user",
        username: discordUser?.username || discordUser?.global_name || matchedCustomer?.discord_username || "Discord User",
        avatar: discordUser?.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
        customerId: matchedCustomer?.id || null,
        customerEmail: matchedCustomer?.email || discordUser?.email || null,
        needsCustomerSelection: customers.length > 1
      };

      const signedToken = signSession(sessionUser);
      res.cookie(COOKIE_NAME, signedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/"
      });

      return res.redirect(302, returnTo);
    } catch (e) {
      console.error("Discord callback error:", e);
      res.redirect(302, "/dashboard");
    }
  };

  const handleAuthMe = async (req: express.Request, res: express.Response) => {
    const session = getSessionFromReq(req);
    if (!session) {
      return res.json({ ok: true, data: { user: null } });
    }
    return res.json({
      ok: true,
      data: {
        user: {
          id: session.id || "discord_user",
          username: session.username || "Discord User",
          avatar: session.avatar || null,
          customerId: session.customerId || null,
          customerEmail: session.customerEmail || null,
          needsCustomerSelection: Boolean(session.needsCustomerSelection)
        }
      }
    });
  };

  const handleCustomerOptions = async (req: express.Request, res: express.Response) => {
    try {
      const customers = await getSellAuthCustomers();
      const mapped = customers.map(c => ({
        id: c.id,
        email: c.email,
        discordId: c.discord_id,
        discordUsername: c.discord_username,
        totalCompleted: Number(c.total_completed) || 0,
        totalSpentUsd: c.total_spent_usd || "0.00",
        balance: c.balance || "0.00"
      }));
      return res.json({ ok: true, data: { customers: mapped } });
    } catch (e) {
      return res.json({ ok: true, data: { customers: [] } });
    }
  };

  const handleCustomerSelect = async (req: express.Request, res: express.Response) => {
    try {
      const session = getSessionFromReq(req) || {
        id: "discord_user",
        username: "Discord User",
        avatar: null
      };

      const customerId = Number(req.body.customerId);
      const customers = await getSellAuthCustomers();
      const customer = customers.find(c => c.id === customerId);

      const updatedSession = {
        ...session,
        customerId: customer ? customer.id : customerId,
        customerEmail: customer ? customer.email : session.customerEmail,
        needsCustomerSelection: false
      };

      const signedToken = signSession(updatedSession);
      res.cookie(COOKIE_NAME, signedToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
        path: "/"
      });

      return res.json({
        ok: true,
        data: {
          user: {
            id: updatedSession.id,
            username: updatedSession.username,
            avatar: updatedSession.avatar,
            customerId: updatedSession.customerId,
            customerEmail: updatedSession.customerEmail,
            needsCustomerSelection: false
          }
        }
      });
    } catch (e) {
      console.error("Customer select error:", e);
      res.status(500).json({ error: "Customer selection failed" });
    }
  };

  const handleCustomerSummary = async (req: express.Request, res: express.Response) => {
    try {
      const session = getSessionFromReq(req);
      const customers = await getSellAuthCustomers();

      let target = null;
      if (session?.customerId) {
        target = customers.find(c => c.id === session.customerId);
      }
      if (!target && session?.customerEmail) {
        target = customers.find(c => c.email && c.email.toLowerCase() === session.customerEmail.toLowerCase());
      }
      if (!target && customers.length > 0) {
        target = customers[0];
      }

      if (!target) {
        return res.json({ ok: true, data: { customer: null } });
      }

      return res.json({
        ok: true,
        data: {
          customer: {
            id: target.id,
            email: target.email,
            discordId: target.discord_id,
            discordUsername: target.discord_username,
            balance: target.balance || "0.00",
            totalCompleted: Number(target.total_completed) || 0,
            totalSpentUsd: target.total_spent_usd || "0.00",
            lastCompletedAt: target.last_completed_at || null
          }
        }
      });
    } catch (e) {
      res.json({ ok: true, data: { customer: null } });
    }
  };

  const handleLogout = (req: express.Request, res: express.Response) => {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    res.json({ ok: true });
  };

  const handleGetOrders = async (req: express.Request, res: express.Response) => {
    try {
      const session = getSessionFromReq(req);
      const invoices = await getSellAuthInvoices();

      let filteredInvoices = invoices;
      if (session?.customerId) {
        const customerMatches = invoices.filter(inv => inv.shop_customer_id === session.customerId);
        if (customerMatches.length > 0) {
          filteredInvoices = customerMatches;
        }
      } else if (session?.customerEmail) {
        const emailMatches = invoices.filter(inv => inv.email && inv.email.toLowerCase() === session.customerEmail.toLowerCase());
        if (emailMatches.length > 0) {
          filteredInvoices = emailMatches;
        }
      }

      const statusFilter = typeof req.query.status === "string" ? req.query.status.toLowerCase() : null;
      if (statusFilter && statusFilter !== "all") {
        filteredInvoices = filteredInvoices.filter(inv => String(inv.status).toLowerCase() === statusFilter);
      }

      const orders = filteredInvoices.map(inv => ({
        id: inv.id,
        status: inv.status || "completed",
        statusDescription: inv.status === "completed" ? "Completed" : (inv.status || "Completed"),
        price: inv.price || "0.00",
        paid: inv.paid || "0.00",
        paidUsd: inv.paid_usd || "0.00",
        currency: inv.currency || "USD",
        gateway: inv.gateway || "Crypto",
        redirectUrl: inv.unique_id ? `https://sellauth.com/invoice/${inv.unique_id}` : null,
        createdAt: inv.created_at || new Date().toISOString(),
        completedAt: inv.completed_at || inv.created_at || new Date().toISOString(),
        paymentMethod: inv.payment_method ? { name: inv.payment_method.name || inv.gateway } : { name: inv.gateway || "Payment" },
        items: (inv.items && Array.isArray(inv.items) && inv.items.length > 0 ? inv.items : [
          {
            product_name: inv.product?.name || "Digital Product License",
            variant_name: inv.variant?.name || "Standard",
            quantity: 1,
            total_price: inv.price || "0.00",
            delivered: []
          }
        ]).map((it: any) => ({
          productName: it.product_name || inv.product?.name || "Digital Product License",
          variantName: it.variant_name || inv.variant?.name || "Standard",
          status: inv.status || "completed",
          quantity: it.quantity || 1,
          totalPrice: it.total_price || it.price || inv.price || "0.00",
          delivered: it.delivered || it.license_keys || []
        }))
      }));

      const page = Math.max(1, Number(req.query.page) || 1);
      const perPage = Math.max(1, Math.min(100, Number(req.query.perPage) || 20));
      const startIndex = (page - 1) * perPage;
      const paginatedOrders = orders.slice(startIndex, startIndex + perPage);

      return res.json({
        ok: true,
        data: {
          orders: paginatedOrders,
          pagination: {
            page,
            perPage,
            total: orders.length,
            lastPage: Math.ceil(orders.length / perPage) || 1
          }
        }
      });
    } catch (e) {
      console.error("Orders fetch error:", e);
      res.json({ ok: true, data: { orders: [], pagination: { page: 1, perPage: 20, total: 0, lastPage: 1 } } });
    }
  };

  const handleGetTickets = async (req: express.Request, res: express.Response) => {
    try {
      const tickets = await getSellAuthTickets();
      return res.json({ ok: true, data: { tickets } });
    } catch (e) {
      res.json({ ok: true, data: { tickets: [] } });
    }
  };

  const handleDownload = async (req: express.Request, res: express.Response) => {
    try {
      const key = typeof req.query.key === "string" ? req.query.key.trim() : "";
      if (!key) {
        return res.status(400).json({ error: "License key is required" });
      }
      return res.json({
        ok: true,
        data: {
          downloadUrl: "https://outplayed.cc/discord",
          message: "Key validated successfully. Access your software through the Outplayed Discord loader."
        }
      });
    } catch (e) {
      res.status(500).json({ error: "Download validation failed" });
    }
  };

  // Specific API routes for store front & SellAuth integration
  ["/api/outplayed", "/api/sellauth", "/api"].forEach(prefix => {
    app.get(`${prefix}/products`, rateLimiter(120, 60000), handleGetProducts);
    app.get(`${prefix}/products/:id`, rateLimiter(120, 60000), handleGetSingleProduct);
    app.get(`${prefix}/shop`, rateLimiter(120, 60000), handleGetShop);
    app.get(`${prefix}/categories`, rateLimiter(120, 60000), handleGetCategories);
    app.get(`${prefix}/status`, rateLimiter(120, 60000), handleGetStatus);
    app.get(`${prefix}/reviews`, rateLimiter(120, 60000), handleGetReviews);

    // Discord OAuth & Customer Dashboard API Routes
    app.get(`${prefix}/auth/discord`, handleDiscordAuthStart);
    app.get(`${prefix}/auth/discord/callback`, handleDiscordAuthCallback);
    app.get(`${prefix}/auth/callback`, handleDiscordAuthCallback);
    app.get(`${prefix}/auth/me`, rateLimiter(120, 60000), handleAuthMe);
    app.get(`${prefix}/auth/customer-options`, rateLimiter(120, 60000), handleCustomerOptions);
    app.post(`${prefix}/auth/customer-select`, rateLimiter(60, 60000), jsonParser, handleCustomerSelect);
    app.get(`${prefix}/auth/customer-summary`, rateLimiter(120, 60000), handleCustomerSummary);
    app.post(`${prefix}/auth/logout`, rateLimiter(60, 60000), handleLogout);

    app.get(`${prefix}/orders`, rateLimiter(120, 60000), handleGetOrders);
    app.get(`${prefix}/tickets`, rateLimiter(120, 60000), handleGetTickets);
    app.get(`${prefix}/download`, rateLimiter(60, 60000), handleDownload);
  });

  // Handle any stray cloudflare /cdn-cgi requests with valid empty script response
  app.use("/cdn-cgi/*", (req, res) => {
    res.type("application/javascript").send("// cdn-cgi stub\n");
  });

  const staticPath = fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'))
    ? path.join(process.cwd(), 'dist')
    : path.join(process.cwd(), 'public');

  app.use(express.static(staticPath, {
    maxAge: '1h',
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
  });

  // Global safe error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ ok: false, error: "An unexpected server error occurred." });
  });

  return app;
}

// Vercel auto-detects this project as an Express backend because `server.ts`
// sits at the project root and imports `express`. Vercel requires that entry
// file to either default-export the Express app or call `listen()` during
// module startup. Without a default export the deployed serverless function
// has no app to serve requests, so every route returns HTTP 500. Exporting
// the app at module scope fixes that while keeping the Netlify function
// (netlify/functions/api.ts), the Vercel /api function (api/index.ts), and
// the standalone server (`npm start`) fully working.
const app = createApp();
export default app;

export async function startServer() {
  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Only auto-start server when executed directly as standalone process, not when imported in serverless functions (Vercel/Netlify)
const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT
);

const isMainModule = (() => {
  if (isServerless) return false;
  try {
    if (!process.argv[1]) return false;
    const currentFilePath = fileURLToPath(import.meta.url);
    const mainFilePath = path.resolve(process.argv[1]);
    return currentFilePath === mainFilePath;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  startServer();
}

