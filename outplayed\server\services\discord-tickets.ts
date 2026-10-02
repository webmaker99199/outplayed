import crypto from "crypto";
import { gunzipSync } from "node:zlib";
import { config } from "../config.js";

/**
 * Discord tickets/transcripts for the dashboard (per-server).
 *
 * The Discord bots mirror ticket records into Firestore `dashboardSnapshots`
 * (project `outplayed-7eeb7`, packed + gzipped buckets). This service reads
 * those snapshots server-side, keeps only rows that belong to THIS site's
 * guild (`config.tickets.guildId`) and to the logged-in Discord user
 * (`ownerId`/`userId` === the OAuth Discord id), and normalizes them into the
 * shape the storefront ticket cards already render:
 *
 *   { ticketId, status, isOpen, createdAt, closedAt, channelUrl, transcriptUrl }
 *
 * Open tickets get a Discord `channelUrl` ("Open Ticket"), closed tickets get
 * a `transcriptUrl` ("View Transcript"). Everything runs server-side with the
 * Firebase service account from env vars; when Firebase is not configured the
 * service returns [] and the dashboard falls back to SellAuth tickets only.
 */

export interface DiscordTicket {
  ticketId: string;
  channelId: string | null;
  channelName: string | null;
  status: "Open" | "Closed";
  isOpen: boolean;
  createdAt: string | null;
  closedAt: string | null;
  channelUrl: string | null;
  transcriptUrl: string | null;
  source: "discord";
}

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

let cachedToken: { token: string; expiresAt: number } | null = null;
const userCache = new Map<string, { expiresAt: number; tickets: DiscordTicket[] }>();

function firebaseReady(): boolean {
  return Boolean(
    config.firebase.projectId && config.firebase.clientEmail && config.firebase.privateKey
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input as any).toString("base64url");
}

/** Mint a Google OAuth2 access token from the service-account key (no new deps). */
async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 90_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.firebase.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), {
    key: config.firebase.privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });
  const assertion = `${signingInput}.${signature.toString("base64url")}`;

  const resp = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Google token exchange failed (${resp.status})`);
  const data = (await resp.json()) as any;
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

function firestoreValue(value: any): any {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(firestoreValue);
  if ("mapValue" in value) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value.mapValue?.fields || {})) out[k] = firestoreValue(v);
    return out;
  }
  if ("bytesValue" in value) return value.bytesValue;
  return null;
}

function decodeDoc(doc: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc?.fields || {})) out[k] = firestoreValue(v);
  return out;
}

async function runQuery(structuredQuery: unknown): Promise<any[]> {
  const token = await accessToken();
  const url =
    `https://firestore.googleapis.com/v1/projects/${config.firebase.projectId}` +
    `/databases/(default)/documents:runQuery`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`Firestore query failed (${resp.status})`);
  const rows = (await resp.json()) as any[];
  return Array.isArray(rows) ? rows : [];
}

/** Unpack one dashboardSnapshots doc into its ticket rows (checksum-verified). */
function unpackTickets(snapshot: Record<string, any>): Array<{ id: string; record: Record<string, any> }> {
  const source = String(snapshot.source || "");
  const guildId = String(snapshot.guildId || "");
  const kind = String(snapshot.kind || "");
  const bucket = Number(snapshot.bucket);
  const id = String((snapshot as any).id || "");
  if (
    kind !== "tickets" ||
    !Number.isInteger(bucket) ||
    bucket < 0 ||
    bucket >= 32 ||
    id !== `${source}-tickets-${String(bucket).padStart(2, "0")}`
  ) {
    return [];
  }
  const encoded = String(snapshot.payloadGzip || "");
  const expected = String(snapshot.sha256 || "");
  if (!encoded || !expected) return [];
  const compressed = Buffer.from(encoded, "base64");
  if (compressed.length > 700_000) return [];
  let raw: Buffer;
  try {
    raw = gunzipSync(compressed, { maxOutputLength: 16_000_000 });
  } catch {
    return [];
  }
  if (crypto.createHash("sha256").update(raw).digest("hex") !== expected) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: Array<{ id: string; record: Record<string, any> }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { path, record } = item as { path?: unknown; record?: unknown };
    if (typeof path !== "string" || !record || typeof record !== "object" || Array.isArray(record)) continue;
    const parts = path.split("/");
    // guilds/{guildId}/tickets/{ticketId}
    if (parts.length !== 4 || parts[0] !== "guilds" || parts[2] !== "tickets") continue;
    // Enforce per-server isolation: row must belong to this site's guild.
    if (parts[1] !== config.tickets.guildId || String((record as any).guildId || "") !== config.tickets.guildId) continue;
    if (String((record as any).source || "") !== source) continue;
    rows.push({ id: parts[3], record: { ...(record as Record<string, any>), guildId } });
  }
  return rows;
}

