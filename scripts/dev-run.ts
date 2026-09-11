// Operator/dev use: launches a real audit without going through checkout
// (dev-only tooling). Creates/reuses a brand for the user, grants dev
// entitlement (plan='pro' in the DEV database only), then goes through
// createRun() — the one legal run-creation path — which emits the Inngest
// event. Requires `npx inngest-cli dev` + `npm run dev` to be running.
// Usage:
//   npx tsx --env-file=.env.local scripts/dev-run.ts <userEmail> <brandName> <domain> [competitorsCsv] [category]
import { createClient } from "@supabase/supabase-js";
import { createRun } from "../src/lib/runs";

async function main() {
  if (process.env.VERCEL_ENV === "production") throw new Error("dev-run forbidden in prod");
  const [email, name, domain, competitorsCsv, category] = process.argv.slice(2);
  if (!email || !name || !domain) {
    throw new Error("usage: dev-run.ts <userEmail> <brandName> <domain> [competitorsCsv] [category]");
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: profile } = await admin.from("profiles").select("id,plan").eq("email", email).single();
  if (!profile) throw new Error(`no profile for ${email} — sign in once first`);

  if (profile.plan !== "pro") {
    await admin.from("profiles").update({ plan: "pro" }).eq("id", profile.id);
    console.log("dev entitlement: plan set to 'pro' (DEV database only)");
  }

  const { data: existing } = await admin
    .from("brands")
    .select("id")
    .eq("user_id", profile.id)
    .eq("domain", domain)
    .maybeSingle();
  let brandId = existing?.id;
  if (!brandId) {
    const { data: brand, error } = await admin
      .from("brands")
      .insert({
        user_id: profile.id,
        name,
        domain,
        competitors: competitorsCsv ? competitorsCsv.split(",").map((s) => s.trim()) : [],
        category: category ?? "",
      })
      .select("id")
      .single();
    if (error || !brand) throw new Error(`brand insert: ${error?.message}`);
    brandId = brand.id;
  }

  const result = await createRun({ userId: profile.id, brandId: brandId!, kind: "audit" });
  console.log(result.ok ? `run created: ${result.runId} (profile=${process.env.AUDIT_PROFILE ?? "full"})` : `refused: ${result.reason}`);
  if (result.ok) console.log(`watch: http://localhost:3000/app/run/${result.runId} · inngest: http://localhost:8288`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
