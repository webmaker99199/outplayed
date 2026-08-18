import { Router } from "express";
import { config } from "../config.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import { sanitizeCart, isValidEmail, sanitizeShortString } from "../utils/validation.js";
import * as sellauth from "../services/sellauth.js";

/**
 * Checkout routes (canonical namespace: /api/sellauth/*).
 *
 * - GET /altcha proxies the SellAuth challenge and always returns valid JSON.
 * - POST /checkout validates + allowlists the payload server-side, enforces
 *   the shopId, and proxies to SellAuth. Checkout behavior is unchanged.
 */

const router = Router();

/** GET /altcha — SellAuth verification challenge (valid JSON, application/json). */
router.get("/altcha", rateLimiter(60, 60_000), async (req, res) => {
  try {
    const data = await sellauth.getAltchaChallenge();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Verification service temporarily unavailable" });
  }
});

/** POST /checkout — secure checkout proxy. */
router.post("/checkout", rateLimiter(20, 60_000), async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Invalid checkout request body" });
    }

    // Explicitly allowlist and sanitize cart items.
    const sanitizedCart = sanitizeCart(req.body.cart);
    if (sanitizedCart.length === 0) {
      return res.status(400).json({ error: "Cart is empty or contains invalid items" });
    }

    // Validate email if present.
    let sanitizedEmail: string | undefined;
    if (req.body.email && typeof req.body.email === "string") {
      if (!isValidEmail(req.body.email)) {
        return res.status(400).json({ error: "Please enter a valid email address" });
      }
      sanitizedEmail = req.body.email.trim();
    }

    // ALTCHA: prefer the client-provided token, otherwise solve server-side
    // as a last resort (the storefront widget normally submits a token).
    let altcha = req.body.altcha;
    if (!altcha || typeof altcha !== "string" || altcha.length < 20) {
      altcha = await sellauth.getOrSolveAltcha();
    }

    // Construct a clean, allowlisted payload with a server-authoritative shopId.
    const cleanCheckoutPayload: Record<string, unknown> = {
      cart: sanitizedCart,
      shopId: Number(config.shopId),
      altcha: typeof altcha === "string" ? altcha : "",
    };
    if (sanitizedEmail) cleanCheckoutPayload.email = sanitizedEmail;

    const coupon = sanitizeShortString(req.body.coupon);
    if (coupon) cleanCheckoutPayload.coupon = coupon;

    const gateway = sanitizeShortString(req.body.gateway);
    if (gateway) cleanCheckoutPayload.gateway = gateway;

    if (typeof req.body.customFields === "object" && req.body.customFields !== null && !Array.isArray(req.body.customFields)) {
      cleanCheckoutPayload.customFields = req.body.customFields;
    }

    const { status, data } = await sellauth.createCheckout(cleanCheckoutPayload);
    res.status(status).json(data);
  } catch (e) {
    console.error("Checkout error:", e);
    res.status(500).json({ error: "Payment gateway communication error. Please try again." });
  }
});

export { router as checkoutRouter };
