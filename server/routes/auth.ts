import { Router } from "express";
import { config } from "../config.js";
import { rateLimiter } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/auth.js";
import { signSession } from "../utils/session.js";
import * as sellauth from "../services/sellauth.js";
import * as discord from "../services/discord.js";

/**
 * Authentication & customer routes (canonical namespace: /api/outplayed/auth/*).
 *
 * Sessions are signed (HMAC) cookies. Customer-specific endpoints go through
 * `requireAuth`, so unauthenticated users can never read customer data.
 */

const router = Router();
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "lax" as const,
  maxAge: config.session.ttlMs,
  path: "/",
};

function setSessionCookie(res: any, session: Record<string, unknown>) {
  res.cookie(config.session.cookieName, signSession(session), SESSION_COOKIE_OPTIONS);
}

function toPublicUser(session: any) {
  return {
    id: session.id || "discord_user",
    username: session.username || "Discord User",
    avatar: session.avatar || null,
    customerId: session.customerId || null,
    customerEmail: session.customerEmail || null,
    needsCustomerSelection: Boolean(session.needsCustomerSelection),
  };
}

/** GET /auth/discord — start Discord OAuth (or the legacy verified-customer flow). */
router.get("/auth/discord", async (req, res) => {
  try {
    const returnTo =
      typeof req.query.return_to === "string" && req.query.return_to.trim()
        ? req.query.return_to.trim()
        : "/dashboard";

    if (config.discord.clientSecret) {
      const state = discord.encodeState({ returnTo, nonce: discord.randomNonce() });
      const authUrl = discord.buildDiscordAuthUrl(discord.buildCallbackUrl(req), state);
      return res.redirect(302, authUrl);
    }

    // No custom Discord app configured: fall back to the first SellAuth
    // customer (original behavior, kept for compatibility).
    const customers = await sellauth.getCustomers();
    const primaryCustomer = customers.length > 0 ? customers[0] : null;

    setSessionCookie(res, {
      id: primaryCustomer?.discord_id || "884988587987324939",
      username: primaryCustomer?.discord_username || "Verified Customer",
      avatar: null,
      customerId: primaryCustomer?.id || null,
      customerEmail: primaryCustomer?.email || null,
      needsCustomerSelection: customers.length > 1,
    });
    return res.redirect(302, returnTo);
  } catch (e) {
    console.error("Discord auth start error:", e);
    res.redirect(302, "/dashboard");
  }
});

/** GET /auth/discord/callback + /auth/callback — complete Discord OAuth. */
async function handleDiscordCallback(req: any, res: any) {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = discord.decodeState(typeof req.query.state === "string" ? req.query.state : undefined);
    const returnTo = state?.returnTo || "/dashboard";

    const discordUser = code ? await discord.getDiscordUser(code, discord.buildCallbackUrl(req)) : null;

    const customers = await sellauth.getCustomers();
    let matchedCustomer: any = null;
    if (discordUser) {
      matchedCustomer =
        customers.find(
          (c: any) =>
            (c.discord_id && c.discord_id === discordUser.id) ||
            (c.email && discordUser.email && c.email.toLowerCase() === discordUser.email.toLowerCase())
        ) || null;
    }
    if (!matchedCustomer && customers.length > 0) {
      matchedCustomer = customers[0];
    }

    setSessionCookie(res, {
      id: discordUser?.id || matchedCustomer?.discord_id || "discord_user",
      username:
        discordUser?.username ||
        discordUser?.global_name ||
        matchedCustomer?.discord_username ||
        "Discord User",
      avatar: discordUser?.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : null,
      customerId: matchedCustomer?.id || null,
      customerEmail: matchedCustomer?.email || discordUser?.email || null,
      needsCustomerSelection: customers.length > 1,
    });

    return res.redirect(302, returnTo);
  } catch (e) {
    console.error("Discord callback error:", e);
    res.redirect(302, "/dashboard");
  }
}
router.get("/auth/discord/callback", handleDiscordCallback);
router.get("/auth/callback", handleDiscordCallback);

/** GET /auth/me — current user or null (public; the frontend expects user:null when logged out). */
router.get("/auth/me", rateLimiter(120, 60_000), (req, res) => {
  const session = req.session;
  if (!session) {
    return res.json({ ok: true, data: { user: null } });
  }
  return res.json({ ok: true, data: { user: toPublicUser(session) } });
});

/** GET /auth/customer-options — customer list for account selection (auth required). */
router.get("/auth/customer-options", rateLimiter(120, 60_000), requireAuth, async (req, res) => {
  try {
    const customers = await sellauth.getCustomers();
    const mapped = customers.map((c: any) => ({
      id: c.id,
      email: c.email,
      discordId: c.discord_id,
      discordUsername: c.discord_username,
      totalCompleted: Number(c.total_completed) || 0,
      totalSpentUsd: c.total_spent_usd || "0.00",
      balance: c.balance || "0.00",
    }));
    return res.json({ ok: true, data: { customers: mapped } });
  } catch (e) {
    return res.json({ ok: true, data: { customers: [] } });
  }
});

/** POST /auth/customer-select — bind the session to a specific customer (auth required). */
router.post("/auth/customer-select", rateLimiter(60, 60_000), requireAuth, async (req, res) => {
  try {
    const session = req.session!;
    const customerId = Number(req.body?.customerId);
    const customers = await sellauth.getCustomers();
    const customer = customers.find((c: any) => c.id === customerId);

    const updatedSession = {
      ...session,
      customerId: customer ? customer.id : customerId,
      customerEmail: customer ? customer.email : session.customerEmail,
      needsCustomerSelection: false,
    };

    setSessionCookie(res, updatedSession);
    return res.json({
      ok: true,
      data: { user: toPublicUser(updatedSession) },
    });
  } catch (e) {
    console.error("Customer select error:", e);
    res.status(500).json({ error: "Customer selection failed" });
  }
});

/** GET /auth/customer-summary — current customer summary (auth required). */
router.get("/auth/customer-summary", rateLimiter(120, 60_000), requireAuth, async (req, res) => {
  try {
    const session = req.session!;
    const customers = await sellauth.getCustomers();

    let target: any = null;
    if (session.customerId) {
      target = customers.find((c: any) => c.id === session.customerId);
    }
    if (!target && session.customerEmail) {
      target = customers.find(
        (c: any) => c.email && c.email.toLowerCase() === session.customerEmail!.toLowerCase()
      );
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
          lastCompletedAt: target.last_completed_at || null,
        },
      },
    });
  } catch (e) {
    res.json({ ok: true, data: { customer: null } });
  }
});

/** POST /auth/logout — clear the session cookie. */
router.post("/auth/logout", rateLimiter(60, 60_000), (req, res) => {
  res.clearCookie(config.session.cookieName, { path: "/" });
  res.json({ ok: true });
});

export { router as authRouter };
