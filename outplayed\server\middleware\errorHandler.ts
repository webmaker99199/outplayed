import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Centralized error handling.
 *
 * - `safeError` always returns a plain string. Detailed messages are only
 *   surfaced in development; production gets a generic fallback so no keys,
 *   hostnames, or stack internals ever reach the browser.
 * - API requests that match no route get a JSON 404 (never an HTML page).
 * - A final error handler guarantees JSON responses for anything thrown.
 */

export function safeError(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error) {
    const msg = e.message?.trim();
    if (msg) return config.isProduction ? fallback : msg;
  }
  return fallback;
}

/** JSON 404 for unmatched /api/* paths (before the SPA fallback). */
export function apiNotFound(req: Request, res: Response) {
  res.status(404).json({ ok: false, error: "Not found" });
}

/** Global error handler — last resort, always JSON. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  console.error("Unhandled error:", err);
  if (res.headersSent) return next(err);
  const detail = err instanceof Error && err.message ? err.message : "";
  res.status(500).json({
    ok: false,
    error: config.isProduction || !detail ? "An unexpected server error occurred." : detail,
  });
}
