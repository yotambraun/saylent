// Implements METHODOLOGY.md (model registry) — the model registry. THE ONLY place model names exist.
// Every value is env-overridable; defaults verified July 2026. When a default 404s
// (models drift), pick the closest current tier from the provider's model list,
// update the default here and note it in the changelog (verified at build time).
// Never import a model string from anywhere else in src/.
//
// SINGLE-PROVIDER MODE (open-source release): this file also owns resolveRoles()
// — which provider family serves each judgment role (brand model, drafter, and
// the judge for each answer engine) given the keys the operator actually has.
// Two keys = today's cross-family judging, unchanged. One key = every role runs
// on that family and the run is stamped judge_mode:"single-family" so the report
// can say so. Gemini/Perplexity are ANSWER engines only: they never judge or draft.
import type { ModelSelection } from "./config";
import { ALL_ENGINES } from "./engines";
import type { Engine } from "./types";

/** Where a resolved model id came from. PRECEDENCE, highest first:
 *  a CLI flag (`--judge`, `--model role=id`) > the MODEL_* env var >
 *  an injected override map ("console" — the self-hosted app's admin console)
 *  > saylent.config `models` > the shipped registry
 *  default below. The CLI never injects overrides, so its behavior is unchanged. */
export type ModelSource = "flag" | "env" | "console" | "config" | "default";

/** every slot in the registry — one model id each */
export type ModelRole =
  | "chatgptAnswer"
  | "claudeAnswer"
  | "geminiAnswer"
  | "perplexityAnswer"
  | "judgeAnthropic"
  | "judgeOpenai"
  | "brand"
  | "drafter"
  | "brandOpenai"
  | "drafterOpenai";

export interface ModelChoice {
  model: string;
  source: ModelSource;
  /** the MODEL_* env var that overrides this slot */
  envVar: string;
  /** how the CLI names the slot in `saylent models` */
  label: string;
}

/** The flat registry shape (the MODELS object) — role → model id. */
export type ModelRegistry = Record<ModelRole, string>;
/** The same, with the source of every choice (what `saylent models` prints). */
export type ModelTable = Record<ModelRole, ModelChoice>;

/** role → model id, the shape an embedding host (the app's admin console) injects. */
export type ModelOverrides = Partial<Record<ModelRole, string>>;

export interface ModelInputs {
  /** CLI flags — the highest-precedence layer */
  flags?: ModelSelection;
  /** Per-role overrides from the HOST, below env and above saylent.config. This is
   *  the seam the self-hosted app's "Providers & models" console writes through
   *  so an operator can change a model with no
   *  redeploy. Omitted → the ambient map from injectModelOverrides(), if any. */
  overrides?: ModelOverrides;
  /** saylent.config `models` — the lowest-precedence layer above the defaults */
  config?: ModelSelection;
  /** default: process.env (read fresh on every call) */
  env?: NodeJS.ProcessEnv;
}

/** The ambient (process-wide) override map. Needed because the engine's own
 *  callers — llm.ts's brandModelCall/drafterCall/judgeCall, judge.ts — resolve the
 *  registry internally with no inputs, so a host that wants console-managed models
 *  to reach EVERY call has one place to say so. Null on every CLI process (the CLI
 *  never calls the injector), which is what keeps CLI behavior byte-for-byte. */
let ambientOverrides: ModelOverrides | null = null;

/** Install (or clear, with null) the ambient override map. The host calls this once
 *  per run, right where it resolves keys and models — src/inngest/functions.ts. */
export function injectModelOverrides(overrides: ModelOverrides | null): void {
  ambientOverrides =
    overrides && Object.keys(overrides).length > 0 ? { ...overrides } : null;
}

/** What is currently injected (tests, and the console's "what will this run use"). */
export function injectedModelOverrides(): ModelOverrides | null {
  return ambientOverrides ? { ...ambientOverrides } : null;
}

