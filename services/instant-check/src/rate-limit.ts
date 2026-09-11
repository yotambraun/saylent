// Per-IP token bucket ("per-IP rate limit").
//
// HONEST LIMIT, stated here and again in website/content/docs/check.mdx:
// this bucket lives in ONE function instance's
// memory. Vercel Fluid Compute reuses a warm instance across many concurrent
// invocations, so in practice a single caller hammering the endpoint keeps
// hitting the same bucket — but there is no guarantee. Under a burst Vercel
// scales out, and each new instance starts with a full bucket; a cold start
// resets it entirely. So this is a POLITENESS limit that stops the accidental
// loop and the casual scraper, not an anti-abuse control.
//
// The real controls are the ones that do not need shared state:
//   1. the 24 h cache (src/cache.ts) + `Cache-Control: s-maxage`, so a repeated
//      domain is answered by Vercel's CDN and never reaches this code at all;
//   2. Vercel's own WAF rate-limiting rule on the project, which IS global and
//      is the recommended step if the endpoint is ever abused.
// Deliberately no KV/Redis: this service must stay on the free tier and cost $0.

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the next token — the value sent as `Retry-After`. */
  retryAfter: number;
  /** Tokens left after this decision (0 when the request was refused). */
  remaining: number;
}

export interface RateLimiterOptions {
  /** Burst size: how many checks one IP may fire back to back. */
  capacity?: number;
  /** How long one token takes to refill, in ms. */
  refillMs?: number;
  /** How many IPs to track before evicting the oldest. Bounded so a spray of
   *  spoofed IPs cannot grow this map without limit. */
  maxKeys?: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updated: number;
}

export const DEFAULT_CAPACITY = 5;
export const DEFAULT_REFILL_MS = 12_000; // 5 checks/minute sustained, burst 5.

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(opts: RateLimiterOptions = {}) {
    this.capacity = opts.capacity ?? DEFAULT_CAPACITY;
    this.refillMs = opts.refillMs ?? DEFAULT_REFILL_MS;
    this.maxKeys = opts.maxKeys ?? 10_000;
    this.now = opts.now ?? Date.now;
  }

  /** Continuous refill: tokens accrue at 1 / refillMs and are capped at
   *  `capacity`, so the decision depends only on elapsed time and never on how
   *  often `take` happens to be called.
   *
   *  `cost` (P4 security review #18): a cache HIT is cheap for the origin
   *  (no outbound fetch, no engine call) but still costs a request — a caller
   *  who defeats the CDN's URL-keyed cache with junk query params (the domain
   *  is still normalized by `validateDomain`/`clientIp` before it ever
   *  reaches here, so this never buckets on the raw query string) must not
   *  get unlimited free requests against this instance. Default 1 is a full
   *  token, matching every existing caller (a real check). */
  take(key: string, cost = 1): RateLimitDecision {
    const t = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updated: t };
    const elapsed = Math.max(0, t - bucket.updated);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed / this.refillMs);
    bucket.updated = t;

    if (bucket.tokens < cost) {
      const waitMs = (cost - bucket.tokens) * this.refillMs;
      this.remember(key, bucket);
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)), remaining: 0 };
    }

    bucket.tokens -= cost;
    this.remember(key, bucket);
    return { allowed: true, retryAfter: 0, remaining: Math.floor(bucket.tokens) };
  }

  /** Map iteration order is insertion order, so the first key is the oldest. */
  private remember(key: string, bucket: Bucket): void {
    // Re-insert so the touched key moves to the end (simple LRU on a Map).
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }
  }

  /** Test seam only. */
  get size(): number {
    return this.buckets.size;
  }
}

/**
 * The caller's IP as Vercel reports it. `x-forwarded-for` is a comma-separated
 * chain; the FIRST entry is the client. On Vercel the header is set by the
 * platform edge, so it cannot be spoofed past it — off Vercel (a local `node`
 * run) it can be, which only matters for a limiter that is already best-effort.
 * `x-real-ip` is the fallback Vercel also sets; "unknown" buckets everything
 * anonymous together, which is the safe direction.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
