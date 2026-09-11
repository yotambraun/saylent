// "Your next move" — priority order, the no-brands only-card rule, the verify
// move (offered as soon as a completed audit exists, mirroring the ONE condition
// src/lib/runs.ts puts on a verify), failed-run precedence, per-brand de-dupe,
// and the top-3 cap. Pure logic; $0.
import { describe, expect, it } from "vitest";
import { computeNextMoves, type NextMoveRun, type NextMovesInput } from "./next-moves";

const NOW = Date.parse("2026-07-10T09:00:00Z");

const run = (o: Partial<NextMoveRun>): NextMoveRun => ({
  id: "run-1",
  brand_id: "brand-a",
  kind: "audit",
  status: "done",
  created_at: "2026-07-01T09:00:00Z",
  finished_at: "2026-07-01T09:10:00Z",
  baseline_run_id: null,
  scores: null,
  ...o,
});

const input = (o: Partial<NextMovesInput>): NextMovesInput => ({
  now: NOW,
  plan: "audit",
  draftedFixes: 0,
  brands: [{ id: "brand-a", name: "Metricly" }],
  runs: [],
  ...o,
});

describe("computeNextMoves — empty / no-brands", () => {
  it("no brands ⇒ exactly the first-audit card, and it is the only card", () => {
    const moves = computeNextMoves(input({ brands: [], draftedFixes: 5 }));
    expect(moves).toHaveLength(1);
    expect(moves[0].kind).toBe("first-audit");
    expect(moves[0].href).toBe("/app/onboarding");
  });

  it("a brand with no runs at all contributes no move", () => {
    const moves = computeNextMoves(input({ runs: [] }));
    expect(moves).toHaveLength(0);
  });
});

describe("computeNextMoves — failed latest run (priority 3)", () => {
  it("surfaces a retry card naming the brand, linking to the failed run", () => {
    const moves = computeNextMoves(
      input({
        runs: [
          run({ id: "old", kind: "audit", status: "done", created_at: "2026-07-01T09:00:00Z" }),
          run({ id: "new", kind: "audit", status: "failed", created_at: "2026-07-05T09:00:00Z" }),
        ],
      }),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].kind).toBe("retry");
    expect(moves[0].text).toContain("Metricly");
    expect(moves[0].text).toContain("not charged");
    expect(moves[0].href).toBe("/app/run/new");
  });

  it("an ACTIVE latest run (queued/running) is NOT a move — the Right-now strip owns it", () => {
    const moves = computeNextMoves(
      input({
        runs: [
          run({ id: "done", kind: "audit", status: "done", created_at: "2026-07-01T09:00:00Z" }),
          run({ id: "live", kind: "audit", status: "running", created_at: "2026-07-06T09:00:00Z" }),
        ],
      }),
    );
    expect(moves).toHaveLength(0);
  });

  it("a failed run that is NOT the latest run does not fire (latest is a live run)", () => {
    const moves = computeNextMoves(
      input({
        runs: [
          run({ id: "failed", status: "failed", created_at: "2026-07-02T09:00:00Z" }),
          run({ id: "live", status: "queued", created_at: "2026-07-06T09:00:00Z" }),
        ],
      }),
    );
    expect(moves).toHaveLength(0);
  });
});

describe("computeNextMoves — drafted fixes (priority 4)", () => {
  it("pluralizes and links to the tracker", () => {
    const moves = computeNextMoves(input({ draftedFixes: 3, runs: [] }));
    expect(moves[0].kind).toBe("drafted-fixes");
    expect(moves[0].text).toBe("3 drafted fixes are waiting: ship them.");
    expect(moves[0].href).toBe("/app/fixes");
  });

  it("singular copy for one drafted fix", () => {
    const moves = computeNextMoves(input({ draftedFixes: 1 }));
    expect(moves[0].text).toBe("1 drafted fix is waiting: ship it.");
  });

  it("failed-run retry outranks drafted fixes", () => {
    const moves = computeNextMoves(
      input({
        draftedFixes: 4,
        runs: [run({ id: "f", status: "failed", created_at: "2026-07-05T09:00:00Z" })],
      }),
    );
    expect(moves.map((m) => m.kind)).toEqual(["retry", "drafted-fixes"]);
  });
});

