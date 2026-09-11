import { describe, expect, it } from "vitest";
import { clientIp, RateLimiter } from "./rate-limit";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("RateLimiter", () => {
  it("allows a full burst, then refuses with a whole-second Retry-After", () => {
    const c = clock();
    const limiter = new RateLimiter({ capacity: 3, refillMs: 10_000, now: c.now });
    for (let i = 0; i < 3; i++) expect(limiter.take("1.1.1.1").allowed).toBe(true);
    const refused = limiter.take("1.1.1.1");
    expect(refused).toMatchObject({ allowed: false, remaining: 0 });
    expect(refused.retryAfter).toBe(10);
  });

  it("refills continuously, one token per refillMs", () => {
    const c = clock();
    const limiter = new RateLimiter({ capacity: 2, refillMs: 10_000, now: c.now });
    limiter.take("ip");
    limiter.take("ip");
    expect(limiter.take("ip").allowed).toBe(false);
    c.advance(5_000);
    expect(limiter.take("ip").allowed).toBe(false); // half a token
    c.advance(5_000);
    expect(limiter.take("ip").allowed).toBe(true);
    expect(limiter.take("ip").allowed).toBe(false);
  });

  it("never accrues more than the capacity, however long the gap", () => {
    const c = clock();
    const limiter = new RateLimiter({ capacity: 2, refillMs: 1_000, now: c.now });
    c.advance(10_000_000);
    expect(limiter.take("ip").allowed).toBe(true);
    expect(limiter.take("ip").allowed).toBe(true);
    expect(limiter.take("ip").allowed).toBe(false);
  });

  it("buckets each IP separately", () => {
    const limiter = new RateLimiter({ capacity: 1, refillMs: 60_000, now: clock().now });
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
    expect(limiter.take("b").allowed).toBe(true);
  });

  it("accepts a fractional cost (a cache hit spends less than a full check)", () => {
    const c = clock();
    const limiter = new RateLimiter({ capacity: 1, refillMs: 60_000, now: c.now });
    expect(limiter.take("ip", 0.2)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.take("ip", 0.2)).toMatchObject({ allowed: true, remaining: 0 });
    // Default cost (1) still applies when the caller passes nothing.
    expect(limiter.take("ip").allowed).toBe(false);
  });

  it("refuses a cost it cannot afford even with tokens available for a cheaper one", () => {
    // 0.75/0.25 are exact in binary floating point, so this isn't sensitive
    // to rounding the way e.g. 0.9/0.1 would be.
    const limiter = new RateLimiter({ capacity: 1, refillMs: 60_000, now: clock().now });
    limiter.take("ip", 0.75);
    expect(limiter.take("ip", 0.3).allowed).toBe(false); // only 0.25 left
    expect(limiter.take("ip", 0.25).allowed).toBe(true); // exactly enough
  });

  it("evicts the least recently used key so the map cannot grow without limit", () => {
    const limiter = new RateLimiter({ capacity: 1, refillMs: 60_000, maxKeys: 2, now: clock().now });
    limiter.take("a");
    limiter.take("b");
    limiter.take("a"); // touching "a" moves it ahead of "b"
    limiter.take("c");
    expect(limiter.size).toBe(2);
    expect(limiter.take("b").allowed).toBe(true); // "b" was evicted, so it starts fresh
  });
});

describe("clientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.4, 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.4");
  });

  it("falls back to x-real-ip, then to a shared anonymous bucket", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
