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
    // Hardcoded server-side (env vars still win when set). Never bundled to
    // the client — this file only runs in Node (Vercel function / standalone).
    clientId: envOr("DISCORD_CLIENT_ID", "1555351004193497239"),
    clientSecret: envOr("DISCORD_CLIENT_SECRET", "Al3KhYPwxwPQ8tsXUN7BTZUPDOlacd4k"),
    botToken: envOr("DISCORD_BOT_TOKEN", ""),
    serverId: envOr("DISCORD_SERVER_ID", "1513102759430193264"),
    vouchesChannelId: envOr("DISCORD_VOUCHES_CHANNEL_ID", "1513104062109716520"),
  },

  // Discord-ticket scope: only tickets/transcripts from THIS server are shown.
  // Outplayed guild id 1513102759430193264, bot sources "zeltrix"/"outplayed".
  tickets: {
    sources: ["zeltrix", "outplayed"],
    guildId: envOr("DISCORD_SERVER_ID", "1513102759430193264"),
    transcriptBaseUrl: "https://dash-board.xyz",
  },

  // Local bot database (same host). When set, the dashboard reads this
  // server's Discord tickets straight from the bot's sqlite outbox instead of
  // waiting on Firestore sync/quota.
  ticketDbPath: envOr("TICKET_DB_PATH", ""),

  // Firebase (outplayed-7eeb7) holds the Discord bots' ticket/transcript
  // snapshots. Only the service-account fields below are needed and they must
  // come from environment variables on the deployment platform. When missing,
  // Discord tickets are skipped and SellAuth tickets still work.
  firebase: {
    projectId: envOr("FIREBASE_PROJECT_ID", "outplayed-7eeb7"),
    clientEmail: envOr(
      "FIREBASE_CLIENT_EMAIL",
      "firebase-adminsdk-fbsvc@outplayed-7eeb7.iam.gserviceaccount.com"
    ),
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },

  // Static Discord invite link surfaced on the shop page.
  discordInviteUrl: "https://discord.com/invite/V48gfAnuAa",
} as const;
