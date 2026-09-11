// /admin/users/[id]: full operator view of one user. Service-role reads
// (bypass RLS); requireAdmin() gates it. Shows profile, runs, and the
// interactive controls (disable/enable, re-run, retry) which post to server
// actions. No plan/credit gating exists in this self-host app (createRun never
// consults profiles.plan or a balance) — the real operator levers are the
// deployment-wide throttle/spend-cap (env-driven, see BUDGET & LIMITS below)
// and the BRAND_LIMIT this user is measured against.
import { notFound } from "next/navigation";
import { Badge } from "@saylent/report/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@saylent/report/ui/table";
import Link from "next/link";
import { sumSpend } from "@/lib/admin-metrics";
import { requireAdmin } from "@/lib/admin-auth";
import {
  brandLimit,
  MAX_AUDITS_PER_WINDOW,
  MAX_VERIFIES_PER_WINDOW,
  THROTTLE_WINDOW_HOURS,
} from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoadError } from "../../load-error";
import { computeConsumption, type DoneAudit, type EventRow } from "./consumption";
import {
  DisableAccountButton,
  RecoveryLink,
  ReRunBrandButton,
  RunRowControls,
} from "./detail-client";

export const metadata = { title: "User · Admin · Saylent" };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const admin = createAdminClient();

  const [
    { data: profile, error: profileError },
    { data: runs, error: runsError },
    { data: brands, error: brandsError },
    { data: notifications },
    { data: allRunCosts },
    authRes,
    { data: eventsData },
    { data: doneAuditsData },
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("id,email,display_name,role")
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("runs")
      .select("id,brand_id,kind,status,est_cost_usd,created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("brands")
      .select("id,name,domain,authorized_at,created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("notifications")
      .select("id,type,title,href,created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    admin.from("runs").select("est_cost_usd,created_at").eq("user_id", id),
    admin.auth.admin.getUserById(id),
    // CONSUMPTION strip: one batched read of this user's analytics events + the
    // set of DONE audits (with finished_at) that the never-opened flag needs.
    admin.from("analytics_events").select("event,at,props").eq("user_id", id),
    admin
      .from("runs")
      .select("id,finished_at")
      .eq("user_id", id)
      .eq("kind", "audit")
      .eq("status", "done"),
  ]);

  // A failed query is not a missing user and not an empty account: say which.
  const loadError = profileError ?? runsError ?? brandsError;
  if (loadError) return <LoadError what="this user" message={loadError.message} />;
  if (!profile) notFound();

  const consumption = computeConsumption(
    (eventsData ?? []) as EventRow[],
    (doneAuditsData ?? []) as DoneAudit[],
  );

  const runRows = runs ?? [];
  const brandRows = brands ?? [];
  const notificationRows = notifications ?? [];
  const totalSpend = sumSpend(allRunCosts ?? []);
  // Disable sets a 100-year ban (876000h); enable sets ban_duration 'none', which
  // clears banned_until to null — so its presence alone marks a disabled account.
  const bannedUntil = (authRes.data?.user as { banned_until?: string | null } | undefined)
    ?.banned_until;
  const isDisabled = !!bannedUntil;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl">{profile.email}</h1>
        <p className="font-mono text-xs text-wire">{profile.id}</p>
      </div>

      {/* PROFILE */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-wire">Display name</p>
            <p className="text-ink">{profile.display_name || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-wire">Role</p>
            <Badge variant={profile.role === "admin" ? "default" : "secondary"}>
              {profile.role}
            </Badge>
          </div>
          <div>
            <p className="text-xs text-wire">Status</p>
            {isDisabled ? (
              <Badge variant="destructive">disabled</Badge>
            ) : (
              <Badge variant="secondary">active</Badge>
            )}
          </div>
          <div>
            <p className="text-xs text-wire">Total spend</p>
            <p className="font-mono tabular-nums text-ink">${totalSpend.toFixed(2)}</p>
          </div>
        </CardContent>
      </Card>

      {/* CONSUMPTION — did they actually USE what we delivered? */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Consumption</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {consumption.neverOpened.length > 0 && (
            <div className="flex flex-col gap-1 rounded-lg border border-pill-dismissed/40 bg-pill-dismissed/10 px-4 py-3">
              <p className="font-medium text-pill-dismissed">
                ⚠ Delivered, never opened: {consumption.neverOpened.length} audit
                {consumption.neverOpened.length === 1 ? "" : "s"}
              </p>
              <p className="text-xs text-wire">
                A completed audit with zero receipt views in the 7 days after it finished: the
                churn-risk signal.
              </p>
              <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-wire">
                {consumption.neverOpened.slice(0, 6).map((n) => (
                  <li key={n.runId} className="flex items-center gap-2">
                    <Link href={`/admin/view-as/${n.runId}`} className="text-signal hover:underline">
                      {n.runId.slice(0, 8)} ↗
                    </Link>
                    <span suppressHydrationWarning>
                      finished{" "}
                      {new Date(n.finishedAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <span className={n.windowClosed ? "text-pill-dismissed" : "text-wire"}>
                      · {n.windowClosed ? "window closed" : "window still open"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-wire">Receipts opened</p>
              <p className="font-mono text-xl tabular-nums text-ink">
                {consumption.receiptsOpened.count}
              </p>
              {consumption.receiptsOpened.lastAt && (
                <p className="font-mono text-[10px] text-wire" suppressHydrationWarning>
                  last{" "}
                  {new Date(consumption.receiptsOpened.lastAt).toLocaleDateString("en-GB", {
                    day: "2-digit",
                    month: "short",
                  })}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs text-wire">Artifacts copied</p>
              <p className="font-mono text-xl tabular-nums text-ink">
                {consumption.artifactsCopied}
              </p>
            </div>
            <div>
              <p className="text-xs text-wire">Fixes shipped</p>
              <p className="font-mono text-xl tabular-nums text-ink">{consumption.fixesShipped}</p>
            </div>
            <div>
              <p className="text-xs text-wire">Verify runs</p>
              <p className="font-mono text-xl tabular-nums text-ink">{consumption.verifyRuns}</p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-xs text-wire">Last activity</p>
              <p className="font-mono text-sm tabular-nums text-ink" suppressHydrationWarning>
                {consumption.lastActivity
                  ? new Date(consumption.lastActivity).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BRANDS */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Brands</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0 text-sm">
          {brandRows.length === 0 ? (
            <p className="py-4 text-center text-wire">No brands.</p>
          ) : (
            brandRows.map((b) => (
              <div key={b.id} className="flex flex-col gap-2 border-b border-line pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span className="font-medium text-ink">{b.name}</span>{" "}
                    <span className="font-mono text-xs text-wire">{b.domain}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/admin/view-as/brand/${b.id}`}
                      className="text-signal hover:underline"
                    >
                      view movement ↗
                    </Link>
                    {b.authorized_at ? (
                      <Badge variant="secondary">consent on file</Badge>
                    ) : (
                      <Badge variant="outline">no consent record</Badge>
                    )}
                  </div>
                </div>
                <ReRunBrandButton userId={profile.id} brandId={b.id} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* RUNS */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Runs</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[680px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                  <TableHead>View</TableHead>
                  <TableHead>Controls</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-wire">
                      No runs.
                    </TableCell>
                  </TableRow>
                ) : (
                  runRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-wire tabular-nums" suppressHydrationWarning>
                        {new Date(r.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.kind === "verify" ? "outline" : "default"}>
                          {r.kind}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={
                          r.status === "done"
                            ? "text-success"
                            : r.status === "failed"
                              ? "text-pill-dismissed"
                              : "text-signal"
                        }
                      >
                        {r.status}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.est_cost_usd != null ? `$${Number(r.est_cost_usd).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell>
                        {r.status === "done" && r.kind === "audit" ? (
                          <Link
                            href={`/admin/view-as/${r.id}`}
                            className="text-signal hover:underline"
                          >
                            view-as ↗
                          </Link>
                        ) : (
                          <span className="text-xs text-wire">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <RunRowControls userId={profile.id} runId={r.id} status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* NOTIFICATIONS */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Recent notifications</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm">
          {notificationRows.length === 0 ? (
            <p className="py-4 text-center text-wire">No notifications.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notificationRows.map((n) => (
                <li key={n.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-ink">{n.title}</span>
                  <span className="shrink-0 font-mono text-xs text-wire tabular-nums" suppressHydrationWarning>
                    {new Date(n.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* BUDGET & LIMITS — this self-host app has no plans/credits: the real
          levers are the brand cap, the deployment-wide run throttle (no
          per-user override exists in src/lib/limits.ts, so it's shown
          read-only here), and the kill switch/spend cap on /admin. */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Budget &amp; limits</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-wire">Brands</p>
            <p className="font-mono text-ink">
              {brandRows.length} / {brandLimit()}{" "}
              <span className="text-xs text-wire">(BRAND_LIMIT)</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-wire">Run throttle (deployment-wide)</p>
            <p className="font-mono text-ink">
              {MAX_AUDITS_PER_WINDOW} audits / {MAX_VERIFIES_PER_WINDOW} verifies per brand /{" "}
              {THROTTLE_WINDOW_HOURS}h
            </p>
            <p className="text-xs text-wire">
              Read-only — set via RUN_THROTTLE_* env vars, applies to every user.
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs text-wire">Spend cap &amp; kill switch</p>
            <p className="text-ink">
              Deployment-wide, not per-user — see{" "}
              <Link href="/admin#budget-limits" className="text-signal hover:underline">
                Budget &amp; limits on /admin
              </Link>
              .
            </p>
          </div>
        </CardContent>
      </Card>

      {/* RECOVERY */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Account recovery</CardTitle>
        </CardHeader>
        <CardContent>
          <RecoveryLink userId={profile.id} />
        </CardContent>
      </Card>

      {/* DANGER */}
      <Card className="border-pill-dismissed/40">
        <CardHeader>
          <CardTitle className="font-display text-pill-dismissed">Account access</CardTitle>
        </CardHeader>
        <CardContent>
          <DisableAccountButton userId={profile.id} disabled={isDisabled} />
        </CardContent>
      </Card>
    </div>
  );
}
