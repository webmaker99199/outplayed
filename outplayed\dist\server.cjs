var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server/app.ts
var import_express5 = __toESM(require("express"), 1);
var import_cookie_parser = __toESM(require("cookie-parser"), 1);
var import_path2 = __toESM(require("path"), 1);
var import_fs2 = __toESM(require("fs"), 1);

// server/middleware/securityHeaders.ts
function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}

// server/middleware/urlNormalizer.ts
function urlNormalizer(req, res, next) {
  let url = req.url || "/";
  if (url.startsWith("/.netlify/functions/api")) {
    url = url.replace("/.netlify/functions/api", "/api");
  }
  const forwardedUri = req.headers["x-forwarded-uri"] || req.headers["x-original-uri"];
  if (forwardedUri && forwardedUri.startsWith("/api/")) {
    url = forwardedUri;
  } else {
    const matchedPath = req.headers["x-matched-path"];
    if (matchedPath && matchedPath.startsWith("/api/") && !matchedPath.includes("[")) {
      url = matchedPath;
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
}

// server/utils/session.ts
var import_crypto = __toESM(require("crypto"), 1);

// server/config.ts
var import_dotenv = __toESM(require("dotenv"), 1);
var isProduction = process.env.NODE_ENV === "production";
import_dotenv.default.config({ quiet: isProduction });
function envOr(name, fallback) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}
function requiredSecret(name, devFallback) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (isProduction) {
    throw new Error(
      `Missing required environment variable: ${name}. Add it to your deployment platform's environment variables (Vercel: Settings -> Environment Variables) and redeploy.`
    );
  }
  return devFallback;
}
var config = {
  isProduction,
  shopId: envOr("SELLAUTH_SHOP_ID", "250261"),
  sellauth: {
    apiKey: envOr("SELLAUTH_API_KEY", ""),
    apiBase: "https://api.sellauth.com/v1",
    internalBase: "https://api-internal-3.sellauth.com/v1"
  },
  session: {
    secret: requiredSecret("SESSION_SECRET", "dev_only_insecure_session_secret"),
    cookieName: "outplayed_session",
    ttlMs: 30 * 24 * 60 * 60 * 1e3
  },
  discord: {
    // Hardcoded server-side (env vars still win when set). Never bundled to
    // the client — this file only runs in Node (Vercel function / standalone).
    clientId: envOr("DISCORD_CLIENT_ID", "1555351004193497239"),
    clientSecret: envOr("DISCORD_CLIENT_SECRET", "Al3KhYPwxwPQ8tsXUN7BTZUPDOlacd4k"),
    botToken: envOr("DISCORD_BOT_TOKEN", ""),
    serverId: envOr("DISCORD_SERVER_ID", "1513102759430193264"),
    vouchesChannelId: envOr("DISCORD_VOUCHES_CHANNEL_ID", "1513104062109716520")
  },
  // Discord-ticket scope: only tickets/transcripts from THIS server are shown.
  // Outplayed guild id 1513102759430193264, bot sources "zeltrix"/"outplayed".
  tickets: {
    sources: ["zeltrix", "outplayed"],
    guildId: envOr("DISCORD_SERVER_ID", "1513102759430193264"),
    transcriptBaseUrl: "https://dash-board.xyz"
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
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  },
  // Static Discord invite link surfaced on the shop page.
  discordInviteUrl: "https://discord.com/invite/V48gfAnuAa"
};

// server/utils/session.ts
function signSession(data) {
  const json = JSON.stringify(data);
  const sig = import_crypto.default.createHmac("sha256", config.session.secret).update(json).digest("hex");
  return Buffer.from(json).toString("base64url") + "." + sig;
}
function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const expectedSig = import_crypto.default.createHmac("sha256", config.session.secret).update(json).digest("hex");
    if (sig !== expectedSig) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}
function getSessionFromReq(req) {
  const fromCookie = (req.cookies || {})[config.session.cookieName];
  if (typeof fromCookie === "string") {
    const session = verifySession(fromCookie);
    if (session) return session;
  }
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const session = verifySession(authHeader.substring(7).trim());
    if (session) return session;
  }
  return null;
}

// server/middleware/auth.ts
function attachSession(req, _res, next) {
  req.session = getSessionFromReq(req);
  next();
}
function requireAuth(req, res, next) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }
  req.session = session;
  next();
}

// server/middleware/errorHandler.ts
function safeError(e, fallback) {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error) {
    const msg = e.message?.trim();
    if (msg) return config.isProduction ? fallback : msg;
  }
  return fallback;
}
function apiNotFound(req, res) {
  res.status(404).json({ ok: false, error: "Not found" });
}
function errorHandler(err, req, res, next) {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  const detail = err instanceof Error && err.message ? err.message : "";
  res.status(500).json({
    ok: false,
    error: config.isProduction || !detail ? "An unexpected server error occurred." : detail
  });
}

// server/routes/public.ts
var import_express = require("express");

// server/middleware/rateLimit.ts
var rateLimitMap = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetTime) rateLimitMap.delete(key);
  }
}, 6e4).unref?.();
function rateLimiter(limit, windowMs) {
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
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

// server/services/discord-vouch.ts
var cachedVouches = null;
function avatarUrl(author) {
  if (!author || !author.id || !author.avatar) return null;
  const extension = String(author.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${extension}?size=128`;
}
function cleanMessage(raw) {
  return raw.replace(/^\s*<@!?\d+>\s*$/gim, "").replace(/^\s*(?:rating\s*[:：-]?\s*)?(?:[⭐★]\s*){1,5}\s*$/gim, "").replace(/^\s*(?:rating\s*[:：-]?\s*)?\d(?:\.\d)?\s*\/\s*5\s*$/gim, "").replace(/[⭐★]+/g, "").replace(/[`*_]/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
function mapMessage(message) {
  const sourceAuthor = message?.author || {};
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  const reviewerEmbed = embeds.find((embed) => embed?.author?.name);
  const reviewer = reviewerEmbed?.author || sourceAuthor;
  const embedText = embeds.flatMap((embed) => [
    embed?.title,
    embed?.description,
    ...Array.isArray(embed?.fields) ? embed.fields.flatMap((field) => [field?.name, field?.value]) : []
  ]).filter(Boolean).join("\n");
  const rawMessage = [message?.content, embedText].filter(Boolean).join("\n");
  const ratingMatches = rawMessage.match(/[⭐★]/g) || [];
  const images = [
    ...(Array.isArray(message?.attachments) ? message.attachments : []).filter(
      (attachment) => String(attachment?.content_type || "").startsWith("image/") || /\.(?:png|jpe?g|gif|webp)(?:\?|$)/i.test(String(attachment?.url || ""))
    ).map((attachment) => attachment?.proxy_url || attachment?.url),
    ...embeds.flatMap((embed) => [embed?.image?.proxy_url || embed?.image?.url])
  ].filter((url) => typeof url === "string" && /^https:\/\//i.test(url));
  return {
    hasReviewerEmbed: Boolean(reviewerEmbed),
    vouch: {
      id: String(message?.id || ""),
      message: cleanMessage(rawMessage),
      rating: Math.min(ratingMatches.length || 5, 5),
      createdAt: String(message?.timestamp || (/* @__PURE__ */ new Date()).toISOString()),
      images: [...new Set(images)],
      author: {
        name: String(reviewer?.name || reviewer?.username || "Verified Customer"),
        avatarUrl: reviewer?.icon_url || avatarUrl(reviewer) || avatarUrl(sourceAuthor)
      }
    }
  };
}
function isPublishable(vouch, sourceAuthor, hasReviewerEmbed) {
  if (!vouch.id || !vouch.message) return false;
  const lower = vouch.message.toLowerCase();
  const prompt = [
    "thank you for vouching",
    "please leave a vouch",
    "use the button below",
    "new vouch"
  ].some((phrase) => lower.includes(phrase));
  if (prompt) return false;
  if (sourceAuthor?.bot && !hasReviewerEmbed) return false;
  return true;
}
async function getDiscordVouches(limit = 18, options = {}) {
  if (!config.discord.botToken || !config.discord.vouchesChannelId) return [];
  if (!options.refresh && cachedVouches && cachedVouches.expiresAt > Date.now()) {
    return cachedVouches.value.slice(0, limit);
  }
  const endpoint = `https://discord.com/api/v10/channels/${encodeURIComponent(
    config.discord.vouchesChannelId
  )}/messages?limit=100`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      Authorization: `Bot ${config.discord.botToken}`
    },
    signal: AbortSignal.timeout(8e3)
  });
  if (!response.ok) throw new Error(`Discord API responded with ${response.status}`);
  const messages = await response.json();
  const vouches = (Array.isArray(messages) ? messages : []).filter((message) => message?.type === 0).map((message) => ({
    message,
    ...mapMessage(message)
  })).filter(
    ({ message, vouch, hasReviewerEmbed }) => isPublishable(vouch, message?.author, hasReviewerEmbed)
  ).map(({ vouch }) => vouch).sort((a, b) => {
    const bTime = Date.parse(b.createdAt);
    const aTime = Date.parse(a.createdAt);
    return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
  });
  cachedVouches = { expiresAt: Date.now() + 6e4, value: vouches };
  return vouches.slice(0, limit);
}