interface SlotSpec {
  role: ModelRole;
  envVar: string;
  label: string;
  fallback: string;
  pick: (sel: ModelSelection | undefined) => string | undefined;
}

/** The ONE place a model default lives (see the header). Every slot: which env
 *  var overrides it, which saylent.config `models` field selects it, and the
 *  shipped default. `brand`/`drafter` map to BOTH family slots — the run uses
 *  the slot for the family that actually serves the role (resolveRoles). */
const SLOTS: SlotSpec[] = [
  { role: "chatgptAnswer", envVar: "MODEL_CHATGPT_ANSWER", label: "chatgpt (answer)", fallback: "gpt-5.4", pick: (s) => s?.engines?.chatgpt },
  { role: "claudeAnswer", envVar: "MODEL_CLAUDE_ANSWER", label: "claude (answer)", fallback: "claude-sonnet-4-6", pick: (s) => s?.engines?.claude },
  { role: "geminiAnswer", envVar: "MODEL_GEMINI_ANSWER", label: "gemini (answer)", fallback: "gemini-3.6-flash", pick: (s) => s?.engines?.gemini },
  { role: "perplexityAnswer", envVar: "MODEL_PERPLEXITY_ANSWER", label: "perplexity (answer)", fallback: "sonar", pick: (s) => s?.engines?.perplexity },
  { role: "judgeAnthropic", envVar: "MODEL_JUDGE_ANTHROPIC", label: "judge (anthropic)", fallback: "claude-haiku-4-5", pick: (s) => s?.judge?.anthropic },
  { role: "judgeOpenai", envVar: "MODEL_JUDGE_OPENAI", label: "judge (openai)", fallback: "gpt-5-mini", pick: (s) => s?.judge?.openai },
  { role: "brand", envVar: "MODEL_BRAND", label: "brand model (anthropic)", fallback: "claude-haiku-4-5", pick: (s) => s?.brand },
  { role: "drafter", envVar: "MODEL_DRAFTER", label: "drafter (anthropic)", fallback: "claude-sonnet-4-6", pick: (s) => s?.drafter },
  { role: "brandOpenai", envVar: "MODEL_BRAND_OPENAI", label: "brand model (openai)", fallback: "gpt-5-mini", pick: (s) => s?.brand },
  { role: "drafterOpenai", envVar: "MODEL_DRAFTER_OPENAI", label: "drafter (openai)", fallback: "gpt-5.4", pick: (s) => s?.drafter },
];

/** Resolve every slot with its provenance. Pure apart from reading env. */
export function resolveModelTable(inputs: ModelInputs = {}): ModelTable {
  const env = inputs.env ?? process.env;
  const overrides = inputs.overrides ?? ambientOverrides ?? undefined;
  const out = {} as ModelTable;
  for (const slot of SLOTS) {
    const flag = slot.pick(inputs.flags)?.trim();
    const fromEnv = env[slot.envVar]?.trim();
    const fromConsole = overrides?.[slot.role]?.trim();
    const fromConfig = slot.pick(inputs.config)?.trim();
    const [model, source]: [string, ModelSource] = flag
      ? [flag, "flag"]
      : fromEnv
        ? [fromEnv, "env"]
        : fromConsole
          ? [fromConsole, "console"]
          : fromConfig
            ? [fromConfig, "config"]
            : [slot.fallback, "default"];
    out[slot.role] = { model, source, envVar: slot.envVar, label: slot.label };
  }
  return out;
}

/** The flat MODELS-shaped object a table reduces to. */
export function modelRegistry(table: ModelTable): ModelRegistry {
  const out = {} as ModelRegistry;
  for (const slot of SLOTS) out[slot.role] = table[slot.role].model;
  return out;
}

/** Which family a model id belongs to, for `--judge <model>` without a family.
 *  null = ambiguous: the caller must ask for --judge-family. */
