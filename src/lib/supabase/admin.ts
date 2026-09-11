// Service-role client — imported ONLY by
// Inngest server code and server-only scripts. NEVER by anything a
// user-facing route imports.
// The build-time guard below fails the app build if this ever gets pulled into a
// client bundle. `server-only` is a Next build alias (not a real npm module), so
// the tsx dev rig (dev-run.ts → runs.ts → this module) would throw MODULE_NOT_FOUND
// on it — that is resolved by the scripts-scoped no-op stub
// (scripts/server-only.stub.ts, mapped via scripts/tsconfig.json + TSX_TSCONFIG_PATH).
// Under `next build` this stays Next's real guard.
import "server-only";
import { createClient } from "@supabase/supabase-js";

// Hard guard: smoke profile must never run against production.
if (process.env.AUDIT_PROFILE === "smoke" && process.env.VERCEL_ENV === "production") {
  throw new Error("smoke profile forbidden against prod");
}

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
