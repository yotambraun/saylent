// Operator use: fails, listing ANY missing var for the chosen profile, so a
// deployment/CLI install stays red until every required env var is set. Run:
//   npx tsx --env-file=.env.local scripts/check-env.ts --profile cli|app
// (no --profile = "app", the historical default).
//
// Both profiles check the REQUIRED tier only — the vars without which the thing
// cannot start. Everything else is optional by design and degrades visibly, so
// listing it here would turn "you cannot run" into "you have not finished
// shopping".
//
// --profile cli:  `npx saylent audit` needs ONE of OPENAI_API_KEY / ANTHROPIC_API_KEY
//                 (single-provider mode routes brand/drafter/judge to whichever
//                 family has a key — packages/engine/src/models.ts); nothing else.
// --profile app:  the self-hosted app's required tier — the Supabase trio, the two
//                 public URLs, and one model-provider key. There is no payment
//                 processor: plans and credits are operator-set limits.
//
// Optional (not checked here — every one has a code default or is inert unset),
// except APP_SECRET which is WARNED about below:
// DATABASE_URL / DIRECT_DATABASE_URL (needed for `npm run db:migrate`, not to boot),
// GEMINI_API_KEY, PERPLEXITY_API_KEY, INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
// (required in production only — src/lib/env.ts fails the boot there),
// RESEND_API_KEY / EMAIL_FROM (email is a no-op without them), SENTRY_* (Sentry is
// inert without a DSN), MODEL_* registry overrides, DEMO_RUN_ID, AUDIT_PROFILE
// (default "smoke"), NEXT_PUBLIC_OPERATOR_NAME (unset = /privacy and /terms say so
// instead of naming an operator), NEXT_PUBLIC_AUTH_METHODS (csv of
// "password"|"magic-link"|"google", default "password,magic-link" — which login
// methods login-form.tsx shows; see supabase/config.toml for the local Auth
// settings each method needs).

export {}; // module scope (scripts without imports otherwise share globals)

const PROVIDER_ONE_OF = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;

const APP_REQUIRED = [
  "NEXT_PUBLIC_APP_URL",
  // Consumed by layout/sitemap/robots with a localhost fallback; required-with-
  // localhost for dev, set to the real domain before going to production.
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const args = process.argv.slice(2);
const profileFlagIdx = args.indexOf("--profile");
const profile = profileFlagIdx >= 0 ? args[profileFlagIdx + 1] : "app";
if (profile !== "cli" && profile !== "app") {
  console.error(`check-env: unknown --profile "${profile}" (expected "cli" or "app")`);
  process.exit(1);
}

const haveProviderKey = PROVIDER_ONE_OF.some((k) => process.env[k]?.trim());

if (profile === "cli") {
  console.log(`check-env --profile cli: needs one of ${PROVIDER_ONE_OF.join(" / ")}`);
  if (!haveProviderKey) {
    console.error(`MISSING: set at least one of\n  - ${PROVIDER_ONE_OF.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("Env manifest complete ✅");
  process.exit(0);
}

const missing: string[] = APP_REQUIRED.filter((k) => !process.env[k]?.trim());
if (!haveProviderKey) missing.push(`one of ${PROVIDER_ONE_OF.join(" / ")}`);

const checks = APP_REQUIRED.length + 1; // + the one-of provider key
console.log(`check-env --profile app: ${checks - missing.length}/${checks} required vars present`);
if (missing.length > 0) {
  console.error(`MISSING:\n  - ${missing.join("\n  - ")}`);
  process.exit(1);
}

// APP_SECRET is OPTIONAL — warn, never fail. Without it the app runs exactly as
// before on env keys; with it, /admin/providers can store provider keys encrypted
// (pgcrypto) and change models with no redeploy. Warned about rather than
// ignored, because "I saved a key and it did nothing" is the confusing failure it
// prevents.
const appSecret = process.env.APP_SECRET?.trim();
if (!appSecret) {
  console.warn(
    "NOTE: APP_SECRET is not set — provider keys are environment-only and cannot be managed in /admin/providers. Generate one with: openssl rand -hex 32",
  );
} else if (appSecret.length < 16) {
  console.warn(
    `NOTE: APP_SECRET is only ${appSecret.length} characters — key encryption refuses anything under 16. Replace it with: openssl rand -hex 32`,
  );
}

console.log("Env manifest complete ✅");
