// Operator/dev use: $0 rig. Manufactures a DONE verify run so the verify
// page's WIN surface (shipped chips, watch-note movement, sentence receipts,
// the one celebration) can be exercised without any LLM spend.
//
// HONEST LABEL: this is SIMULATION, not a live pipeline run. It takes a brand's
// two most recent comparable done runs (same profile — e.g. the simulate-run.ts
// baseline plus the simulate-second-run.ts re-run), ships the baseline's top fix,
// and writes a verify-kind run whose answers are a verbatim copy of the newest
// run. If no question flipped to brand-present between the two runs, it flips
// exactly ONE still-absent answer (prepended sentence + verdict listed/early/
// positive) so the celebration path renders; scores are shifted to match that
// one edit (rates recomputed, not invented). Prod-guarded like its siblings.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/simulate-verify-run.ts <brandId>
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

interface AnswerRow {
  qid: string;
  qtype: string;
  question: string;
  engine: string;
  ok: boolean;
  raw_text: string;
  citations: unknown;
  verdict: Record<string, unknown> | null;
  usage: unknown;
  error: unknown;
}

const brandPresent = (a: AnswerRow) => a.verdict?.brand_present === true;
const presentQids = (rows: AnswerRow[]) => new Set(rows.filter(brandPresent).map((a) => a.qid));

async function main() {
  const brandId = process.argv[2];
  if (!brandId) throw new Error("usage: simulate-verify-run.ts <brandId>");
  if (process.env.VERCEL_ENV === "production")
    throw new Error("simulate-verify-run forbidden in prod");

  const admin: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: brand, error: be } = await admin
    .from("brands")
    .select("id,user_id,name,aliases")
    .eq("id", brandId)
    .single();
  if (be || !brand) throw new Error(`brand ${brandId}: ${be?.message ?? "not found"}`);

  const { data: runs, error: re } = await admin
    .from("runs")
    .select("id,user_id,kind,profile,scores,created_at")
    .eq("brand_id", brandId)
    .eq("status", "done")
    .order("created_at", { ascending: true });
  if (re || !runs || runs.length < 2)
    throw new Error(`need two done runs on brand ${brandId} (run simulate-run.ts then simulate-second-run.ts first)`);
  const baseline = runs.find((r) => r.profile === runs[runs.length - 1].profile)!;
  const source = runs[runs.length - 1];
  if (baseline.id === source.id) throw new Error("no comparable pair (same profile) found");

  const fetchAnswers = async (rid: string) =>
    ((await admin
      .from("answers")
      .select("qid,qtype,question,engine,ok,raw_text,citations,verdict,usage,error")
      .eq("run_id", rid)).data ?? []) as AnswerRow[];
  const [baseAns, srcAns] = [await fetchAnswers(baseline.id), await fetchAnswers(source.id)];
  if (!baseAns.length || !srcAns.length) throw new Error("missing answers on one of the runs");

  // ship the baseline's top fix (idempotent) at a between-runs timestamp
  const { data: topFix, error: fe } = await admin
    .from("fixes")
    .select("id,fix_key,title,published_at")
    .eq("run_id", baseline.id)
    .order("weight", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fe || !topFix) throw new Error(`no fixes on baseline ${baseline.id}: ${fe?.message ?? ""}`);
  const shippedAt = new Date(new Date(source.created_at).getTime() - 3600_000).toISOString();
  if (!topFix.published_at)
    await admin.from("fixes").update({ published_at: shippedAt }).eq("id", topFix.id);

  // movement: qids newly brand-present vs baseline; flip one honestly if none
  const before = presentQids(baseAns);
  const rows = srcAns.map((a) => ({ ...a }));
  const scores = JSON.parse(JSON.stringify(source.scores ?? {}));
  let newly = [...presentQids(rows)].filter((q) => !before.has(q));
  if (newly.length === 0) {
    const cand = rows.find(
      (a) =>
        a.ok &&
        a.verdict &&
        !before.has(a.qid) &&
        !rows.some((o) => o.qid === a.qid && brandPresent(o)),
    );
    if (cand) {
      const gained = `${brand.name} now appears here: reviewers increasingly point to ${brand.name} as a credible option for this question.`;
      cand.raw_text = `${gained}\n\n${cand.raw_text}`;
      cand.verdict = {
        ...cand.verdict,
        brand_present: true,
        mention_type: "listed",
        prominence: "early",
        sentiment: "positive",
        excerpt: gained,
      };
      newly = [cand.qid];
      const eng = cand.engine;
      if (scores.overall) {
        scores.overall.mentioned = (scores.overall.mentioned ?? 0) + 1;
        if (scores.overall.answered)
          scores.overall.mention_rate = scores.overall.mentioned / scores.overall.answered;
      }
      const pe = scores.per_engine?.[eng];
      if (pe) {
        pe.mentioned = (pe.mentioned ?? 0) + 1;
        if (pe.answered) pe.mention_rate = pe.mentioned / pe.answered;
      }
    }
  }

  const note = newly.length
    ? `${newly.join(", ")} now name${newly.length === 1 ? "s" : ""} you — movement within the stated window`
    : "no movement yet — within the stated time-to-impact window";
  scores.verify = {
    baseline: baseline.scores,
    watch_notes: [
      { fixKey: topFix.fix_key, title: topFix.title, note, newlyPresentQids: newly },
    ],
  };

  const verifyId = randomUUID();
  const now = new Date().toISOString();
  const { error: e1 } = await admin.from("runs").insert({
    id: verifyId,
    user_id: brand.user_id,
    brand_id: brandId,
    kind: "verify",
    status: "done",
    profile: source.profile,
    stage: "done",
    baseline_run_id: baseline.id,
    scores,
    est_cost_usd: 0,
    created_at: now,
    finished_at: now,
  });
  if (e1) throw new Error(`runs insert: ${e1.message}`);

  const { error: e2 } = await admin
    .from("answers")
    .insert(rows.map((a) => ({ ...a, run_id: verifyId, user_id: brand.user_id })));
  if (e2) throw new Error(`answers insert: ${e2.message}`);

  console.log(`verify run seeded ($0) → /app/run/${verifyId}/verify`);
  console.log(`  baseline ${baseline.id} · answers copied from ${source.id}`);
  console.log(`  shipped fix: ${topFix.fix_key} · newlyPresentQids: ${newly.join(", ") || "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
