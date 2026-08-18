import crypto from "crypto";
import { config } from "../config.js";

export interface SessionData {
  id?: string;
  username?: string;
  avatar?: string | null;
  customerId?: number | null;
  customerEmail?: string | null;
  needsCustomerSelection?: boolean;
}

/** Sign an HMAC-protected, base64url-encoded session payload. */
export function signSession(data: unknown): string {
  const json = JSON.stringify(data);
  const sig = crypto.createHmac("sha256", config.session.secret).update(json).digest("hex");
  return Buffer.from(json).toString("base64url") + "." + sig;
}

/** Verify a signed session token. Returns null when missing or tampered with. */
export function verifySession(token?: string): SessionData | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const expectedSig = crypto.createHmac("sha256", config.session.secret).update(json).digest("hex");
    if (sig !== expectedSig) return null;
    return JSON.parse(json) as SessionData;
  } catch {
    return null;
  }
}

interface SessionRequestLike {
  cookies?: Record<string, unknown>;
  headers?: { authorization?: string };
}

/**
 * Resolve the session from the signed cookie first, then fall back to a
 * `Bearer` token in the Authorization header.
 */
export function getSessionFromReq(req: SessionRequestLike): SessionData | null {
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
