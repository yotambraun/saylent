// Operator/dev use: replays the captured fixture (fixtures/run.json) as a LIVE
// audit so the Audit Theater can be watched — and demoed — end to end at $0 LLM spend.
// Honest by construction: it only re-emits real captured data, in the real
// order the pipeline produces it (observe saves raw_text+citations with no
// verdict; the judge pass fills verdicts; then corpus/checks/fixes; then done),
// with the exact live stage strings the engine sets. Nothing is invented.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/simulate-run.ts <userEmail> [--fast]
//
// Guard mirrors seed-fixture-run.ts: refuses to run against production.
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"] as const;
const STAGE_LABEL: Record<string, string> = {
  chatgpt: "Asking ChatGPT",
  claude: "Asking Claude",
  gemini: "Asking Gemini",
  perplexity: "Asking Perplexity",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FixtureAnswer {
  qid: string;
  qtype: string;
  question: string;
  engine: string;
  ok: boolean;
  raw_text: string;
  citations: unknown;
  verdict: unknown;
  usage?: unknown;
  error?: unknown;
}

async function setStage(admin: SupabaseClient, runId: string, label: string) {
  const { error } = await admin
    .from("runs")
    .update({ stage: label, status: "running" })
    .eq("id", runId);
  if (error) throw new Error(`setStage(${label}): ${error.message}`);
  process.stdout.write(`  stage → ${label}\n`);
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u.slice(0, 30);
  }
}

async function main() {
  const email = process.argv[2];
  const fast = process.argv.includes("--fast");
  if (!email) throw new Error("usage: simulate-run.ts <userEmail> [--fast]");
  if (process.env.VERCEL_ENV === "production") throw new Error("simulate-run forbidden in prod");

  // dev timings (~90s) or --fast for a quick smoke of the script itself
  const T = fast
    ? { prep: 150, observe: 120, judge: 90, corpus: 80, tail: 200 }
    : { prep: 1200, observe: 1500, judge: 1000, corpus: 450, tail: 1500 };

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const fx = JSON.parse(readFileSync("fixtures/run.json", "utf8"));

  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).single();
  if (!profile) throw new Error(`no profile for ${email} — sign in once first`);
  const userId = profile.id;

  // brand carries the frozen question_set → the theater board reads it
  const { data: brand, error: be } = await admin
    .from("brands")
    .insert({ ...fx.brand, user_id: userId })
    .select("id")
    .single();
  if (be || !brand) throw new Error(`brand insert: ${be?.message}`);

  // run starts LIVE (running), not done — this is the whole point
  const { kind, profile: prof } = fx.run;
  const { data: run, error: re } = await admin
    .from("runs")
    .insert({
      brand_id: brand.id,
      user_id: userId,
      kind,
      profile: prof,
      status: "running",
      stage: "Crawling your site",
    })
    .select("id")
    .single();
  if (re || !run) throw new Error(`run insert: ${re?.message}`);
  const runId = run.id as string;
  console.log(`\nsimulated run live → /app/run/${runId}\n`);

  // ---- prep ----
  await sleep(T.prep);
  await setStage(admin, runId, `Crawling your site · /features (${fx.brand.question_set ? 8 : 6} pages)`);
  await sleep(T.prep);
  await setStage(admin, runId, "Building your brand model");
  await sleep(T.prep);

  // ---- observe: one engine at a time, answers drip in (NO verdict yet) ----
  const answers = fx.answers as FixtureAnswer[];
  const byEngine = new Map<string, FixtureAnswer[]>();
  for (const a of answers) {
    if (!byEngine.has(a.engine)) byEngine.set(a.engine, []);
    byEngine.get(a.engine)!.push(a);
  }
  for (const engine of ENGINES) {
    const rows = byEngine.get(engine) ?? [];
    await setStage(admin, runId, `${STAGE_LABEL[engine]} · 0/${rows.length} answered`);
    let done = 0;
    for (const a of rows) {
      await sleep(T.observe);
      const { error } = await admin.from("answers").insert({
        run_id: runId,
        user_id: userId,
        qid: a.qid,
        qtype: a.qtype,
        question: a.question,
        engine: a.engine,
        ok: a.ok,
        raw_text: a.raw_text,
        citations: a.citations ?? [],
        error: a.error ?? null,
        usage: a.usage ?? null,
        // verdict deliberately omitted — arrives in the judge pass, like reality
      });
      if (error) throw new Error(`answer insert (${engine}/${a.qid}): ${error.message}`);
      done++;
      await setStage(admin, runId, `${STAGE_LABEL[engine]} · ${done}/${rows.length} answered`);
    }
  }

  // ---- judge: verdicts land on the already-inserted rows, cross-board ----
  await setStage(admin, runId, "Reading the answers");
  for (const a of answers) {
    await sleep(T.judge);
    if (!a.ok) continue; // failed answers stay unjudged (flagged), like reality
    const { error } = await admin
      .from("answers")
      .update({ verdict: a.verdict })
      .eq("run_id", runId)
      .eq("qid", a.qid)
      .eq("engine", a.engine);
    if (error) throw new Error(`verdict update (${a.engine}/${a.qid}): ${error.message}`);
  }

  // ---- corpus: read the cited pages, host by host ----
  await setStage(admin, runId, "Reading the pages the engines cited");
  const corpus = fx.corpus_pages as Array<Record<string, unknown>>;
  let read = 0;
  for (const c of corpus) {
    await sleep(T.corpus);
    read++;
    const host = hostOf(((c.final_url ?? c.url) as string) ?? "");
    await setStage(
      admin,
      runId,
      `Reading the pages the engines cited · ${host} (${read}/${corpus.length})`,
    );
  }
  await insertTable(admin, "corpus_pages", corpus, runId, userId);

  // ---- domain checks ----
  await setStage(admin, runId, "Testing your site's gates");
  await sleep(T.tail);
  await insertTable(admin, "domain_checks", fx.domain_checks, runId, userId);

  // ---- fixes ----
  await setStage(admin, runId, "Writing your fix plan");
  await sleep(T.tail);
  await insertTable(admin, "fixes", fx.fixes, runId, userId);

  // ---- done ----
  const { error: fe } = await admin
    .from("runs")
    .update({
      status: "done",
      stage: "done",
      scores: fx.run.scores,
      est_cost_usd: 0, // simulated — no real spend
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (fe) throw new Error(`finish: ${fe.message}`);

  console.log(`\n✓ simulated run complete → /app/run/${runId}\n`);
}

/** Insert a fixture table verbatim (strip generated/stateful columns), reusing
 * the seed-fixture-run.ts pattern. */
async function insertTable(
  admin: SupabaseClient,
  table: "corpus_pages" | "domain_checks" | "fixes",
  rows: Array<Record<string, unknown>>,
  runId: string,
  userId: string,
) {
  const mapped = (rows ?? []).map((r) => {
    const rest: Record<string, unknown> = { ...r, run_id: runId, user_id: userId };
    delete rest.fts; // generated column — Postgres refuses it on insert
    delete rest.published_at; // a fresh run's fixes are unpublished
    return rest;
  });
  if (mapped.length === 0) return;
  const { error } = await admin.from(table).insert(mapped);
  if (error) throw new Error(`${table} insert: ${error.message}`);
  console.log(`  inserted ${table}: ${mapped.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
