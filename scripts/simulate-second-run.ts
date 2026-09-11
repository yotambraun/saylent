// Operator/dev use: manufacture a REALISTIC second run so The
// Pulse & The Win screens have real, shaped data to render.
//
// HONEST LABEL: this is SIMULATION, not a live pipeline run. It reads a brand's
// existing done run (created by scripts/simulate-run.ts — itself a replay of the
// captured fixture) and writes a SECOND done run whose answers are a verbatim
// copy of the first EXCEPT three deliberate, plausible sentence-level edits that
// mirror the shapes a real re-audit produces:
//   1. one answer GAINS a strong pro-brand sentence + verdict → recommended/first
//   2. one answer GAINS a rival-favoring sentence, verdict UNCHANGED
//   3. one answer LOSES its brand-mentioning sentence + verdict → absent
// Scores are copied and the recommended/mentioned counts shifted to match those
// exact edits (rates recomputed, not invented). No LLM spend. Prod-guarded like
// simulate-run.ts.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/simulate-second-run.ts <brandId>
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { splitSentences } from "@saylent/report/answer-diff";
import { wordPresent } from "@saylent/engine/util";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Append a sentence to an answer's text on its own line (natural boundary). */
function appendSentence(raw: string, sentence: string): string {
  return `${raw.trimEnd()}\n\n${sentence}`;
}

/** Remove the whole LINE carrying the first brand-mentioning sentence, so the
 * diff engine reports a clean "removed" sentence with no orphaned markdown
 * markers (removing only the substring can leave a bare "#" heading marker).
 * Returns [newText, removedSentence]. */
function removeBrandSentence(raw: string, aliases: string[]): [string, string | null] {
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const s of splitSentences(lines[i])) {
      if (aliases.some((a) => a && wordPresent(a, s))) {
        lines.splice(i, 1);
        const next = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
        return [next, s];
      }
    }
  }
  return [raw, null];
}

