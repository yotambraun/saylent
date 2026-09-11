// The Fix Tracker: one working queue across runs. Dedupe by (brand, fix_key);
// lifecycle Open → Shipped → Watched, with the verify run's watch note shown
// verbatim on watched rows (the action→outcome loop). Reads under the user's RLS
// session; $0 — existing tables only.
import Link from "next/link";
import { fixWinRate, trackFixes, type TrackerFixRow, type TrackerVerify } from "@saylent/report/fix-tracker";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@saylent/report/ui/button";
import { FixesTable } from "./fixes-table";
import { VerifyPromptCard } from "./verify-prompt-card";

export const metadata = { title: "Fix tracker · Saylent" };

export default async function FixesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { brand: brandFilter } = await searchParams;
  const supabase = await createClient();

  const [{ data: brands }, { data: runsData, error: runsError }] = await Promise.all([
      supabase
        .from("brands")
        .select("id,name")
        // migration 0038 soft-delete: a deleted brand's fixes never enter the tracker.
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("runs")
        // finished_at + baseline_run_id locate the verify baseline (below).
        .select("id,brand_id,kind,status,created_at,finished_at,baseline_run_id,scores")
        .eq("status", "done")
        // migration 0038 soft-delete: a hidden run's fixes drop out of the queue too.
        .is("hidden_at", null)
        .order("created_at", { ascending: false })
        .limit(120),
    ]);
  // A read failure is NOT "no fixes yet" — surface it to the error boundary.
  if (runsError) throw runsError;

  const runs = runsData ?? [];
  const runById = new Map(runs.map((r) => [r.id, r]));
  const brandName = new Map((brands ?? []).map((b) => [b.id, b.name]));

  const { data: fixData } = runs.length
    ? await supabase
        .from("fixes")
        .select("id,fix_key,title,factor,weight,effort,published_at,run_id,artifact,evidence,engines")
        .in("run_id", runs.map((r) => r.id))
    : { data: [] };

  const fixRows: TrackerFixRow[] = (fixData ?? []).flatMap((f) => {
    const run = runById.get(f.run_id);
    if (!run || run.kind !== "audit") return [];
    return [
      {
        id: f.id,
        fix_key: f.fix_key,
        title: f.title,
        factor: f.factor,
        weight: f.weight,
        effort: f.effort,
        published_at: f.published_at,
        run_id: f.run_id,
        brand_id: run.brand_id,
        run_created_at: run.created_at,
        has_artifact: f.artifact !== null,
        evidence: Array.isArray(f.evidence) ? (f.evidence as string[]) : [],
        engines: Array.isArray(f.engines) ? (f.engines as string[]) : [],
      },
    ];
  });

  const verifies: TrackerVerify[] = runs
    .filter((r) => r.kind === "verify")
    .map((r) => ({
      brand_id: r.brand_id,
      created_at: r.created_at,
      watch_notes:
        (
          r.scores as {
            verify?: {
              watch_notes?: { fixKey: string; note: string; newlyPresentQids?: string[] }[];
            };
          } | null
        )?.verify?.watch_notes ?? [],
    }));

  const all = trackFixes(fixRows, verifies);
  const tracked = brandFilter ? all.filter((f) => f.brand_id === brandFilter) : all;
  const openCount = tracked.filter((f) => f.status === "open").length;
  const brandsWithFixes = [...new Set(all.map((f) => f.brand_id))];
  const brandNameObj = Object.fromEntries(brandName);
  const winRate = fixWinRate(tracked);

  // The re-measure moment: a brand with ≥1 shipped-but-not-yet-verified fix
  // (tracker status "shipped" = shipped, no POST-ship verify) is the moment to
  // run a verify. ONE card only — the active brand filter if set, else the brand
  // with the most shipped fixes. It needs a completed audit to compare against;
  // beyond that nothing gates it, and the CTA POSTs /api/runs, which stays the
  // one authority on whether a run may start.
  const shippedByBrand = new Map<string, number>();
  for (const f of all) {
    if (f.status === "shipped")
      shippedByBrand.set(f.brand_id, (shippedByBrand.get(f.brand_id) ?? 0) + 1);
  }
  const promptBrandId =
    (brandFilter ? [brandFilter] : [...shippedByBrand.keys()])
      .filter((id) => (shippedByBrand.get(id) ?? 0) > 0)
      .sort((a, b) => (shippedByBrand.get(b) ?? 0) - (shippedByBrand.get(a) ?? 0))[0] ?? null;
  let verifyPrompt: {
    brandId: string;
    brandName: string;
    shippedCount: number;
    baselineRunId: string;
  } | null = null;
  if (promptBrandId) {
    const baseline =
      runs
        .filter((r) => r.brand_id === promptBrandId && r.kind === "audit" && r.status === "done")
        .sort((a, b) =>
          (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at),
        )[0] ?? null;
    if (baseline) {
      verifyPrompt = {
        brandId: promptBrandId,
        brandName: brandName.get(promptBrandId) ?? "this brand",
        shippedCount: shippedByBrand.get(promptBrandId) ?? 0,
        baselineRunId: baseline.id,
      };
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl">Fix tracker</h1>
        <span className="font-mono text-xs text-wire">
          {openCount} open · {tracked.length} total
        </span>
      </div>

      {winRate.watched > 0 && (
        <p className="font-mono text-xs text-wire">
          Of {winRate.watched} fix{winRate.watched === 1 ? "" : "es"} verified,{" "}
          <span className="text-ink">{winRate.moved} moved a metric</span>
          {winRate.pct !== null ? ` (${winRate.pct}%)` : ""}.
        </p>
      )}

      {brandsWithFixes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/fixes"
            className={`rounded-full border px-3 py-1 text-xs ${!brandFilter ? "border-ink bg-ink text-paper" : "border-line text-wire hover:border-ink"}`}
          >
            All brands
          </Link>
          {brandsWithFixes.map((id) => (
            <Link
              key={id}
              href={`/app/fixes?brand=${id}`}
              className={`rounded-full border px-3 py-1 text-xs ${brandFilter === id ? "border-ink bg-ink text-paper" : "border-line text-wire hover:border-ink"}`}
            >
              {brandName.get(id) ?? "—"}
            </Link>
          ))}
        </div>
      )}

      {verifyPrompt && (
        <VerifyPromptCard
          brandId={verifyPrompt.brandId}
          brandName={verifyPrompt.brandName}
          shippedCount={verifyPrompt.shippedCount}
          baselineRunId={verifyPrompt.baselineRunId}
        />
      )}

      {tracked.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-card py-16 text-center">
          <p className="text-wire">
            {all.length === 0
              ? "No fixes yet. Your first audit writes the fix plan that lands here."
              : "No fixes for this brand."}
          </p>
          {all.length === 0 && (
            <Button asChild>
              <Link href="/app/onboarding">Run your first audit</Link>
            </Button>
          )}
        </div>
      ) : (
        <FixesTable fixes={tracked} brandName={brandNameObj} />
      )}

      <p className="font-mono text-xs text-wire">
        Watched = a verify ran after you shipped; its finding for that fix is shown verbatim.
        Run a verify from the dashboard to move shipped fixes forward.
      </p>
    </div>
  );
}
