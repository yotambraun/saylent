import "server-only";
// Best-effort Inngest reachability check for /setup. Only two targets are
// cheaply probeable with an unauthenticated GET:
//   - own-server (Docker): INNGEST_BASE_URL points at the compose container.
//   - local dev: `npx inngest-cli dev` serves on :8288 with no keys at all
//     (see https://yotambraun.github.io/saylent/docs/self-host/environment —
//     "Local dev needs neither Inngest key").
// Inngest Cloud (INNGEST_EVENT_KEY/INNGEST_SIGNING_KEY set, no base URL) has
// no equivalent unauthenticated health endpoint, so that case is reported as
// "configured, not actively probed" (reachable: null) rather than guessed at.
import type { ReadinessInngestInput } from "./readiness";

const PING_TIMEOUT_MS = 1500;

export async function pingInngest(env: NodeJS.ProcessEnv = process.env): Promise<ReadinessInngestInput> {
  const configuredKeys = Boolean(env.INNGEST_EVENT_KEY?.trim() && env.INNGEST_SIGNING_KEY?.trim());
  const base = env.INNGEST_BASE_URL?.trim();
  const target = base || (!configuredKeys ? "http://localhost:8288" : null);

  if (!target) {
    return { configuredKeys, reachable: null, target: "Inngest Cloud" };
  }

  try {
    const res = await fetch(`${target}/health`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    return { configuredKeys, reachable: res.ok, target };
  } catch {
    return { configuredKeys, reachable: false, target };
  }
}
