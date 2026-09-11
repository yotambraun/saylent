// T3 — the guards on the Questions and run options mutations. Three things must
// hold before anything is written or spent: the read-only demo refuses, a signed
// -out or non-owner caller gets nothing, and an edit that changes what the run
// asks clears the frozen baseline. The Supabase client is a stub, so these are
// unit tests of the decisions, not of Postgres.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_READ_ONLY_MESSAGE } from "@/lib/demo-mode";
import { toDraftQuestions, toEngineQuestions, type DraftQuestion } from "@/lib/question-options";

const state: {
  user: { id: string } | null;
  brand: Record<string, unknown> | null;
  updates: Record<string, unknown>[];
} = { user: { id: "u1" }, brand: null, updates: [] };

type CreateRunArg = {
  userId: string;
  brandId: string;
  kind: string;
  runOptions?: { samples?: number; skip?: Record<string, boolean>; questions?: unknown[] } | null;
};
type CreateRunResult = { ok: true; runId: string } | { ok: false; reason: string };
const createRunMock = vi.fn<(p: CreateRunArg) => Promise<CreateRunResult>>(async () => ({
  ok: true,
  runId: "run_1",
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/runs", () => ({ createRun: (p: CreateRunArg) => createRunMock(p) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    // One chainable stub for every builder shape these actions use:
    // select().eq().eq().is().maybeSingle() and update().eq().eq().
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      update: (patch: Record<string, unknown>) => {
        state.updates.push(patch);
        return chain;
      },
      eq: () => chain,
      is: () => chain,
      maybeSingle: async () => ({ data: state.brand, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    });
    return {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      from: () => chain,
    };
  },
}));

import { resetRunOptions, saveRunOptions, startRunWithOptions } from "./actions";

const FROZEN: DraftQuestion[] = [
  { id: "q01", type: "category", text: "Best uptime monitor for small teams?", source: "template" },
  { id: "q02", type: "problem", text: "How do I stop pager noise?", source: "template" },
  { id: "q03", type: "branded", text: "What is Kestrel Uptime?", source: "template" },
];

function brandWithFrozenSet() {
  return {
    id: "b1",
    name: "Kestrel Uptime",
    category: "uptime monitoring",
    icp: "small platform teams",
    competitors: ["Pingdom"],
    problems: ["noisy alerts"],
    engines: null,
    question_set: { questions: toEngineQuestions(FROZEN), version: 2, engines: null },
    question_set_version: 2,
  };
}

const form = (over: Record<string, unknown> = {}) => ({
  brandId: "b1",
  questions: FROZEN,
  samples: 2,
  engines: ["chatgpt", "claude", "gemini", "perplexity"],
  locale: "",
  skip: {},
  ...over,
});

beforeEach(() => {
  state.user = { id: "u1" };
  state.brand = brandWithFrozenSet();
  state.updates = [];
  createRunMock.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("the read-only demo refuses every one of them", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEMO_READONLY", "1"));

  it("refuses to save, to run, and to reset", async () => {
    for (const call of [
      () => saveRunOptions(form()),
      () => startRunWithOptions(form()),
      () => resetRunOptions("b1"),
    ]) {
      const res = await call();
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(DEMO_READ_ONLY_MESSAGE);
    }
    expect(state.updates).toHaveLength(0);
    expect(createRunMock).not.toHaveBeenCalled();
  });
});

describe("ownership", () => {
  it("refuses a signed-out caller", async () => {
    state.user = null;
    const res = await startRunWithOptions(form());
    expect(res).toEqual({ ok: false, error: "Sign in first." });
    expect(createRunMock).not.toHaveBeenCalled();
  });

  it("treats another account's brand as missing and starts nothing", async () => {
    // The action filters on user_id as well as RLS, so a brand the caller does
    // not own comes back empty rather than as somebody else's row.
    state.brand = null;
    const res = await startRunWithOptions(form());
    expect(res).toEqual({ ok: false, error: "Brand not found." });
    expect(state.updates).toHaveLength(0);
    expect(createRunMock).not.toHaveBeenCalled();
  });
});

describe("validation happens on the server, whatever the form sent", () => {
  it("refuses a single-engine run and writes nothing", async () => {
    const res = await saveRunOptions(form({ engines: ["chatgpt"] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("at least 2");
    expect(state.updates).toHaveLength(0);
  });

  it("refuses an empty question row", async () => {
    const res = await saveRunOptions(form({ questions: [...FROZEN, { id: "q04", type: "custom", text: "  ", source: "user" }] }));
    expect(res.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });
});

describe("the re-baseline rule", () => {
  it("stores no question set and keeps the baseline when nothing was edited", async () => {
    const res = await saveRunOptions(form());
    expect(res).toEqual({ ok: true, rebaselined: false });
    const patch = state.updates[0];
    expect(patch).not.toHaveProperty("question_set");
    expect((patch.run_options as Record<string, unknown>).questions).toBeUndefined();
  });

  it("clears the frozen set and bumps the version when the questions changed", async () => {
    const edited = [...FROZEN.slice(1), { id: "q09", type: "custom" as const, text: "Do you page on weekends?", source: "user" as const }];
    const res = await saveRunOptions(form({ questions: edited }));
    expect(res).toEqual({ ok: true, rebaselined: true });
    const patch = state.updates[0];
    expect(patch.question_set).toBeNull();
    expect(patch.question_set_version).toBe(3);
    expect((patch.run_options as { questions: DraftQuestion[] }).questions).toHaveLength(3);
  });

  it("treats a narrowed engine set as a question change", async () => {
    const res = await saveRunOptions(form({ engines: ["chatgpt", "gemini"] }));
    expect(res).toEqual({ ok: true, rebaselined: true });
    expect(state.updates[0].question_set).toBeNull();
  });

  it("does not re-baseline a brand that has no frozen set yet", async () => {
    state.brand = { ...brandWithFrozenSet(), question_set: null, question_set_version: 1 };
    const res = await saveRunOptions(form({ questions: toDraftQuestions(toEngineQuestions(FROZEN)) }));
    expect(res).toEqual({ ok: true, rebaselined: false });
    expect(state.updates[0]).not.toHaveProperty("question_set");
  });
});

describe("starting the run", () => {
  it("goes through createRun and hands it the saved options", async () => {
    const res = await startRunWithOptions(form({ samples: 3, skip: { drafts: true } }));
    expect(res).toEqual({ ok: true, runId: "run_1" });
    expect(createRunMock).toHaveBeenCalledTimes(1);
    const arg = createRunMock.mock.calls[0]?.[0] as CreateRunArg;
    expect(arg).toMatchObject({ kind: "audit", brandId: "b1", userId: "u1" });
    expect(arg.runOptions?.samples).toBe(3);
    expect(arg.runOptions?.skip).toEqual({ drafts: true });
  });

  it("passes a refusal from createRun straight back", async () => {
    createRunMock.mockResolvedValueOnce({
      ok: false,
      reason: "A run is already in progress for this brand.",
    });
    const res = await startRunWithOptions(form());
    expect(res).toEqual({ ok: false, error: "A run is already in progress for this brand." });
  });
});

describe("reset", () => {
  it("clears the draft without touching the frozen set", async () => {
    const res = await resetRunOptions("b1");
    expect(res).toEqual({ ok: true, rebaselined: false });
    expect(state.updates[0]).toEqual({ run_options: null });
  });
});
