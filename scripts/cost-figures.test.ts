// The rate table's measured inputs and the published cost copy cannot drift from
// what the code computes: this re-measures them exactly as scripts/cost-figures.ts
// does. $0, offline.
import { describe, expect, it } from "vitest";
import { ROLE_CALL_USAGE, TYPICAL_ANSWER_USAGE } from "@saylent/engine/rates";
import { FULL_COMPUTED_USD, SMOKE_COMPUTED_USD } from "../src/lib/cost-copy";
import { computeRanges, measureRoleCallUsage, measureTypicalAnswerUsage } from "./cost-figures";

describe("cost figures are recomputed from the code", () => {
  it("TYPICAL_ANSWER_USAGE is the sample run's median usage", () => {
    expect(measureTypicalAnswerUsage()).toEqual(TYPICAL_ANSWER_USAGE);
  });

  it("ROLE_CALL_USAGE is what the engine's own prompt builders produce", async () => {
    expect(await measureRoleCallUsage()).toEqual(ROLE_CALL_USAGE);
  });

  it("cost-copy's computed ranges are the estimator's output", () => {
    const { full, smoke } = computeRanges();
    expect(full).toEqual(FULL_COMPUTED_USD);
    expect(smoke).toEqual(SMOKE_COMPUTED_USD);
  });
});
