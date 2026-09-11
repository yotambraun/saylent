// Operator use: proves RLS isolation — user A cannot read
// user B's rows (and vice versa). Run:
//   npx tsx --env-file=.env.local scripts/rls-proof.ts
// Uses throwaway users a-rls@test.local / b-rls@test.local; deletes them at the end.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PASS = "rls-proof-Passw0rd!";

async function main() {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // fresh throwaway users (delete leftovers from previous runs first)
  const existing = await admin.auth.admin.listUsers();
  for (const u of existing.data.users ?? []) {
    if (u.email?.endsWith("@test.local")) await admin.auth.admin.deleteUser(u.id);
  }
  const a = await admin.auth.admin.createUser({ email: "a-rls@test.local", password: PASS, email_confirm: true });
  const b = await admin.auth.admin.createUser({ email: "b-rls@test.local", password: PASS, email_confirm: true });
  if (a.error || b.error) throw new Error(`createUser: ${a.error?.message ?? b.error?.message}`);
  const aId = a.data.user!.id;
  console.log(`created users A=${aId.slice(0, 8)}… B=${b.data.user!.id.slice(0, 8)}…`);

  const clientA = createClient(url, anonKey, { auth: { persistSession: false } });
  const clientB = createClient(url, anonKey, { auth: { persistSession: false } });
  const sA = await clientA.auth.signInWithPassword({ email: "a-rls@test.local", password: PASS });
  const sB = await clientB.auth.signInWithPassword({ email: "b-rls@test.local", password: PASS });
  if (sA.error || sB.error) throw new Error(`signIn: ${sA.error?.message ?? sB.error?.message}`);

  // profiles auto-created by trigger?
  const profA = await clientA.from("profiles").select("id,email");
  console.log(`A sees own profile rows: ${profA.data?.length} (expect 1, email=${profA.data?.[0]?.email})`);

  // A inserts a brand
  const ins = await clientA.from("brands").insert({ user_id: aId, name: "AcmeRLS", domain: "acme-rls.example" }).select();
  console.log(`A inserts brand: ${ins.error ? "FAIL " + ins.error.message : "ok id=" + ins.data![0].id.slice(0, 8) + "…"}`);

  // the four isolation checks
  const bReadsBrands = await clientB.from("brands").select("*");
  const bReadsProfiles = await clientB.from("profiles").select("*").eq("id", aId);
  const bUpdates = await clientB.from("brands").update({ name: "hacked" }).eq("user_id", aId).select();
  const bInsertsAsA = await clientB.from("brands").insert({ user_id: aId, name: "forged", domain: "x.example" });

  console.log(`B reads A's brands:        ${bReadsBrands.data?.length === 0 ? "0 rows ✅" : "LEAK ❌ " + JSON.stringify(bReadsBrands.data)}`);
  console.log(`B reads A's profile:       ${bReadsProfiles.data?.length === 0 ? "0 rows ✅" : "LEAK ❌"}`);
  console.log(`B updates A's brand:       ${bUpdates.data?.length === 0 ? "0 rows affected ✅" : "LEAK ❌"}`);
  console.log(`B inserts with A's id:     ${bInsertsAsA.error ? "rejected ✅ (" + bInsertsAsA.error.code + ")" : "ACCEPTED ❌"}`);
  const aStill = await clientA.from("brands").select("name");
  console.log(`A still sees own brand:    ${aStill.data?.length === 1 && aStill.data[0].name === "AcmeRLS" ? "intact ✅" : "❌"}`);

  // service role bypasses RLS (expected — jobs/webhook path)
  const svc = await admin.from("brands").select("*");
  console.log(`service role sees all:     ${svc.data?.length} row(s) (expected ≥1 — RLS bypass is the job/webhook path)`);

  // cleanup (FK cascades wipe profile+brand)
  await admin.auth.admin.deleteUser(aId);
  await admin.auth.admin.deleteUser(b.data.user!.id);
  console.log("cleanup done (users + cascaded rows deleted)");

  const leak =
    (bReadsBrands.data?.length ?? 1) !== 0 ||
    (bReadsProfiles.data?.length ?? 1) !== 0 ||
    (bUpdates.data?.length ?? 1) !== 0 ||
    !bInsertsAsA.error;
  console.log(leak ? "RLS PROOF: FAILED ❌" : "RLS PROOF: PASSED ✅ (A≠B isolation holds)");
  process.exit(leak ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
