// SEC-HARDEN durable rate limiter. A fixed-window counter shared across all
// serverless instances via the migration-0025 `rate_limit_hit` RPC (the previous
// in-memory Map reset on every cold start). Written only by the service role.
import { createAdminClient } from "./supabase/admin";

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

// Keep limits here (config), not scattered in routes. runs is per-user (a manual
// re-audit spam guard on top of C-CTRL's economic caps).
export const RATE_LIMITS = {
  runs: { bucket: "api_runs", limit: 10, windowSeconds: 60 },
  // Public takedown intake (per-IP): abuse guard on an unauthenticated form.
  takedown: { bucket: "takedown", limit: 3, windowSeconds: 3600 },
  // In-app support intake (per-IP): a tracked contact form, not a mailto.
  support: { bucket: "support", limit: 5, windowSeconds: 3600 },
  // Domain reachability preflight (per-user): an exported server action is a
  // public endpoint that makes an OUTBOUND fetch to a caller-supplied host, so
  // it is a free scanner unless it is capped.
  preflight: { bucket: "preflight", limit: 20, windowSeconds: 60 },
  // Product-analytics event sink (per-IP): generous — a client fires several
  // events per session — but capped so the public /api/track can't spam the log.
  track: { bucket: "track", limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/** Increment the window counter for (rule.bucket, identifier) and report whether
 *  the caller is still WITHIN the limit. Fails OPEN by design: a limiter hiccup
 *  (DB blip, missing RPC) must never 500 or block a legitimate request. */
export async function checkRateLimit(rule: RateLimitRule, identifier: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rate_limit_hit", {
      p_bucket: rule.bucket,
      p_identifier: identifier,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) return true;
    return data === true;
  } catch {
    return true;
  }
}

/** Best-effort client IP for per-IP limiting. Prefers x-real-ip (the single
 *  client IP the platform proxy sets) over the client-appendable x-forwarded-for
 *  list, whose LEFTMOST hop is the platform-attributed origin. Never trust a raw
 *  arbitrary header value as identity — this is a coarse abuse key, not auth. */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "local";
}
