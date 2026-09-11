// Operator/dev use: exports one real run's rows (run, answers,
// corpus_pages, domain_checks, fixes) to fixtures/run.json, secrets-free
// (user ids stripped; seed script re-maps them). Usage:
//   npx tsx --env-file=.env.local scripts/capture-fixture.ts <runId>
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const runId = process.argv[2];
  if (!runId) throw new Error("usage: capture-fixture.ts <runId>");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const strip = (rows: Record<string, unknown>[]) =>
    rows.map((row) => {
      const rest = { ...row };
      for (const k of ["id", "run_id", "user_id", "brand_id"]) delete rest[k];
      return rest;
    });

  const { data: run, error } = await admin.from("runs").select("*").eq("id", runId).single();
  if (error || !run) throw new Error(`run not found: ${error?.message}`);
  const { data: brand } = await admin.from("brands").select("*").eq("id", run.brand_id).single();
  const tables = ["answers", "corpus_pages", "domain_checks", "fixes"] as const;
  const out: Record<string, unknown> = {
    captured_at: new Date().toISOString(),
    run: {
      kind: run.kind,
      status: run.status,
      profile: run.profile,
      stage: run.stage,
      scores: run.scores,
      est_cost_usd: run.est_cost_usd,
      finished_at: run.finished_at,
    },
    brand: brand
      ? {
          name: brand.name,
          domain: brand.domain,
          aliases: brand.aliases,
          category: brand.category,
          icp: brand.icp,
          competitors: brand.competitors,
          problems: brand.problems,
          question_set: brand.question_set,
        }
      : null,
  };
  for (const t of tables) {
    const { data } = await admin.from(t).select("*").eq("run_id", runId);
    out[t] = strip(data ?? []);
  }
  mkdirSync("fixtures", { recursive: true });
  writeFileSync("fixtures/run.json", JSON.stringify(out, null, 1));
  console.log(
    `fixtures/run.json written: ${tables.map((t) => `${t}=${(out[t] as unknown[]).length}`).join(" ")}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
