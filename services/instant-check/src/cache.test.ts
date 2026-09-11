import { describe, expect, it } from "vitest";
import { DAY_MS, TtlCache } from "./cache";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TtlCache", () => {
  it("returns a value inside the TTL and forgets it after", () => {
    const c = clock();
    const cache = new TtlCache<string>({ ttlMs: DAY_MS, now: c.now });
    cache.set("acme.com", "result");
    c.advance(DAY_MS - 1);
    expect(cache.get("acme.com")).toBe("result");
    c.advance(1);
    expect(cache.get("acme.com")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("misses on an unknown key", () => {
    expect(new TtlCache<string>().get("nothing.com")).toBeUndefined();
  });

  it("restarts the TTL when a key is written again", () => {
    const c = clock();
    const cache = new TtlCache<string>({ ttlMs: 1_000, now: c.now });
    cache.set("k", "one");
    c.advance(900);
    cache.set("k", "two");
    c.advance(900);
    expect(cache.get("k")).toBe("two");
  });

  it("evicts the oldest entry past maxEntries", () => {
    const cache = new TtlCache<string>({ ttlMs: DAY_MS, maxEntries: 2, now: clock().now });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe("3");
  });
});