async function main() {
  const brandId = process.argv[2];
  if (!brandId) throw new Error("usage: simulate-second-run.ts <brandId>");
  if (process.env.VERCEL_ENV === "production")
    throw new Error("simulate-second-run forbidden in prod");

  const admin: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: brand, error: be } = await admin
    .from("brands")
    .select("id,user_id,name,aliases,competitors")
    .eq("id", brandId)
    .single();
  if (be || !brand) throw new Error(`brand ${brandId}: ${be?.message ?? "not found"}`);
  const aliases: string[] = brand.aliases?.length ? brand.aliases : [brand.name];
  const rival: string = brand.competitors?.[0] ?? "the incumbent";

  // baseline = the brand's most recent DONE run (the simulate-run.ts output)
  const { data: baseRun, error: re } = await admin
    .from("runs")
    .select("id,kind,profile,scores,created_at")
    .eq("brand_id", brandId)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (re || !baseRun) throw new Error(`no done run for brand ${brandId}: ${re?.message ?? ""}`);
  const baselineRunId = baseRun.id as string;

  const { data: answers, error: ae } = await admin
    .from("answers")
    .select("qid,qtype,question,engine,ok,raw_text,citations,verdict,usage,error")
    .eq("run_id", baselineRunId);
  if (ae || !answers?.length) throw new Error(`no answers on ${baselineRunId}: ${ae?.message ?? ""}`);
  const rows = answers as AnswerRow[];

  // Pick the three edit targets from what actually mentions the brand, so the
  // edits land on real, brand-relevant answers (falls back gracefully).
  const brandRows = rows.filter((r) => r.ok && aliases.some((a) => wordPresent(a, r.raw_text)));
  const pick = (used: Set<string>) => {
    const r = brandRows.find((x) => !used.has(`${x.engine}:${x.qid}`));
    if (r) used.add(`${r.engine}:${r.qid}`);
    return r;
  };
  const used = new Set<string>();
  const proTarget = pick(used); // edit 1
  const rivalTarget = pick(used); // edit 2
  const dropTarget = pick(used); // edit 3
  const keyOf = (r?: AnswerRow) => (r ? `${r.engine}:${r.qid}` : "");
  const proKey = keyOf(proTarget);
  const rivalKey = keyOf(rivalTarget);
  const dropKey = keyOf(dropTarget);

  const PRO_SENTENCE = `The leading alternative for most teams in 2026 is undeniably ${brand.name}, widely considered the most compelling modern option.`;
  const RIVAL_SENTENCE = `${rival} has recently become the default recommendation for larger teams.`;

  // sleep so created_at is a few seconds after the baseline (the runs read
  // newest-first; a distinct timestamp keeps ordering honest)
  await sleep(3000);

  const { data: newRun, error: nre } = await admin
    .from("runs")
    .insert({
      brand_id: brandId,
      user_id: brand.user_id,
      kind: "audit",
      profile: "smoke",
      status: "done",
      stage: "done",
      est_cost_usd: 0,
      finished_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (nre || !newRun) throw new Error(`new run insert: ${nre?.message}`);
  const currentRunId = newRun.id as string;

  const edits: string[] = [];
  const toInsert = rows.map((r) => {
    const key = `${r.engine}:${r.qid}`;
    let raw_text = r.raw_text;
    let verdict = r.verdict ? { ...r.verdict } : r.verdict;

    if (key === proKey) {
      raw_text = appendSentence(raw_text, PRO_SENTENCE);
      verdict = {
        ...(verdict ?? {}),
        brand_present: true,
        mention_type: "recommended",
        prominence: "first",
        sentiment: "positive",
      };
      edits.push(`  [+pro/upgrade] ${key} → recommended/first`);
    } else if (key === rivalKey) {
      raw_text = appendSentence(raw_text, RIVAL_SENTENCE);
      edits.push(`  [+rival/unchanged] ${key} (verdict unchanged)`);
    } else if (key === dropKey) {
      const [next, removed] = removeBrandSentence(raw_text, aliases);
      raw_text = next;
      verdict = {
        ...(verdict ?? {}),
        brand_present: false,
        mention_type: "absent",
        prominence: "none",
      };
      edits.push(`  [-brand/downgrade] ${key} → absent (removed: "${(removed ?? "").slice(0, 60)}…")`);
    }

    return {
      run_id: currentRunId,
      user_id: brand.user_id,
      qid: r.qid,
      qtype: r.qtype,
      question: r.question,
      engine: r.engine,
      ok: r.ok,
      raw_text,
      citations: r.citations ?? [],
      verdict,
      error: r.error ?? null,
      usage: r.usage ?? null,
    };
  });

  const { error: aie } = await admin.from("answers").insert(toInsert);
  if (aie) throw new Error(`answers insert: ${aie.message}`);

  // Scores: copy the baseline, shift counts to match the three edits exactly.
  // edit1: one answer compared→recommended  → recommended +1 (that engine +1)
  // edit3: one answer compared→absent        → mentioned  -1 (that engine -1)
  // edit2: verdict unchanged                 → no score change
  const scores = JSON.parse(JSON.stringify(baseRun.scores ?? {})) as {
    overall?: Record<string, number | null>;
    per_engine?: Record<string, Record<string, number | null>>;
  };
  const recompute = (b: Record<string, number | null> | undefined) => {
    if (!b) return;
    const answered = (b.answered as number) || 0;
    b.rec_rate = answered ? (b.recommended as number) / answered : null;
    b.mention_rate = answered ? (b.mentioned as number) / answered : null;
  };
  const proEngine = proTarget?.engine;
  const dropEngine = dropTarget?.engine;
  if (scores.overall) {
    scores.overall.recommended = ((scores.overall.recommended as number) || 0) + 1;
    scores.overall.mentioned = Math.max(0, ((scores.overall.mentioned as number) || 0) - 1);
    recompute(scores.overall);
  }
  if (proEngine && scores.per_engine?.[proEngine]) {
    const pe = scores.per_engine[proEngine];
    pe.recommended = ((pe.recommended as number) || 0) + 1;
    recompute(pe);
  }
  if (dropEngine && scores.per_engine?.[dropEngine]) {
    const de = scores.per_engine[dropEngine];
    de.mentioned = Math.max(0, ((de.mentioned as number) || 0) - 1);
    recompute(de);
  }
  const { error: se } = await admin.from("runs").update({ scores }).eq("id", currentRunId);
  if (se) throw new Error(`scores update: ${se.message}`);

  // Publish two of the baseline run's fixes BETWEEN the runs (published_at after
  // baseline, before now) so The Win can show "fixes shipped between runs".
  const { data: fixes } = await admin
    .from("fixes")
    .select("id,title")
    .eq("run_id", baselineRunId)
    .limit(2);
  if (fixes?.length) {
    const shippedAt = new Date(Date.now() - 1500).toISOString();
    for (const f of fixes) {
      await admin.from("fixes").update({ published_at: shippedAt }).eq("id", f.id);
    }
    edits.push(`  [fixes shipped] ${fixes.map((f) => f.title).join(" · ")}`);
  }

  console.log(`\n✓ simulated SECOND run for brand ${brandId}`);
  console.log(`  baseline run: ${baselineRunId}`);
  console.log(`  current  run: ${currentRunId}`);
  console.log(`  edits:`);
  for (const e of edits) console.log(e);
  console.log(`\n  view → /app/brand/${brandId} (The Pulse panel)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
