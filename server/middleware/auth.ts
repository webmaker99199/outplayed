import type { Request, Response, NextFunction } from "express";
import { getSessionFromReq, type SessionData } from "../utils/session.js";

/**
 * Authentication middleware. Sessions are read from the signed cookie (or
 * Bearer token) and attached to `req.session`. `requireAuth` rejects requests
 * without a valid session so customer-specific endpoints never have to
 * remember their own security check.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionData | null;
    }
  }
}

export function attachSession(req: Request, _res: Response, next: NextFunction) {
  req.session = getSessionFromReq(req);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSessionFromReq(req);
  if (!session) {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }
  req.session = session;
  next();
}
