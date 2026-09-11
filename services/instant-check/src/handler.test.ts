// The whole HTTP surface, against a FAKE gate function — no network, no engine,
// no LLM. Validation, CORS, the cache, the rate limiter, the hard timeout and
// the structured errors are all exercised here.
import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "./cache";
import { createHandler, DEFAULT_ALLOWED_ORIGINS } from "./handler";
import { RateLimiter } from "./rate-limit";
import type { GateFn, InstantCheckResult } from "./types";

const SITE = DEFAULT_ALLOWED_ORIGINS[0];

function fakeResult(domain: string, checkedAt = "2026-09-09T00:00:00.000Z"): InstantCheckResult {
  return {
    domain,
    result: "warn",
    robots: {
      status: "warn",
      readable: true,
      training: [{ agent: "GPTBot", status: "warn", detail: "blocked — feeds future model weights" }],
      search: [{ agent: "OAI-SearchBot", status: "pass", detail: "allowed" }],
      user: [{ agent: "ChatGPT-User", status: "pass", detail: "allowed" }],
      notes: [],
    },
    probe: { status: "pass", agents: [{ agent: "GPTBot", http: "200", status: "pass", detail: "HTTP 200" }], notes: [] },
    jsonld: { status: "pass", checked: true, types: [{ type: "Organization", present: true, status: "pass", detail: "present" }] },
    meta: { status: "pass", checked: true, noindex: false, nosnippet: false, findings: [] },
    notes: [],
    checked_at: checkedAt,
    cached: false,
    elapsed_ms: 1234,
    pages_crawled: 3,
  };
}

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "GET", headers });
}

const okGate: GateFn = async (domain) => fakeResult(domain);

