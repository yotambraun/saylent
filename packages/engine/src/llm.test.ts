// The judgment layer must
// be reachable from EXPLICIT keys, not only process.env — a key stored only in
// the admin console never reaches process.env (see provider-settings.ts). This
// pins makeLlmCallers() to that contract: a console-only key (no env at all)
// produces working brand/drafter/judge callers, and the env-reading exported
// wrappers still resolve from process.env exactly as before. No live LLM calls —
// the @anthropic-ai/sdk and openai clients are mocked.
import { afterEach, describe, expect, it, vi } from "vitest";

const anthropicCreate = vi.fn();
const openaiCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function (this: unknown, opts: { apiKey?: string }) {
    return { messages: { create: (args: unknown) => anthropicCreate(opts, args) } };
  }),
}));

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function (this: unknown, opts: { apiKey?: string }) {
    return { responses: { create: (args: unknown) => openaiCreate(opts, args) } };
  }),
}));

const ENV_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  anthropicCreate.mockReset();
  openaiCreate.mockReset();
});

const CALL_ARGS = { system: "sys", user: "hi", maxTokens: 100 };

describe("makeLlmCallers — console-only key, no process.env", () => {
  it("resolves a working Anthropic brand/drafter/judge caller from an explicit key alone", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "brand-reply" }] });

    const { makeLlmCallers } = await import("./llm");
    const { brandModelCall, drafterCall, judgeCall } = makeLlmCallers({ anthropic: "console-key-only" });

    expect(await brandModelCall(CALL_ARGS)).toBe("brand-reply");
    expect(await drafterCall(CALL_ARGS)).toBe("brand-reply");
    // The anthropic judge returns the structured-output JSON text as-is.
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn" });
    expect(await judgeCall("anthropic", CALL_ARGS)).toBe('{"ok":true}');

    // Every SDK construction used the passed key, never process.env (unset here).
    for (const [opts] of anthropicCreate.mock.calls) {
      expect(opts).toEqual({ apiKey: "console-key-only" });
    }
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("resolves a working OpenAI brand/drafter/judge caller from an explicit key alone", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    openaiCreate.mockResolvedValue({ output_text: "openai-reply" });

    const { makeLlmCallers } = await import("./llm");
    const { brandModelCall, drafterCall, judgeCall } = makeLlmCallers({ openai: "console-key-only" });

    expect(await brandModelCall(CALL_ARGS)).toBe("openai-reply");
    expect(await drafterCall(CALL_ARGS)).toBe("openai-reply");
    expect(await judgeCall("openai", CALL_ARGS)).toBe("openai-reply");

    for (const [opts] of openaiCreate.mock.calls) {
      expect(opts).toEqual({ apiKey: "console-key-only" });
    }
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("no key at all -> every caller degrades to null, never throws", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { makeLlmCallers } = await import("./llm");
    const { brandModelCall, drafterCall, judgeCall } = makeLlmCallers({});

    expect(await brandModelCall(CALL_ARGS)).toBeNull();
    expect(await drafterCall(CALL_ARGS)).toBeNull();
    expect(await judgeCall("anthropic", CALL_ARGS)).toBeNull();
    expect(await judgeCall("openai", CALL_ARGS)).toBeNull();
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("a passed ResolvedRoles wins over the default availableFamiliesFromKeys resolution", async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "anthropic-said-so" }] });
    const { makeLlmCallers } = await import("./llm");
    const { resolveRoles } = await import("./models");
    // Force brand/drafter onto Anthropic even though only an OpenAI-shaped key
    // dict is handed in — proves `roles` (2nd arg) takes precedence.
    const roles = resolveRoles({ anthropic: true });
    const { brandModelCall } = makeLlmCallers({ anthropic: "k" }, roles);
    expect(await brandModelCall(CALL_ARGS)).toBe("anthropic-said-so");
  });
});

describe("brandModelCall / drafterCall / judgeCall (env-reading wrappers)", () => {
  it("env still wins when set — identical behavior to before the keys seam", async () => {
    process.env.ANTHROPIC_API_KEY = "env-anthropic-key";
    delete process.env.OPENAI_API_KEY;
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "from-env" }] });

    const { brandModelCall, drafterCall, judgeCall } = await import("./llm");
    expect(await brandModelCall(CALL_ARGS)).toBe("from-env");
    expect(await drafterCall(CALL_ARGS)).toBe("from-env");
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn" });
    expect(await judgeCall("anthropic", CALL_ARGS)).toBe('{"ok":true}');

    for (const [opts] of anthropicCreate.mock.calls) {
      expect(opts).toEqual({ apiKey: "env-anthropic-key" });
    }
  });

  it("with no env key set, the wrappers degrade to null (no console key reaches them, by design)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const { brandModelCall, judgeCall } = await import("./llm");
    expect(await brandModelCall(CALL_ARGS)).toBeNull();
    expect(await judgeCall("anthropic", CALL_ARGS)).toBeNull();
  });
});

