// website/instrumentation.ts — no-op. Its only job is to exist: without it,
// Next.js's monorepo root inference (see the comment in next.config.ts) walks
// up to the repo root and picks up the main app's own src/instrumentation.ts
// (Sentry wiring that imports "@/lib/sentry-scrub", unresolvable from here).
// A local file, even empty, wins over that fallback.
export async function register() {}