describe("computeNextMoves — verify is available as soon as an audit is done", () => {
  const audit = run({
    id: "aud",
    kind: "audit",
    status: "done",
    finished_at: "2026-07-01T09:00:00Z",
  });

  it("offers the verify move the moment the audit finishes, with no waiting period", () => {
    const moves = computeNextMoves(
      input({ now: Date.parse("2026-07-01T09:00:01Z"), runs: [audit] }),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].kind).toBe("verify-open");
    expect(moves[0].text).toBe("Metricly's audit is done. Run verify to measure your shipped fixes.");
    expect(moves[0].cta).toBe("Run verify");
    expect(moves[0].href).toBe("/app/run/aud");
  });

  it("never renders an unlock date: the verify-coming state is gone", () => {
    const moves = computeNextMoves(
      input({ now: Date.parse("2026-07-01T09:00:01Z"), runs: [audit] }),
    );
    for (const m of moves) {
      expect(m.kind).not.toBe("verify-coming");
      expect(m.text).not.toMatch(/unlocks/i);
    }
  });

  it("offers it on any plan — plan no longer gates a move", () => {
    for (const plan of ["pro", "audit", "none", undefined]) {
      const moves = computeNextMoves(
        input({ plan, now: Date.parse("2026-07-20T09:00:00Z"), runs: [audit] }),
      );
      expect(moves.map((m) => m.kind)).toEqual(["verify-open"]);
    }
  });

  it("falls back to created_at when finished_at is null", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-02T09:00:00Z"),
        runs: [run({ id: "aud", kind: "audit", status: "done", finished_at: null })],
      }),
    );
    expect(moves[0].kind).toBe("verify-open");
  });

  it("no completed audit ⇒ no verify move (the one thing runs.ts refuses)", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        runs: [run({ id: "aud", kind: "audit", status: "done", brand_id: "other-brand" })],
      }),
    );
    expect(moves.filter((m) => m.kind === "verify-open")).toHaveLength(0);
  });

  it("a verify already run against this baseline ⇒ the card does not repeat", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        runs: [
          audit,
          run({ id: "v1", kind: "verify", status: "done", baseline_run_id: "aud" }),
        ],
      }),
    );
    expect(moves.filter((m) => m.kind === "verify-open")).toHaveLength(0);
  });

  it("a FAILED verify does not count — the move is still offered", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        runs: [
          audit,
          run({ id: "v1", kind: "verify", status: "failed", baseline_run_id: "aud" }),
        ],
      }),
    );
    expect(moves[0].kind).toBe("verify-open");
  });
});

describe("computeNextMoves — verify movement", () => {
  const shippedAudit = run({ id: "aud", kind: "audit", status: "done", baseline_run_id: null });

  it("counts distinct newly-present qids across watch notes", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        runs: [
          shippedAudit,
          run({
            id: "v1",
            kind: "verify",
            status: "done",
            baseline_run_id: "aud",
            created_at: "2026-07-15T09:00:00Z",
            scores: {
              verify: {
                watch_notes: [
                  { newlyPresentQids: ["q01", "q02"] },
                  { newlyPresentQids: ["q02", "q07"] }, // q02 de-duped
                ],
              },
            },
          }),
        ],
      }),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].kind).toBe("verify-movement");
    expect(moves[0].text).toBe("Since you shipped: 3 answers now name you.");
    expect(moves[0].href).toBe("/app/brand/brand-a");
  });

  it("singular copy for a single moved answer", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        runs: [
          shippedAudit,
          run({
            id: "v1",
            kind: "verify",
            status: "done",
            baseline_run_id: "aud",
            created_at: "2026-07-15T09:00:00Z",
            scores: { verify: { watch_notes: [{ newlyPresentQids: ["q01"] }] } },
          }),
        ],
      }),
    );
    expect(moves[0].text).toBe("Since you shipped: 1 answer now name you.");
  });

  it("no movement (empty qids) ⇒ no movement card", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        runs: [
          shippedAudit,
          run({
            id: "v1",
            kind: "verify",
            status: "done",
            baseline_run_id: "aud",
            created_at: "2026-07-15T09:00:00Z",
            scores: { verify: { watch_notes: [{ newlyPresentQids: [] }] } },
          }),
        ],
      }),
    );
    expect(moves).toHaveLength(0);
  });
});

describe("computeNextMoves — de-dupe and the top-3 cap", () => {
  it("a brand contributes at most one move (retry wins over its verify state)", () => {
    // brand with a failed latest run AND an old audit that would otherwise be verify-open
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        runs: [
          run({ id: "aud", kind: "audit", status: "done", finished_at: "2026-07-01T09:00:00Z" }),
          run({ id: "fail", kind: "audit", status: "failed", created_at: "2026-07-18T09:00:00Z" }),
        ],
      }),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0].kind).toBe("retry");
  });

  it("never returns more than 3 cards", () => {
    const brands = ["a", "b", "c", "d", "e"].map((x) => ({ id: x, name: x.toUpperCase() }));
    const runs = brands.map((b) =>
      run({ id: `f-${b.id}`, brand_id: b.id, status: "failed", created_at: "2026-07-08T09:00:00Z" }),
    );
    const moves = computeNextMoves(input({ brands, runs, draftedFixes: 9 }));
    expect(moves).toHaveLength(3);
  });

  it("orders across types: retry, then drafted, then verify-open", () => {
    const moves = computeNextMoves(
      input({
        now: Date.parse("2026-07-20T09:00:00Z"),
        draftedFixes: 2,
        brands: [
          { id: "brand-a", name: "Metricly" },
          { id: "brand-b", name: "Plausible" },
        ],
        runs: [
          run({ id: "fa", brand_id: "brand-a", status: "failed", created_at: "2026-07-18T09:00:00Z" }),
          run({
            id: "ab",
            brand_id: "brand-b",
            kind: "audit",
            status: "done",
            finished_at: "2026-07-01T09:00:00Z",
          }),
        ],
      }),
    );
    expect(moves.map((m) => m.kind)).toEqual(["retry", "drafted-fixes", "verify-open"]);
  });
});
