// The operator readiness page. It FAILS CLOSED — see setupRequiresAdmin in
// readiness.ts. Two access states:
//   1. Fresh deployment: the profiles table was read successfully and is empty,
//      so there is no admin to authenticate as yet. Reachable with NO auth, so
//      the very first operator can see what's missing before they even sign up
//      (the same moment migration 0040 is waiting to promote them).
//   2. Anything else — profiles exist, OR the probe failed (unmigrated table,
//      Postgres down, bad service key): requireAdmin() gates it like every other
//      /admin surface (never trusts a layout, redirects non-admins to /app and
//      anonymous visitors to /login). A DB error must not open the page.
// Reads the SAME payload src/app/api/health/route.ts serves (getHealthPayload,
// imported directly rather than a self-HTTP-fetch — same process, same data,
// no extra network hop) plus one live Inngest reachability probe. Nothing
// rendered here is ever a secret: every row is presence, provenance, or a
// public docs link (src/app/admin/providers/page.tsx follows the same rule).
import Link from "next/link";
import { Badge } from "@saylent/report/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { isAdmin, requireAdmin } from "@/lib/admin-auth";
import { PROVIDER_META } from "@/lib/provider-settings";
import { brandLimit, DAILY_SPEND_CAP_USD } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHealthPayload } from "@/app/api/health/route";
import { pingInngest } from "./inngest-ping";
import {
  computeReadiness,
  setupRequiresAdmin,
  type ProfilesProbe,
  type ReadinessAdminsInput,
  type ReadinessInput,
  type ReadinessRow,
  type ReadinessStatus,
} from "./readiness";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup · Saylent" };

/** Probe the profiles table — migration 0040 promotes the first row to admin, so
 *  "no profile yet" and "no admin yet" are the same moment. Every failure mode
 *  (unmigrated table, unreachable Postgres, bad service key, a throw) reports
 *  `readable: false`, which setupRequiresAdmin treats as "require an admin". */
async function probeProfiles(): Promise<ProfilesProbe> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("profiles").select("id").limit(1);
    if (error) return { readable: false };
    return { readable: true, empty: (data?.length ?? 0) === 0 };
  } catch {
    return { readable: false };
  }
}

/** How many OPERATORS this deployment has. Migration 0040 keeps
 *  promoting the first profile row until an admin exists, so "accounts, but no
 *  admin" means the next stranger to sign up owns /admin. Service-role read:
 *  `profiles.role` is service-role-only (migration 0020), and a failure reports
 *  "not known" rather than a reassuring zero. */
async function probeAdmins(): Promise<ReadinessAdminsInput> {
  try {
    const admin = createAdminClient();
    const [{ count: admins, error: e1 }, { count: profiles, error: e2 }] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
      admin.from("profiles").select("id", { count: "exact", head: true }),
    ]);
    if (e1 || e2) return { known: false, count: 0, anyProfiles: false };
    return { known: true, count: admins ?? 0, anyProfiles: (profiles ?? 0) > 0 };
  } catch {
    return { known: false, count: 0, anyProfiles: false };
  }
}

async function buildReadinessInput(): Promise<ReadinessInput> {
  const [health, inngest, admins] = await Promise.all([
    getHealthPayload(),
    pingInngest(),
    probeAdmins(),
  ]);

  const providers = PROVIDER_META.map((p) => ({
    id: p.id,
    label: p.label,
    envVar: p.envVar,
    present: health.providers?.[p.id] ?? false,
  }));

  return {
    db: health.db,
    migrations: health.migrations ?? null,
    authMethods: health.auth_methods ?? [],
    providers,
    admins,
    inngest,
    email: {
      resendApiKey: health.email?.resend_api_key ?? false,
      emailFrom: health.email?.email_from ?? false,
    },
    budget: {
      dailySpendCapUsd: health.budget?.daily_spend_cap_usd ?? DAILY_SPEND_CAP_USD,
      brandLimit: health.budget?.brand_limit ?? brandLimit(),
    },
  };
}

const BADGE_VARIANT: Record<ReadinessStatus, "secondary" | "outline" | "destructive"> = {
  ok: "secondary",
  warn: "outline",
  error: "destructive",
};

