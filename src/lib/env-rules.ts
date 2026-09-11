// Pure rules about the environment, kept apart from env.ts because that module
// validates process.env the moment it is imported (so tests cannot load it).

/** The read-only demo refuses every run (src/lib/demo-mode.ts), so it has no job
 *  runner at all and the Inngest route answers 404 there (src/app/api/inngest).
 *  Only in that mode are the Inngest keys not required in production. */
export function inngestKeysRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV === "production" && env.NEXT_PUBLIC_DEMO_READONLY !== "1";
}
