// `--judge`, `--judge-family` and repeatable `--model <role>=<model>` — the
// flag layer of the model registry. Precedence, highest
// first: these flags > MODEL_* env vars > saylent.config `models` > the
// shipped registry default. models.ts owns that resolution; this module only
// turns argv strings into the ModelSelection shape it takes, and refuses
// anything it cannot resolve honestly (an unknown role, an empty model id, a
// judge model whose provider family cannot be told from its name).
import type { ModelSelection } from "@saylent/engine/config";
import { opt, options } from "./help";

/** The roles `--model <role>=<model>` accepts, in the order `--help` lists them. */
export const MODEL_ROLES = ["brand", "drafter", "chatgpt", "claude", "gemini", "perplexity"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const MODEL_FLAG_OPTIONS = {
  judge: { type: "string" },
  "judge-family": { type: "string" },
  model: { type: "string", multiple: true },
} as const;

export interface ModelFlagValues {
  judge?: string;
  "judge-family"?: string;
  model?: string[];
}

/** The `--judge`/`--model` help block, shared by audit, verify and models —
 *  through help.ts's one option formatter, like every other option row. */
export const MODEL_FLAG_HELP = options([
  opt("--judge <model>", "Judge model; its provider family is inferred from the name"),
  opt("--judge-family <fam>", "anthropic | openai, when the judge model name is ambiguous"),
  opt("--model <role>=<model>", `Repeatable. role: ${MODEL_ROLES.join(" | ")}`),
]);

/** models.ts owns the one definition of "which family is this model id?" —
 *  the caller passes it in (engineMod.familyOfModel) so the rule never drifts
 *  between the engine and the CLI. */
export type FamilyOfModel = (model: string) => "anthropic" | "openai" | null;

/**
 * Build the flag layer of a ModelSelection. Throws an Error with a
 * copy-pasteable message on anything ambiguous or unknown — a model flag that
 * silently did nothing would be the worst possible outcome here, because the
 * user would pay for a run on models they did not pick.
 */
export function parseModelFlags(values: ModelFlagValues, familyOf: FamilyOfModel): ModelSelection {
  const selection: ModelSelection = {};

  const judge = values.judge?.trim();
  if (judge) {
    const declared = values["judge-family"]?.trim().toLowerCase();
    if (declared && declared !== "anthropic" && declared !== "openai") {
      throw new Error(`--judge-family ${declared}: expected "anthropic" or "openai".`);
    }
    const family = (declared as "anthropic" | "openai" | undefined) ?? familyOf(judge);
    if (!family) {
      throw new Error(
        `--judge ${judge}: cannot tell which provider this model belongs to. ` +
          "Add --judge-family anthropic or --judge-family openai.",
      );
    }
    selection.judge = { [family]: judge };
  } else if (values["judge-family"]) {
    throw new Error("--judge-family only means something together with --judge <model>.");
  }

  for (const raw of values.model ?? []) {
    const at = raw.indexOf("=");
    if (at < 1) {
      throw new Error(`--model ${raw}: expected <role>=<model>, e.g. --model brand=claude-haiku-4-5.`);
    }
    const role = raw.slice(0, at).trim().toLowerCase();
    const model = raw.slice(at + 1).trim();
    if (!model) throw new Error(`--model ${raw}: the model id is empty.`);
    if (!(MODEL_ROLES as readonly string[]).includes(role)) {
      throw new Error(`--model ${raw}: unknown role "${role}". Roles: ${MODEL_ROLES.join(", ")}.`);
    }
    if (role === "brand" || role === "drafter") selection[role] = model;
    else selection.engines = { ...selection.engines, [role]: model };
  }

  return selection;
}
