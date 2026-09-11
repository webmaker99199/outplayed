import { config } from "../config.js";

/**
 * Presentation helpers that map raw SellAuth payloads into the shapes the
 * frontend expects. Behavior is preserved from the original monolith; only
 * the location is new.
 */

/** Map a SellAuth product status into a { type, text, color, lastUpdatedAt } object. */
export function parseSellAuthStatus(p: any) {
  const text =
    p.status_text && typeof p.status_text === "string" && p.status_text.trim()
      ? p.status_text.trim()
      : "Undetected";
  const lower = text.toLowerCase();
  let type = "undetected";

  if (
    lower.includes("undetect") ||
    lower.includes("working") ||
    lower.includes("operational") ||
    lower.includes("safe")
  ) {
    type = "undetected";
  } else if (
    lower.includes("detect") ||
    lower.includes("banned") ||
    lower.includes("risky")
  ) {
    type = "down";
  } else if (
    lower.includes("updat") ||
    lower.includes("patch") ||
    lower.includes("maint")
  ) {
    type = "updating";
  } else if (lower.includes("test")) {
    type = "testing";
  } else if (
    lower.includes("down") ||
    lower.includes("offline") ||
    lower.includes("disabled")
  ) {
    type = "down";
  } else if (p.status_color) {
    const hex = String(p.status_color).toLowerCase();
    if (
      hex.includes("2ed573") ||
      hex.includes("22c55e") ||
      hex.includes("00ff") ||
      hex.includes("4ade80") ||
      hex.includes("00c853")
    ) {
      type = "undetected";
    } else if (
      hex.includes("ff9f43") ||
      hex.includes("f59e0b") ||
      hex.includes("eab308") ||
      hex.includes("ffa500") ||
      hex.includes("ffb300")
    ) {
      type = "updating";
    } else if (
      hex.includes("f90000") ||
      hex.includes("ff4d4f") ||
      hex.includes("ef4444") ||
      hex.includes("ff0000") ||
      hex.includes("dc2626") ||
      hex.includes("d50000")
    ) {
      type = "down";
    } else if (
      hex.includes("3b82f6") ||
      hex.includes("60a5fa") ||
      hex.includes("00bfff") ||
      hex.includes("74a3ff")
    ) {
      type = "testing";
    }
  }

  return {
    type,
    text,
    color: p.status_color || null,
    lastUpdatedAt: p.updated_at ? new Date(p.updated_at).getTime() : null,
  };
}

/** Map a raw SellAuth product into the standardized product shape the storefront consumes. */
export function mapProductToStandard(p: any, categoriesMap?: Map<any, any>) {
  const images =
    p.images && p.images.length
      ? p.images.map((img: any) =>
          typeof img === "string"
            ? img
            : img.url ||
              `https://api.sellauth.com/storage/images/${img.id || img.cloudflare_image_id}.webp`
        )
      : p.image
        ? [p.image]
        : [];

  const category =
    p.category ||
    (categoriesMap && categoriesMap.get(p.category_id)) ||
    { id: p.category_id || 1, name: "General" };

  const plans = p.variants
    ? p.variants.map((v: any) => ({
        id: v.id,
        label: v.name || v.label,
        description: v.description || null,
        price: Number(v.price || 0),
        stock: v.stock ?? null,
      }))
    : p.plans || [];

  const statusObj = parseSellAuthStatus(p);

  const rawBadges = p.product_badges || p.badges || (p.badge ? [p.badge] : []);
  const badges = Array.isArray(rawBadges)
    ? rawBadges.map((b: any) => ({
        id: b.id,
        label: b.label || b.text || (typeof b === "string" ? b : "Special"),
        icon: b.icon || "far fa-star",
        color: b.color || "#003eff",
        show_on_card: b.show_on_card !== false,
        show_on_page: b.show_on_page !== false,
      }))
    : [];

  return {
    ...p,
    id: p.id,
    shop_id: p.shop_id || Number(config.shopId),
    name: p.name,
    path: p.path || String(p.id),
    description: p.description || "",
    visibility: p.visibility || "public",
    category,
    images,
    image: images[0] || null,
    tabs: p.product_tabs || p.tabs || [],
    product_tabs: p.product_tabs || p.tabs || [],
    plans,
    badges,
    product_badges: badges,
    badge: badges[0] || null,
    badge_text: badges[0]?.label || p.badge_text || null,
    badge_color: badges[0]?.color || p.badge_color || null,
    status: statusObj,
    status_text: p.status_text,
    status_color: p.status_color,
    updated_at: p.updated_at,
  };
}

/**
 * Strip sensitive internal fields from shop objects before sending them to
 * the browser. Never send webhooks, tokens, or subscription internals.
 */
export function sanitizeShopData(rawShop: any) {
  if (!rawShop || typeof rawShop !== "object") return rawShop;
  const safeShop = { ...rawShop };

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

/** Fallback reviews shown when the SellAuth feedbacks API is unavailable. */
export const defaultReviews = [
  {
    id: 1,
    rating: 5,
    message:
      "Hands down the cleanest and most responsive experience I've used. Instant setup and zero issues so far!",
    author: { name: "Vortex" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
  },
  {
    id: 2,
    rating: 5,
    message:
      "Customer support on Discord helped me set everything up within minutes. Completely undetected and smooth.",
    author: { name: "Kyro" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 5,
  },
  {
    id: 3,
    rating: 5,
    message:
      "Instant key delivery right after crypto payment. The feature set is unmatched, definitely renewing next month.",
    author: { name: "ShadowPulse" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 8,
  },
  {
    id: 4,
    rating: 5,
    message:
      "Top tier performance with zero frame drops. Very easy configuration and frequent safety updates.",
    author: { name: "AeroX" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 11,
  },
  {
    id: 5,
    rating: 5,
    message:
      "Best undetected software on the market right now. Simple instructions and working flawlessly on latest build.",
    author: { name: "Matrix99" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 14,
  },
  {
    id: 6,
    rating: 5,
    message:
      "Vouching 100%. Was skeptical at first but after 2 weeks of intense games without any flags, I am hooked.",
    author: { name: "Nexus" },
    createdAt: Date.now() - 1000 * 60 * 60 * 24 * 18,
  },
];