const STATUS_WORD: Record<ReadinessStatus, string> = { ok: "ok", warn: "check", error: "missing" };

function ReadinessRowItem({ row }: { row: ReadinessRow }) {
  return (
    <li className="flex flex-col gap-1 border-b border-line py-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink">{row.label}</span>
        <Badge variant={BADGE_VARIANT[row.status]}>{STATUS_WORD[row.status]}</Badge>
      </div>
      <p className="text-sm text-wire">{row.detail}</p>
      {row.fix && (
        <p className="text-xs text-wire">
          {row.fix.envVar && (
            <>
              Set <code className="rounded bg-card px-1 py-0.5">{row.fix.envVar}</code>
              {row.fix.command || row.fix.href ? ", " : "."}
            </>
          )}
          {row.fix.command && (
            <>
              run <code className="rounded bg-card px-1 py-0.5">{row.fix.command}</code>
              {row.fix.href ? ", " : "."}
            </>
          )}
          {row.fix.href &&
            (row.fix.href.startsWith("http") ? (
              <a href={row.fix.href} className="underline underline-offset-2 hover:text-ink">
                {row.fix.hrefLabel ?? row.fix.href}
              </a>
            ) : (
              <Link href={row.fix.href} className="underline underline-offset-2 hover:text-ink">
                {row.fix.hrefLabel ?? row.fix.href}
              </Link>
            ))}
        </p>
      )}
    </li>
  );
}

export default async function SetupPage() {
  if (setupRequiresAdmin(await probeProfiles())) {
    await requireAdmin();
  }
  // Chrome. This page rendered with no header, no nav and no way
  // back, and it is linked from the admin nav now — but it is ALSO reachable
  // with no session at all on a fresh deployment (see the header comment), so
  // the operator links only appear for someone who is actually an operator.
  const operator = await isAdmin();

  let input: ReadinessInput | null = null;
  try {
    input = await buildReadinessInput();
  } catch {
    input = null;
  }

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-line bg-card px-4 lg:px-8">
        <span className="font-display text-lg font-semibold">
          Saylent <span className="text-wire">· Setup</span>
        </span>
        <div className="flex items-center gap-4 text-sm">
          {operator ? (
            <>
              <Link href="/admin" className="text-wire hover:text-ink">
                Admin
              </Link>
              <Link href="/app" className="text-wire hover:text-ink">
                ← back to app
              </Link>
            </>
          ) : (
            <Link href="/login" className="text-wire hover:text-ink">
              Sign in
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 lg:px-0">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl">Setup</h1>
        <p className="max-w-2xl text-sm text-wire">
          What this deployment needs, what it already has, and the exact fix for anything
          missing. Nothing on this page is a secret. Every row is presence, not the value
          itself.
        </p>
      </div>

      {!input && (
        <Card>
          <CardContent className="py-6 text-sm text-wire">
            Could not compute readiness right now. Reload the page, or check the server logs —
            this page never spends against a provider or writes anything.
          </CardContent>
        </Card>
      )}

      {input &&
        (() => {
          const { rows, ready } = computeReadiness(input);
          return (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="font-display flex items-center justify-between">
                    <span>{ready ? "You are ready" : "Not ready yet"}</span>
                    <Badge variant={ready ? "secondary" : "destructive"}>
                      {ready ? "green" : "action needed"}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-wire">
                  {ready
                    ? "The database is reachable, migrations are applied, and at least one provider key is set. Optional rows below (Inngest, email, extra engines) are informational."
                    : "Fix every row marked \"missing\" below, then reload this page."}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="font-display text-lg">Checks</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-col">
                    {rows.map((row) => (
                      <ReadinessRowItem key={row.id} row={row} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </>
          );
        })()}

      <p className="text-xs text-wire">
        Full reference:{" "}
        <a
          href="https://yotambraun.github.io/saylent/docs/self-host/environment"
          className="underline underline-offset-2 hover:text-ink"
        >
          Environment variables
        </a>
        .
      </p>
      </main>
    </>
  );
}
