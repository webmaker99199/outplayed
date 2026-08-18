import type { Request, Response, NextFunction } from "express";

/**
 * Lightweight in-memory sliding-window rate limiter.
 *
 * NOTE: This memory is per serverless instance, so it is NOT a global rate
 * limit across Vercel/Netlify instances. It only provides per-instance
 * protection against bursts. Do not rely on it as the sole defense for
 * anything critical.
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetTime) rateLimitMap.delete(key);
  }
}, 60_000).unref?.();

export function rateLimiter(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
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
