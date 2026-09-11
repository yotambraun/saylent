// Server-side LLM callers for the engine's judgment layer (brand model, judge,
// drafter) — models from the registry ONLY (METHODOLOGY.md (model registry)). Returns null on any
// failure (the engine degrades, never crashes).
//
// KEY SEAM: makeLlmCallers(keys, roles)
// is the factory — it reads ONLY the keys it is handed, never process.env, so a
// key that lives solely in the admin console (encrypted at rest, migration 0042)
// reaches this layer exactly like an env key does. The exported
// brandModelCall/drafterCall/judgeCall below are thin wrappers around the
// factory that read process.env fresh on every call (the CLI's only source of
// keys), which keeps their behavior byte-for-byte identical to before this seam
// existed.
//
// SINGLE-PROVIDER MODE: which family serves each role is resolveRoles()'s call
// (models.ts). With one key, brand + drafter + every judge run on that family;
// with two, nothing about today's behavior changes.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { LlmCall } from "./brandModel";
import type { JudgeFamily } from "./judge";
import {
  availableFamiliesFromKeys,
  judgeModelFor,
  resolveRoles,
  type ResolvedRoles,
  type RoleAssignment,
} from "./models";

/** The two provider keys the judgment layer can use. Both optional — a caller
 *  with neither key still gets working (null-returning) callers. */
export interface LlmKeys {
  openai?: string;
  anthropic?: string;
}

export interface LlmCallers {
  brandModelCall: LlmCall;
  drafterCall: LlmCall;
  judgeCall: (family: JudgeFamily, args: Parameters<LlmCall>[0]) => ReturnType<LlmCall>;
}

function textOf(res: Anthropic.Message): string {
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function anthropicCall(model: string, key: string | undefined): LlmCall {
  return async ({ system, user, maxTokens }) => {
    if (!key) return null;
    try {
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      });
      return textOf(res);
    } catch {
      return null;
    }
  };
}

// JSON-constrained Anthropic caller for the JUDGE ONLY (METHODOLOGY.md (judge)). Forces a
// JSON object by prefilling the assistant turn with "{" and prepending it back —
// the documented, reliable JSON-mode for the model. Prefill is supported on the
// registry's default judge (claude-haiku-4-5). If MODEL_JUDGE_ANTHROPIC is ever
// pointed at a 4.6+/Fable model (prefill 400s there), this throws → judgeOne's
// retry+fallback degrades gracefully (parsed:false); switch to tool_choice then.
function anthropicJsonCall(model: string, key: string | undefined): LlmCall {
  return async ({ system, user, maxTokens }) => {
    if (!key) return null;
    try {
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        // temperature 0 — an LLM judge should be as deterministic as possible so
        // the rubric decides the label, not sampling noise (supported on the
        // registry's Haiku 4.5 judge; removed on 4.6+/Fable — see the note above).
        temperature: 0,
        system,
        messages: [
          { role: "user", content: user },
          { role: "assistant", content: "{" },
        ],
      });
      return `{${textOf(res)}`;
    } catch {
      return null;
    }
  };
}

/** Plain-text OpenAI caller for the BRAND MODEL and the DRAFTER in OpenAI-only
 *  mode (the Anthropic-family analog is anthropicCall). No JSON mode: the brand
 *  prompt asks for a bare JSON object and parseJsonLoosely handles the rest,
 *  and the drafter wants prose. "low" reasoning + headroom so reasoning tokens
 *  can never crowd out the body. */
function openaiTextCall(model: string, key: string | undefined): LlmCall {
  return async ({ system, user, maxTokens }) => {
    if (!key) return null;
    try {
      const client = new OpenAI({ apiKey: key });
      const res = await client.responses.create({
        model,
        instructions: system,
        input: user,
        reasoning: { effort: "low" },
        max_output_tokens: maxTokens + 800,
      });
      return res.output_text ?? null;
    } catch {
      return null;
    }
  };
}

function openaiCall(model: string, key: string | undefined): LlmCall {
  return async ({ system, user, maxTokens }) => {
    if (!key) return null;
    try {
      const client = new OpenAI({ apiKey: key });
      const res = await client.responses.create({
        model,
        instructions: system,
        input: user,
        // JUDGE path (openaiCall is judge-only): "low" reasoning (up from minimal)
        // buys the rubric adherence the golden set needs on the claude+perplexity
        // answers — the Anthropic judge gets temperature 0, this is its analog.
        reasoning: { effort: "low" },
        // Force a JSON-object response. json_object mode requires "JSON" in the
        // prompt — the judge prompt says "Return a JSON object …". (METHODOLOGY.md (judge))
        text: { format: { type: "json_object" } },
        // Extra headroom so low-reasoning tokens never crowd out the JSON body.
        max_output_tokens: maxTokens + 800,
      });
      return res.output_text ?? null;
    } catch {
      return null;
    }
  };
}

/** Prose/JSON-free transport for a resolved role (brand, drafter), given the
 *  explicit keys to use. */
function callFor(role: RoleAssignment, keys: LlmKeys): LlmCall {
  return role.family === "anthropic"
    ? anthropicCall(role.model, keys.anthropic)
    : openaiTextCall(role.model, keys.openai);
}

/** THE factory: build brand/drafter/judge callers
 *  from explicit keys — no `process.env` read anywhere in this function or what
 *  it returns. `roles`, when supplied, is the run's already-resolved
 *  ResolvedRoles (so this agrees with the rest of the pipeline on which family
 *  serves brand/drafter); omitted, it is resolved fresh from `keys` alone via
 *  availableFamiliesFromKeys(). */
export function makeLlmCallers(keys: LlmKeys, roles?: ResolvedRoles): LlmCallers {
  const resolved = roles ?? resolveRoles(availableFamiliesFromKeys(keys));
  const brandModelCall: LlmCall = (args) => callFor(resolved.roles.brand, keys)(args);
  const drafterCall: LlmCall = (args) => callFor(resolved.roles.drafter, keys)(args);
  const judgeCall = (family: JudgeFamily, args: Parameters<LlmCall>[0]) => {
    const model = judgeModelFor(family);
    return (family === "anthropic"
      ? anthropicJsonCall(model, keys.anthropic)
      : openaiCall(model, keys.openai))(args);
  };
  return { brandModelCall, drafterCall, judgeCall };
}

/** Keys read fresh from the environment on every call — the CLI's source (and
 *  every existing test's), unchanged from before this seam existed. */
function envKeys(): LlmKeys {
  return { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
}

export const brandModelCall: LlmCall = (args) => makeLlmCallers(envKeys()).brandModelCall(args);
export const drafterCall: LlmCall = (args) => makeLlmCallers(envKeys()).drafterCall(args);

/** The judge transport. `family` is already resolved by judge.ts from the run's
 *  ResolvedRoles (cross-family with two keys, the single family with one), so
 *  this only picks the family's dedicated judge model + its JSON mode. */
export function judgeCall(family: JudgeFamily, args: Parameters<LlmCall>[0]) {
  return makeLlmCallers(envKeys()).judgeCall(family, args);
}
