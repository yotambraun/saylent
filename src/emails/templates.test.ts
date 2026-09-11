// The transactional email templates render the spec'd subjects
// and weave their props into the HTML. Pure functions, no network.
import { describe, expect, it } from "vitest";
import {
  dossierReadyEmail,
  movementEmail,
  verifyReminderEmail,
  welcomeEmail,
} from "./templates";

const APP = "https://app.saylent.test";

describe("welcomeEmail", () => {
  it("has the spec subject and links to /app", () => {
    const e = welcomeEmail({ appUrl: APP });
    expect(e.subject).toBe("Your Saylent account is ready");
    expect(e.html).toContain(`${APP}/app`);
    expect(e.html).toContain("ten minutes");
  });
});

describe("dossierReadyEmail", () => {
  it("renders recommended-in-N in the subject and links to the run", () => {
    const e = dossierReadyEmail({
      appUrl: APP,
      brand: "Acme",
      recommended: 7,
      answered: 20,
      topFixTitle: "Publish a comparison page",
      runId: "run_1",
    });
    expect(e.subject).toBe("Your AI visibility dossier: recommended in 7 of 20");
    expect(e.html).toContain("Acme");
    expect(e.html).toContain("7 of 20");
    expect(e.html).toContain("Publish a comparison page");
    expect(e.html).toContain(`${APP}/app/run/run_1`);
  });

  it("omits the top-fix line when none is provided", () => {
    const e = dossierReadyEmail({
      appUrl: APP,
      brand: "Acme",
      recommended: 0,
      answered: 20,
      runId: "run_1",
    });
    expect(e.html).not.toContain("highest-leverage fix");
  });
});

describe("movementEmail (non-transactional — needs unsubscribe)", () => {
  it("shows before→after and an unsubscribe link", () => {
    const e = movementEmail({
      appUrl: APP,
      brand: "Acme",
      before: 5,
      after: 9,
      answered: 20,
      runId: "run_2",
      watchLines: ["Comparison page: recommended by 2 more engines"],
      unsubscribeUrl: `${APP}/unsubscribe?t=tok`,
    });
    expect(e.subject).toBe("Verify results: 5→9 of 20");
    expect(e.html).toContain("5 → 9");
    expect(e.html).toContain("Comparison page: recommended by 2 more engines");
    expect(e.html).toContain(`${APP}/unsubscribe?t=tok`);
    expect(e.html).toContain("Unsubscribe");
  });

  it("adds the honest noise note when |Δ| ≤ 1", () => {
    const e = movementEmail({
      appUrl: APP,
      brand: "Acme",
      before: 8,
      after: 9,
      answered: 20,
      runId: "run_2",
      unsubscribeUrl: `${APP}/unsubscribe`,
    });
    expect(e.html).toContain("noise floor");
  });

  it("omits the noise note for a clear move", () => {
    const e = movementEmail({
      appUrl: APP,
      brand: "Acme",
      before: 3,
      after: 9,
      answered: 20,
      runId: "run_2",
      unsubscribeUrl: `${APP}/unsubscribe`,
    });
    expect(e.html).not.toContain("noise floor");
  });
});

describe("verifyReminderEmail", () => {
  it("has the day-10 subject and a run-verify link", () => {
    const e = verifyReminderEmail({ appUrl: APP, brand: "Acme", brandId: "brand_1" });
    expect(e.subject).toBe("Time to measure your fixes");
    expect(e.html).toContain(`${APP}/app/brand/brand_1`);
    expect(e.html).toContain("Acme");
  });
});

describe("HTML escaping", () => {
  it("escapes a brand name with angle brackets / ampersands", () => {
    const e = dossierReadyEmail({
      appUrl: APP,
      brand: "A<b>&Co",
      recommended: 1,
      answered: 2,
      runId: "r",
    });
    expect(e.html).toContain("A&lt;b&gt;&amp;Co");
    expect(e.html).not.toContain("A<b>&Co");
  });
});
