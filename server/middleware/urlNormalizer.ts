import type { Request, Response, NextFunction } from "express";

/**
 * Normalize the incoming URL across deployment targets:
 *
 * - Netlify functions prefix (/.netlify/functions/api) is stripped.
 * - `x-forwarded-uri` / `x-original-uri` / `x-matched-path` from proxies are
 *   honored when they carry the true /api path.
 * - Legacy external aliases (/outplayed, /sellauth, /health, /auth) are
 *   rewritten onto the canonical /api namespace.
 *
 * The obsolete Vercel catch-all `?path=` rewriting was removed together with
 * the `[...path]` function it targeted.
 */
export function urlNormalizer(req: Request, res: Response, next: NextFunction) {
  let url = req.url || "/";

  // Strip the Netlify functions prefix.
  if (url.startsWith("/.netlify/functions/api")) {
    url = url.replace("/.netlify/functions/api", "/api");
  }

  // Some proxies pass the true incoming path in a header.
  const forwardedUri =
    (req.headers["x-forwarded-uri"] as string) || (req.headers["x-original-uri"] as string);
  if (forwardedUri && forwardedUri.startsWith("/api/")) {
    url = forwardedUri;
  } else {
    const matchedPath = req.headers["x-matched-path"] as string;
    if (matchedPath && matchedPath.startsWith("/api/") && !matchedPath.includes("[")) {
      url = matchedPath;
    }
  }

  // Legacy aliases onto the canonical /api namespace.
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