export function familyOfModel(model: string): Family | null {
  const m = model.trim().toLowerCase().replace(/^(?:us|eu|apac)\./, "");
  if (m.startsWith("claude") || m.startsWith("anthropic")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("openai") || /^o[1-9]([.-]|$)/.test(m) || m.startsWith("chatgpt")) {
    return "openai";
  }
  return null;
}

/** Read the registry from the CURRENT environment. MODELS is the snapshot taken
 *  at import; resolveRoles() re-reads so a MODEL_* override applied later in the
 *  process (a test, a wrapper script) still wins. */
function readModels(inputs: ModelInputs = {}): ModelRegistry {
  return modelRegistry(resolveModelTable(inputs));
}

/** WHAT EACH SLOT IS (the defaults themselves live in SLOTS above):
 *  chatgptAnswer     ChatGPT answer engine - OpenAI Responses API + {type:"web_search"} tool
 *  claudeAnswer      Claude answer engine - messages + web_search_20250305 tool
 *  geminiAnswer      Gemini answer engine - googleSearch tool; 3.x-flash bills PER SEARCH QUERY.
 *                    Default moved 2.5-flash -> 3.6-flash: Google 404s gemini-2.5-flash for new
 *                    projects. Search-GROUNDED calls need paid billing on the key's project
 *                    (free-tier grounding quota = 0); plain generation works unbilled.
 *  perplexityAnswer  Perplexity answer engine - chat/completions; per-request search fee
 *  judgeAnthropic    judges chatgpt+gemini answers in cross-family mode (METHODOLOGY.md)
 *  judgeOpenai       judges claude+perplexity answers; if deprecated, gpt-5.4-mini succeeds it
 *  brand / drafter   brand-model extraction (1 call/audit) and artifact drafting (3 calls/audit)
 *  brandOpenai /     the same two roles when OpenAI is the only family with a key
 *  drafterOpenai     (single-provider mode) */

export const MODELS = readModels();

// ---------------------------------------------------------------------------
// role resolution — which provider family serves which judgment role
// ---------------------------------------------------------------------------

/** The two families that can judge/draft. Answer-only engines are not families. */
export type Family = "anthropic" | "openai";

/** "cross-family" = an answer is judged by the OTHER family (self-preference
 *  bias control). "single-family" = one provider key, so every role runs on it. */
export type JudgeMode = "cross-family" | "single-family";

export type RoleName = "brand" | "drafter" | `judge:for-${Engine}`;

export interface RoleAssignment {
  family: Family;
  model: string;
}

export interface ResolvedRoles {
  judgeMode: JudgeMode;
  /** the families that have a usable key, in registry order */
  families: Family[];
  /** every judgment role → the family and the exact registry model that serves it */
  roles: Record<RoleName, RoleAssignment>;
  /** engines whose judge model is the SAME model that produced the answer —
   *  possible only in single-family mode with MODEL_* overrides that collapse
   *  the two onto one id. Surfaced (never silently accepted) so a report can
   *  flag it; the registry defaults never collide. */
  selfJudged: Engine[];
}

export interface AvailableKeys {
  openai?: boolean;
  anthropic?: boolean;
}

/** The cross-family map: an engine's answer is judged by the OTHER family
 *  (METHODOLOGY.md (judge)). Used verbatim whenever both keys exist. */
export const CROSS_FAMILY_JUDGE: Record<Engine, Family> = {
  chatgpt: "anthropic",
  gemini: "anthropic",
  claude: "openai",
  perplexity: "openai",
};

/** Which judge/drafter families have a key in this environment. */
export function availableFamilies(env: NodeJS.ProcessEnv = process.env): AvailableKeys {
  return {
    openai: Boolean(env.OPENAI_API_KEY?.trim()),
    anthropic: Boolean(env.ANTHROPIC_API_KEY?.trim()),
  };
}

/** The same as availableFamilies(), but from explicit keys rather than
 *  `process.env` — the seam llm.ts's makeLlmCallers() uses so a key that lives
 *  only in the admin console (never published into process.env)
 *  still resolves which family serves brand/drafter/judge. */
