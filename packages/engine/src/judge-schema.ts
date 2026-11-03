// The judge verdict as a JSON Schema — the shape judge.ts's prompt asks for
// (METHODOLOGY.md (judge)), handed to the Anthropic judge as a structured-output
// format so the reply is a schema-valid JSON object without an assistant prefill
// (current Claude models reject prefill with a 400). Key ORDER matches the
// prompt's reasoning-first order: evidence_quote and reasoning come before the
// verdict fields. judge.ts still normalizes and caps every field, so the schema
// only guarantees shape, never the rubric.
//
// Kept to the JSON Schema subset structured outputs support: objects with
// `additionalProperties: false` and every key required, string enums, arrays
// without length bounds (the prompt states the caps; normalization enforces them).

const str = { type: "string" } as const;
const strEnum = (values: readonly string[]) => ({ type: "string", enum: [...values] }) as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const JUDGE_MENTIONS = ["recommended", "listed", "compared", "neutral", "dismissed", "absent"] as const;
export const JUDGE_PROMINENCE = ["first", "early", "buried", "none"] as const;
export const JUDGE_SENTIMENT = ["positive", "neutral", "negative"] as const;

export const JUDGE_OUTPUT_SCHEMA: Record<string, unknown> = obj({
  evidence_quote: str,
  reasoning: str,
  mention_type: strEnum(JUDGE_MENTIONS),
  prominence: strEnum(JUDGE_PROMINENCE),
  sentiment: strEnum(JUDGE_SENTIMENT),
  claims: { type: "array", items: obj({ text: str, kind: strEnum(["praise", "risk", "neutral_fact"]) }) },
  other_brands: { type: "array", items: obj({ name: str, why: str }) },
  segments: { type: "array", items: obj({ segment: str, winner: str, reason: str }) },
  pricing_claims: { type: "array", items: str },
  entity_confusion: { type: "boolean" },
});
