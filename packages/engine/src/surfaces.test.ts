// The surfaces registry, and how answer surfaces ride the existing engine
// contracts: selection, cost, scoring, judging.
import { describe, expect, it } from "vitest";
import { COST_CENTS, answerCents } from "./answer-cost";
import { ALL_ENGINES, normalizeSelection, resolveEngines } from "./engines";
import { CROSS_FAMILY_JUDGE } from "./models";
import { SERP_REQUEST_CENTS, SURFACE_REQUESTS } from "./rates";
import { computeScores } from "./score";
import {
  ENGINE_IDS,
  SERP_PROVIDERS,
  SURFACES,
  SURFACE_IDS,
  engineLabel,
  isNotShownRow,
  keyEnvVarFor,
  normalizeSurfaceLocale,
  surfaceSourceId,
} from "./surfaces";
import type { AnswerRow } from "./types";

describe("surfaces registry", () => {
  it("covers every id once, model APIs first", () => {
    expect(ENGINE_IDS).toEqual([...ALL_ENGINES, ...SURFACE_IDS]);
    for (const id of ENGINE_IDS) {
      expect(SURFACES[id].id).toBe(id);
      expect(SURFACES[id].label.length).toBeGreaterThan(0);
    }
  });

  it("every SERP surface is served by a provider and priced per request", () => {
    for (const id of SURFACE_IDS) {
      expect(SURFACES[id].kind).toBe("serp");
      expect(SURFACES[id].cost).toBe("per_request");
      expect(SERP_PROVIDERS.serpapi.serves[id]).toBeTruthy();
      expect(keyEnvVarFor(id)).toBe("SERPAPI_API_KEY");
      expect(SURFACE_REQUESTS[id].typical).toBeGreaterThanOrEqual(SURFACE_REQUESTS[id].low);
    }
    expect(keyEnvVarFor("gemini")).toBe("GEMINI_API_KEY");
  });

  it("labels known ids and degrades for unknown ones", () => {
    expect(engineLabel("google_ai_overview")).toBe("Google AI Overviews");
    expect(engineLabel("chatgpt")).toBe("ChatGPT");
    expect(engineLabel("newthing")).toBe("Newthing");
  });

  it("validates a locale", () => {
    expect(normalizeSurfaceLocale({ country: "US", language: "pt-BR", location: "  Austin,  Texas " })).toEqual({
      ok: true,
      value: { country: "us", language: "pt-BR", location: "Austin, Texas" },
    });
    expect(normalizeSurfaceLocale({ country: "usa" }).ok).toBe(false);
    expect(normalizeSurfaceLocale({ language: "english!" }).ok).toBe(false);
    expect(normalizeSurfaceLocale(null)).toEqual({ ok: true, value: {} });
  });
});

describe("selection", () => {
  it("defaults stay the four model APIs; surfaces are opt-in", () => {
    expect(resolveEngines(null)).toEqual(ALL_ENGINES);
    expect(resolveEngines(["google_ai_mode", "chatgpt"])).toEqual(["chatgpt", "google_ai_mode"]);
    expect(resolveEngines(["google_ai_overview", "google_ai_mode"])).toEqual(["google_ai_overview", "google_ai_mode"]);
    // one source alone is below the floor → the default
    expect(resolveEngines(["google_ai_mode"])).toEqual(ALL_ENGINES);
  });

  it("the four plus a surface is stored; exactly the four is the default (null)", () => {
    expect(normalizeSelection([...ALL_ENGINES])).toEqual({ ok: true, store: null });
    expect(normalizeSelection([...ALL_ENGINES, "google_ai_overview"])).toEqual({
      ok: true,
      store: [...ALL_ENGINES, "google_ai_overview"],
    });
    expect(normalizeSelection(["chatgpt", "claude", "gemini", "google_ai_mode"])).toEqual({
      ok: true,
      store: ["chatgpt", "claude", "gemini", "google_ai_mode"],
    });
  });
});

describe("cost", () => {
  const row = (engine: string, ok: boolean, searches?: number) => ({
    engine,
    ok,
    ...(searches !== undefined ? { usage: { searches } } : {}),
  });
  it("prices a surface per provider request from rates.ts", () => {
    expect(SERP_REQUEST_CENTS.serpapi).toBe(2.5);
    expect(answerCents(row("google_ai_overview", true, 2))).toBe(5);
    expect(answerCents(row("google_ai_mode", true, 1))).toBe(2.5);
  });
  it("bills a not-shown answer (the search ran), never a failed one", () => {
    expect(answerCents(row("google_ai_overview", false, 1))).toBe(2.5);
    expect(answerCents(row("google_ai_overview", false))).toBe(0);
  });
  it("falls back to the typical request count when usage is missing", () => {
    expect(COST_CENTS.google_ai_overview).toBe(5);
    expect(COST_CENTS.copilot).toBe(2.5);
    expect(answerCents(row("google_ai_overview", true))).toBe(5);
  });
});

describe("judging and scoring", () => {
  it("every surface is judged by the family that produced none of them", () => {
    for (const id of SURFACE_IDS) expect(CROSS_FAMILY_JUDGE[id]).toBe("anthropic");
    expect(surfaceSourceId("google_ai_mode")).toBe("serpapi:google_ai_mode");
  });

  const a = (engine: AnswerRow["engine"], ok: boolean, mention: string | null, error?: string): AnswerRow => ({
    qid: "q01",
    qtype: "category",
    question: "q",
    engine,
    ok,
    raw_text: ok ? "text" : "",
    citations: [],
    ...(error ? { error } : {}),
    ...(mention
      ? {
          verdict: {
            brand_present: mention !== "absent",
            mention_type: mention as "recommended",
            prominence: "first",
            sentiment: "neutral",
            claims: [],
            other_brands: [],
            excerpt: "",
          },
        }
      : {}),
  });

  it("a surface gets a per_engine row only when asked; a not-shown answer is a gap", () => {
    const plain = computeScores([a("chatgpt", true, "recommended")]);
    expect(Object.keys(plain.per_engine)).toEqual(["chatgpt", "claude", "gemini", "perplexity"]);
    const withSurface = computeScores([
      a("chatgpt", true, "recommended"),
      a("google_ai_overview", true, "absent"),
      a("google_ai_mode", false, null, "no_answer: Google AI Mode showed no answer for this question (x)"),
    ]);
    expect(withSurface.per_engine.google_ai_overview).toEqual({
      answered: 1,
      recommended: 0,
      mentioned: 0,
      rec_rate: 0,
      mention_rate: 0,
    });
    expect(withSurface.per_engine.google_ai_mode?.answered).toBe(0);
    expect(withSurface.overall.answered).toBe(2);
    expect(withSurface.recommended_band?.per_engine.google_ai_overview).toEqual({ min: 0, max: 0 });
  });

  it("isNotShownRow tells a not-shown answer from a failure", () => {
    expect(isNotShownRow({ ok: false, error: "no_answer: x" })).toBe(true);
    expect(isNotShownRow({ ok: false, error: "auth: x" })).toBe(false);
    expect(isNotShownRow({ ok: true, error: "no_answer: x" })).toBe(false);
  });
});

describe("call cap", () => {
  it("scales with the sources asked, never below the historical 200", async () => {
    const { callCapFor, CALL_CAP } = await import("./observe");
    expect(callCapFor(4)).toBe(CALL_CAP);
    expect(callCapFor(7)).toBe(350);
    // full profile worst case, seven sources: (12 scored x 3 + 11) x 7 = 329
    expect((12 * 3 + 11) * 7).toBeLessThanOrEqual(callCapFor(7));
  });
});
