// Settings › Limits shows the operator's guardrails, never a price, a plan or a
// credit balance. These pin the exact wording.
import { describe, expect, it } from "vitest";
import { brandLimitCopy, fairUseCopy, spendCapCopy } from "./copy";

const NO_COMMERCE = /\$?\b(plan|credit|upgrade|pro\b|buy|purchase|pricing|checkout|stripe)\b/i;

describe("spendCapCopy", () => {
  it("names the daily cap in dollars when one is set", () => {
    expect(spendCapCopy(50)).toBe("$50 / day, deployment-wide.");
  });

  it("says no cap set when the cap is 0", () => {
    expect(spendCapCopy(0)).toBe("No cap set.");
  });
});

describe("fairUseCopy", () => {
  it("states the audit/verify caps and the window", () => {
    expect(fairUseCopy(3, 3, 24)).toBe(
      "Up to 3 audits and 3 verifies per brand every 24 hours; one run at a time per brand.",
    );
  });
});

describe("brandLimitCopy", () => {
  it("counts brands, singular and plural", () => {
    expect(brandLimitCopy(1)).toBe("1 brand per account.");
    expect(brandLimitCopy(5)).toBe("5 brands per account.");
  });
});

describe("no commerce anywhere on the limits page", () => {
  it("never sells, upsells or names a tier", () => {
    for (const line of [spendCapCopy(50), spendCapCopy(0), fairUseCopy(3, 3, 24), brandLimitCopy(5)]) {
      expect(line).not.toMatch(NO_COMMERCE);
    }
  });
});