describe("Anthropic request shape (current Claude models reject prefill and sampling params)", () => {
  it("the judge uses a JSON-schema structured output: no prefill, no temperature", async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn" });
    const { makeLlmCallers } = await import("./llm");
    const { JUDGE_OUTPUT_SCHEMA } = await import("./judge-schema");
    await makeLlmCallers({ anthropic: "k" }).judgeCall("anthropic", CALL_ARGS);

    const [, req] = anthropicCreate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(req).not.toHaveProperty("temperature");
    expect(req).not.toHaveProperty("top_p");
    expect(req).not.toHaveProperty("top_k");
    expect(req.messages).toEqual([{ role: "user", content: "hi" }]); // no assistant prefill turn
    expect(req.output_config).toEqual({
      effort: "low",
      format: { type: "json_schema", schema: JUDGE_OUTPUT_SCHEMA },
    });
    // the caller's budget is for the visible reply; thinking gets headroom on top
    expect(req.max_tokens as number).toBeGreaterThan(CALL_ARGS.maxTokens);
  });

  it("brand and drafter calls send no prefill and no sampling params either", async () => {
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: "x" }], stop_reason: "end_turn" });
    const { makeLlmCallers } = await import("./llm");
    const { brandModelCall, drafterCall } = makeLlmCallers({ anthropic: "k" });
    await brandModelCall(CALL_ARGS);
    await drafterCall(CALL_ARGS);
    for (const [, req] of anthropicCreate.mock.calls as [unknown, Record<string, unknown>][]) {
      expect(req).not.toHaveProperty("temperature");
      expect(req.messages).toEqual([{ role: "user", content: "hi" }]);
      expect(req).not.toHaveProperty("output_config.format");
    }
  });

  it("the judge schema is one structured outputs accepts: every object closed and fully required", async () => {
    const { JUDGE_OUTPUT_SCHEMA } = await import("./judge-schema");
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      if (n.type === "object") {
        expect(n.additionalProperties).toBe(false);
        expect(n.required).toEqual(Object.keys(n.properties as object));
      }
      for (const k of ["maxItems", "minLength", "maxLength", "minimum", "maximum"]) expect(n).not.toHaveProperty(k);
      for (const v of Object.values(n)) walk(v);
    };
    walk(JUDGE_OUTPUT_SCHEMA);
  });

  it("a truncated or refused judge reply is a failure (null), not half a JSON object", async () => {
    const lines: string[] = [];
    const { makeLlmCallers, setLlmFailureLog } = await import("./llm");
    setLlmFailureLog((l) => lines.push(l));
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: '{"evidence' }], stop_reason: "max_tokens" });
    expect(await makeLlmCallers({ anthropic: "k" }).judgeCall("anthropic", CALL_ARGS)).toBeNull();
    expect(lines.join("\n")).toMatch(/max_tokens/);
    setLlmFailureLog(null);
  });
});

describe("OpenAI request shape", () => {
  it("the OpenAI judge asks for a strict JSON-schema output with the shared verdict schema", async () => {
    openaiCreate.mockResolvedValue({ output_text: "{}" });
    const { makeLlmCallers } = await import("./llm");
    const { JUDGE_OUTPUT_SCHEMA } = await import("./judge-schema");
    await makeLlmCallers({ openai: "k" }).judgeCall("openai", CALL_ARGS);
    const [, req] = openaiCreate.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(req.text).toEqual({
      format: { type: "json_schema", name: "verdict", schema: JUDGE_OUTPUT_SCHEMA, strict: true },
    });
    expect(req.reasoning).toEqual({ effort: "low" });
    expect(req).not.toHaveProperty("temperature");
  });
});

describe("failures are logged, redacted and deduplicated, and still degrade to null", () => {
  it("a 400 from the provider is written once with the reason, never the key", async () => {
    const lines: string[] = [];
    const { makeLlmCallers, setLlmFailureLog } = await import("./llm");
    setLlmFailureLog((l) => lines.push(l));
    const key = "sk-ant-api03-" + "x".repeat(40);
    const err = Object.assign(new Error(`invalid_request_error: prefill is not supported (key ${key})`), { status: 400 });
    anthropicCreate.mockRejectedValue(err);
    const { judgeCall } = makeLlmCallers({ anthropic: key });

    expect(await judgeCall("anthropic", CALL_ARGS)).toBeNull();
    expect(await judgeCall("anthropic", CALL_ARGS)).toBeNull();

    expect(lines).toHaveLength(1); // the same failure twice prints once
    expect(lines[0]).toMatch(/judge call to .+ failed/);
    expect(lines[0]).toMatch(/prefill is not supported/);
    expect(lines[0]).not.toContain(key);
    setLlmFailureLog(null);
  });

  it("OpenAI failures are logged the same way", async () => {
    const lines: string[] = [];
    const { makeLlmCallers, setLlmFailureLog } = await import("./llm");
    setLlmFailureLog((l) => lines.push(l));
    openaiCreate.mockRejectedValue(Object.assign(new Error("model not found"), { status: 404 }));
    const { brandModelCall, judgeCall } = makeLlmCallers({ openai: "k" });
    expect(await brandModelCall(CALL_ARGS)).toBeNull();
    expect(await judgeCall("openai", CALL_ARGS)).toBeNull();
    expect(lines.some((l) => /brand model call/.test(l))).toBe(true);
    expect(lines.some((l) => /judge call/.test(l))).toBe(true);
    setLlmFailureLog(null);
  });
});
