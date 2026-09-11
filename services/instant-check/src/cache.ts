// 24 h result cache, keyed by domain.
//
// HONEST LIMIT, same caveat as the rate limiter: this Map lives in ONE function
// instance. A second instance, or the same instance after a cold start, has an
// empty cache and re-checks the domain. So it is a hit-rate optimisation, not a
// guarantee — a domain may legitimately be re-crawled more than once a day.
//
// The cross-instance half of the 24 h cache is free and needs no store: the
// handler answers with `Cache-Control: public, s-maxage=86400,
// stale-while-revalidate=86400`, so Vercel's CDN caches the JSON per URL — and
// the URL is exactly one domain. A repeat check of a popular domain is then
// served at the edge and the function is never invoked. This in-memory map is
// what catches the requests the CDN cannot (a MISS on a different edge, a
// no-store client). Deliberately no KV/Redis: the service must cost $0.

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface TtlCacheOptions {
  ttlMs?: number;
  /** Entry ceiling; the oldest entry is evicted past it, so a spray of
   *  one-off domains cannot grow this map without limit. */
  maxEntries?: number;
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expires: number;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: TtlCacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DAY_MS;
    this.maxEntries = opts.maxEntries ?? 500;
    this.now = opts.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Test seam only. */
  get size(): number {
    return this.entries.size;
  }
}
