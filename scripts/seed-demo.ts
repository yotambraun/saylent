// Seeds the public, hosted read-only demo.
//
// Creates (or repairs) ONE shared demo account and gives it the Kestrel Uptime
// fixture as its brand + finished audit run, so a visitor who never logs in can walk
// the dashboard, the summary, the full report, compare, movement and settings for
// real-shaped data at $0 (fixtures/run.json is a captured run — no LLM call happens
// here or afterwards; every write path refuses, see src/lib/demo-mode.ts).
//
// Usage (against the DEMO Supabase project, never dev/prod):
//   NEXT_PUBLIC_DEMO_READONLY=1 npx tsx --tsconfig scripts/tsconfig.json \
//     --env-file=.env.demo scripts/seed-demo.ts
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + DEMO_USER_EMAIL +
// DEMO_USER_PASSWORD — AND a real operator admin that is not the demo account
// (sign yourself up on the demo deployment first; see NO_OPERATOR_ADMIN_MESSAGE).
// Idempotent: run it as often as you like — an existing demo
// user/brand/run is reused and repaired, never duplicated.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { DEMO_ENV, demoCredentials, isDemoReadOnly } from "@/lib/demo-mode";

/** The subset of the service-role client this script uses. Declared structurally so
 *  the test can pass a tiny in-memory double instead of a live project. */
export type SeedClient = {
  auth: {
    admin: {
      createUser(p: {
        email: string;
        password: string;
        email_confirm: boolean;
      }): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
      updateUserById(
        id: string,
        p: { password: string },
      ): Promise<{ error: { message: string } | null }>;
    };
  };
  from(table: string): SeedQuery;
};
type SeedError = { message: string } | null;
type SeedRow = Record<string, unknown>;
type SeedQuery = PromiseLike<{ data: SeedRow[] | null; error: SeedError }> & {
  select(cols: string): SeedQuery;
  insert(rows: unknown): SeedQuery;
  update(patch: SeedRow): SeedQuery;
  eq(col: string, val: unknown): SeedQuery;
  maybeSingle(): Promise<{ data: SeedRow | null; error: SeedError }>;
  single(): Promise<{ data: SeedRow | null; error: SeedError }>;
};

export type SeedResult = {
  userId: string;
  brandId: string;
  runId: string;
  /** What already existed — a second run of the script reports all three as reused. */
  reused: { user: boolean; brand: boolean; run: boolean };
};

/** The child tables of a run, in the order seed-fixture-run.ts writes them. */
const RUN_CHILD_TABLES = ["answers", "corpus_pages", "domain_checks", "fixes"] as const;

/** Refuse to run unless this is really a demo deployment, and never against
 *  production without the operator saying so out loud. Pure so it is unit-tested. */
export function assertSeedAllowed(
  env: Record<string, string | undefined>,
  argv: string[],
): void {
  if (!isDemoReadOnly(env.NEXT_PUBLIC_DEMO_READONLY)) {
    throw new Error(
      `${DEMO_ENV.flag} is not set — refusing to seed. This script only ever writes to a demo deployment.`,
    );
  }
  if (env.VERCEL_ENV === "production" && !argv.includes("--yes-production")) {
    throw new Error(
      "VERCEL_ENV=production — refusing to seed without --yes-production (say it out loud if the demo really IS your production project).",
    );
  }
}

/**
 * The demo project must always have a REAL operator.
 *
 * Migration 0040 promotes the FIRST profile row on a project to `role='admin'`.
 * On a fresh demo project that first row is the demo account this script
 * creates, and step 1b then demotes it back to 'user' — correctly, because
 * otherwise /admin would be published to every visitor. The bug was what that
 * left behind: a project with ZERO admins, and a 0040 trigger still armed. The
 * next person to sign up — anyone on the internet, on a public demo — became the
 * operator of the deployment.
 *
 * So the seed refuses to demote (and refuses to finish) unless a real operator
 * admin already exists that is NOT the demo account.
 */
export const NO_OPERATOR_ADMIN_MESSAGE =
  "no operator admin exists on this project. Migration 0040 promotes the FIRST profile row " +
  "to operator, and this script demotes the demo account — which would leave the project with " +
  "zero admins and hand /admin to the next person who signs up. Sign up your own operator " +
  "account on this deployment first (it becomes the admin), then re-run the seed.";

/** Admin profile ids that are NOT the demo account. */
export async function operatorAdmins(admin: SeedClient, demoUserId: string): Promise<string[]> {
  const { data, error } = await admin.from("profiles").select("id,role").eq("role", "admin");
  if (error) throw new Error(`could not read the operator admins: ${error.message}`);
  return (data ?? [])
    .map((r) => r.id as string)
    .filter((id) => id && id !== demoUserId);
}

/** Strip the generated columns Postgres refuses on insert (same rule as
 *  scripts/seed-fixture-run.ts) and re-key a fixture child row onto this run. */
function childRow(r: Record<string, unknown>, runId: string, userId: string) {
  const rest: Record<string, unknown> = { ...r, run_id: runId, user_id: userId };
  delete rest.fts;
  return rest;
}

/** THE seeding routine. Idempotent by construction: every step looks first and only
 *  writes what is missing. Takes its client + fixture so the test can drive it. */
