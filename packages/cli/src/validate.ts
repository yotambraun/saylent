// `--profile` and `--engines` (and their AUDIT_PROFILE / AUDIT_ENGINES /
// saylent.config twins), validated by hand before anything downstream casts
// them.
//
// Both flags used to be raw casts into the engine's own types
// (`values.profile as ProfileName`, `values.engines?.split(",") as Engine[]`),
// which meant a typo either crashed with a JavaScript TypeError
// ("Cannot read properties of undefined (reading 'scoredSamples')") or — worse
// — was SILENTLY DROPPED: `--engines chatgpt,claud` filtered the unknown name
// away and ran a one-engine audit the operator paid for believing they asked
// for two. Every other flag on `audit` already refuses a bad value with a
// sentence; these two now do too, from ONE place so the flag, the env var and
// the config file all say the same thing.
import type { Engine } from "@saylent/engine";
import { PROVIDERS, PROVIDER_TO_ENGINE } from "./keys";

/** The four answer engines, derived from the provider registry so the two
 *  vocabularies can never drift (`keys set openai` -> the `chatgpt` engine). */
export const ENGINE_NAMES: readonly Engine[] = PROVIDERS.map((p) => PROVIDER_TO_ENGINE[p.id]);

/** The provider-side word for an engine, when the two differ. A user who just
 *  ran `saylent keys set anthropic` will type `--engines anthropic`; that must
 *  be corrected, never dropped. */
const PROVIDER_WORD_TO_ENGINE: Record<string, Engine> = {
  openai: "chatgpt",
  anthropic: "claude",
  google: "gemini",
  "google-gemini": "gemini",
};

/** Where a value came from, spelled the way the user would recognise it.
 *  `--profile` / `AUDIT_PROFILE` / `saylent.config profile`. */
export type ValueSource = "flag" | "env" | "config";

function cite(source: ValueSource, name: { flag: string; env: string; config: string }, raw: string): string {
  if (source === "flag") return `${name.flag} ${raw}`;
  if (source === "env") return `${name.env} "${raw}"`;
  return `${name.config} "${raw}"`;
}

const PROFILE_NAMES = { flag: "--profile", env: "AUDIT_PROFILE", config: "saylent.config profile" };
const ENGINE_FLAG_NAMES = { flag: "--engines", env: "AUDIT_ENGINES", config: "saylent.config engines" };

/** `expected "full" or "smoke".` — built from the profile registry the run
 *  actually reads (profiles.ts PROFILES), never a hand-kept copy. */
function expectedProfiles(valid: readonly string[]): string {
  const quoted = valid.map((p) => `"${p}"`);
  if (quoted.length === 0) return "expected a profile name.";
  if (quoted.length === 1) return `expected ${quoted[0]}.`;
  return `expected ${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}.`;
}

/**
 * Validate one profile name against the live PROFILES registry.
 * Returns the name unchanged, or throws an Error whose message is the whole
 * thing the CLI prints (no stack, exit 1).
 */
export function parseProfileName<T extends string>(
  raw: string | undefined,
  valid: readonly T[],
  source: ValueSource = "flag",
): T | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (value === "") return undefined;
  if ((valid as readonly string[]).includes(value)) return value as T;
  throw new Error(`${cite(source, PROFILE_NAMES, value)}: ${expectedProfiles(valid)}`);
}

const validEngineList = (): string => ENGINE_NAMES.join(", ");

/**
 * Validate one comma-separated engine list. Every name must be one of the four
 * answer engines; a PROVIDER name is corrected by name rather than rejected
 * generically, because "openai"/"anthropic" is exactly what `saylent keys set`
 * taught the user to type.
 */
export function parseEngineList(
  raw: string | string[] | undefined,
  source: ValueSource = "flag",
): Engine[] | undefined {
  if (raw === undefined) return undefined;
  const names = (Array.isArray(raw) ? raw : raw.split(","))
    .map((e) => String(e).trim())
    .filter((e) => e !== "");
  const printable = Array.isArray(raw) ? names.join(",") : raw.trim();
  if (names.length === 0) {
    throw new Error(
      `${cite(source, ENGINE_FLAG_NAMES, printable)}: expected a comma-separated list of ${validEngineList()}.`,
    );
  }
  const out: Engine[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if ((ENGINE_NAMES as readonly string[]).includes(lower)) {
      if (!out.includes(lower as Engine)) out.push(lower as Engine);
      continue;
    }
    const engine = PROVIDER_WORD_TO_ENGINE[lower];
    if (engine) {
      throw new Error(
        `${cite(source, ENGINE_FLAG_NAMES, printable)}: "${name}" is a provider; the engine is "${engine}". ` +
          `Valid engines: ${validEngineList()}.`,
      );
    }
    throw new Error(
      `${cite(source, ENGINE_FLAG_NAMES, printable)}: unknown engine "${name}". ` +
        `Valid engines: ${validEngineList()}.`,
    );
  }
  return out;
}
