// Operator/dev use: inserts fixtures/run.json for a given dev user;
// used for UI work at $0 (no LLM spend). Usage:
//   npx tsx --env-file=.env.local scripts/seed-fixture-run.ts <userEmail>
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const email = process.argv[2];
  if (!email) throw new Error("usage: seed-fixture-run.ts <userEmail>");
  if (process.env.VERCEL_ENV === "production") throw new Error("seed script forbidden in prod");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const fx = JSON.parse(readFileSync("fixtures/run.json", "utf8"));

  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).single();
  if (!profile) throw new Error(`no profile for ${email} — sign in once first`);
  const userId = profile.id;

  const { data: brand, error: be } = await admin
    .from("brands")
    .insert({ ...fx.brand, user_id: userId })
    .select("id")
    .single();
  if (be || !brand) throw new Error(`brand insert: ${be?.message}`);

  const { data: run, error: re } = await admin
    .from("runs")
    .insert({ ...fx.run, brand_id: brand.id, user_id: userId })
    .select("id")
    .single();
  if (re || !run) throw new Error(`run insert: ${re?.message}`);

  for (const t of ["answers", "corpus_pages", "domain_checks", "fixes"] as const) {
    const rows = (fx[t] as Record<string, unknown>[]).map((r) => {
      // fixtures captured from live runs include generated columns (fts),
      // which Postgres refuses on insert — strip them.
      const rest: Record<string, unknown> = { ...r, run_id: run.id, user_id: userId };
      delete rest.fts;
      return rest;
    });
    if (rows.length === 0) continue;
    const { error } = await admin.from(t).insert(rows);
    if (error) throw new Error(`${t} insert: ${error.message}`);
    console.log(`seeded ${t}: ${rows.length}`);
  }
  console.log(`fixture run seeded → /app/run/${run.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
