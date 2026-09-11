// The uptime-monitor target. No auth, fast: one
// cheap indexed query proves the app can reach Postgres. 200 when up, 503 when the
// DB query fails. Never cached (each probe must hit the DB live).
//
// Self-hosted operators have no internal ops log to check
// after `git pull`, so this is where "did I forget a migration?" gets answered:
// migrations.applied/latest/missing (public._migrations, written by
// scripts/apply-migrations.ts, compared against the supabase/migrations/*.sql
// files shipped in this build) and which login methods are live
// (NEXT_PUBLIC_AUTH_METHODS). Nothing here is a secret (file names, counts, a csv
// env value) — no keys/URLs/tokens are ever included in the response. It is,
// however, a configuration disclosure, so the HTTP
// response carries the full payload only for a signed-in ADMIN; everyone else
// (the uptime monitor, the Docker HEALTHCHECK, a stranger) gets {ok, db}.
//
// `getHealthPayload()` is exported so
// `src/app/setup/page.tsx` (the operator readiness page) reads the SAME payload
// this endpoint serves, plus three more env-presence facts (never key material,
// same rule as above): which provider keys are set (checked against the
// canonical PROVIDER_META list — env only, a console-only key does not show
// here; /admin/providers has the full picture), whether email is configured, and
// the budget defaults in force. All still booleans/numbers/strings — no secret
// leaves this file.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PROVIDER_META } from "@/lib/provider-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { brandLimit, DAILY_SPEND_CAP_USD } from "@/lib/limits";

export const dynamic = "force-dynamic";

interface MigrationsStatus {
  total: number;
  applied: number;
  latest: string | null;
  missing: string[];
  note?: string;
}

/** Compare supabase/migrations/*.sql (this build's copy, filename order — matches
 *  apply-migrations.ts) against public._migrations (the marker table THAT script
 *  writes one row to per applied file). `supabase start`'s OWN local run target
 *  applies the same files via its own tracking table instead (never touches
 *  public._migrations) — in that case the query below fails (relation not found)
 *  and this returns a `note` instead of guessing; it never 500s the health check
 *  over a missing marker table. */
async function migrationsStatus(admin: SupabaseClient): Promise<MigrationsStatus> {
  let files: string[] = [];
  try {
    files = readdirSync(join(process.cwd(), "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return { total: 0, applied: 0, latest: null, missing: [], note: "supabase/migrations not readable at runtime" };
  }
  const latest = files.length ? files[files.length - 1] : null;

  const { data, error } = await admin.from("_migrations").select("name");
  if (error) {
    return {
      total: files.length,
      applied: 0,
      latest,
      missing: files,
      note:
        "public._migrations not found: either no migration has been applied with `npm run db:migrate` yet, or this DB uses `supabase start`'s own migration tracking (the local run target) instead",
    };
  }
  const appliedSet = new Set((data ?? []).map((r: { name: string }) => r.name));
  return {
    total: files.length,
    applied: appliedSet.size,
    latest,
    missing: files.filter((f) => !appliedSet.has(f)),
  };
}

function authMethods(): string[] {
  return (process.env.NEXT_PUBLIC_AUTH_METHODS ?? "password,magic-link")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export type ProviderPresence = Record<string, boolean>;

/** Env-only presence per PROVIDER_META (src/lib/provider-settings.ts) — the same
 *  four ids /admin/providers uses. A console-only key (no env var set) reads
 *  false here on purpose: /setup is the ENV-tier check, and links to
 *  /admin/providers for the console-aware picture. */
function providerPresence(): ProviderPresence {
  const out: ProviderPresence = {};
  for (const p of PROVIDER_META) out[p.id] = Boolean(process.env[p.envVar]?.trim());
  return out;
}

export interface HealthPayload {
  ok: boolean;
  db: "up" | "down";
  migrations?: MigrationsStatus;
  auth_methods?: string[];
  providers?: ProviderPresence;
  email?: { resend_api_key: boolean; email_from: boolean };
  budget?: { daily_spend_cap_usd: number; brand_limit: number };
}

/** The one DB round trip (UptimeRobot's target) plus every other fact below —
 *  all cheap env reads, no extra query. Exported so /setup reads this exact
 *  payload instead of re-deriving it. */
export async function getHealthPayload(): Promise<HealthPayload> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("profiles").select("id").limit(1);
    if (error) {
      return { ok: false, db: "down" };
    }
    const migrations = await migrationsStatus(admin);
    return {
      ok: true,
      db: "up",
      migrations,
      auth_methods: authMethods(),
      providers: providerPresence(),
      email: {
        resend_api_key: Boolean(process.env.RESEND_API_KEY?.trim()),
        email_from: Boolean(process.env.EMAIL_FROM?.trim()),
      },
      budget: {
        daily_spend_cap_usd: DAILY_SPEND_CAP_USD,
        brand_limit: brandLimit(),
      },
    };
  } catch {
    return { ok: false, db: "down" };
  }
}

/** What an ANONYMOUS caller gets. The full payload is a
 *  configuration disclosure: which migrations this deployment is missing (a
 *  precise "which known bugs are still live here" list), which login methods are
 *  enabled, which providers are wired, whether email works, and the operator's
 *  spend cap. None of it is a secret, and all of it is reconnaissance. The
 *  uptime monitor only ever needed liveness. */
export function publicHealth(payload: HealthPayload): { ok: boolean; db: "up" | "down" } {
  return { ok: payload.ok, db: payload.db };
}

/** Is it even worth a Supabase round trip to check for an admin session? A probe
 *  from UptimeRobot / the Docker HEALTHCHECK carries no cookies, and this route
 *  is hit every minute forever — so no cookie, no auth call. */
export function hasSupabaseSessionCookie(cookieHeader: string | null | undefined): boolean {
  return /(?:^|;\s*)sb-[^=\s]*=/.test(cookieHeader ?? "");
}

/** The full payload is for operators. /setup reads it IN-PROCESS
 *  (getHealthPayload), and a signed-in admin can still curl it with their
 *  session. Everything else sees {ok, db}. */
async function viewerIsAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    return data?.role === "admin";
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const payload = await getHealthPayload();
  const status = payload.ok ? 200 : 503;
  if (hasSupabaseSessionCookie(request.headers.get("cookie")) && (await viewerIsAdmin())) {
    return NextResponse.json(payload, { status });
  }
  return NextResponse.json(publicHealth(payload), { status });
}
