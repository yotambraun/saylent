// Operator/dev use: admin bootstrap — mirrors grant-pro.ts. Sets profiles.role
// for an account (role is service-role-write-only per migration 0020). Refuses prod.
// Usage:
//   npx tsx --env-file=.env.local scripts/grant-admin.ts <userEmail> [admin|user]
import { createClient } from "@supabase/supabase-js";

async function main() {
  if (process.env.VERCEL_ENV === "production") throw new Error("grant-admin forbidden in prod");
  const [email, role = "admin"] = process.argv.slice(2);
  if (!email || !["admin", "user"].includes(role)) {
    throw new Error("usage: grant-admin.ts <userEmail> [admin|user]");
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await admin
    .from("profiles")
    .update({ role })
    .eq("email", email)
    .select("email,role");
  if (error) throw error;
  if (!data?.length) throw new Error(`no profile for ${email} — sign in once first`);
  console.log(`${data[0].email} → role='${data[0].role}' (DEV database)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
