import path from "path";
import fs from "fs";

/**
 * Local fallback data used when the SellAuth API is unreachable. This mirrors
 * the previous behavior: the storefront keeps serving sensible data instead of
 * erroring when the upstream API is temporarily down.
 */

// Find a data file in any of the locations the app may be running from
// (project root, dist/, public/, or the serverless bundle root).
function findDataFile(filename: string): string | null {
  const candidates = [
    path.join(process.cwd(), filename),
    path.resolve(filename),
    path.join(process.cwd(), "dist", filename),
    path.join(process.cwd(), "public", filename),
  ];
  // `__dirname` only exists in CommonJS. The Vercel/Netlify serverless bundles
  // run as ESM, where referencing it throws, so only add these when present.
  if (typeof __dirname !== "undefined") {
    candidates.push(
      path.join(__dirname, "..", filename),
      path.join(__dirname, filename),
      path.join(__dirname, "public", filename)
    );
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return null;
}

function readJsonFile(filename: string): unknown | null {
  const file = findDataFile(filename);
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${filename}:`, e);
    return null;
  }
}

/** Local product data used when the SellAuth API is unreachable. */
export function loadFallbackProducts(): any[] {
  const fromSellAuth = readJsonFile("sellauth_products.json") as { data?: any[] } | null;
  if (Array.isArray(fromSellAuth?.data) && fromSellAuth.data.length > 0) {
    return fromSellAuth.data;
  }
  const fromProducts = readJsonFile("products.json") as { data?: { products?: any[] } } | null;
  if (Array.isArray(fromProducts?.data?.products) && fromProducts.data.products.length > 0) {
    return fromProducts.data.products;
  }
  return [];
}

/** Local shop data used when the SellAuth API is unreachable. */
export function loadFallbackShop(): any {
  const parsed = readJsonFile("shop.json");
  if (parsed && typeof parsed === "object") return parsed;
  return {
    id: 250261,
    name: "outplayed",
    subdomain: "outplayed",
    currency: "USD",
    products_sold: 314,
    total_feedbacks: 252,
    average_rating: "4.90",
  };
}
