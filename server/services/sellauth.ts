import crypto from "crypto";
import { config } from "../config.js";
import { createTtlCache } from "../utils/cache.js";

/**
 * Centralized SellAuth API client.
 *
 * All requests are server-side only: the API key lives in `config` (from
 * SELLAUTH_API_KEY) and is never sent to the browser. Public storefront data
 * (shop/products/categories/reviews) is memoized in a per-instance TTL cache
 * to avoid hammering SellAuth; private data (customers/invoices/tickets) is
 * cached briefly too but is always filtered per authenticated session before
 * being returned.
 */

export class SellauthError extends Error {}

const publicCache = {
  shop: createTtlCache<any>(5 * 60_000),
  products: createTtlCache<any[]>(45_000),
  categories: createTtlCache<any[]>(45_000),
  feedbacks: createTtlCache<any[]>(2 * 60_000),
  customers: createTtlCache<any[]>(30_000),
  invoices: createTtlCache<any[]>(30_000),
  tickets: createTtlCache<any[]>(30_000),
};

function shopUrl(path: string): string {
  return `${config.sellauth.apiBase}/shops/${config.shopId}${path}`;
}

async function sellauthFetch<T>(url: string, options: RequestInit = {}, timeoutMs = 5000): Promise<T> {
  const resp = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(config.sellauth.apiKey ? { Authorization: `Bearer ${config.sellauth.apiKey}` } : {}),
      ...(options.headers || {}),
    },
    signal: options.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    throw new SellauthError(`SellAuth API responded with ${resp.status}`);
  }
  return (await resp.json()) as T;
}

/** Run a cached fetch: serve from cache within TTL, otherwise fetch and store. */
async function cachedFetch<T>(key: string, ttlCache: ReturnType<typeof createTtlCache<T>>, fetchFn: () => Promise<T>): Promise<T> {
  const cached = ttlCache.get(key);
  if (cached !== undefined) return cached;
  const value = await fetchFn();
  ttlCache.set(key, value);
  return value;
}

function unwrapList(json: any): any[] {
  return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
}

function unwrapData(json: any): any {
  return json?.data ?? json;
}

/** Public storefront data -------------------------------------------------- */

export function getShop(): Promise<any> {
  return cachedFetch("shop", publicCache.shop, () =>
    sellauthFetch(shopUrl("")).then(unwrapData)
  );
}

export function getProducts(): Promise<any[]> {
  return cachedFetch("products", publicCache.products, () =>
    sellauthFetch(shopUrl("/products")).then(unwrapList)
  );
}

/** Single product is fetched fresh (product pages can be deep-linked). */
export function getProduct(id: string | number): Promise<any> {
  return sellauthFetch(shopUrl(`/products/${encodeURIComponent(String(id))}`)).then(unwrapData);
}

export function getCategories(): Promise<any[]> {
  return cachedFetch("categories", publicCache.categories, () =>
    sellauthFetch(shopUrl("/categories")).then(unwrapList)
  );
}

export function getFeedbacks(): Promise<any[]> {
  return cachedFetch("feedbacks", publicCache.feedbacks, () =>
    sellauthFetch(shopUrl("/feedbacks")).then(unwrapList)
  );
}

/** Customer/account data (always filtered per session by the routes) -------- */

export function getCustomers(): Promise<any[]> {
  return cachedFetch("customers", publicCache.customers, () =>
    sellauthFetch(shopUrl("/customers")).then(unwrapList)
  );
}

export function getInvoices(): Promise<any[]> {
  return cachedFetch("invoices", publicCache.invoices, () =>
    sellauthFetch(shopUrl("/invoices")).then(unwrapList)
  );
}

export function getTickets(): Promise<any[]> {
  return cachedFetch("tickets", publicCache.tickets, () =>
    sellauthFetch(shopUrl("/tickets")).then(unwrapList)
  );
}

/** ALTCHA + checkout -------------------------------------------------------- */

/** Proxy the SellAuth challenge endpoint (no API key involved). */
export function getAltchaChallenge(): Promise<any> {
  return sellauthFetch(`${config.sellauth.internalBase}/altcha`, {}, 5000);
}

/**
 * Use the client-provided altcha token when present; otherwise solve a fresh
 * challenge server-side. Solving is only a fallback — the storefront's ALTCHA
 * widget normally submits a pre-solved token.
 */
export async function getOrSolveAltcha(providedAltcha?: string): Promise<string | null> {
  if (providedAltcha && typeof providedAltcha === "string" && providedAltcha.length > 20) {
    return providedAltcha;
  }
  try {
    const chal = await getAltchaChallenge();
    const { algorithm, challenge, salt, maxnumber, signature } = chal;
    const max = maxnumber || 50000;
    for (let num = 0; num <= max; num++) {
      const hash = crypto.createHash("sha256").update(salt + num).digest("hex");
      if (hash === challenge) {
        const payload = { algorithm, challenge, number: num, salt, signature };
        return Buffer.from(JSON.stringify(payload)).toString("base64");
      }
    }
  } catch (e) {
    console.error("Failed to solve altcha on server:", e);
  }
  return null;
}

/** Create a checkout; returns the upstream status + parsed body unchanged. */
export async function createCheckout(payload: Record<string, unknown>): Promise<{ status: number; data: any }> {
  const resp = await fetch(`${config.sellauth.internalBase}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  return { status: resp.status, data };
}
