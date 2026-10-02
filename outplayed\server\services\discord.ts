import crypto from "crypto";
import type { Request } from "express";
import { config } from "../config.js";

/**
 * Discord OAuth helpers. Session/cookie handling lives in the auth routes;
 * this module only owns the Discord-specific HTTP logic.
 */

const DISCORD_API = "https://discord.com/api";

/** Reconstruct the public callback URL from forwarded headers (works behind Vercel/Netlify). */
export function buildCallbackUrl(req: Request): string {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${host}/api/outplayed/auth/discord/callback`;
}

/** Build the Discord authorization URL for a given callback + state. */
export function buildDiscordAuthUrl(callbackUrl: string, state: string): string {
  return (
    `${DISCORD_API}/oauth2/authorize?client_id=${encodeURIComponent(config.discord.clientId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code&scope=identify%20email&state=${encodeURIComponent(state)}`
  );
}

export function encodeState(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeState(state: string | undefined): { returnTo?: string } | null {
  if (!state) return null;
  try {
    return JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function randomNonce(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** Exchange an authorization code for the Discord user. Returns null on failure. */
export async function getDiscordUser(code: string, callbackUrl: string): Promise<any | null> {
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
        redirect_uri: callbackUrl,
      }),
    });
    if (!tokenResp.ok) return null;
    const tokenData = await tokenResp.json();

    const userResp = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userResp.ok) return null;
    return await userResp.json();
  } catch (e) {
    console.error("Discord token exchange failed:", e);
    return null;
  }
}