function normalizeTicket(id: string, record: Record<string, any>): DiscordTicket {  const statusRaw = String(record.status || "").toLowerCase();
  const isOpen = statusRaw !== "closed";
  const channelId = record.channelId != null ? String(record.channelId) : record.ticketId != null ? String(record.ticketId) : id;
  const channelUrl = `https://discord.com/channels/${config.tickets.guildId}/${channelId}`;
  let transcriptUrl: string | null = null;
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
    source: "discord",
  };
}

/**
 * Firestore cloud read (packed dashboardSnapshots). Used when the site runs
 * away from the bot (e.g. Vercel). Returns [] when Firebase is unconfigured
 * or unreachable — never throws.
 */
async function getCloudTickets(discordUserId: string): Promise<DiscordTicket[]> {
  if (!firebaseReady()) return [];
  try {
    const tickets: DiscordTicket[] = [];
    for (const source of config.tickets.sources) {
      const rows = await runQuery({
        from: [{ collectionId: "dashboardSnapshots" }],
        where: {
          compositeFilter: {
            op: "AND",
            filters: [
              { fieldFilter: { field: { fieldPath: "source" }, op: "EQUAL", value: { stringValue: source } } },
              { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: "tickets" } } },
            ],
          },
        },
      });
      for (const row of rows) {
        const doc = row?.document;
        if (!doc) continue;
        const snapshot: Record<string, any> = { ...decodeDoc(doc), id: String(doc.name || "").split("/").pop() || "" };
        // Belt + suspenders: ignore snapshots outside this site's guild.
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

/**
 * Local bot-database fallback (same host).
 *
 * When TICKET_DB_PATH points at a bot's transcript_outbox.sqlite3, ticket
 * rows are read directly from it — no Firestore quota involved. This is the
 * primary source when the site runs on the same machine/VPS as the bot.
 * Never throws.
 */
async function getLocalTickets(discordUserId: string): Promise<DiscordTicket[]> {
  const dbPath = config.ticketDbPath;
  if (!dbPath) return [];
  try {
    const sqlite: any = await import("node:sqlite").catch(() => null);
    if (!sqlite?.DatabaseSync) return [];
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare("SELECT path, payload FROM dashboard_rows WHERE kind = 'tickets' AND guild_id = ?")
        .all(config.tickets.guildId) as Array<{ path: unknown; payload: unknown }>;
      const tickets: DiscordTicket[] = [];
      for (const row of rows) {
        if (typeof row.path !== "string" || typeof row.payload !== "string") continue;
        const parts = row.path.split("/");
        // guilds/{guildId}/tickets/{ticketId}
        if (parts.length !== 4 || parts[0] !== "guilds" || parts[2] !== "tickets") continue;
        if (parts[1] !== config.tickets.guildId) continue;
        let record: Record<string, any>;
        try {
          record = JSON.parse(row.payload);
        } catch {
          continue;
        }
        if (!record || typeof record !== "object" || Array.isArray(record)) continue;
        if (!(config.tickets.sources as readonly string[]).includes(String(record.source || ""))) continue;
        if (String(record.guildId || "") !== config.tickets.guildId) continue;
        const owner =
          record.ownerId != null ? String(record.ownerId) : record.userId != null ? String(record.userId) : "";
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

/**
 * Discord tickets for one Discord user id, scoped to this site's server.
 * Reads the local bot database + Firestore snapshots and merges them.
 * Never throws — returns [] when nothing is reachable.
 */
export async function getDiscordTickets(discordUserId: string): Promise<DiscordTicket[]> {
  if (!discordUserId || !/^[0-9]{5,25}$/.test(String(discordUserId))) return [];
  const cached = userCache.get(discordUserId);
  if (cached && Date.now() < cached.expiresAt) return cached.tickets;
  try {
    const [local, cloud] = await Promise.all([getLocalTickets(discordUserId), getCloudTickets(discordUserId)]);
    const seen = new Set<string>();
    const merged: DiscordTicket[] = [];
    for (const t of [...local, ...cloud]) {
      if (seen.has(t.ticketId)) continue;
      seen.add(t.ticketId);
      merged.push(t);
    }
    merged.sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
    userCache.set(discordUserId, { expiresAt: Date.now() + 60_000, tickets: merged });
    return merged;
  } catch (e) {
    console.error("Discord tickets fetch failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
