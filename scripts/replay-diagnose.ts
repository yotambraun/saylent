// Operator/dev use: $0 engine-change validation. Replays a stored run's data
// through the CURRENT diagnose() and prints the fix plan it would produce
// today. No LLM calls, no writes — pure read + pure function. Usage:
//   npx tsx --env-file=.env.local scripts/replay-diagnose.ts [runId]
import { Client } from "pg";
import { diagnose } from "@saylent/engine/fixes";
import type { AnswerRow, BrandModel, CorpusPageRow, DomainCheck, Question } from "@saylent/engine/types";

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("usage: replay-diagnose.ts <runId>");

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const { rows: [run] } = await c.query("select brand_id from runs where id=$1", [runId]);
  if (!run) throw new Error(`no run ${runId}`);
  const { rows: [brand] } = await c.query("select * from brands where id=$1", [run.brand_id]);
  const { rows: answers } = await c.query(
    `select engine, ok, raw_text, citations, verdict, qid, qtype, question
     from answers where run_id=$1`,
    [runId],
  );
  const { rows: corpus } = await c.query("select * from corpus_pages where run_id=$1", [runId]);
  const { rows: checksRaw } = await c.query(
    "select check_name, status, detail, factor from domain_checks where run_id=$1",
    [runId],
  );
  // the run's question set, derived from its answers (qid/text/qtype live on answers)
  const { rows: questions } = await c.query(
    `select qid, min(question) as text, min(qtype) as qtype
     from answers where run_id=$1 group by qid order by qid`,
    [runId],
  );

  const bm: BrandModel = {
    brand: brand.name,
    domain: brand.domain,
    aliases: brand.aliases ?? [brand.name],
    category: brand.category ?? "",
    icp: brand.icp ?? "",
    products: [],
    value_props: brand.value_props ?? [],
    problems: [],
    competitors: brand.competitors ?? [],
    language: "en",
  };
  const checks = checksRaw.map((r) => ({
    check: r.check_name,
    status: r.status,
    detail: r.detail,
    factor: r.factor,
  })) as DomainCheck[];

  const fixes = diagnose(
    bm,
    questions as Question[],
    answers as AnswerRow[],
    corpus as CorpusPageRow[],
    checks,
  );

  const cited = (corpus as CorpusPageRow[]).filter((p) =>
    Object.values(p.cited_by ?? {}).some((n) => (n ?? 0) > 0),
  );
  const tp = cited.filter((p) => p.page_type !== "brand_owned").length;
  console.log(
    `cited pages: ${cited.length} · third-party: ${tp} (t=${cited.length ? (tp / cited.length).toFixed(2) : "n/a"})`,
  );
  console.log(`\nFIX PLAN the current engine would produce for ${brand.name} (${fixes.length} fixes):`);
  for (const f of fixes) console.log(`  ${f.weight}\t[${f.factor}] ${f.title}`);
  const hub = fixes.find((f) => f.fixKey === "coverage-hub");
  if (hub) {
    console.log("\ncoverage-hub evidence:");
    for (const e of hub.evidence) console.log("  -", e);
  }
  await c.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
