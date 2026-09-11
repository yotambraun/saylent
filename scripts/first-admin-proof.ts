// Operator use: proves migration 0040 (public.first_user_admin trigger) both
// pieces — the advisory lock actually serializes, and the check-then-set logic
// only ever promotes when no admin exists yet. Refuses prod. Run:
//   npx tsx --env-file=.env.local scripts/first-admin-proof.ts
//
// THREE proofs, cheapest/safest first:
//   A) Lock mutual exclusion — two raw Postgres sessions fight over the EXACT
//      advisory-lock key the trigger uses (hashtext('saylent_first_admin')).
//      Touches zero rows; safe on a populated DB.
//   B) Check-then-set logic, fully rolled back — ONE session, ONE transaction:
//      temporarily hides any real admin rows, inserts two throwaway profiles in
//      sequence, asserts only the first becomes 'admin', then ROLLBACK undoes
//      everything (the neutralization AND the inserts). Nothing is committed.
//   C) Real-world default path (no transaction tricks) — with the DB's actual
//      admin(s) intact, a brand-new signup must NOT become admin. Throwaway
//      auth user via the admin API, cleaned up at the end (rls-proof.ts pattern).
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const LOCK_KEY_EXPR = "hashtext('saylent_first_admin')::bigint";

async function proofA_lockMutualExclusion(url: string): Promise<boolean> {
  const a = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const b = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await a.connect();
  await b.connect();
  try {
    await a.query("begin");
    await a.query(`select pg_advisory_xact_lock(${LOCK_KEY_EXPR})`);
    console.log("A: acquired the lock, holding it in an open transaction");

    await b.query("begin");
    const blocked = await b.query(`select pg_try_advisory_xact_lock(${LOCK_KEY_EXPR}) as got`);
    const bGotWhileHeld = blocked.rows[0].got as boolean;
    console.log(
      `B: pg_try_advisory_xact_lock while A holds it -> got=${bGotWhileHeld} (expect false)`,
    );
    await b.query("rollback"); // release B's failed attempt cleanly

    await a.query("commit"); // releases A's lock
    console.log("A: committed (lock released)");

    await b.query("begin");
    const after = await b.query(`select pg_try_advisory_xact_lock(${LOCK_KEY_EXPR}) as got`);
    const bGotAfter = after.rows[0].got as boolean;
    console.log(`B: pg_try_advisory_xact_lock after A released -> got=${bGotAfter} (expect true)`);
    await b.query("rollback");

    const ok = bGotWhileHeld === false && bGotAfter === true;
    console.log(ok ? "PROOF A: PASSED ✅ (lock serializes)" : "PROOF A: FAILED ❌");
    return ok;
  } finally {
    await a.end();
    await b.end();
  }
}

async function proofB_checkThenSetRolledBack(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("begin");
    // Neutralize any real admin rows FOR THIS TRANSACTION ONLY — invisible to every
    // other session (read committed), undone by the rollback below.
    await client.query("update public.profiles set role = 'user' where role = 'admin'");
    const zero = await client.query("select count(*)::int as n from public.profiles where role = 'admin'");
    console.log(`B: admins visible inside the txn after neutralizing = ${zero.rows[0].n} (expect 0)`);

    // Two throwaway auth.users rows so the FK on profiles.id is satisfiable —
    // inserted in the SAME transaction, so they vanish on rollback too.
    const u1 = "00000000-0000-4000-8000-00000000a001";
    const u2 = "00000000-0000-4000-8000-00000000a002";
    for (const id of [u1, u2]) {
      await client.query(
        `insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
         values ($1::uuid, $2::text, '', now(), 'authenticated', 'authenticated')`,
        [id, `${id}@first-admin-proof.test.local`],
      );
    }
    // profiles rows normally come from the 0001 handle_new_user trigger (fires on
    // auth.users insert); either way the NEW 0040 trigger on profiles decides role.
    const p1 = await client.query(
      "select role from public.profiles where id = $1",
      [u1],
    );
    const p2 = await client.query(
      "select role from public.profiles where id = $1",
      [u2],
    );
    const role1 = p1.rows[0]?.role;
    const role2 = p2.rows[0]?.role;
    console.log(`B: first throwaway profile role  = ${role1} (expect admin)`);
    console.log(`B: second throwaway profile role = ${role2} (expect user)`);

    const ok = role1 === "admin" && role2 === "user";
    console.log(ok ? "PROOF B: PASSED ✅ (check-then-set holds)" : "PROOF B: FAILED ❌");
    return ok;
  } finally {
    // ALWAYS roll back — this proof must leave zero trace in the real DB.
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

async function proofC_realDefaultPath(supabaseUrl: string, serviceKey: string): Promise<boolean> {
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const email = "first-admin-proof-c@test.local";
  const existing = await admin.auth.admin.listUsers();
  for (const u of existing.data.users ?? []) {
    if (u.email === email) await admin.auth.admin.deleteUser(u.id);
  }
  const created = await admin.auth.admin.createUser({
    email,
    password: "first-admin-proof-Passw0rd!",
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`proofC: createUser failed: ${created.error?.message}`);
  }
  const userId = created.data.user.id;
  try {
    const { data: profile, error } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();
    if (error) throw new Error(`proofC: read profile failed: ${error.message}`);
    console.log(`C: brand-new signup's role with real admin(s) already present = ${profile?.role}`);
    const ok = profile?.role === "user";
    console.log(ok ? "PROOF C: PASSED ✅ (does not re-promote once an admin exists)" : "PROOF C: FAILED ❌");
    return ok;
  } finally {
    await admin.auth.admin.deleteUser(userId); // cascades to profiles (0001 FK)
  }
}

async function main() {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("first-admin-proof forbidden in prod");
  }
  const directUrl = process.env.DIRECT_DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!directUrl) throw new Error("DIRECT_DATABASE_URL missing");
  if (!supabaseUrl || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");

  const okA = await proofA_lockMutualExclusion(directUrl);
  const okB = await proofB_checkThenSetRolledBack(directUrl);
  const okC = await proofC_realDefaultPath(supabaseUrl, serviceKey);

  const all = okA && okB && okC;
  console.log(all ? "\nFIRST-ADMIN PROOF: ALL PASSED ✅" : "\nFIRST-ADMIN PROOF: FAILED ❌");
  process.exit(all ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
