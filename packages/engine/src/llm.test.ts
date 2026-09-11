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
    // judgeCall's anthropic path prepends the "{" prefill back onto the reply.
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: '"ok":true}' }] });
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
    anthropicCreate.mockResolvedValue({ content: [{ type: "text", text: '"ok":true}' }] });
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
