import "server-only";
// Who is calling the read-only API (/api/v1/*), and the client to read with.
//
// Two ways in:
//   * `Authorization: Bearer slt_...`: a personal API token (migration 0048).
//     The token is hashed and resolved by resolve_api_token(), a SECURITY
//     DEFINER function only the service role may run. RLS cannot see a
//     token, so the reads that follow use the service client AND are scoped
//     to the resolved owner in src/lib/api-data.ts, the share page's pattern
//     (dossier-data.ts getSharedRun): owner checked on the run or brand row
//     first, child rows read only by an id that passed that check.
//   * a signed-in session cookie: the user's own RLS client, exactly as the
//     app's other routes read.
// Either way the caller is rate limited per user (RATE_LIMITS.api).
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import { RATE_LIMITS, checkRateLimit } from "./rate-limit";

export const API_TOKEN_PREFIX = "slt_";
const TOKEN_SHAPE = /^slt_[A-Za-z0-9_-]{43}$/;

/** A new token, its stored hash, and the prefix shown in Settings. */
export function newApiToken(): { token: string; hash: string; prefix: string } {
  const token = `${API_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashApiToken(token), prefix: token.slice(0, 10) };
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The bearer token on a request, when it has the token's shape. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  if (!m) return null;
  return m[1];
}

export type ApiCaller =
  | { ok: true; userId: string; client: SupabaseClient; via: "token" | "session" }
  | { ok: false; status: 401 | 429 | 503; error: string; retryAfter?: number };

export interface ApiAuthDeps {
  resolveToken: (hash: string) => Promise<string | null>;
  sessionUser: () => Promise<{ id: string; client: SupabaseClient } | null>;
  serviceClient: () => SupabaseClient;
  rateLimit: (userId: string) => Promise<boolean>;
}

export const realApiAuthDeps: ApiAuthDeps = {
  resolveToken: async (hash) => {
    const { data, error } = await createAdminClient().rpc("resolve_api_token", { p_hash: hash });
    if (error || typeof data !== "string") return null;
    return data;
  },
  sessionUser: async () => {
    const client = await createClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    return user ? { id: user.id, client } : null;
  },
  serviceClient: () => createAdminClient(),
  rateLimit: (userId) => checkRateLimit(RATE_LIMITS.api, userId),
};

export async function resolveApiCaller(req: Request, deps: ApiAuthDeps = realApiAuthDeps): Promise<ApiCaller> {
  const header = req.headers.get("authorization");
  let caller: { userId: string; client: SupabaseClient; via: "token" | "session" } | null = null;
  if (header) {
    const token = bearerToken(req);
    if (!token || !TOKEN_SHAPE.test(token)) return { ok: false, status: 401, error: "Authorization must be `Bearer slt_...`, a token from Settings › API tokens." };
    let userId: string | null;
    try {
      userId = await deps.resolveToken(hashApiToken(token));
    } catch {
      // e.g. no SUPABASE_SERVICE_ROLE_KEY on this deployment: say so, never a bare 500
      return { ok: false, status: 503, error: "Token checks are unavailable on this deployment right now." };
    }
    if (!userId) return { ok: false, status: 401, error: "Unknown, revoked or expired token." };
    caller = { userId, client: deps.serviceClient(), via: "token" };
  } else {
    const session = await deps.sessionUser();
    if (!session) return { ok: false, status: 401, error: "Sign in, or send `Authorization: Bearer slt_...`." };
    caller = { userId: session.id, client: session.client, via: "session" };
  }
  if (!(await deps.rateLimit(caller.userId))) {
    return { ok: false, status: 429, error: `Rate limit: ${RATE_LIMITS.api.limit} requests a minute.`, retryAfter: RATE_LIMITS.api.windowSeconds };
  }
  return { ok: true, ...caller };
}

/** The JSON error every /api/v1 route returns. */
export function apiError(status: number, error: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

export function callerError(c: Extract<ApiCaller, { ok: false }>): Response {
  return apiError(c.status, c.error, c.retryAfter ? { "Retry-After": String(c.retryAfter) } : {});
}
