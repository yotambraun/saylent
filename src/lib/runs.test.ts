// createRun is the ONE run-creation path, and on a self-hosted deployment it has
// no entitlement to check: no plans, no credits, no "you're out of audits". These
// tests pin (a) the smoke hard guard and (b) the first-operator scenario the old
// credit gate refused — a brand-new account with no plan and no credit rows must
// be able to start its first audit.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// A minimal Supabase-shaped double. Every builder method chains; `maybeSingle`,
// `single` and a bare `await` all resolve through one `resolve(table, ops)`
// callback, so a test only has to say what each table answers. `ops` carries the
// method names called, which is how the double tells an insert from a read.
// ---------------------------------------------------------------------------
interface QueryResult {
  data?: unknown;
  count?: number;
  error?: { code?: string; message?: string } | null;
}

const touchedTables: string[] = [];
const sentEvents: unknown[] = [];
/** Every row handed to .insert(), so a test can read the run row that was written. */
const insertedRows: { table: string; row: Record<string, unknown> }[] = [];
let answer: (table: string, ops: string[]) => QueryResult = () => ({ data: null });

function makeAdmin() {
  return {
    from(table: string) {
      touchedTables.push(table);
      const ops: string[] = [];
      const builder: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "then") {
              const result = answer(table, ops);
              return (onOk: (r: QueryResult) => unknown) => Promise.resolve(result).then(onOk);
            }
            if (prop === "maybeSingle" || prop === "single") {
              return async () => answer(table, ops);
            }
            ops.push(prop);
            return (...args: unknown[]) => {
              if (prop === "insert") {
                insertedRows.push({ table, row: (args[0] ?? {}) as Record<string, unknown> });
              }
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
}

vi.mock("@/inngest/client", () => ({
  inngest: {
    send: async (e: unknown) => {
      sentEvents.push(e);
    },
  },
}));
/** Mutable operator settings so a test can trip the kill switch or lower the
 *  ceiling. vi.hoisted keeps it initialized before the mock factory runs. */
const settings = vi.hoisted(() => ({
  runsPaused: false,
  dailySpendCapUsd: 20,
  pausedWrites: [] as boolean[],
}));
vi.mock("./app-settings", () => ({
  getAppSettings: async () => ({
    runsPaused: settings.runsPaused,
    dailySpendCapUsd: settings.dailySpendCapUsd,
  }),
  setRunsPaused: async (v: boolean) => {
    settings.pausedWrites.push(v);
  },
}));
vi.mock("./demo-mode", () => ({ assertNotDemo: () => null }));
vi.mock("./blocked-domains", () => ({ blockedDomainReason: async () => null }));
vi.mock("./db", () => ({ stampRunSnapshot: async () => {} }));
vi.mock("./supabase/admin", () => ({ createAdminClient: () => makeAdmin() }));

const { createRun, projectedSpendUsd, resolveRunProfile, retryRun, RUN_COST_ESTIMATE_USD } =
  await import("./runs");

beforeEach(() => {
  settings.runsPaused = false;
  settings.dailySpendCapUsd = 20;
  settings.pausedWrites.length = 0;
});

describe("resolveRunProfile — the smoke hard guard", () => {
  const base = { wantsSmoke: true, isProduction: false };

  it("env asks for smoke, non-production → smoke", () => {
    expect(resolveRunProfile(base)).toBe("smoke");
  });
  it("env does not ask for smoke → full", () => {
    expect(resolveRunProfile({ ...base, wantsSmoke: false })).toBe("full");
  });
  it("production ALWAYS gets full, even when the env asks for smoke", () => {
    expect(resolveRunProfile({ ...base, isProduction: true })).toBe("full");
  });
});

describe("createRun — the first operator is never refused", () => {
  /** A fresh deployment: one brand, no runs at all, no profile/credit rows. */
  function freshDeployment(opts: { doneAudit?: boolean } = {}) {
    answer = (table, ops) => {
      if (table === "brands") {
        return {
          data: {
            id: "brand-1",
            user_id: "user-1",
            domain: "example.com",
            // Onboarding requires both fields now — a real brand
            // never reaches createRun without them. Fixtures model that, so
            // these tests exercise the budget/entitlement guards, not the
            // placeholder guard (covered on its own in placeholder-guard.test.ts).
            category: "uptime monitoring",
            icp: "SRE teams",
            question_set: null,
          },
        };
      }
      if (table === "runs") {
        if (ops.includes("insert")) return { data: { id: "run-1" }, error: null };
        // the baseline lookup (verify) is the one read that wants a single row
        if (ops.includes("order")) {
          return opts.doneAudit
            ? { data: { id: "audit-1", finished_at: null, profile: "full" } }
            : { data: null };
        }
        // today's spend (an array) + the concurrency/throttle counts
        return { data: [], count: 0 };
      }
      return { data: null };
    };
  }

  beforeEach(() => {
    touchedTables.length = 0;
    sentEvents.length = 0;
    insertedRows.length = 0;
    freshDeployment();
  });

  it("creates the first audit for an account with no plan and no credit rows", async () => {
    const result = await createRun({ userId: "user-1", brandId: "brand-1", kind: "audit" });

    expect(result).toEqual({ ok: true, runId: "run-1" });
    expect(sentEvents).toEqual([
      { name: "audit/run.requested", data: { runId: "run-1", userId: "user-1" } },
    ]);
  });

  it("never reads a plan, a credit balance, or the credit ledger", async () => {
    await createRun({ userId: "user-1", brandId: "brand-1", kind: "audit" });

    expect(touchedTables).not.toContain("profiles");
    expect(touchedTables).not.toContain("credit_balances");
    expect(touchedTables).not.toContain("credit_ledger");
  });

  it("runs a verify with no waiting period once an audit is done", async () => {
    freshDeployment({ doneAudit: true });

    const result = await createRun({ userId: "user-1", brandId: "brand-1", kind: "verify" });

    expect(result).toEqual({ ok: true, runId: "run-1" });
  });

  it("refuses a verify only when there is no completed audit to compare against", async () => {
    const result = await createRun({ userId: "user-1", brandId: "brand-1", kind: "verify" });

    expect(result).toEqual({ ok: false, reason: "No completed audit to compare against." });
  });
});

describe("createRun — T3 run options ride on the run row", () => {
  const draft = {
    samples: 3,
    engines: ["chatgpt", "gemini"],
    skip: { drafts: true },
    updated_at: "2026-09-10T00:00:00.000Z",
  };

  /** A brand carrying a saved draft from the questions tab. */
  function brandWithDraft() {
    answer = (table, ops) => {
      if (table === "brands") {
        return {
          data: {
            id: "brand-1",
            user_id: "user-1",
            domain: "example.com",
            category: "uptime monitoring",
            icp: "SRE teams",
            question_set: null,
            run_options: draft,
          },
        };
      }
      if (table === "runs") {
        if (ops.includes("insert")) return { data: { id: "run-1" }, error: null };
        if (ops.includes("order")) return { data: { id: "audit-1", finished_at: null, profile: "full" } };
        return { data: [], count: 0 };
      }
      return { data: null };
    };
  }

  beforeEach(() => {
    touchedTables.length = 0;
    sentEvents.length = 0;
    insertedRows.length = 0;
    brandWithDraft();
  });

  const runRow = () => insertedRows.find((r) => r.table === "runs")?.row ?? {};

  it("uses the draft stored on the brand when the caller passes none", async () => {
    // The dashboard CTA, the API and the crons all call createRun without a
    // blob; the owner's saved choices still have to be what gets asked.
    await createRun({ userId: "user-1", brandId: "brand-1", kind: "audit" });
    expect(runRow().run_options).toEqual(draft);
  });

  it("lets an explicit blob win, so the questions tab never races its own write", async () => {
    const explicit = { samples: 1, updated_at: "2026-09-10T01:00:00.000Z" };
    await createRun({ userId: "user-1", brandId: "brand-1", kind: "audit", runOptions: explicit });
    expect(runRow().run_options).toEqual(explicit);
  });

  it("stamps nothing on a verify, which must re-ask the frozen baseline", async () => {
    await createRun({ userId: "user-1", brandId: "brand-1", kind: "verify" });
    expect(runRow().run_options).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The daily spend ceiling only ever summed FINISHED runs.
// est_cost_usd is written when a run completes, so twenty runs started in the
// same minute all saw a $0 total and all sailed through; the ceiling only
// noticed after the money was gone.
// ---------------------------------------------------------------------------
describe("projectedSpendUsd — in-flight runs count against the ceiling (#15)", () => {
  it("was $0 before the fix: three queued runs with no recorded cost", () => {
    const burst = [
      { est_cost_usd: null, status: "queued", profile: "full" },
      { est_cost_usd: null, status: "running", profile: "full" },
      { est_cost_usd: null, status: "queued", profile: "full" },
    ];
    // the old sum
    expect(burst.reduce((s, r) => s + Number(r.est_cost_usd ?? 0), 0)).toBe(0);
    // what the ceiling sees now
    expect(projectedSpendUsd(burst)).toBe(RUN_COST_ESTIMATE_USD.full * 3);
  });

  it("counts a smoke run at the smoke estimate", () => {
    expect(projectedSpendUsd([{ est_cost_usd: null, status: "running", profile: "smoke" }])).toBe(
      RUN_COST_ESTIMATE_USD.smoke,
    );
  });

  it("a realized cost wins over the estimate", () => {
    expect(projectedSpendUsd([{ est_cost_usd: "7.25", status: "done", profile: "full" }])).toBe(7.25);
    expect(projectedSpendUsd([{ est_cost_usd: 1.5, status: "running", profile: "full" }])).toBe(1.5);
  });

  it("ignores failed/cancelled runs that never recorded a cost", () => {
    expect(projectedSpendUsd([{ est_cost_usd: null, status: "failed", profile: "full" }])).toBe(0);
  });
});

describe("createRun — a burst cannot outrun the ceiling (#15)", () => {
  beforeEach(() => {
    touchedTables.length = 0;
    sentEvents.length = 0;
    insertedRows.length = 0;
    settings.dailySpendCapUsd = 5;
    answer = (table, ops) => {
      if (table === "brands") {
        return {
          data: {
            id: "brand-1",
            user_id: "user-1",
            domain: "example.com",
            category: "uptime monitoring",
            icp: "SRE teams",
            question_set: null,
          },
        };
      }
      if (table === "runs") {
        if (ops.includes("insert")) return { data: { id: "run-1" }, error: null };
        if (ops.includes("order")) return { data: null };
        // today's runs: three full audits in flight, none with a cost yet
        if (ops.includes("gte") && !ops.includes("eq")) {
          return {
            data: [
              { est_cost_usd: null, status: "queued", profile: "full" },
              { est_cost_usd: null, status: "running", profile: "full" },
              { est_cost_usd: null, status: "queued", profile: "full" },
            ],
          };
        }
        return { data: [], count: 0 };
      }
      return { data: null };
    };
  });

  it("refuses and trips the kill switch while $9 of work is already in flight", async () => {
    const result = await createRun({ userId: "user-1", brandId: "brand-1", kind: "audit" });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("daily spend ceiling");
    expect(settings.pausedWrites).toEqual([true]);
    expect(sentEvents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// retryRun re-dispatches a run (a real provider spend) and used
// to check NOTHING: not the kill switch, not the ceiling, not the throttle. A
// failed run was an unlimited spend button.
// ---------------------------------------------------------------------------
describe("retryRun — the same cost controls as createRun (#7)", () => {
  /** `spend` = today's run rows; `recent` = the throttle count for this brand. */
  function failedRun(opts: { spend?: unknown[]; recent?: number } = {}) {
    answer = (table, ops) => {
      if (table !== "runs") return { data: null };
      if (ops.includes("update")) return { data: null, error: null };
      if (ops.includes("gte") && ops.includes("eq")) return { data: [], count: opts.recent ?? 0 };
      if (ops.includes("gte")) return { data: opts.spend ?? [] };
      return {
        data: { id: "run-1", status: "failed", user_id: "user-1", brand_id: "brand-1", kind: "audit" },
      };
    };
  }

  beforeEach(() => {
    touchedTables.length = 0;
    sentEvents.length = 0;
    insertedRows.length = 0;
    failedRun();
  });

  it("still retries a failed run when nothing is tripped", async () => {
    expect(await retryRun("user-1", "run-1")).toEqual({ ok: true, runId: "run-1" });
    expect(sentEvents).toEqual([
      { name: "audit/run.requested", data: { runId: "run-1", userId: "user-1" } },
    ]);
  });

  it("refuses under the global kill switch", async () => {
    settings.runsPaused = true;

    const result = await retryRun("user-1", "run-1");

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("paused");
    expect(sentEvents).toEqual([]);
  });

  it("refuses when today's spend (in-flight included) is at the ceiling", async () => {
    settings.dailySpendCapUsd = 2;
    failedRun({ spend: [{ est_cost_usd: null, status: "running", profile: "full" }] });

    const result = await retryRun("user-1", "run-1");

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("daily spend ceiling");
    expect(settings.pausedWrites).toEqual([true]);
    expect(sentEvents).toEqual([]);
  });

  it("refuses when the brand's rolling-window throttle is used up", async () => {
    failedRun({ recent: 99 });

    const result = await retryRun("user-1", "run-1");

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain("limit of");
    expect(sentEvents).toEqual([]);
  });
});