describe("createHandler — validation", () => {
  it("returns the result for a valid domain", async () => {
    const handle = createHandler({ gate: okGate });
    const res = await handle(get("https://svc.test/api/check?domain=acme.com"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as InstantCheckResult;
    expect(body).toMatchObject({ domain: "acme.com", result: "warn", cached: false, pages_crawled: 3 });
    expect(body.robots.training[0].agent).toBe("GPTBot");
  });

  it("normalises the domain before the gate ever sees it", async () => {
    const gate = vi.fn(okGate);
    const handle = createHandler({ gate });
    await handle(get("https://svc.test/api/check?domain=https%3A%2F%2FACME.com%2F"));
    expect(gate).toHaveBeenCalledWith("acme.com");
  });

  it("400s a missing domain and 422s an invalid one, without calling the gate", async () => {
    const gate = vi.fn(okGate);
    const handle = createHandler({ gate });

    const missing = await handle(get("https://svc.test/api/check"));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("missing_domain");

    for (const bad of ["localhost", "127.0.0.1", "acme.com%2Fadmin", "not-a-domain"]) {
      const res = await handle(get(`https://svc.test/api/check?domain=${bad}`));
      expect(res.status, bad).toBe(422);
      expect((await res.json()).error.code).toBe("invalid_domain");
    }
    expect(gate).not.toHaveBeenCalled();
  });

  it("405s a write method and says which methods are allowed", async () => {
    const handle = createHandler({ gate: okGate });
    const res = await handle(new Request("https://svc.test/api/check?domain=acme.com", { method: "POST" }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, OPTIONS");
    expect((await res.json()).error.code).toBe("method_not_allowed");
  });
});

describe("createHandler — CORS", () => {
  it("allows the docs site and no other browser origin", async () => {
    const handle = createHandler({ gate: okGate });
    const allowed = await handle(get("https://svc.test/api/check?domain=acme.com", { origin: SITE }));
    expect(allowed.headers.get("access-control-allow-origin")).toBe(SITE);

    const stranger = await handle(get("https://svc.test/api/check?domain=other.com", { origin: "https://evil.example" }));
    expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers the preflight with 204 and varies on Origin", async () => {
    const handle = createHandler({ gate: okGate });
    const res = await handle(new Request("https://svc.test/api/check", { method: "OPTIONS", headers: { origin: SITE } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("honours an extra configured origin (preview / local docs)", async () => {
    const handle = createHandler({ gate: okGate, allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, "http://localhost:3000"] });
    const res = await handle(get("https://svc.test/api/check?domain=acme.com", { origin: "http://localhost:3000" }));
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  it("serves a non-browser caller (no Origin header) with no allow header and no error", async () => {
    const handle = createHandler({ gate: okGate });
    const res = await handle(get("https://svc.test/api/check?domain=acme.com"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("createHandler — cache", () => {
  it("checks a domain once, then answers from the cache with the original timestamp", async () => {
    const gate = vi.fn(okGate);
    const handle = createHandler({ gate });

    const first = await handle(get("https://svc.test/api/check?domain=acme.com"));
    const second = await handle(get("https://svc.test/api/check?domain=acme.com"));

    expect(gate).toHaveBeenCalledTimes(1);
    expect((await first.json()).cached).toBe(false);
    const cached = await second.json();
    expect(cached.cached).toBe(true);
    expect(cached.checked_at).toBe("2026-09-09T00:00:00.000Z");
  });

  it("re-checks once the 24 h TTL has passed", async () => {
    let t = 0;
    const gate = vi.fn(okGate);
    const handle = createHandler({ gate, cache: new TtlCache<InstantCheckResult>({ ttlMs: 86_400_000, now: () => t }) });
    await handle(get("https://svc.test/api/check?domain=acme.com"));
    t += 86_400_001;
    await handle(get("https://svc.test/api/check?domain=acme.com"));
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it("asks the CDN to hold the answer for 24 h", async () => {
    const handle = createHandler({ gate: okGate });
    const res = await handle(get("https://svc.test/api/check?domain=acme.com"));
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
  });

  it("never caches an error", async () => {
    const handle = createHandler({ gate: okGate });
    const res = await handle(get("https://svc.test/api/check?domain=localhost"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("spends a CHEAPER token on a cache hit, not a free one", async () => {
    // capacity 1.25 (exact in binary float, unlike e.g. 1.2/1.4 — avoids
    // rounding noise near the comparison boundary): the miss spends a full
    // token (1), leaving exactly 0.25 — enough for one 0.2-cost hit, not two.
    const limiter = new RateLimiter({ capacity: 1.25, refillMs: 60_000, now: () => 0 });
    const gate = vi.fn(okGate);
    const handle = createHandler({ gate, limiter });
    const headers = { "x-forwarded-for": "203.0.113.7" };

    expect((await handle(get("https://svc.test/api/check?domain=acme.com", headers))).status).toBe(200); // miss, cost 1
    expect((await handle(get("https://svc.test/api/check?domain=acme.com", headers))).status).toBe(200); // hit, cost 0.2 — fits exactly
    // Bucket is now empty: a THIRD hit against the same cached domain from
    // the same IP is refused, proving cache hits are no longer free.
    const third = await handle(get("https://svc.test/api/check?domain=acme.com", headers));
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe("rate_limited");
    expect(gate).toHaveBeenCalledTimes(1);
  });

  it("does not let junk query params defeat the per-instance cache key or buy free requests", async () => {
    // capacity 1.25 (exact in binary float): one miss (cost 1) leaves exactly
    // 0.25 — enough for exactly one more 0.2-cost hit, however its query
    // string is decorated, not two.
    const limiter = new RateLimiter({ capacity: 1.25, refillMs: 60_000, now: () => 0 });
    const gate = vi.fn(okGate);
    const handle = createHandler({ gate, limiter });
    const headers = { "x-forwarded-for": "203.0.113.8" };

    const first = await handle(get("https://svc.test/api/check?domain=acme.com", headers));
    expect(first.status).toBe(200);
    expect((await first.json()).cached).toBe(false);

    // Same domain, but the request URL differs by junk params on every call —
    // a CDN that keys on the full URL would MISS every one of these and
    // forward all of them to this origin. Our own cache/limiter must still
    // treat them as the same, already-checked domain: one real gate call
    // total, and the junk params buy no extra rate-limit headroom.
    const second = await handle(get("https://svc.test/api/check?domain=acme.com&utm_source=x", headers));
    expect(second.status).toBe(200);
    expect((await second.json()).cached).toBe(true);

    const third = await handle(get("https://svc.test/api/check?domain=acme.com&r=123456&cachebust=abcdef", headers));
    expect(third.status).toBe(429); // the 0.25 leftover from the miss covered exactly one 0.2 hit, not two

    expect(gate).toHaveBeenCalledTimes(1); // still just the one real check, whatever the query string looked like
  });
});

describe("createHandler — rate limit", () => {
  it("429s past the burst, with Retry-After and the local-run way out", async () => {
    const limiter = new RateLimiter({ capacity: 2, refillMs: 12_000, now: () => 0 });
    const handle = createHandler({ gate: okGate, limiter });
    const headers = { "x-forwarded-for": "198.51.100.3" };

    expect((await handle(get("https://svc.test/api/check?domain=a.com", headers))).status).toBe(200);
    expect((await handle(get("https://svc.test/api/check?domain=b.com", headers))).status).toBe(200);

    const res = await handle(get("https://svc.test/api/check?domain=c.com", headers));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "rate_limited", retry_after: 12 });
    expect(body.error.message).toContain("npx saylent gate-check");
  });

  it("limits per IP, not globally", async () => {
    const limiter = new RateLimiter({ capacity: 1, refillMs: 60_000, now: () => 0 });
    const handle = createHandler({ gate: okGate, limiter });
    expect((await handle(get("https://svc.test/api/check?domain=a.com", { "x-forwarded-for": "1.1.1.1" }))).status).toBe(200);
    expect((await handle(get("https://svc.test/api/check?domain=b.com", { "x-forwarded-for": "1.1.1.1" }))).status).toBe(429);
    expect((await handle(get("https://svc.test/api/check?domain=c.com", { "x-forwarded-for": "2.2.2.2" }))).status).toBe(200);
  });

  it("does not spend a token on an invalid domain", async () => {
    const limiter = new RateLimiter({ capacity: 1, refillMs: 60_000, now: () => 0 });
    const handle = createHandler({ gate: okGate, limiter });
    const headers = { "x-forwarded-for": "198.51.100.9" };
    expect((await handle(get("https://svc.test/api/check?domain=localhost", headers))).status).toBe(422);
    expect((await handle(get("https://svc.test/api/check?domain=acme.com", headers))).status).toBe(200);
  });
});

describe("createHandler — failure modes", () => {
  it("504s a check that outruns the hard timeout", async () => {
    const handle = createHandler({
      gate: () => new Promise(() => {}),
      timeoutMs: 20,
    });
    const res = await handle(get("https://svc.test/api/check?domain=slow.com"));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error.code).toBe("timeout");
    expect(body.error.message).toContain("npx saylent gate-check slow.com");
  });

  it("502s a thrown check without leaking the underlying error", async () => {
    const handle = createHandler({
      gate: async () => {
        throw new Error("ENOTFOUND internal-host:5432 at /home/runner/work/secret/path");
      },
    });
    const res = await handle(get("https://svc.test/api/check?domain=broken.com"));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("check_failed");
    expect(JSON.stringify(body)).not.toContain("internal-host");
  });

  it("counts outcomes without ever seeing the domain", async () => {
    const seen: string[] = [];
    const handle = createHandler({ gate: okGate, onCheck: (o) => seen.push(o) });
    await handle(get("https://svc.test/api/check?domain=acme.com"));
    await handle(get("https://svc.test/api/check?domain=acme.com"));
    expect(seen).toEqual(["miss", "hit"]);
  });
});