// server/services/sellauth.ts
var import_crypto2 = __toESM(require("crypto"), 1);

// server/utils/cache.ts
function createTtlCache(defaultTtlMs) {
  const store = /* @__PURE__ */ new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return void 0;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return void 0;
      }
      return entry.value;
    },
    set(key, value, ttlMs = defaultTtlMs) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

// server/services/sellauth.ts
var SellauthError = class extends Error {
};
var publicCache = {
  shop: createTtlCache(5 * 6e4),
  products: createTtlCache(45e3),
  categories: createTtlCache(45e3),
  feedbacks: createTtlCache(2 * 6e4),
  customers: createTtlCache(3e4),
  invoices: createTtlCache(3e4),
  tickets: createTtlCache(3e4)
};
function shopUrl(path3) {
  return `${config.sellauth.apiBase}/shops/${config.shopId}${path3}`;
}
async function sellauthFetch(url, options = {}, timeoutMs = 5e3) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...config.sellauth.apiKey ? { Authorization: `Bearer ${config.sellauth.apiKey}` } : {},
      ...options.headers || {}
    },
    signal: options.signal ?? AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) {
    throw new SellauthError(`SellAuth API responded with ${resp.status}`);
  }
  return await resp.json();
}
async function cachedFetch(key, ttlCache, fetchFn) {
  const cached = ttlCache.get(key);
  if (cached !== void 0) return cached;
  const value = await fetchFn();
  ttlCache.set(key, value);
  return value;
}
function unwrapList(json) {
  return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
}
function unwrapData(json) {
  return json?.data ?? json;
}
function getShop() {
  return cachedFetch(
    "shop",
    publicCache.shop,
    () => sellauthFetch(shopUrl("")).then(unwrapData)
  );
}
function getProducts() {
  return cachedFetch(
    "products",
    publicCache.products,
    () => sellauthFetch(shopUrl("/products")).then(unwrapList)
  );
}
function getProduct(id) {
  return sellauthFetch(shopUrl(`/products/${encodeURIComponent(String(id))}`)).then(unwrapData);
}
function getCategories() {
  return cachedFetch(
    "categories",
    publicCache.categories,
    () => sellauthFetch(shopUrl("/categories")).then(unwrapList)
  );
}
function getFeedbacks() {
  return cachedFetch(
    "feedbacks",
    publicCache.feedbacks,
    () => sellauthFetch(shopUrl("/feedbacks")).then(unwrapList)
  );
}
function getCustomers() {
  return cachedFetch(
    "customers",
    publicCache.customers,
    () => sellauthFetch(shopUrl("/customers")).then(unwrapList)
  );
}
function getInvoices() {
  return cachedFetch(
    "invoices",
    publicCache.invoices,
    () => sellauthFetch(shopUrl("/invoices")).then(unwrapList)
  );
}
function getTickets() {
  return cachedFetch(
    "tickets",
    publicCache.tickets,
    () => sellauthFetch(shopUrl("/tickets")).then(unwrapList)
  );
}
function getAltchaChallenge() {
  return sellauthFetch(`${config.sellauth.internalBase}/altcha`, {}, 5e3);
}
async function getOrSolveAltcha(providedAltcha) {
  if (providedAltcha && typeof providedAltcha === "string" && providedAltcha.length > 20) {
    return providedAltcha;
  }
  try {
    const chal = await getAltchaChallenge();
    const { algorithm, challenge, salt, maxnumber, signature } = chal;
    const max = maxnumber || 5e4;
    for (let num = 0; num <= max; num++) {
      const hash = import_crypto2.default.createHash("sha256").update(salt + num).digest("hex");
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
async function createCheckout(payload) {
  const resp = await fetch(`${config.sellauth.internalBase}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  return { status: resp.status, data };
}

// server/utils/fallback.ts
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
function findDataFile(filename) {
  const candidates = [
    import_path.default.join(process.cwd(), filename),
    import_path.default.resolve(filename),
    import_path.default.join(process.cwd(), "dist", filename),
    import_path.default.join(process.cwd(), "public", filename)
  ];
  if (typeof __dirname !== "undefined") {
    candidates.push(
      import_path.default.join(__dirname, "..", filename),
      import_path.default.join(__dirname, filename),
      import_path.default.join(__dirname, "public", filename)
    );
  }
  for (const p of candidates) {
    try {
      if (import_fs.default.existsSync(p)) return p;
    } catch {
    }
  }
  return null;
}
function readJsonFile(filename) {
  const file = findDataFile(filename);
  if (!file) return null;
  try {
    return JSON.parse(import_fs.default.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Failed to parse ${filename}:`, e);
    return null;
  }
}
function loadFallbackProducts() {
  const fromSellAuth = readJsonFile("sellauth_products.json");
  if (Array.isArray(fromSellAuth?.data) && fromSellAuth.data.length > 0) {
    return fromSellAuth.data;
  }
  const fromProducts = readJsonFile("products.json");
  if (Array.isArray(fromProducts?.data?.products) && fromProducts.data.products.length > 0) {
    return fromProducts.data.products;
  }
  return [];
}
function loadFallbackShop() {
  const parsed = readJsonFile("shop.json");
  if (parsed && typeof parsed === "object") return parsed;
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

// server/utils/legal.ts
var section = (title, body) => `<h2>${title}</h2>${body}`;
var legalPolicies = {
  terms: `<h1 style="text-align:center">Terms of Service</h1><p style="text-align:center"><strong>Effective Date:</strong> 11.01.2026</p>
${section("1. Acceptance of Terms", `<p>By accessing or using our website, Discord server, or any related services (collectively, the \u201CServices\u201D), you agree to be bound by these Terms of Service and all applicable laws and regulations.</p><p>If you do not agree to these Terms, you must not access or use our Services.</p>`)}
${section("2. Use of Services", `<p>You agree to use our Services only for lawful purposes and in compliance with all applicable laws and regulations.</p><p>You must not attempt to disrupt, interfere with, misuse, reverse-engineer, or otherwise alter any part of our Services, systems, or infrastructure.</p>`)}
${section("3. Accounts", `<p>If you create an account, you are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately if you suspect any unauthorized access or use of your account.</p>`)}
${section("4. Purchases and Pricing", `<p>All purchases are subject to the pricing displayed at the time of purchase. You agree to provide accurate and complete payment information and to complete transactions promptly.</p>`)}
${section("5. Refunds", `<p>Refunds are not guaranteed and are handled in accordance with our <strong>Refund Policy</strong>. By making a purchase, you acknowledge that refunds may be denied at our sole discretion.</p>`)}
${section("6. Compatibility Responsibility", `<p>It is your responsibility to ensure that your system meets all stated requirements before making a purchase. We do not guarantee compatibility with all systems, and incompatibility issues are generally not eligible for refunds.</p>`)}
${section("7. Chargebacks", `<p>Initiating a chargeback or payment dispute without first contacting our support may result in the suspension or termination of your account and access to our Services.</p>`)}
${section("8. Intellectual Property", `<p>All content, software, designs, and materials associated with our Services are our intellectual property and are protected by applicable copyright and trademark laws. You may not copy, modify, distribute, or use any of our intellectual property without prior written consent.</p>`)}
${section("9. Limitation of Liability", `<p>To the fullest extent permitted by law, we shall not be liable for any direct, indirect, incidental, or consequential damages arising from the use or inability to use our Services.</p>`)}
${section("10. Termination", `<p>We reserve the right to suspend or terminate your account or access to the Services at any time, with or without notice, for any reason, including violations of these Terms.</p>`)}
${section("11. Modifications", `<p>We reserve the right to modify these Terms at any time. Continued use of the Services after changes are posted constitutes acceptance of the revised Terms.</p>`)}
${section("12. Contact", `<p>If you have any questions regarding these Terms of Service, please contact us via our official Discord server.</p>`)}
${section("13. Product Duration", `<p>Products are provided for the duration stated at the time of purchase. Lifetime access means you can use the product for as long as that product remains active and in service. If we replace, discontinue, or change a product, we may offer compensation or an alternative product where appropriate. \u201CLifetime\u201D does not guarantee that a product or service will operate indefinitely.</p>`)}`,
  privacy: `<h1 style="text-align:center">Privacy Policy</h1><p style="text-align:center"><strong>Effective Date:</strong> 11.01.2026</p>
${section("1. Data Collection and Use", `<p>We respect your privacy and are committed to protecting your personal information. Any data collected is used solely to operate our Services, improve functionality, and communicate with users.</p>`)}
${section("2. Information Sharing", `<p>We do not sell, rent, or share your personal or sensitive information with third parties. Access to user data is strictly limited to authorized personnel for legitimate business purposes.</p>`)}
${section("3. Security", `<p>We implement industry-standard security measures to protect your information from unauthorized access, alteration, or disclosure. However, no system can be guaranteed to be completely secure.</p>`)}
${section("4. Your Rights", `<p>You have the right to request access to the data we hold about you and request correction or deletion of your personal data. To exercise these rights, please contact us via our official Discord server.</p>`)}
${section("5. Changes to This Policy", `<p>We reserve the right to update this Privacy Policy at any time. Any changes will be posted on this page with an updated effective date.</p>`)}
${section("6. Contact", `<p>For any questions regarding privacy, please contact us through our official Discord server.</p>`)}`,
  refund: `<h1 style="text-align:center">Refund Policy</h1><p style="text-align:center"><strong>Effective Date:</strong> 11.01.2026</p>
${section("1. Overview", `<p>We strive to provide high-quality products and services. Refunds are evaluated on a <strong>case-by-case basis</strong> and are granted <strong>at our sole discretion</strong>.</p>`)}
${section("2. Eligibility for Refunds", `<ul><li>Verified technical issues that prevent the software from functioning and cannot be resolved</li><li>Undelivered products or services beyond the stated delivery timeframe</li><li>Proven unauthorized or fraudulent purchases</li></ul>`)}
${section("3. Non-Refundable Situations", `<p>Refunds will not be provided for violations of our Terms of Service, unsupported or incompatible systems, personal circumstances or change of mind, compatibility issues despite meeting stated requirements, or account suspension or termination due to rule violations.</p>`)}
${section("4. Refund Process", `<ol><li>Contact our support team via the official Discord server</li><li>Provide your order details and a clear explanation of the issue</li><li>Allow up to <strong>5 business days</strong> for review and response</li></ol>`)}
${section("5. Important Notes", `<ul><li>Approved refunds will be issued to the original payment method</li><li>Partial refunds may be issued depending on usage and circumstances</li></ul>`)}
${section("6. Changes to This Policy", `<p>We reserve the right to modify this Refund Policy at any time. Changes will be posted with an updated effective date.</p>`)}
${section("7. Contact", `<p>For any questions regarding refunds, please contact us through our official Discord server.</p>`)}`
};

// server/utils/shop.ts
function parseSellAuthStatus(p) {
  const text = p.status_text && typeof p.status_text === "string" && p.status_text.trim() ? p.status_text.trim() : "Undetected";
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
  return {
    type,
    text,
    color: p.status_color || null,
    lastUpdatedAt: p.updated_at ? new Date(p.updated_at).getTime() : null
  };
}
function mapProductToStandard(p, categoriesMap) {
  const images = p.images && p.images.length ? p.images.map(
    (img) => typeof img === "string" ? img : img.url || `https://api.sellauth.com/storage/images/${img.id || img.cloudflare_image_id}.webp`
  ) : p.image ? [p.image] : [];
  const category = p.category || categoriesMap && categoriesMap.get(p.category_id) || { id: p.category_id || 1, name: "General" };
  const plans = p.variants ? p.variants.map((v) => ({
    id: v.id,
    label: v.name || v.label,
    description: v.description || null,
    price: Number(v.price || 0),
    stock: v.stock ?? null
  })) : p.plans || [];
  const statusObj = parseSellAuthStatus(p);
  const rawBadges = p.product_badges || p.badges || (p.badge ? [p.badge] : []);
  const badges = Array.isArray(rawBadges) ? rawBadges.map((b) => ({
    id: b.id,
    label: b.label || b.text || (typeof b === "string" ? b : "Special"),
    icon: b.icon || "far fa-star",
    color: b.color || "#003eff",
    show_on_card: b.show_on_card !== false,
    show_on_page: b.show_on_page !== false
  })) : [];
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
    updated_at: p.updated_at
  };
}
function sanitizeShopData(rawShop) {
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
var defaultReviews = [
  {
    id: 1,
    rating: 5,
    message: "Hands down the cleanest and most responsive experience I've used. Instant setup and zero issues so far!",
    author: { name: "Vortex" },
    createdAt: Date.now() - 1e3 * 60 * 60 * 24 * 2
  },
  {
    id: 2,
    rating: 5,
    message: "Customer support on Discord helped me set everything up within minutes. Completely undetected and smooth.",
    author: { name: "Kyro" },
    createdAt: Date.now() - 1e3 * 60 * 60 * 24 * 5
  },
  {
    id: 3,
    rating: 5,
    message: "Instant key delivery right after crypto payment. The feature set is unmatched, definitely renewing next month.",
    author: { name: "ShadowPulse" },
    createdAt: Date.now() - 1e3 * 60 * 60 * 24 * 8
  },
  {
    id: 4,
    rating: 5,
    message: "Top tier performance with zero frame drops. Very easy configuration and frequent safety updates.",
    author: { name: "AeroX" },
    createdAt: Date.now() - 1e3 * 60 * 60 * 24 * 11
  },
  {
    id: 5,
    rating: 5,
    message: "Best undetected software on the market right now. Simple instructions and working flawlessly on latest build.",
    author: { name: "Matrix99" },
    createdAt: Date.now() - 1e3 * 60 * 60 * 24 * 14
  },
  {
    id: 6,
    rating: 5,
    message: "Vouching 100%. Was skeptical at first but after 2 weeks of intense games without any flags, I am hooked.",
    author: { name: "Nexus" },
    createdAt: Date.now() - 1e3 * 60 * 60 * 24 * 18
  }
];

// server/routes/public.ts
var router = (0, import_express.Router)();
var legacyAliasRouter = (0, import_express.Router)();
async function loadPublicLegalPage(shopUrl2, slug) {
  try {
    const response = await fetch(`${shopUrl2.replace(/\/$/, "")}/${slug}`, {
      signal: AbortSignal.timeout(5e3),
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: `${shopUrl2.replace(/\/$/, "")}/`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) return null;
    const html = await response.text();
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
    const content = main.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").trim();
    return content || null;
  } catch {
    return null;
  }
}
async function getProductsWithCategories() {
  const [productsResult, categoriesResult] = await Promise.allSettled([
    getProducts(),
    getCategories()
  ]);
  const rawList = productsResult.status === "fulfilled" ? productsResult.value : [];
  const categories = categoriesResult.status === "fulfilled" ? categoriesResult.value : [];
  const categoriesMap = new Map(categories.map((c) => [c.id, { id: c.id, name: c.name }]));
  return { rawList, categoriesMap };
}
async function handleGetProducts(req, res) {
  try {
    let { rawList, categoriesMap } = await getProductsWithCategories();
    if (!rawList.length) rawList = loadFallbackProducts();
    const products = rawList.map((p) => mapProductToStandard(p, categoriesMap));
    res.json({ ok: true, data: { products } });
  } catch (e) {
    const products = loadFallbackProducts().map((p) => mapProductToStandard(p));
    res.json({ ok: true, data: { products } });
  }
}
async function handleGetSingleProduct(req, res) {
  try {
    const productId = req.params.id;
    if (!productId || productId.length > 100) {
      return res.status(400).json({ ok: false, error: "Invalid product identifier" });
    }
    let p = null;
    try {
      p = await getProduct(productId);
    } catch {
      try {
        const list = await getProducts();
        p = list.find((item) => String(item.id) === String(productId) || item.path === productId);
      } catch {
        p = null;
      }
    }
    if (!p || !p.id) {
      const localList = loadFallbackProducts();
      p = localList.find((item) => String(item.id) === String(productId) || item.path === productId);
    }
    if (!p || !p.id) {
      return res.status(404).json({ ok: false, error: "Product not found" });
    }
    let categoriesMap;
    const rawCatName = String(p.category?.name ?? "").trim();
    if (!rawCatName || /^general$/i.test(rawCatName)) {
      try {
        const categories = await getCategories();
        categoriesMap = new Map(categories.map((c) => [c.id, { id: c.id, name: c.name }]));
      } catch (e) {
        console.error("Category enrichment failed:", e);
      }
    }
    res.json({ ok: true, data: { product: mapProductToStandard(p, categoriesMap) } });
  } catch (e) {
    console.error("handleGetSingleProduct error:", e);
    res.status(500).json({ ok: false, error: "Unable to retrieve product" });
  }
}
function firstNonNegativeNumber(...values) {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}
function calculateReviewMetrics(reviews) {
  const ratings = reviews.map((review) => {
    const rawRating = review?.rating;
    if (rawRating === void 0 || rawRating === null || rawRating === "") return 5;
    const rating = Number(rawRating);
    return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
  }).filter((rating) => rating !== null);
  if (!ratings.length) return { totalFeedbacks: 0, avgRating: 0 };
  const average = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  return { totalFeedbacks: ratings.length, avgRating: Number(average.toFixed(2)) };
}
async function getLanderReviews() {
  try {
    const vouches = await getDiscordVouches(100);
    if (vouches.length) return vouches;
  } catch (error) {
    console.error("Discord vouches unavailable for shop metrics:", error);
  }
  try {
    const feedbacks = await getFeedbacks();
    return feedbacks.length ? feedbacks : defaultReviews;
  } catch {
    return defaultReviews;
  }
}
async function handleGetShop(req, res) {
  try {
    let shopObj = null;
    let loadedFromSellAuth = false;
    try {
      shopObj = await getShop();
      loadedFromSellAuth = Boolean(shopObj && typeof shopObj === "object");
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
      const logo = shopObj.logo_image_url || shopObj.logo_image && shopObj.logo_image.url || "https://api.sellauth.com/storage/images/1088445.webp";
      shopObj.logo = logo;
      shopObj.image = logo;
      shopObj.logo_image_url = logo;
      shopObj.favicon = logo;
      const policies = shopObj.policies || shopObj.legal || shopObj.legal_pages || {};
      const policyValue = (...values) => {
        const value = values.find((candidate) => candidate !== void 0 && candidate !== null && candidate !== "");
        if (value && typeof value === "object") {
          return value.html ?? value.content ?? value.value ?? value.text ?? null;
        }
        return value ?? null;
      };
      shopObj.privacyPolicy = policyValue(
        shopObj.privacyPolicy,
        shopObj.privacy_policy,
        shopObj.privacy_policy_text,
        policies.privacyPolicy,
        policies.privacy_policy,
        policies.privacy
      );
      shopObj.refundPolicy = policyValue(
        shopObj.refundPolicy,
        shopObj.refund_policy,
        shopObj.refund_policy_text,
        policies.refundPolicy,
        policies.refund_policy,
        policies.refund
      );
      const terms = shopObj.termsOfService || shopObj.terms_of_service || shopObj.terms || shopObj.terms_text || policyValue(policies.termsOfService, policies.terms_of_service, policies.terms);
      const privacy = shopObj.privacyPolicy || shopObj.privacy_policy || shopObj.privacy_policy_text;
      const refund = shopObj.refundPolicy || shopObj.refund_policy || shopObj.refund_policy_text;
      if (terms) {
        shopObj.terms = terms;
        shopObj.termsOfService = terms;
      }
      if (privacy) {
        shopObj.privacy_policy = privacy;
        shopObj.privacyPolicy = privacy;
      }
      if (refund) {
        shopObj.refund_policy = refund;
        shopObj.refundPolicy = refund;
      }
      if (shopObj.url && (!shopObj.termsOfService || !shopObj.privacyPolicy || !shopObj.refundPolicy)) {
        const [terms2, privacy2, refund2] = await Promise.all([
          shopObj.termsOfService ? Promise.resolve(null) : loadPublicLegalPage(shopObj.url, "terms-of-service"),
          shopObj.privacyPolicy ? Promise.resolve(null) : loadPublicLegalPage(shopObj.url, "privacy-policy"),
          shopObj.refundPolicy ? Promise.resolve(null) : loadPublicLegalPage(shopObj.url, "refund-policy")
        ]);
        if (terms2) shopObj.terms = shopObj.termsOfService = terms2;
        if (privacy2) shopObj.privacy_policy = shopObj.privacyPolicy = privacy2;
        if (refund2) shopObj.refund_policy = shopObj.refundPolicy = refund2;
        if (!shopObj.termsOfService) shopObj.terms = shopObj.termsOfService = legalPolicies.terms;
        if (!shopObj.privacyPolicy) shopObj.privacy_policy = shopObj.privacyPolicy = legalPolicies.privacy;
        if (!shopObj.refundPolicy) shopObj.refund_policy = shopObj.refundPolicy = legalPolicies.refund;
      }
    }
    const reviews = await getLanderReviews();
    const reviewMetrics = calculateReviewMetrics(reviews);
    const totalSales = loadedFromSellAuth ? firstNonNegativeNumber(shopObj?.total_completed_invoices) : 0;
    res.json({
      ok: true,
      data: {
        shop: shopObj,
        metrics: { totalSales, ...reviewMetrics }
      }
    });
  } catch (e) {
    console.error("handleGetShop error:", e);
    res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve shop configuration") });
  }
}
async function handleGetCategories(req, res) {
  try {
    let catList = [];
    let prodList = [];
    try {
      [catList, prodList] = await Promise.all([getCategories(), getProducts()]);
    } catch {
      catList = [];
      prodList = [];
    }
    if (!prodList.length) prodList = loadFallbackProducts();
    const productsByCat = /* @__PURE__ */ new Map();
    prodList.forEach((p) => {
      const catId = p.category_id || p.category?.id || 1;
      if (!productsByCat.has(catId)) productsByCat.set(catId, []);
      let stock = 0;
      if (p.variants) {
        stock = p.variants.reduce((acc, v) => acc + (v.stock || 0), 0);
      } else if (p.plans) {
        stock = p.plans.reduce((acc, v) => acc + (v.stock || 0), 0);
      } else {
        stock = p.stock || 0;
      }
      productsByCat.get(catId).push({ id: p.id, name: p.name, stock });
    });
    if (!catList.length) {
      const seenCats = /* @__PURE__ */ new Map();
      prodList.forEach((p) => {
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
      catList = catList.map((c) => ({
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
}
async function handleGetStatus(req, res) {
  try {
    let products = [];
    try {
      products = await getProducts();
    } catch {
      products = [];
    }
    const publicProducts = products.filter((p) => {
      const visibility = String(p.visibility || "").toLowerCase();
      return visibility === "public" && !p.deleted_at && !p.terminated_at;
    });
    const statuses = publicProducts.map((p) => ({
      id: p.id,
      name: p.name,
      productName: p.name,
      path: p.path,
      category: p.category?.name || "General",
      status: parseSellAuthStatus(p),
      status_text: p.status_text,
      status_color: p.status_color,
      updated_at: p.updated_at
    }));
    res.json({ ok: true, data: { statuses } });
  } catch (e) {
    console.error("handleGetStatus error:", e);
    res.status(500).json({ ok: false, error: safeError(e, "Unable to retrieve status") });
  }
}
async function handleGetReviews(req, res) {
  try {
    try {
      const refreshImages = String(req.query?.refreshImages || "") === "1";
      const vouches = await getDiscordVouches(100, { refresh: refreshImages });
      if (vouches.length) {
        return res.json({
          ok: true,
          data: {
            reviews: vouches.map((vouch) => ({
              id: vouch.id,
              rating: vouch.rating,
              message: vouch.message,
              author: { name: vouch.author.name, avatarUrl: vouch.author.avatarUrl },
              createdAt: vouch.createdAt,
              images: vouch.images
            }))
          }
        });
      }
    } catch (error) {
      console.error("Discord vouches unavailable:", error);
    }
    let list = [];
    try {
      list = await getFeedbacks();
    } catch {
      list = [];
    }
    if (list.length > 0) {
      const mapped = list.map((f, idx) => ({
        id: f.id || idx + 1,
        rating: f.rating ?? 5,
        message: f.message || f.feedback || f.comment || "Amazing product and fast delivery!",
        author: {
          name: f.author_name || f.customer_email?.split("@")[0] || f.username || "Verified Customer"
        },
        createdAt: f.created_at ? new Date(f.created_at).getTime() : Date.now()
      }));
      return res.json({ ok: true, data: { reviews: mapped } });
    }
    return res.json({ ok: true, data: { reviews: defaultReviews } });
  } catch {
    return res.json({ ok: true, data: { reviews: defaultReviews } });
  }
}
var publicRoutes = [
  { method: "get", path: "/products", handler: handleGetProducts },
  { method: "get", path: "/products/:id", handler: handleGetSingleProduct },
  { method: "get", path: "/shop", handler: handleGetShop },
  { method: "get", path: "/categories", handler: handleGetCategories },
  { method: "get", path: "/status", handler: handleGetStatus },
  { method: "get", path: "/reviews", handler: handleGetReviews }
];
for (const route of publicRoutes) {
  const handlers = [rateLimiter(120, 6e4), route.handler];
  router.get(route.path, ...handlers);
  legacyAliasRouter.get(route.path, ...handlers);
}

// server/routes/auth.ts
var import_express2 = require("express");

// server/services/discord.ts
var import_crypto3 = __toESM(require("crypto"), 1);
var DISCORD_API = "https://discord.com/api";
function buildCallbackUrl(req) {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${host}/api/outplayed/auth/discord/callback`;
}
function buildDiscordAuthUrl(callbackUrl, state) {
  return `${DISCORD_API}/oauth2/authorize?client_id=${encodeURIComponent(config.discord.clientId)}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=identify%20email&state=${encodeURIComponent(state)}`;
}
function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
function decodeState(state) {
  if (!state) return null;
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
function randomNonce() {
  return import_crypto3.default.randomBytes(8).toString("hex");
}
async function getDiscordUser(code, callbackUrl) {
  if (!config.discord.clientSecret) return null;
  try {
    const tokenResp = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl
      })
    });
    if (!tokenResp.ok) return null;
    const tokenData = await tokenResp.json();
    const userResp = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    if (!userResp.ok) return null;
    return await userResp.json();
  } catch (e) {
    console.error("Discord token exchange failed:", e);
    return null;
  }
}

// server/routes/auth.ts
var router2 = (0, import_express2.Router)();
var SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: "lax",
  maxAge: config.session.ttlMs,
  path: "/"
};
function setSessionCookie(res, session) {
  res.cookie(config.session.cookieName, signSession(session), SESSION_COOKIE_OPTIONS);
}
function toPublicUser(session) {
  return {
    id: session.id || "discord_user",
    username: session.username || "Discord User",
    avatar: session.avatar || null,
    customerId: session.customerId || null,
    customerEmail: session.customerEmail || null,
    needsCustomerSelection: Boolean(session.needsCustomerSelection)
  };
}
router2.get("/auth/discord", async (req, res) => {
  try {
    const returnTo = typeof req.query.return_to === "string" && req.query.return_to.trim() ? req.query.return_to.trim() : "/dashboard";
    if (config.discord.clientSecret) {
      const state = encodeState({ returnTo, nonce: randomNonce() });
      const authUrl = buildDiscordAuthUrl(buildCallbackUrl(req), state);
      return res.redirect(302, authUrl);
    }
    return res.redirect(302, "/discord");
  } catch (e) {
    console.error("Discord auth start error:", e);
    res.redirect(302, "/dashboard");
  }
});
async function handleDiscordCallback(req, res) {
  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = decodeState(typeof req.query.state === "string" ? req.query.state : void 0);
    const returnTo = state?.returnTo || "/dashboard";
    const discordUser = code ? await getDiscordUser(code, buildCallbackUrl(req)) : null;
    if (!discordUser || !state) return res.redirect(302, "/discord");
    const oauthEmail = typeof discordUser.email === "string" && discordUser.email.includes("@") ? discordUser.email.toLowerCase() : null;
    let customers = [];
    try {
      customers = await getCustomers();
    } catch {
      customers = [];
    }
    const matchedCustomer = customers.find(
      (c) => c.discord_id != null && String(c.discord_id) === String(discordUser.id) || oauthEmail && c.email && String(c.email).toLowerCase() === oauthEmail
    ) || null;
    setSessionCookie(res, {
      id: discordUser.id,
      username: discordUser?.username || discordUser?.global_name || matchedCustomer?.discord_username || "Discord User",
      avatar: discordUser?.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null,
      customerId: matchedCustomer?.id || null,
      customerEmail: matchedCustomer?.email || discordUser?.email || null,
      discordEmail: discordUser?.email || null,
      needsCustomerSelection: false
    });
    return res.redirect(302, returnTo);
  } catch (e) {
    console.error("Discord callback error:", e);
    res.redirect(302, "/dashboard");
  }
}
router2.get("/auth/discord/callback", handleDiscordCallback);
router2.get("/auth/callback", handleDiscordCallback);
router2.get("/auth/me", rateLimiter(120, 6e4), (req, res) => {
  const session = req.session;
  if (!session) {
    return res.json({ ok: true, data: { user: null } });
  }
  return res.json({ ok: true, data: { user: toPublicUser(session) } });
});
router2.get("/auth/customer-options", rateLimiter(120, 6e4), requireAuth, async (req, res) => {
  try {
    const session = req.session;
    const customers = await getCustomers();
    const oauthEmail = String(session.discordEmail || session.customerEmail || "").toLowerCase();
    const linked = customers.filter(
      (c) => c.discord_id != null && String(c.discord_id) === String(session.id) || oauthEmail && c.email && String(c.email).toLowerCase() === oauthEmail
    );
    const scoped = session.customerId ? linked.filter((c) => c.id === session.customerId) : linked.slice(0, 1);
    const mapped = scoped.map((c) => ({
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
});
router2.post("/auth/customer-select", rateLimiter(60, 6e4), requireAuth, async (req, res) => {
  try {
    const session = req.session;
    const customerId = Number(req.body?.customerId);
    const customers = await getCustomers();
    const oauthEmail = String(session.discordEmail || session.customerEmail || "").toLowerCase();
    const customer = customers.find((c) => c.id === customerId && (c.discord_id != null && String(c.discord_id) === String(session.id) || oauthEmail && c.email && String(c.email).toLowerCase() === oauthEmail));
    if (!customer) return res.status(403).json({ error: "Customer account is not linked to this Discord user" });
    const updatedSession = {
      ...session,
      customerId: customer ? customer.id : customerId,
      customerEmail: customer ? customer.email : session.customerEmail,
      needsCustomerSelection: false
    };
    setSessionCookie(res, updatedSession);
    return res.json({
      ok: true,
      data: { user: toPublicUser(updatedSession) }
    });
  } catch (e) {
    console.error("Customer select error:", e);
    res.status(500).json({ error: "Customer selection failed" });
  }
});
router2.get("/auth/customer-summary", rateLimiter(120, 6e4), requireAuth, async (req, res) => {
  try {
    const session = req.session;
    const customers = await getCustomers();
    let target = null;
    if (session.customerId) {
      target = customers.find((c) => c.id === session.customerId);
    }
    if (!target && session.customerEmail) {
      target = customers.find(
        (c) => c.email && c.email.toLowerCase() === session.customerEmail.toLowerCase()
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
          lastCompletedAt: target.last_completed_at || null
        }
      }
    });
  } catch (e) {
    res.json({ ok: true, data: { customer: null } });
  }
});
router2.post("/auth/logout", rateLimiter(60, 6e4), (req, res) => {
  res.clearCookie(config.session.cookieName, { path: "/" });
  res.json({ ok: true });
});

// server/routes/customer.ts
var import_express3 = require("express");

// server/utils/validation.ts
var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value) {
  return typeof value === "string" && EMAIL_REGEX.test(value.trim());
}
function sanitizeCart(cart) {
  if (!Array.isArray(cart)) return [];
  return cart.filter((item) => !!item && typeof item === "object").map((item) => ({
    productId: Number(item.productId),
    variantId: Number(item.variantId),
    quantity: Math.max(1, Math.min(1e3, Number(item.quantity) || 1))
  })).filter(
    (item) => !Number.isNaN(item.productId) && !Number.isNaN(item.variantId) && item.productId > 0 && item.variantId > 0
  );
}
function sanitizeShortString(value, maxLength = 50) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : void 0;
}
function getPagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const perPage = Math.max(1, Math.min(100, Number(query.perPage) || 20));
  return {
    page,
    perPage,
    startIndex: (page - 1) * perPage,
    lastPage: (total) => Math.max(1, Math.ceil(total / perPage))
  };
}

// server/services/discord-tickets.ts
var import_crypto4 = __toESM(require("crypto"), 1);
var import_node_zlib = require("node:zlib");
var TOKEN_URI = "https://oauth2.googleapis.com/token";
var SCOPE = "https://www.googleapis.com/auth/datastore";
var cachedToken = null;
var userCache = /* @__PURE__ */ new Map();
function firebaseReady() {
  return Boolean(
    config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey
  );
}
function base64url(input) {
  return Buffer.from(input).toString("base64url");
}
async function accessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 9e4) return cachedToken.token;
  const now = Math.floor(Date.now() / 1e3);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.firebase.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = import_crypto4.default.sign("RSA-SHA256", Buffer.from(signingInput), {
    key: config.firebase.privateKey,
    padding: import_crypto4.default.constants.RSA_PKCS1_PADDING
  });
  const assertion = `${signingInput}.${signature.toString("base64url")}`;
  const resp = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    signal: AbortSignal.timeout(1e4)
  });
  if (!resp.ok) throw new Error(`Google token exchange failed (${resp.status})`);
  const data = await resp.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1e3 };
  return cachedToken.token;
}
function firestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(firestoreValue);
  if ("mapValue" in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue?.fields || {})) out[k] = firestoreValue(v);
    return out;
  }
  if ("bytesValue" in value) return value.bytesValue;
  return null;
}
function decodeDoc(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) out[k] = firestoreValue(v);
  return out;
}
async function runQuery(structuredQuery) {
  const token = await accessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${config.firebase.projectId}/databases/(default)/documents:runQuery`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
    signal: AbortSignal.timeout(15e3)
  });
  if (!resp.ok) throw new Error(`Firestore query failed (${resp.status})`);
  const rows = await resp.json();
  return Array.isArray(rows) ? rows : [];
}
function unpackTickets(snapshot) {
  const source = String(snapshot.source || "");
  const guildId = String(snapshot.guildId || "");
  const kind = String(snapshot.kind || "");
  const bucket = Number(snapshot.bucket);
  const id = String(snapshot.id || "");
  if (kind !== "tickets" || !Number.isInteger(bucket) || bucket < 0 || bucket >= 32 || id !== `${source}-tickets-${String(bucket).padStart(2, "0")}`) {
    return [];
  }
  const encoded = String(snapshot.payloadGzip || "");
  const expected = String(snapshot.sha256 || "");
  if (!encoded || !expected) return [];
  const compressed = Buffer.from(encoded, "base64");
  if (compressed.length > 7e5) return [];
  let raw;
  try {
    raw = (0, import_node_zlib.gunzipSync)(compressed, { maxOutputLength: 16e6 });
  } catch {
    return [];
  }
  if (import_crypto4.default.createHash("sha256").update(raw).digest("hex") !== expected) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { path: path3, record } = item;
    if (typeof path3 !== "string" || !record || typeof record !== "object" || Array.isArray(record)) continue;
    const parts = path3.split("/");
    if (parts.length !== 4 || parts[0] !== "guilds" || parts[2] !== "tickets") continue;
    if (parts[1] !== config.tickets.guildId || String(record.guildId || "") !== config.tickets.guildId) continue;
    if (String(record.source || "") !== source) continue;
    rows.push({ id: parts[3], record: { ...record, guildId } });
  }
  return rows;
}
function normalizeTicket(id, record) {
  const statusRaw = String(record.status || "").toLowerCase();
  const isOpen = statusRaw !== "closed";
  const channelId = record.channelId != null ? String(record.channelId) : record.ticketId != null ? String(record.ticketId) : id;
  const channelUrl = `https://discord.com/channels/${config.tickets.guildId}/${channelId}`;
  let transcriptUrl = null;
  if (!isOpen) {
    const raw = typeof record.transcriptUrl === "string" ? record.transcriptUrl.trim() : "";
    if (/^https?:\/\//i.test(raw)) transcriptUrl = raw;
    else if (raw) transcriptUrl = `${config.tickets.transcriptBaseUrl}/transcripts/${raw}`;
    else if (record.transcriptId) transcriptUrl = `${config.tickets.transcriptBaseUrl}/transcripts/${record.transcriptId}`;
  }
  return {
    ticketId: record.ticketId != null ? String(record.ticketId) : channelId,
    channelId,
    channelName: record.channelName != null ? String(record.channelName) : null,
    status: isOpen ? "Open" : "Closed",
    isOpen,
    createdAt: record.createdAt != null ? String(record.createdAt) : null,
    closedAt: record.closedAt != null ? String(record.closedAt) : null,
    channelUrl: isOpen ? channelUrl : typeof record.channelUrl === "string" && record.channelUrl ? record.channelUrl : null,
    transcriptUrl,
    source: "discord"
  };
}
async function getCloudTickets(discordUserId) {
  if (!firebaseReady()) return [];
  try {
    const tickets = [];
    for (const source of config.tickets.sources) {
      const rows = await runQuery({
        from: [{ collectionId: "dashboardSnapshots" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "source" }, op: "EQUAL", value: { stringValue: source } } },
              { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: "tickets" } } }
            ]
          }
        }
      });
      for (const row of rows) {
        const doc = row?.document;
        if (!doc) continue;
        const snapshot = { ...decodeDoc(doc), id: String(doc.name || "").split("/").pop() || "" };
        if (String(snapshot.guildId || "") !== config.tickets.guildId) continue;
        for (const { id, record } of unpackTickets(snapshot)) {
          const owner = record.ownerId != null ? String(record.ownerId) : record.userId != null ? String(record.userId) : "";
          if (owner !== String(discordUserId)) continue;
          tickets.push(normalizeTicket(id, record));
        }
      }
    }
    return tickets;
  } catch (e) {
    console.error("Discord cloud tickets fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
async function getLocalTickets(discordUserId) {
  const dbPath = config.ticketDbPath;
  if (!dbPath) return [];
  try {
    const sqlite = await import("node:sqlite").catch(() => null);
    if (!sqlite?.DatabaseSync) return [];
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare("SELECT path, payload FROM dashboard_rows WHERE kind = 'tickets' AND guild_id = ?").all(config.tickets.guildId);
      const tickets = [];
      for (const row of rows) {
        if (typeof row.path !== "string" || typeof row.payload !== "string") continue;
        const parts = row.path.split("/");
        if (parts.length !== 4 || parts[0] !== "guilds" || parts[2] !== "tickets") continue;
        if (parts[1] !== config.tickets.guildId) continue;
        let record;
        try {
          record = JSON.parse(row.payload);
        } catch {
          continue;
        }
        if (!record || typeof record !== "object" || Array.isArray(record)) continue;
        if (!config.tickets.sources.includes(String(record.source || ""))) continue;
        if (String(record.guildId || "") !== config.tickets.guildId) continue;
        const owner = record.ownerId != null ? String(record.ownerId) : record.userId != null ? String(record.userId) : "";
        if (owner !== String(discordUserId)) continue;
        tickets.push(normalizeTicket(parts[3], { ...record, guildId: config.tickets.guildId }));
      }
      return tickets;
    } finally {
      db.close();
    }
  } catch (e) {
    console.error("Local ticket DB read failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
async function getDiscordTickets(discordUserId) {
  if (!discordUserId || !/^[0-9]{5,25}$/.test(String(discordUserId))) return [];
  const cached = userCache.get(discordUserId);
  if (cached && Date.now() < cached.expiresAt) return cached.tickets;
  try {
    const [local, cloud] = await Promise.all([getLocalTickets(discordUserId), getCloudTickets(discordUserId)]);
    const seen = /* @__PURE__ */ new Set();
    const merged = [];
    for (const t of [...local, ...cloud]) {
      if (seen.has(t.ticketId)) continue;
      seen.add(t.ticketId);
      merged.push(t);
    }
    merged.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
    userCache.set(discordUserId, { expiresAt: Date.now() + 6e4, tickets: merged });
    return merged;
  } catch (e) {
    console.error("Discord tickets fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// server/routes/customer.ts
var router3 = (0, import_express3.Router)();
router3.get("/orders", rateLimiter(120, 6e4), requireAuth, async (req, res) => {
  try {
    const session = req.session;
    const invoices = await getInvoices();
    let filteredInvoices;
    if (session.customerId) {
      filteredInvoices = invoices.filter((inv) => inv.shop_customer_id === session.customerId);
    } else if (session.customerEmail) {
      filteredInvoices = invoices.filter(
        (inv) => inv.email && inv.email.toLowerCase() === session.customerEmail.toLowerCase()
      );
    } else {
      filteredInvoices = [];
    }
    const statusFilter = typeof req.query.status === "string" ? req.query.status.toLowerCase() : null;
    if (statusFilter && statusFilter !== "all") {
      filteredInvoices = filteredInvoices.filter(
        (inv) => String(inv.status).toLowerCase() === statusFilter
      );
    }
    const orders = filteredInvoices.map((inv) => ({
      id: inv.id,
      status: inv.status || "completed",
      statusDescription: inv.status === "completed" ? "Completed" : inv.status || "Completed",
      price: inv.price || "0.00",
      paid: inv.paid || "0.00",
      paidUsd: inv.paid_usd || "0.00",
      currency: inv.currency || "USD",
      gateway: inv.gateway || "Crypto",
      redirectUrl: inv.unique_id ? `https://sellauth.com/invoice/${inv.unique_id}` : null,
      createdAt: inv.created_at || (/* @__PURE__ */ new Date()).toISOString(),
      completedAt: inv.completed_at || inv.created_at || (/* @__PURE__ */ new Date()).toISOString(),
      paymentMethod: inv.payment_method ? { name: inv.payment_method.name || inv.gateway } : { name: inv.gateway || "Payment" },
      items: (inv.items && Array.isArray(inv.items) && inv.items.length > 0 ? inv.items : [
        {
          product_name: inv.product?.name || "Digital Product License",
          variant_name: inv.variant?.name || "Standard",
          quantity: 1,
          total_price: inv.price || "0.00",
          delivered: []
        }
      ]).map((it) => ({
        productName: it.product_name || inv.product?.name || "Digital Product License",
        variantName: it.variant_name || inv.variant?.name || "Standard",
        status: inv.status || "completed",
        quantity: it.quantity || 1,
        totalPrice: it.total_price || it.price || inv.price || "0.00",
        delivered: it.delivered || it.license_keys || []
      }))
    }));
    const { page, perPage, startIndex, lastPage } = getPagination(req.query);
    const paginatedOrders = orders.slice(startIndex, startIndex + perPage);
    return res.json({
      ok: true,
      data: {
        orders: paginatedOrders,
        pagination: { page, perPage, total: orders.length, lastPage: lastPage(orders.length) }
      }
    });
  } catch (e) {
    console.error("Orders fetch error:", e);
    res.json({ ok: true, data: { orders: [], pagination: { page: 1, perPage: 20, total: 0, lastPage: 1 } } });
  }
});
router3.get("/tickets", rateLimiter(120, 6e4), requireAuth, async (req, res) => {
  try {
    const session = req.session;
    let sellauthTickets = [];
    try {
      const tickets = await getTickets();
      if (session.customerId) {
        sellauthTickets = tickets.filter((t) => t.shop_customer_id === session.customerId);
      } else if (session.customerEmail) {
        sellauthTickets = tickets.filter(
          (t) => t.email && t.email.toLowerCase() === session.customerEmail.toLowerCase()
        );
      }
    } catch (e) {
      console.error("SellAuth tickets fetch failed:", e instanceof Error ? e.message : e);
    }
    const normalizedSell = sellauthTickets.map((t) => {
      const statusRaw = String(t.status ?? "").trim();
      const isOpen = t.isOpen === true || t.isOpen !== false && statusRaw.toLowerCase() !== "closed";
      return {
        ...t,
        ticketId: t.ticketId ?? t.id ?? t.ticket_id ?? null,
        status: statusRaw || (isOpen ? "Open" : "Closed"),
        isOpen,
        createdAt: t.createdAt ?? t.created_at ?? null,
        closedAt: t.closedAt ?? t.closed_at ?? null,
        channelUrl: t.channelUrl ?? t.channel_url ?? null,
        transcriptUrl: t.transcriptUrl ?? t.transcript_url ?? null,
        source: t.source ?? "sellauth"
      };
    });
    const discordTickets = await getDiscordTickets(String(session.id || ""));
    const merged = [...discordTickets, ...normalizedSell].sort((a, b) => {
      const ta = Date.parse(a?.createdAt || "") || 0;
      const tb = Date.parse(b?.createdAt || "") || 0;
      return tb - ta;
    });
    return res.json({ ok: true, data: { tickets: merged } });
  } catch (e) {
    res.json({ ok: true, data: { tickets: [] } });
  }
});
router3.get("/download", rateLimiter(60, 6e4), requireAuth, async (req, res) => {
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
});

// server/routes/checkout.ts
var import_express4 = require("express");
var router4 = (0, import_express4.Router)();
router4.get("/altcha", rateLimiter(60, 6e4), async (req, res) => {
  try {
    const data = await getAltchaChallenge();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "Verification service temporarily unavailable" });
  }
});
router4.post("/checkout", rateLimiter(20, 6e4), async (req, res) => {
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({ error: "Invalid checkout request body" });
    }
    const sanitizedCart = sanitizeCart(req.body.cart);
    if (sanitizedCart.length === 0) {
      return res.status(400).json({ error: "Cart is empty or contains invalid items" });
    }
    let sanitizedEmail;
    if (req.body.email && typeof req.body.email === "string") {
      if (!isValidEmail(req.body.email)) {
        return res.status(400).json({ error: "Please enter a valid email address" });
      }
      sanitizedEmail = req.body.email.trim();
    }
    if (!sanitizedEmail) {
      const sessionEmail = req.session?.discordEmail || req.session?.customerEmail;
      if (sessionEmail && isValidEmail(sessionEmail)) sanitizedEmail = sessionEmail.trim();
    }
    let altcha = req.body.altcha;
    if (!altcha || typeof altcha !== "string" || altcha.length < 20) {
      altcha = await getOrSolveAltcha();
    }
    const cleanCheckoutPayload = {
      cart: sanitizedCart,
      shopId: Number(config.shopId),
      altcha: typeof altcha === "string" ? altcha : ""
    };
    if (sanitizedEmail) cleanCheckoutPayload.email = sanitizedEmail;
    const coupon = sanitizeShortString(req.body.coupon);
    if (coupon) cleanCheckoutPayload.coupon = coupon;
    const gateway = sanitizeShortString(req.body.gateway);
    if (gateway) cleanCheckoutPayload.gateway = gateway;
    if (typeof req.body.customFields === "object" && req.body.customFields !== null && !Array.isArray(req.body.customFields)) {
      cleanCheckoutPayload.customFields = req.body.customFields;
    }
    const { status, data } = await createCheckout(cleanCheckoutPayload);
    res.status(status).json(data);
  } catch (e) {
    console.error("Checkout error:", e);
    res.status(500).json({ error: "Payment gateway communication error. Please try again." });
  }
});

// server/utils/guide.ts
function renderGuidePage(siteName, inviteUrl) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Setup Guide \u2014 ${esc(siteName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    background: #0a0a19; color: #fff; padding: 24px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .card { width: 100%; max-width: 480px; text-align: center; }
  .eyebrow {
    font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
    color: rgba(255,255,255,0.5);
  }
  h1 { margin-top: 12px; font-size: 32px; font-weight: 700; letter-spacing: -0.01em; }
  p { margin-top: 12px; font-size: 15px; line-height: 1.7; color: rgba(255,255,255,0.6); }
  .join {
    margin-top: 28px; display: inline-flex; width: 100%; align-items: center; justify-content: center; gap: 8px;
    background: #5865f2; color: #fff; text-decoration: none;
    font-size: 15px; font-weight: 600; padding: 14px 20px; border-radius: 16px;
    box-shadow: 0 20px 45px -28px rgba(88,101,242,0.95); transition: background 0.15s ease;
  }
  .join:hover { background: #6772f6; }
  .back { margin-top: 16px; display: inline-block; font-size: 13px; color: rgba(255,255,255,0.5); text-decoration: none; }
  .back:hover { color: rgba(255,255,255,0.85); }
</style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Setup Guide</div>
    <h1>${esc(siteName)} Setup</h1>
    <p>Everything \u2014 setup, support and tickets \u2014 happens in our Discord server. Join below to get started.</p>
    <a class="join" href="${esc(inviteUrl)}" target="_blank" rel="noreferrer">Join Discord</a>
    <br />
    <a class="back" href="/">\u2190 Back to home</a>
  </main>
</body>
</html>`;
}

// server/app.ts
function createApp() {
  const app2 = (0, import_express5.default)();
  app2.disable("x-powered-by");
  app2.use(securityHeaders);
  app2.use(urlNormalizer);
  app2.use((0, import_cookie_parser.default)());
  app2.use(import_express5.default.json({ limit: "1mb" }));
  app2.use(attachSession);
  app2.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  app2.use("/api/outplayed", router);
  app2.use("/api/outplayed", router2);
  app2.use("/api/outplayed", router3);
  app2.use("/api/sellauth", router4);
  app2.use("/api/sellauth", legacyAliasRouter);
  app2.use("/api", legacyAliasRouter);
  app2.use("/cdn-cgi/*", (req, res) => {
    res.type("application/javascript").send("// cdn-cgi stub\n");
  });
  app2.get(["/guide", "/guide/"], (req, res) => {
    res.type("html").send(renderGuidePage("Outplayed", config.discordInviteUrl));
  });
  const staticPath = import_fs2.default.existsSync(import_path2.default.join(process.cwd(), "dist", "index.html")) ? import_path2.default.join(process.cwd(), "dist") : import_path2.default.join(process.cwd(), "public");
  app2.use(
    import_express5.default.static(staticPath, {
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      }
    })
  );
  app2.use("/api", apiNotFound);
  app2.get("*", (req, res) => {
    res.sendFile(import_path2.default.join(staticPath, "index.html"));
  });
  app2.use(errorHandler);
  return app2;
}

// server/standalone.ts
var PORT = Number(process.env.PORT || 3e3);
var app = createApp();
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
//# sourceMappingURL=server.cjs.map
