import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { urlNormalizer } from "./middleware/urlNormalizer.js";
import { attachSession } from "./middleware/auth.js";
import { apiNotFound, errorHandler } from "./middleware/errorHandler.js";
import { publicRouter, legacyAliasRouter } from "./routes/public.js";
import { authRouter } from "./routes/auth.js";
import { customerRouter } from "./routes/customer.js";
import { checkoutRouter } from "./routes/checkout.js";

/**
 * Application factory. The same app powers:
 *
 * - Vercel:  api/index.ts imports createApp() and serves it as the /api
 *            serverless function (vercel.json rewrites /api/* -> /api).
 * - Netlify: netlify/functions/api.ts wraps it with serverless-http.
 * - Local:   server/standalone.ts listens on a port.
 *
 * Relative imports use explicit `.js` extensions because Vercel ships the
 * traced files as ESM (package.json has "type": "module") and Node's ESM
 * loader does not resolve extensionless imports.
 */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // Global middleware
  app.use(securityHeaders);
  app.use(urlNormalizer);
  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(attachSession);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Canonical API namespace
  app.use("/api/outplayed", publicRouter);
  app.use("/api/outplayed", authRouter);
  app.use("/api/outplayed", customerRouter);

  // Checkout + ALTCHA
  app.use("/api/sellauth", checkoutRouter);

  // Legacy aliases for the public storefront endpoints (no duplicated handlers)
  app.use("/api/sellauth", legacyAliasRouter);
  app.use("/api", legacyAliasRouter);

  // Stray Cloudflare /cdn-cgi requests get a valid empty script response.
  app.use("/cdn-cgi/*", (req, res) => {
    res.type("application/javascript").send("// cdn-cgi stub\n");
  });

  // Static site (dist in production, public in development)
  const staticPath = fs.existsSync(path.join(process.cwd(), "dist", "index.html"))
    ? path.join(process.cwd(), "dist")
    : path.join(process.cwd(), "public");

  app.use(
    express.static(staticPath, {
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // Unmatched API paths return JSON, never the SPA HTML.
  app.use("/api", apiNotFound);

  // SPA fallback for client-side routes.
  app.get("*", (req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  // Global error handler (always JSON, generic message in production).
  app.use(errorHandler);

  return app;
}
