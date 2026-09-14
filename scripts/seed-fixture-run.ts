// Operator/dev use: gives a dev user the sample brand + a finished run, for UI
// and screenshot work at $0 (no LLM spend, no network beyond Supabase).
//
//   npx tsx --tsconfig scripts/tsconfig.json --env-file=.env.local \
//     scripts/seed-fixture-run.ts <userEmail> [--bundle <path>]
//
// WHICH RUN IT SEEDS, in order of precedence:
//   1. --bundle <path>
//   2. DEMO_SEED_BUNDLE=<path>          (same variable seed-demo.ts reads, so the
//                                        local rig and the hosted demo can never
//                                        drift apart)
//   3. examples/kestrel/run.json        (the pseudonymized public sample)
//   4. fixtures/run.json                (the older captured fixture)
// Either form of file is accepted: a CLI run bundle (RunBundleV1) is converted
// to DB rows in memory by scripts/bundle-to-fixture.ts; an already-captured
// fixture is inserted as is.
//
// Idempotent: the user's existing brand on the same domain is DELETED first
// (its runs and their children cascade), so re-running leaves exactly one brand
// with one run rather than a pile of near-identical copies.
import { createClient } from "@supabase/supabase-js";
import { loadSeedFixture, resolveSeedBundlePath } from "./seed-demo";

/** The child tables of a run, in insert order (same set as seed-demo.ts). */
const RUN_CHILD_TABLES = ["answers", "corpus_pages", "domain_checks", "fixes"] as const;

function parseArgs(argv: string[]): { email?: string; bundle?: string } {
  const out: { email?: string; bundle?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--bundle") out.bundle = argv[++i];
    else if (!out.email) out.email = argv[i];
  }
  return out;
}

async function main() {
  const { email, bundle } = parseArgs(process.argv.slice(2));
  if (!email) throw new Error("usage: seed-fixture-run.ts <userEmail> [--bundle <path>]");
  if (process.env.VERCEL_ENV === "production") throw new Error("seed script forbidden in prod");
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const path = bundle ?? resolveSeedBundlePath(process.env);
  const fx = loadSeedFixture(path);
  console.log(`seeding from ${path}`);

  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).single();
  if (!profile) throw new Error(`no profile for ${email} — sign in once first`);
  const userId = profile.id;

  // Replace, never accumulate: one Kestrel brand with one run per user, so a
  // screenshot of the dashboard shows the run this bundle describes and no
  // older twin of it beside it. brands -> runs -> children all cascade.
  const { data: stale } = await admin
    .from("brands")
    .select("id")
    .eq("user_id", userId)
    .eq("domain", fx.brand.domain);
  for (const b of stale ?? []) {
    const { error } = await admin.from("brands").delete().eq("id", b.id);
    if (error) throw new Error(`could not remove the stale brand ${b.id}: ${error.message}`);
    console.log(`removed a stale ${fx.brand.domain} brand (${b.id})`);
  }

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

  for (const t of RUN_CHILD_TABLES) {
    const rows = ((fx[t] as Record<string, unknown>[]) ?? []).map((r) => {
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
  const scored = (fx.run.scores as { overall?: { answered?: number } } | null)?.overall?.answered;
  console.log(`fixture run seeded → /app/run/${run.id}  (${scored ?? "?"} scored)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
