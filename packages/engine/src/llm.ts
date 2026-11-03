// Server-side LLM callers for the engine's judgment layer (brand model, judge,
// drafter) — models from the registry ONLY (METHODOLOGY.md (model registry)). Returns null on any
// failure (the engine degrades, never crashes) and writes the redacted reason
// to stderr once (setLlmFailureLog).
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
import { classifyAdapterError, redactSecretsInText } from "./adapters/errors";
import type { LlmCall } from "./brandModel";
import { JUDGE_OUTPUT_SCHEMA } from "./judge-schema";
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

// ---------------------------------------------------------------------------
// Failure logging. Every caller still degrades to null (the engine never
// crashes on a judgment-layer failure), but the reason is written to stderr so
// a run whose judge 400s on every call says why instead of silently scoring
// neutral. stderr, never stdout: the CLI's --json output and the MCP server's
// JSON-RPC channel both live on stdout. Messages are redacted (no key can reach
// the log) and deduplicated so a systematic failure prints once, not 200 times.
// ---------------------------------------------------------------------------

/** Where judgment-layer failures go. Injectable for tests and embedding hosts. */
export type LlmFailureLog = (line: string) => void;

const defaultLog: LlmFailureLog = (line) => {
  process.stderr.write(`${line}\n`);
};

let failureLog: LlmFailureLog = defaultLog;
const seenFailures = new Set<string>();

/** Replace (or, with null, restore) the failure sink; also clears the dedupe set. */
export function setLlmFailureLog(log: LlmFailureLog | null): void {
  failureLog = log ?? defaultLog;
  seenFailures.clear();
}

function logFailure(role: string, model: string, e: unknown): void {
  const c = classifyAdapterError(e);
  const line = redactSecretsInText(`[saylent] ${role} call to ${model} failed (${c.kind}): ${c.message}`).slice(0, 400);
  if (seenFailures.has(line)) return;
  if (seenFailures.size < 50) seenFailures.add(line);
  failureLog(line);
}

/** Room for adaptive thinking on current Claude models: thinking tokens count
 *  against max_tokens, so the caller's budget is for the visible reply and this
 *  is added on top (the OpenAI callers' "+800" for reasoning tokens is the analog). */
const ANTHROPIC_THINKING_HEADROOM = 1000;

/** Plain-text Anthropic caller for the BRAND MODEL and the DRAFTER. No sampling
 *  parameters and no prefill: current Claude models reject both with a 400.
 *  Effort "low" mirrors the OpenAI path's reasoning:{effort:"low"}. */
function anthropicCall(model: string, key: string | undefined, role: string): LlmCall {
  return async ({ system, user, maxTokens }) => {
    if (!key) return null;
    try {
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens + ANTHROPIC_THINKING_HEADROOM,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low" },
      });
      return textOf(res);
    } catch (e) {
      logFailure(role, model, e);
      return null;
    }
  };
}

// JSON-constrained Anthropic caller for the JUDGE ONLY (METHODOLOGY.md (judge)).
// Structured outputs (output_config.format, a JSON schema) make the reply a
// schema-valid JSON object. This replaces the old "{" assistant prefill and
// temperature 0, both of which current Claude models reject with a 400. The
// rubric, not sampling settings, decides the label; the golden gate measures it.
function anthropicJsonCall(model: string, key: string | undefined): LlmCall {
  return async ({ system, user, maxTokens }) => {
    if (!key) return null;
    try {
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens + ANTHROPIC_THINKING_HEADROOM,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: JUDGE_OUTPUT_SCHEMA },
        },
      });
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
        logFailure("judge", model, new Error(`stop_reason ${res.stop_reason}`));
        return null;
      }
      return textOf(res);
    } catch (e) {
      logFailure("judge", model, e);
      return null;
    }
  };
}

/** Plain-text OpenAI caller for the BRAND MODEL and the DRAFTER in OpenAI-only
 *  mode (the Anthropic-family analog is anthropicCall). No JSON mode: the brand
 *  prompt asks for a bare JSON object and parseJsonLoosely handles the rest,
 *  and the drafter wants prose. "low" reasoning + headroom so reasoning tokens
 *  can never crowd out the body. */
function openaiTextCall(model: string, key: string | undefined, role: string): LlmCall {
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
    } catch (e) {
      logFailure(role, model, e);
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
        // answers; the Anthropic judge runs at effort "low" too.
        reasoning: { effort: "low" },
        // Strict structured output against the same verdict schema the Anthropic
        // judge uses (judge-schema.ts). OpenAI documents JSON mode (json_object)
        // for GPT-5 models only and recommends Structured Outputs over it; the
        // current judge default (gpt-6-luna) lists structured outputs.
        text: { format: { type: "json_schema", name: "verdict", schema: JUDGE_OUTPUT_SCHEMA, strict: true } },
        // Extra headroom so low-reasoning tokens never crowd out the JSON body.
        max_output_tokens: maxTokens + 800,
      });
      return res.output_text ?? null;
    } catch (e) {
      logFailure("judge", model, e);
      return null;
    }
  };
}

/** Prose/JSON-free transport for a resolved role (brand, drafter), given the
 *  explicit keys to use. */
function callFor(role: RoleAssignment, keys: LlmKeys, name: string): LlmCall {
  return role.family === "anthropic"
    ? anthropicCall(role.model, keys.anthropic, name)
    : openaiTextCall(role.model, keys.openai, name);
}

/** THE factory: build brand/drafter/judge callers
 *  from explicit keys — no `process.env` read anywhere in this function or what
 *  it returns. `roles`, when supplied, is the run's already-resolved
 *  ResolvedRoles (so this agrees with the rest of the pipeline on which family
 *  serves brand/drafter); omitted, it is resolved fresh from `keys` alone via
 *  availableFamiliesFromKeys(). */
export function makeLlmCallers(keys: LlmKeys, roles?: ResolvedRoles): LlmCallers {
  const resolved = roles ?? resolveRoles(availableFamiliesFromKeys(keys));
  const brandModelCall: LlmCall = (args) => callFor(resolved.roles.brand, keys, "brand model")(args);
  const drafterCall: LlmCall = (args) => callFor(resolved.roles.drafter, keys, "drafter")(args);
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
