// Adaptive sampling constants (profiles.sampleCount / maxDraws).
import { describe, expect, it } from "vitest";
import {
  freezeSamples,
  hasAnySkip,
  maxDraws,
  maxDrawsFor,
  parseSkipList,
  PROFILES,
  resolveSkip,
  resolveSampling,
  sampleCount,
  sampleCountFor,
} from "./profiles";
import type { Question } from "./types";

describe("sampleCount (initial draws)", () => {
  it("full: scored questions (category|problem) get 2 initial draws", () => {
    expect(sampleCount("category", "full")).toBe(2);
    expect(sampleCount("problem", "full")).toBe(2);
    expect(PROFILES.full.scoredSamples).toBe(2);
    expect(PROFILES.full.scoredTiebreak).toBe(true);
  });
  it("full: every non-scored qtype stays single-sample", () => {
    for (const qt of ["comparison", "branded", "integration", "migration", "trust"] as const) {
      expect(sampleCount(qt, "full")).toBe(1);
    }
  });
  it("smoke: sampling OFF — scored questions single-sample, tiebreak off", () => {
    expect(sampleCount("category", "smoke")).toBe(1);
    expect(sampleCount("problem", "smoke")).toBe(1);
    expect(PROFILES.smoke.scoredSamples).toBe(1);
    expect(PROFILES.smoke.scoredTiebreak).toBe(false);
  });
});

describe("maxDraws (call-cap worst case)", () => {
  it("full: a scored question can reach 3 draws (2 initial + 1 tiebreak)", () => {
    expect(maxDraws("category", "full")).toBe(3);
    expect(maxDraws("problem", "full")).toBe(3);
  });
  it("full: non-scored questions max at 1 (never tiebroken)", () => {
    expect(maxDraws("comparison", "full")).toBe(1);
    expect(maxDraws("branded", "full")).toBe(1);
  });
  it("smoke: tiebreak off — worst case equals the single initial draw", () => {
    expect(maxDraws("category", "smoke")).toBe(1);
    expect(maxDraws("branded", "smoke")).toBe(1);
  });
  it("full worst case never exceeds the old flat-3× maximum", () => {
    // 2 initial + 1 tiebreak == the flat 3× the cap was sized for.
    expect(maxDraws("category", "full")).toBe(3);
  });
});

// Samples feature (the operator controls how many times each question is
// asked): run-level resolution, the per-question override, and freezing.
const q = (qtype: Question["qtype"], samples?: number): Question => ({
  qid: "q01",
  text: "best X for teams?",
  qtype,
  ...(samples !== undefined ? { samples } : {}),
});

describe("resolveSampling (run level)", () => {
  it("defaults to the profile's own scoredSamples/scoredTiebreak with no override", () => {
    expect(resolveSampling("full")).toEqual({ samples: 2, tiebreak: true, source: "profile" });
    expect(resolveSampling("smoke")).toEqual({ samples: 1, tiebreak: false, source: "profile" });
  });

  it("precedence: flag > env > config > profile", () => {
    expect(resolveSampling("full", { flag: 4, env: "3", config: { samples: 2 } }).samples).toBe(4);
    expect(resolveSampling("full", { env: "3", config: { samples: 2 } }).samples).toBe(3);
    expect(resolveSampling("full", { config: { samples: 5 } }).samples).toBe(5);
    expect(resolveSampling("smoke", {}).samples).toBe(1); // profile default, nothing else given
  });

  it("reports which layer supplied the value, for the defaults-in-effect line", () => {
    expect(resolveSampling("full", { flag: 3 }).source).toBe("flag");
    expect(resolveSampling("full", { env: "3" }).source).toBe("env");
    expect(resolveSampling("full", { config: { samples: 3 } }).source).toBe("config");
    expect(resolveSampling("full", {}).source).toBe("profile");
  });

  it("the tiebreak rule is unchanged: n=1 never votes, n=2 tiebreaks on disagreement, n>=3 already votes over every draw", () => {
    expect(resolveSampling("full", { flag: 1 }).tiebreak).toBe(false);
    expect(resolveSampling("full", { flag: 2 }).tiebreak).toBe(true);
    expect(resolveSampling("full", { flag: 3 }).tiebreak).toBe(false);
    expect(resolveSampling("full", { flag: 5 }).tiebreak).toBe(false);
  });

  it("saylent.config sampling.tiebreak can turn the n=2 third draw OFF, never on for another count", () => {
    expect(resolveSampling("full", { flag: 2, config: { tiebreak: false } }).tiebreak).toBe(false);
    expect(resolveSampling("full", { flag: 3, config: { tiebreak: true } }).tiebreak).toBe(false);
    expect(resolveSampling("full", { flag: 1, config: { tiebreak: true } }).tiebreak).toBe(false);
  });

  it("rejects an out-of-range or non-numeric --samples / AUDIT_SAMPLES", () => {
    expect(() => resolveSampling("full", { flag: 0 })).toThrow(/--samples/);
    expect(() => resolveSampling("full", { flag: 6 })).toThrow(/--samples/);
    expect(() => resolveSampling("full", { env: "not-a-number" })).toThrow(/AUDIT_SAMPLES/);
    expect(() => resolveSampling("full", { env: "9" })).toThrow(/AUDIT_SAMPLES/);
  });
});

