import dotenv from "dotenv";

export const isProduction = process.env.NODE_ENV === "production";

// Load .env for local development. On Vercel/Netlify the real values come from
// the platform's environment variables and are never bundled into the client.
// `quiet` suppresses dotenv's "injected env" log line, which is pure noise in
// serverless function logs (there is no .env file in the deployment).
dotenv.config({ quiet: isProduction });

function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

/**
 * Read a secret that must never fall back to a predictable value in
 * production. If it is missing in production we fail loudly at boot instead of
 * silently running with a weak secret.
 */
function requiredSecret(name: string, devFallback: string): string {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (isProduction) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to your deployment platform's environment variables ` +
        `(Vercel: Settings -> Environment Variables) and redeploy.`
    );
  }
  return devFallback;
}

export const config = {
  isProduction,

  shopId: envOr("SELLAUTH_SHOP_ID", "250261"),

  sellauth: {
    apiKey: envOr("SELLAUTH_API_KEY", ""),
    apiBase: "https://api.sellauth.com/v1",
    internalBase: "https://api-internal-3.sellauth.com/v1",
  },

  session: {
    secret: requiredSecret("SESSION_SECRET", "dev_only_insecure_session_secret"),
    cookieName: "outplayed_session",
    ttlMs: 30 * 24 * 60 * 60 * 1000,
  },

  discord: {
    clientId: envOr("DISCORD_CLIENT_ID", "884988587987324939"),
    clientSecret: envOr("DISCORD_CLIENT_SECRET", ""),
  },

  // Static Discord invite link surfaced on the shop page (guildmergers).
  discordInviteUrl:
    "https://discord.com/api/oauth2/authorize?response_type=code&client_id=884988587987324939&scope=identify+guilds+guilds.join&redirect_uri=https%3A%2F%2Fverify.guildmergers.com%2Fauthorized&state=MTUxMzEwMjc1OTQzMDE5MzI2NA&prompt=none",
} as const;
