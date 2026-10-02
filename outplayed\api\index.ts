import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../server/app.js";

const app = createApp();

/**
 * Vercel Node.js function entry point.
 *
 * This is the single /api function that vercel.json rewrites every /api/*
 * request to (the documented Express-on-Vercel pattern). Vercel invokes the
 * handler with the ORIGINAL request path in `req.url`, so the Express router
 * in server/app.ts matches routes like /api/outplayed/shop directly.
 *
 * Note: the relative import uses an explicit `.js` extension because Vercel
 * ships traced ESM files ("type": "module") and Node does not resolve
 * extensionless relative imports.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    return app(req as any, res as any);
  } catch (e: any) {
    console.error("Vercel /api handler error:", e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "An unexpected server error occurred." }));
    }
    return undefined;
  }
}