describe("sampleCountFor (per-question override wins over the run level)", () => {
  it("no override: scored gets the resolved run-level count, everything else stays 1", () => {
    expect(sampleCountFor(q("category"), 3)).toBe(3);
    expect(sampleCountFor(q("problem"), 3)).toBe(3);
    expect(sampleCountFor(q("branded"), 3)).toBe(1);
  });

  it("an explicit q.samples wins regardless of the resolved run-level count", () => {
    expect(sampleCountFor(q("category", 4), 2)).toBe(4);
    expect(sampleCountFor(q("branded", 3), 2)).toBe(3); // even a non-scored qtype can be sampled
    expect(sampleCountFor(q("category", 1), 2)).toBe(1); // an override can also ask FEWER times
  });

  it("clamps an out-of-range stored override into 1-5", () => {
    expect(sampleCountFor(q("category", 9), 2)).toBe(5);
    expect(sampleCountFor(q("category", 0), 2)).toBe(1);
  });
});

describe("maxDrawsFor (per-question worst case for the call-cap guard)", () => {
  it("adds the tiebreak draw only when the EFFECTIVE count is exactly 2 and tiebreak is on", () => {
    const resolved = { samples: 2, tiebreak: true, source: "profile" as const };
    expect(maxDrawsFor(q("category"), resolved)).toBe(3);
    expect(maxDrawsFor(q("branded"), resolved)).toBe(1); // non-scored: default stays 1, no tiebreak
  });

  it("--samples 1 never adds a tiebreak draw", () => {
    const resolved = resolveSampling("full", { flag: 1 });
    expect(maxDrawsFor(q("category"), resolved)).toBe(1);
  });

  it("--samples 3+ already votes over every draw — no extra tiebreak draw", () => {
    const resolved = resolveSampling("full", { flag: 4 });
    expect(maxDrawsFor(q("category"), resolved)).toBe(4);
  });

  it("a per-question override of exactly 2 still gets the tiebreak when the run resolves tiebreak on", () => {
    const resolved = resolveSampling("full", { flag: 5 }); // run level = 5, tiebreak off at 5
    expect(maxDrawsFor(q("category", 2), resolved)).toBe(2); // resolved.tiebreak is false at n=5
  });
});

describe("freezeSamples (stamps the effective count onto every frozen question)", () => {
  it("stamps the run-level resolved count onto template questions with no override", () => {
    const frozen = freezeSamples([q("category"), q("branded")], 3);
    expect(frozen.map((f) => f.samples)).toEqual([3, 1]);
  });

  it("leaves an explicit per-question override untouched", () => {
    const frozen = freezeSamples([q("category", 5)], 2);
    expect(frozen[0].samples).toBe(5);
  });

  it("is idempotent: freezing an already-frozen set changes nothing", () => {
    const once = freezeSamples([q("category")], 2);
    const twice = freezeSamples(once, 4); // a different resolvedSamples must NOT touch it
    expect(twice[0].samples).toBe(2);
  });
});

// Stage skips.
describe("parseSkipList", () => {
  it("parses a comma-separated list into SkipStages", () => {
    expect(parseSkipList("drafts,gates")).toEqual({ drafts: true, gates: true });
    expect(parseSkipList("corpus")).toEqual({ corpus: true });
  });

  it("tolerates surrounding whitespace and trailing commas", () => {
    expect(parseSkipList(" drafts , corpus ,")).toEqual({ drafts: true, corpus: true });
  });

  it("throws on an unrecognized stage name", () => {
    expect(() => parseSkipList("drafts,bogus")).toThrow(/--skip bogus/);
  });
});

describe("resolveSkip (flag > env > config > none)", () => {
  it("defaults to nothing skipped when no layer is given", () => {
    expect(resolveSkip()).toEqual({ drafts: false, corpus: false, gates: false, source: "none" });
  });

  it("flag wins over env and config", () => {
    const r = resolveSkip({ flag: "drafts", env: "gates", config: { corpus: true } });
    expect(r).toEqual({ drafts: true, corpus: false, gates: false, source: "flag" });
  });

  it("env wins over config when no flag is given", () => {
    const r = resolveSkip({ env: "gates", config: { corpus: true } });
    expect(r).toEqual({ drafts: false, corpus: false, gates: true, source: "env" });
  });

  it("config applies only when it actually skips something", () => {
    expect(resolveSkip({ config: { corpus: true } })).toEqual({
      drafts: false,
      corpus: true,
      gates: false,
      source: "config",
    });
    // an empty/all-false config is the same as no config at all
    expect(resolveSkip({ config: {} }).source).toBe("none");
  });

  it("a later layer REPLACES the whole set, never merges with an earlier one", () => {
    const r = resolveSkip({ flag: "gates", config: { drafts: true, corpus: true } });
    expect(r).toEqual({ drafts: false, corpus: false, gates: true, source: "flag" });
  });

  it("throws on an unrecognized flag/env stage name", () => {
    expect(() => resolveSkip({ flag: "bogus" })).toThrow(/--skip bogus/);
    expect(() => resolveSkip({ env: "bogus" })).toThrow(/--skip bogus/);
  });
});

describe("hasAnySkip", () => {
  it("true when at least one stage is on", () => {
    expect(hasAnySkip({ drafts: true })).toBe(true);
    expect(hasAnySkip({ gates: false, corpus: true })).toBe(true);
  });

  it("false for an empty/all-false/absent skip", () => {
    expect(hasAnySkip({})).toBe(false);
    expect(hasAnySkip({ drafts: false, corpus: false, gates: false })).toBe(false);
    expect(hasAnySkip(null)).toBe(false);
    expect(hasAnySkip(undefined)).toBe(false);
  });
});