export async function seedDemo(
  admin: SeedClient,
  fixture: {
    brand: Record<string, unknown>;
    run: Record<string, unknown>;
    [table: string]: unknown;
  },
  creds: { email: string; password: string },
  log: (line: string) => void = console.log,
): Promise<SeedResult> {
  const reused = { user: false, brand: false, run: false };

  // 1) The demo account. profiles.email is the lookup key (same as
  //    seed-fixture-run.ts); the auth user is created only when there is no profile.
  let { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("email", creds.email)
    .maybeSingle();
  if (profile) {
    reused.user = true;
    // Repair: the env password is the source of truth, so a rotated
    // DEMO_USER_PASSWORD does not silently strand the proxy sign-in.
    const { error } = await admin.auth.admin.updateUserById(profile.id as string, {
      password: creds.password,
    });
    if (error) throw new Error(`could not reset the demo password: ${error.message}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: creds.email,
      password: creds.password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`could not create the demo user: ${error?.message}`);
    profile = { id: data.user.id };
  }
  const userId = profile.id as string;

  // 1a) An operator admin that is NOT the demo account must already exist (#2).
  //     Checked BEFORE the demotion below, so a refusal leaves the project exactly
  //     as it was rather than half-seeded with no admin at all.
  if ((await operatorAdmins(admin, userId)).length === 0) {
    throw new Error(NO_OPERATOR_ADMIN_MESSAGE);
  }

  // 1b) The demo account must NEVER be an operator. On a fresh demo project the
  //     first profile row is auto-promoted to role='admin' (migration 0040) — that
  //     would publish /admin to every visitor. Force it back, every run.
  {
    const { error } = await admin
      .from("profiles")
      .update({ role: "user", plan: "free" })
      .eq("id", userId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`could not demote the demo profile: ${error.message}`);
  }

  // 1c) ...and never FINISH with no admin row (#2). Belt and braces: if the
  //     demotion above somehow took the last operator with it, say so loudly
  //     instead of leaving a public deployment waiting to crown a stranger.
  if ((await operatorAdmins(admin, userId)).length === 0) {
    throw new Error(NO_OPERATOR_ADMIN_MESSAGE);
  }

  // 2) The brand (fixtures/run.json → Kestrel Uptime). Keyed by owner + domain.
  const domain = fixture.brand.domain as string;
  let { data: brand } = await admin
    .from("brands")
    .select("id")
    .eq("user_id", userId)
    .eq("domain", domain)
    .maybeSingle();
  if (brand) {
    reused.brand = true;
  } else {
    const { data, error } = await admin
      .from("brands")
      .insert({ ...fixture.brand, user_id: userId })
      .select("id")
      .single();
    if (error || !data) throw new Error(`brand insert: ${error?.message}`);
    brand = data;
  }
  const brandId = brand.id as string;

  // 3) The finished audit run + its children. One run per brand is enough for the
  //    report, compare and movement surfaces to have something real to show.
  const { data: existingRun } = await admin
    .from("runs")
    .select("id")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (existingRun) {
    log(`demo run already seeded (${existingRun.id as string}) — leaving it alone`);
    return { userId, brandId, runId: existingRun.id as string, reused: { ...reused, run: true } };
  }

  const { data: run, error: runErr } = await admin
    .from("runs")
    .insert({ ...fixture.run, brand_id: brandId, user_id: userId })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`run insert: ${runErr?.message}`);
  const runId = run.id as string;

  for (const t of RUN_CHILD_TABLES) {
    const rows = ((fixture[t] as Record<string, unknown>[]) ?? []).map((r) =>
      childRow(r, runId, userId),
    );
    if (rows.length === 0) continue;
    const { error } = await admin.from(t).insert(rows).select("id");
    if (error) throw new Error(`${t} insert: ${error.message}`);
    log(`seeded ${t}: ${rows.length}`);
  }

  return { userId, brandId, runId, reused };
}

async function main() {
  assertSeedAllowed(process.env, process.argv.slice(2));
  const creds = demoCredentials();
  if (!creds) {
    throw new Error(
      `${DEMO_ENV.email} + ${DEMO_ENV.password} must both be set — they are the account the proxy signs demo visitors in as.`,
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const fixture = JSON.parse(readFileSync("fixtures/run.json", "utf8"));
  const out = await seedDemo(admin as unknown as SeedClient, fixture, creds);

  console.log("");
  console.log("demo seeded:");
  console.log(`  user   ${out.userId}   ${creds.email}${out.reused.user ? "  (reused)" : ""}`);
  console.log(`  brand  ${out.brandId}   ${fixture.brand.name}${out.reused.brand ? "  (reused)" : ""}`);
  console.log(`  run    ${out.runId}   /app/run/${out.runId}${out.reused.run ? "  (reused)" : ""}`);
  console.log("");
  console.log(`Set on the demo deployment: ${DEMO_ENV.flag}=1, ${DEMO_ENV.email}, ${DEMO_ENV.password}.`);
  console.log("The operator admin on this project is a real account of yours — never the demo user.");
}

// Only run the CLI when invoked directly (not when imported by the test).
if (process.argv[1] && /seed-demo\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
