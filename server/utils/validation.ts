/** Centralized input validation helpers. */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_REGEX.test(value.trim());
}

export interface CartItem {
  productId: number;
  variantId: number;
  quantity: number;
}

/**
 * Sanitize a checkout cart. Only allowlist numeric ids and clamp quantity,
 * dropping any item that is missing/invalid. Never trust the client blindly.
 */
export function sanitizeCart(cart: unknown): CartItem[] {
  if (!Array.isArray(cart)) return [];
  return cart
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      productId: Number(item.productId),
      variantId: Number(item.variantId),
      quantity: Math.max(1, Math.min(1000, Number(item.quantity) || 1)),
    }))
    .filter(
      (item) =>
        !Number.isNaN(item.productId) &&
        !Number.isNaN(item.variantId) &&
        item.productId > 0 &&
        item.variantId > 0
    );
}

/** Clamp a short free-text field (coupon/gateway) or drop it. */
export function sanitizeShortString(value: unknown, maxLength = 50): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : undefined;
}

/** Parse pagination query params with sane defaults and clamps. */
export function getPagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.max(1, Math.min(100, Number(query.perPage) || 20));
  return {
    page,
    perPage,
    startIndex: (page - 1) * perPage,
    lastPage: (total: number) => Math.max(1, Math.ceil(total / perPage)),
  };
}
