/**
 * Minimal dependency-free in-memory TTL cache.
 *
 * NOTE: On Vercel/Netlify this memory belongs to a single serverless instance
 * and is not shared or persistent. It exists only to avoid hammering upstream
 * APIs (SellAuth/Discord) repeatedly within a warm instance's lifetime.
 * Nothing that must be durable or globally shared is ever stored here.
 */
export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs?: number): void;
  delete(key: string): void;
  clear(): void;
}

export function createTtlCache<T>(defaultTtlMs: number): TtlCache<T> {
  const store = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlMs = defaultTtlMs) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}
