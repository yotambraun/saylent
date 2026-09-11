// Env-driven feature flags.
// The point is decoupling "deployed" from "enabled": a feature can ship dark, be
// rolled out, or be KILLED with an env change and a redeploy-of-config — no code
// edit, no rebuild-from-source. This is the minimum acceptable version; the
// `RUNS_PAUSED` kill switch (app_settings, src/lib/app-settings.ts) is the
// DB-backed sibling that flips with NO redeploy at all. A future runtime flag
// table would extend THIS module (same `flag()` call site, DB read behind it).
//
// Convention: flag NAME → env var `FLAG_<UPPER_SNAKE>`. A value of
// "1"/"true"/"on"/"yes" (case-insensitive) is ON; anything else (incl. unset) is
// OFF. Defaults live in the typed map below so every flag is discoverable in one
// place and a typo in a name is a type error, not a silent false.

/** The known flags + their default when the env var is unset. Add new flags here
 *  so `flag()` stays type-checked and the full set is greppable. */
export const FLAG_DEFAULTS = {
  // Transactional email sending. OFF ships the whole email path dark even once
  // RESEND_API_KEY exists (belt-and-suspenders over the key guard in src/lib/email.ts).
  emails: true,
  // Operator-enabled scheduled runs (weekly verify + monthly audit crons). Kill
  // switch for the scheduler independent of Inngest — flip off to stop all
  // cron-initiated runs without touching the global RUNS_PAUSED (which also
  // stops manual runs). There are no plans: scheduling is an operator setting.
  scheduledRuns: false,
  // SEC-HARDEN CSP enforcement (per-request nonce, in src/proxy.ts). DEFAULT ON:
  // the enforced Content-Security-Policy header ships with the nonce'd, strict
  // policy. Flip FLAG_CSP_ENFORCE off (env + redeploy-of-config, no code change)
  // to fall back to Report-Only-only if enforcement breaks rendering. Read by the
  // proxy at the edge — flags.ts is pure (process.env + string ops), so it imports
  // cleanly on the Edge runtime.
  cspEnforce: true,
  // CoVe (Chain-of-Verification) evidence-audit pass over each drafted
  // artifact: one extra cheap-tier LLM call per draft that deletes any claim with no
  // supporting evidence line. DEFAULT OFF (project rule: no incremental spend
  // until explicitly enabled). Flip FLAG_COVE_AUDIT on (env + redeploy-of-config) to
  // turn it on; when off the drafter path is byte-for-byte unchanged (zero extra calls).
  coveAudit: false,
} as const;

export type FlagName = keyof typeof FLAG_DEFAULTS;

/** Legacy env var names still honored for one release, lowest precedence. The
 *  canonical `FLAG_<UPPER_SNAKE>` name always wins when it is set. */
export const LEGACY_ENV_ALIASES: Partial<Record<FlagName, readonly string[]>> = {
  // Renamed when plans were removed: scheduling is an operator setting, not a tier.
  scheduledRuns: ["FLAG_PRO_CRONS"],
};

const TRUTHY = new Set(["1", "true", "on", "yes"]);
const FALSY = new Set(["0", "false", "off", "no"]);

function envVarName(name: FlagName): string {
  return `FLAG_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`;
}

/** Resolve a flag: explicit env override wins, else the typed default. Pure over
 *  its `env` arg so tests pin behavior without mutating process.env. */
export function resolveFlag(
  name: FlagName,
  env: Record<string, string | undefined> = process.env,
): boolean {
  for (const key of [envVarName(name), ...(LEGACY_ENV_ALIASES[name] ?? [])]) {
    const raw = env[key]?.trim().toLowerCase();
    if (raw === undefined || raw === "") continue;
    if (TRUTHY.has(raw)) return true;
    if (FALSY.has(raw)) return false;
    // Unrecognized value → fall through to the next name, then the default
    // (fail-safe, not fail-open).
  }
  return FLAG_DEFAULTS[name];
}

/** Is feature `name` enabled? Reads `FLAG_<NAME>` at call time (no cache) so a
 *  redeploy with a changed env var takes effect on the next invocation. */
export function flag(name: FlagName): boolean {
  return resolveFlag(name);
}
