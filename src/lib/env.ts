// Zod-validated env, fail-fast with missing names listed.
// SKIP_ENV_VALIDATION=1 (CI) skips entirely. Only what the app cannot boot
// without is required here; everything else is optional and degrades visibly
// (a missing provider key flags that engine, a missing Sentry DSN is inert).
// `npm run check-env -- --profile app` reports the same required tier before a
// deploy.
import { z } from "zod";

/** Treat empty strings from `VAR=` lines as missing. */
const nonEmpty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const req = z.preprocess(nonEmpty, z.string({ error: "missing" }).min(1));
const opt = z.preprocess(nonEmpty, z.string().min(1).optional());

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: req,
  NEXT_PUBLIC_SUPABASE_URL: req,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: req,
  NEXT_PUBLIC_SENTRY_DSN: opt, // client-side Sentry DSN; inert if unset
  // The legal entity or person operating this deployment. Unset = /privacy and
  // /terms refuse to render a policy and say so instead of naming nobody.
  NEXT_PUBLIC_OPERATOR_NAME: opt,
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: req,
  DATABASE_URL: opt, // required once the database is wired up
  DIRECT_DATABASE_URL: opt, // required for migrations (direct, non-pooled)
  OPENAI_API_KEY: opt, // missing key = engine flagged, run continues
  ANTHROPIC_API_KEY: opt, // same: missing key = engine flagged
  GEMINI_API_KEY: opt, // same: missing key = engine flagged
  PERPLEXITY_API_KEY: opt, // same: missing key = engine flagged
  INNGEST_EVENT_KEY: opt, // required for a deployed Inngest (local dev server needs none)
  INNGEST_SIGNING_KEY: opt, // required for a deployed Inngest
  RESEND_API_KEY: opt, // required for transactional email
  EMAIL_FROM: opt, // required for transactional email
  SENTRY_DSN: opt, // server-side error reporting; inert if unset
  SENTRY_AUTH_TOKEN: opt, // source-map upload at build; inert if unset
  SENTRY_TRACES_SAMPLE_RATE: opt, // 0–1; default 0.2 in production, 0 elsewhere
  SENTRY_ORG: opt, // Sentry org slug (source-map upload)
  SENTRY_PROJECT: opt, // Sentry project slug (source-map upload)
  DEMO_RUN_ID: opt, // /demo renders a "demo not configured" note if unset
  // The app runs the FULL profile by default (23 questions, about $2.50 to $4.00 per run) and
  // refuses the 6-question smoke profile for real users in production; the estimate is shown
  // before every run. resolveRunProfile() in src/lib/runs.ts enforces this from process.env.
  AUDIT_PROFILE: z.preprocess(nonEmpty, z.enum(["full", "smoke"]).default("full")),
  // Cost-control overrides — all optional; sane const defaults live in
  // src/lib/limits.ts (read there directly). Present here so they're documented
  // + validated as non-empty when set. BRAND_LIMIT_DEFAULT is the older name for
  // BRAND_LIMIT and is still honored.
  BRAND_LIMIT: opt,
  BRAND_LIMIT_DEFAULT: opt,
  RUN_THROTTLE_WINDOW_HOURS: opt,
  RUN_THROTTLE_AUDITS: opt,
  RUN_THROTTLE_VERIFIES: opt,
  DAILY_SPEND_CAP_USD: opt,
  // Model registry overrides — defaults live in src/lib/models.ts
  MODEL_CHATGPT_ANSWER: opt,
  MODEL_CLAUDE_ANSWER: opt,
  MODEL_GEMINI_ANSWER: opt,
  MODEL_PERPLEXITY_ANSWER: opt,
  MODEL_JUDGE_ANTHROPIC: opt,
  MODEL_JUDGE_OPENAI: opt,
  MODEL_BRAND: opt,
  MODEL_DRAFTER: opt,
});

const skip = process.env.SKIP_ENV_VALIDATION === "1";
const isServer = typeof window === "undefined";

// The Inngest keys are optional in dev (the local dev server needs
// none) but a MUST in production — without INNGEST_SIGNING_KEY the /api/inngest
// endpoint serves unauthenticated and paid runs become externally triggerable.
// A prod deploy missing them fails fast at env-parse instead of shipping the hole.
function assertProdInngestKeys(data: Record<string, unknown>) {
  if (process.env.VERCEL_ENV !== "production") return;
  const missing = (["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"] as const).filter((k) => !data[k]);
  if (missing.length > 0) {
    throw new Error(
      `Invalid/missing environment variables: ${missing.join(", ")}\n` +
        "These are REQUIRED in production (VERCEL_ENV=production) so /api/inngest is authenticated.",
    );
  }
}

function validate() {
  const schema = isServer ? publicSchema.extend(serverSchema.shape) : publicSchema;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join("."));
    throw new Error(
      `Invalid/missing environment variables: ${missing.join(", ")}\n` +
        "Fill them in .env.local (see .env.example). CI sets SKIP_ENV_VALIDATION=1.",
    );
  }
  if (isServer) assertProdInngestKeys(parsed.data as Record<string, unknown>);
  return parsed.data;
}

export const env = skip
  ? (process.env as unknown as z.infer<typeof publicSchema> & Partial<z.infer<typeof serverSchema>>)
  : validate();
