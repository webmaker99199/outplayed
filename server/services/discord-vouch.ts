import { config } from "../config.js";

export type DiscordVouch = {
  id: string;
  message: string;
  rating: number;
  createdAt: string;
  author: { name: string; avatarUrl: string | null };
};

let cachedVouches: { expiresAt: number; value: DiscordVouch[] } | null = null;

function avatarUrl(author: any): string | null {
  if (!author || !author.id || !author.avatar) return null;
  const extension = String(author.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.${extension}?size=128`;
}

function cleanMessage(raw: string): string {
  return raw
    .replace(/^\s*<@!?\d+>\s*$/gim, "")
    .replace(/^\s*(?:rating\s*[:：-]?\s*)?(?:[⭐★]\s*){1,5}\s*$/gim, "")
    .replace(/^\s*(?:rating\s*[:：-]?\s*)?\d(?:\.\d)?\s*\/\s*5\s*$/gim, "")
    .replace(/[⭐★]+/g, "")
    .replace(/[`*_]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mapMessage(message: any): { vouch: DiscordVouch; hasReviewerEmbed: boolean } {
  const sourceAuthor = message?.author || {};
  const embeds = Array.isArray(message?.embeds) ? message.embeds : [];
  const reviewerEmbed = embeds.find((embed: any) => embed?.author?.name);
  const reviewer = reviewerEmbed?.author || sourceAuthor;
  const embedText = embeds
    .flatMap((embed: any) => [
      embed?.title,
      embed?.description,
      ...(Array.isArray(embed?.fields)
        ? embed.fields.flatMap((field: any) => [field?.name, field?.value])
        : []),
    ])
    .filter(Boolean)
    .join("\n");
  const rawMessage = [message?.content, embedText].filter(Boolean).join("\n");
  const ratingMatches = rawMessage.match(/[⭐★]/g) || [];

  return {
    hasReviewerEmbed: Boolean(reviewerEmbed),
    vouch: {
      id: String(message?.id || ""),
      message: cleanMessage(rawMessage),
      rating: Math.min(ratingMatches.length || 5, 5),
      createdAt: String(message?.timestamp || new Date().toISOString()),
      author: {
        name: String(reviewer?.name || reviewer?.username || "Verified Customer"),
        avatarUrl: reviewer?.icon_url || avatarUrl(reviewer) || avatarUrl(sourceAuthor),
      },
    },
  };
}

function isPublishable(vouch: DiscordVouch, sourceAuthor: any, hasReviewerEmbed: boolean): boolean {
  if (!vouch.id || !vouch.message) return false;
  const lower = vouch.message.toLowerCase();
  const prompt = [
    "thank you for vouching",
    "please leave a vouch",
    "use the button below",
    "new vouch",
  ].some((phrase) => lower.includes(phrase));
  if (prompt) return false;
  if (sourceAuthor?.bot && !hasReviewerEmbed) return false;
  return true;
}

export async function getDiscordVouches(limit = 18): Promise<DiscordVouch[]> {
  if (!config.discord.botToken || !config.discord.vouchesChannelId) return [];
  if (cachedVouches && cachedVouches.expiresAt > Date.now()) {
    return cachedVouches.value.slice(0, limit);
  }

  const endpoint = `https://discord.com/api/v10/channels/${encodeURIComponent(
    config.discord.vouchesChannelId,
  )}/messages?limit=100`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      Authorization: `Bot ${config.discord.botToken}`,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Discord API responded with ${response.status}`);

  const messages = await response.json();
  const vouches = (Array.isArray(messages) ? messages : [])
    .filter((message: any) => message?.type === 0)
    .map((message: any) => ({
      message,
      ...mapMessage(message),
    }))
    .filter(({ message, vouch, hasReviewerEmbed }: any) =>
      isPublishable(vouch, message?.author, hasReviewerEmbed),
    )
    .map(({ vouch }: any) => vouch as DiscordVouch)
    // Discord returns newest messages first, but sort explicitly so the
    // reviews page stays recent-first even if the upstream response changes.
    .sort((a: DiscordVouch, b: DiscordVouch) => {
      const bTime = Date.parse(b.createdAt);
      const aTime = Date.parse(a.createdAt);
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });

  cachedVouches = { expiresAt: Date.now() + 60_000, value: vouches };
  return vouches.slice(0, limit);
}