export function availableFamiliesFromKeys(keys: { openai?: string; anthropic?: string }): AvailableKeys {
  return {
    openai: Boolean(keys.openai?.trim()),
    anthropic: Boolean(keys.anthropic?.trim()),
  };
}

/**
 * Resolve every judgment role for the keys on hand.
 *
 * - both keys → cross-family judging exactly as before; brand + drafter on Anthropic.
 * - one key   → that family serves brand, drafter and EVERY judge; judgeMode
 *               "single-family" (the report states the weaker guarantee).
 * - no key    → the cross-family map (nothing can run anyway; the callers all
 *               degrade to null, so the shape stays the historical one).
 *
 * MODEL_* env overrides always win: the models come from a fresh registry read.
 */
export function resolveRoles(
  available: AvailableKeys = availableFamilies(),
  /** CLI flags + saylent.config `models` (precedence: flag > env > config > default) */
  inputs: ModelInputs = {},
): ResolvedRoles {
  const M = readModels(inputs);
  const hasOpenai = Boolean(available.openai);
  const hasAnthropic = Boolean(available.anthropic);
  const only: Family | null =
    hasOpenai && hasAnthropic ? null : hasOpenai ? "openai" : hasAnthropic ? "anthropic" : null;
  const judgeMode: JudgeMode = only ? "single-family" : "cross-family";

  const families: Family[] = [];
  if (hasAnthropic) families.push("anthropic");
  if (hasOpenai) families.push("openai");

  const brandFamily: Family = only ?? "anthropic";
  const drafterFamily: Family = only ?? "anthropic";
  const judgeModelOf = (f: Family) => (f === "anthropic" ? M.judgeAnthropic : M.judgeOpenai);
  const answerModel: Record<Engine, string> = {
    chatgpt: M.chatgptAnswer,
    claude: M.claudeAnswer,
    gemini: M.geminiAnswer,
    perplexity: M.perplexityAnswer,
  };

  const roles = {
    brand: {
      family: brandFamily,
      model: brandFamily === "anthropic" ? M.brand : M.brandOpenai,
    },
    drafter: {
      family: drafterFamily,
      model: drafterFamily === "anthropic" ? M.drafter : M.drafterOpenai,
    },
  } as Record<RoleName, RoleAssignment>;

  const selfJudged: Engine[] = [];
  for (const engine of ALL_ENGINES) {
    // Single-family: the judge model is the family's DEDICATED judge model from
    // the registry, which is a different model from the one that answered
    // (gpt-5-mini judging gpt-5.4, claude-haiku judging claude-sonnet). Same
    // model on both sides is only reachable via overrides — flagged, not hidden.
    const family = only ?? CROSS_FAMILY_JUDGE[engine];
    const model = judgeModelOf(family);
    roles[`judge:for-${engine}`] = { family, model };
    if (model === answerModel[engine]) selfJudged.push(engine);
  }

  return { judgeMode, families, roles, selfJudged };
}

/** The family's dedicated judge model, read fresh so a MODEL_JUDGE_* override
 *  applied after import still wins. */
export function judgeModelFor(family: Family, inputs: ModelInputs = {}): string {
  const M = readModels(inputs);
  return family === "anthropic" ? M.judgeAnthropic : M.judgeOpenai;
}

/** engine → judging family, the shape the judge transport wants. */
export function judgeFamilies(roles: ResolvedRoles): Record<Engine, Family> {
  const out = {} as Record<Engine, Family>;
  for (const engine of ALL_ENGINES) out[engine] = roles.roles[`judge:for-${engine}`].family;
  return out;
}

/** Flat role → {family, model} map for the run bundle header (JSON-friendly). */
export function rolesForBundle(roles: ResolvedRoles): Record<string, RoleAssignment> {
  const out: Record<string, RoleAssignment> = {};
  for (const [role, assignment] of Object.entries(roles.roles)) out[role] = { ...assignment };
  return out;
}
