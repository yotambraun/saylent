// `GET /api/check?domain=` — the whole HTTP surface of the instant check.
// Web-standard Request in, Response out, with
// every collaborator injected, so this file is exercised end to end in
// handler.test.ts with a fake gate function and no network.
//
// Order of business, cheapest first: method -> CORS -> validation -> cache ->
// rate limit -> the real check under a hard timeout. Validation runs BEFORE the
// rate limiter on purpose: a malformed request must not consume a token, so a
// typo does not lock a person out of their own check.
import { TtlCache, DAY_MS } from "./cache";
import { clientIp, RateLimiter } from "./rate-limit";
import type { ErrorCode, GateFn, InstantCheckResult } from "./types";
import { validateDomain } from "./validate";

/** The docs site. The ONLY browser origin allowed to read this endpoint. */
export const DEFAULT_ALLOWED_ORIGINS = ["https://yotambraun.github.io"];

/** Hard ceiling on one check. Past this the caller gets a structured timeout
 *  instead of a hung request; gate.ts also clamps each outbound fetch. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** P4 security review #18: a cache HIT used to bypass the rate limiter
 *  entirely, and the CDN's own dedup keys on the full request URL, so a
 *  caller appending junk query params (still stripped down to the same
 *  validated `domain` by the time it reaches the cache/limiter below) forced
 *  every request past the CDN edge into this function for free. A hit is
 *  cheap (no outbound fetch), so it spends a fraction of a token rather than
 *  a full one — repeat legitimate traffic still flows, but an IP spraying
 *  junk params against one cached domain still runs into the limiter. */
export const CACHE_HIT_TOKEN_COST = 0.2;

export interface HandlerDeps {
  gate: GateFn;
  cache?: TtlCache<InstantCheckResult>;
  limiter?: RateLimiter;
  /** Extra browser origins (local docs dev, a preview deployment). */
  allowedOrigins?: string[];
  timeoutMs?: number;
  /** Called once per completed check. The ONLY thing this service records —
   *  a counter, never the domain, never the IP (see check.mdx, "Privacy"). */
  onCheck?: (outcome: "hit" | "miss" | "error") => void;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const base: Record<string, string> = {
    // Two origins may get two different bodies' worth of headers, so the CDN
    // must key on Origin, not just the URL.
    vary: "Origin",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
  // No Origin header at all = not a browser (curl, a server). CORS does not
  // apply; the response is simply returned without an allow header.
  if (origin && allowed.includes(origin)) base["access-control-allow-origin"] = origin;
  return base;
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  headers: Record<string, string>,
  retryAfter?: number,
): Response {
  const body = retryAfter === undefined ? { error: { code, message } } : { error: { code, message, retry_after: retryAfter } };
  const h: Record<string, string> = { ...headers, ...JSON_HEADERS, "cache-control": "no-store" };
  if (retryAfter !== undefined) h["retry-after"] = String(retryAfter);
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** Rejects with a `timeout` marker rather than leaving the request hanging.
 *  The underlying fetches are already individually bounded (gate.ts), so a
 *  lost race leaves at most one short-lived in-flight fetch behind. */
const TIMED_OUT = Symbol("timed-out");

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createHandler(deps: HandlerDeps): (request: Request) => Promise<Response> {
  const cache = deps.cache ?? new TtlCache<InstantCheckResult>({ ttlMs: DAY_MS });
  const limiter = deps.limiter ?? new RateLimiter();
  const allowed = deps.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onCheck = deps.onCheck ?? (() => {});

  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const cors = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return errorResponse(405, "method_not_allowed", "Use GET /api/check?domain=acme.com.", {
        ...cors,
        allow: "GET, OPTIONS",
      });
    }

    let query: string | null;
    try {
      query = new URL(request.url).searchParams.get("domain");
    } catch {
      query = null;
    }
    const valid = validateDomain(query);
    if (!valid.ok) {
      return errorResponse(valid.code === "missing_domain" ? 400 : 422, valid.code, valid.message, cors);
    }
    const { domain } = valid;

    // 24 h cache: keyed on the VALIDATED domain (not the raw query string),
    // so junk query params never create a distinct cache entry here — only
    // the CDN's own URL-keyed edge cache can be defeated that way. A cache
    // hit is cheap but not free: it still spends a (cheaper) rate-limit
    // token, so that CDN-cache-busting trick doesn't buy unlimited requests
    // against this instance either. `cached: true` and the ORIGINAL
    // checked_at go back untouched.
    const hit = cache.get(domain);
    if (hit) {
      const hitDecision = limiter.take(clientIp(request.headers), CACHE_HIT_TOKEN_COST);
      if (!hitDecision.allowed) {
        return errorResponse(
          429,
          "rate_limited",
          "Too many checks from this address. The full check is unlimited from your own machine: npx saylent gate-check <domain>.",
          cors,
          hitDecision.retryAfter,
        );
      }
      onCheck("hit");
      return new Response(JSON.stringify({ ...hit, cached: true }), {
        status: 200,
        headers: { ...cors, ...JSON_HEADERS, ...cacheControl() },
      });
    }

    const decision = limiter.take(clientIp(request.headers));
    if (!decision.allowed) {
      return errorResponse(
        429,
        "rate_limited",
        "Too many checks from this address. The full check is unlimited from your own machine: npx saylent gate-check <domain>.",
        cors,
        decision.retryAfter,
      );
    }

    let outcome: InstantCheckResult | typeof TIMED_OUT;
    try {
      outcome = await withTimeout(deps.gate(domain), timeoutMs);
    } catch {
      onCheck("error");
      // Never leak the underlying error text: it can carry internal URLs and
      // stack detail, and a caller can do nothing with it either way.
      return errorResponse(502, "check_failed", `Could not check ${domain}. Try again, or run it locally: npx saylent gate-check ${domain}.`, cors);
    }
    if (outcome === TIMED_OUT) {
      onCheck("error");
      return errorResponse(
        504,
        "timeout",
        `${domain} did not answer within ${Math.round(timeoutMs / 1000)} seconds. Slow sites are exactly what the local run is for: npx saylent gate-check ${domain}.`,
        cors,
      );
    }

    cache.set(domain, outcome);
    onCheck("miss");
    return new Response(JSON.stringify(outcome), {
      status: 200,
      headers: { ...cors, ...JSON_HEADERS, ...cacheControl() },
    });
  };
}

/** The cross-instance half of the 24 h cache (see cache.ts): Vercel's CDN keys
 *  on the URL, and the URL is exactly one domain, so a repeat check is served
 *  at the edge and never reaches the function. */
function cacheControl(): Record<string, string> {
  return { "cache-control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400" };
}
