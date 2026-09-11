// Split out of packages/engine/src/engine.test.ts during the open-source
// workspace move (2026-09-09): these cases exercise createDbWriter and the
// notification-copy builders, which live in this app-bound db.ts (imports
// @supabase/supabase-js) — they cannot live under packages/engine (purity
// rule: no @/* / @supabase/* imports there). Test bodies are unchanged.
import { describe, expect, it } from "vitest";
import {
  auditReadyNotice,
  createDbWriter,
  redactRunError,
  runFailedNotice,
  stampRunSnapshot,
  verifyReadyNotice,
} from "./db";

describe("notifications — exact copy, type + href", () => {
  it("audit_ready: names the brand, counts rec/answered, links to the dossier", () => {
    expect(auditReadyNotice("run-1", "Acme", 4, 7)).toEqual({
      type: "audit_ready",
      title: "Your Acme dossier is ready — recommended in 4 of 7 answers.",
      href: "/app/run/run-1",
    });
  });
  it("verify_ready: before→after movement over n, links to the verify view", () => {
    expect(verifyReadyNotice("run-2", 2, 5, 8)).toEqual({
      type: "verify_ready",
      title: "Movement measured: 2/8 → 5/8 recommended.",
      href: "/app/run/run-2/verify",
    });
  });
  it("run_failed: names the brand when it is known", () => {
    expect(runFailedNotice("run-3", "Acme")).toEqual({
      type: "run_failed",
      title: "Your Acme run hit a wall — you were not charged. Retry.",
      href: "/app/run/run-3",
    });
  });
  it("run_failed: brand-less fallback when the run dies before the brand loads", () => {
    expect(runFailedNotice("run-3")).toEqual({
      type: "run_failed",
      title: "Your run hit a wall — you were not charged. Retry.",
      href: "/app/run/run-3",
    });
  });
});

describe("notifications — notify() never fails a run", () => {
  // A minimal admin double: `from(table).upsert(row, opts)` returning whatever
  // the test wants. Cast to the writer's admin param (its Supabase type is
  // `import type`-only, so the writer never touches a real client).
  type AdminArg = Parameters<typeof createDbWriter>[0];
  const mockAdmin = (upsert: (...args: unknown[]) => unknown): AdminArg =>
    ({ from: () => ({ upsert }) }) as unknown as AdminArg;

  it("upserts the row with ignoreDuplicates on (run_id,type) for idempotency", async () => {
    const calls: unknown[][] = [];
    const admin = {
      from: (table: string) => {
        calls.push(["from", table]);
        return {
          upsert: (row: unknown, opts: unknown) => {
            calls.push(["upsert", row, opts]);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as unknown as AdminArg;
    const db = createDbWriter(admin, "user-9");
    await db.notify("run-42", "audit_ready", "Title", "/app/run/run-42");
    expect(calls[0]).toEqual(["from", "notifications"]);
    expect(calls[1]).toEqual([
      "upsert",
      { run_id: "run-42", user_id: "user-9", type: "audit_ready", title: "Title", href: "/app/run/run-42" },
      { onConflict: "run_id,type", ignoreDuplicates: true },
    ]);
  });

  it("swallows a THROWN error and resolves (a failed insert never fails the run)", async () => {
    const db = createDbWriter(
      mockAdmin(() => {
        throw new Error("boom");
      }),
      "u1",
    );
    await expect(db.notify("run-1", "audit_ready", "t", "/h")).resolves.toBeUndefined();
  });
  it("swallows a REJECTED promise and resolves", async () => {
    const db = createDbWriter(mockAdmin(() => Promise.reject(new Error("net"))), "u1");
    await expect(db.notify("run-1", "run_failed", "t", "/h")).resolves.toBeUndefined();
  });
  it("swallows a returned {error} (RLS/constraint) and resolves", async () => {
    const db = createDbWriter(
      mockAdmin(() => Promise.resolve({ error: { message: "denied" } })),
      "u1",
    );
    await expect(db.notify("run-1", "verify_ready", "t", "/h")).resolves.toBeUndefined();
  });
});

describe("stampRunSnapshot — 0041 models/template_set_version columns", () => {
  // Minimal admin double: `from("runs").update(patch).eq("id", runId)` — captures
  // the patch so each test can assert the exact partial update.
  type AdminArg = Parameters<typeof stampRunSnapshot>[0];
  function mockAdmin(result: { error: unknown } = { error: null }) {
    const calls: { table: string; patch: unknown; id: unknown }[] = [];
    const admin = {
      from: (table: string) => ({
        update: (patch: unknown) => ({
          eq: (col: string, id: unknown) => {
            calls.push({ table, patch, id: col === "id" ? id : undefined });
            return Promise.resolve(result);
          },
        }),
      }),
    } as unknown as AdminArg;
    return { admin, calls };
  }

  it("stamps models as-is (jsonb column, no serialization)", async () => {
    const { admin, calls } = mockAdmin();
    const models = { chatgpt: "gpt-5.4", claude: "claude-sonnet-4-6", brand: "claude-sonnet-4-6" };
    const ok = await stampRunSnapshot(admin, "run-1", { models });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ table: "runs", patch: { models }, id: "run-1" }]);
  });

  it("stamps templateSetVersion as text (0041 column type), even when given a number", async () => {
    const { admin, calls } = mockAdmin();
    const ok = await stampRunSnapshot(admin, "run-1", { templateSetVersion: 2 });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ table: "runs", patch: { template_set_version: "2" }, id: "run-1" }]);
  });

  it("combines both new fields with the existing 0034 fields in one partial patch", async () => {
    const { admin, calls } = mockAdmin();
    await stampRunSnapshot(admin, "run-1", {
      brandModel: { brand: "Acme" },
      models: { drafter: "claude-sonnet-4-6" },
      templateSetVersion: 2,
    });
    expect(calls[0].patch).toEqual({
      brand_model: { brand: "Acme" },
      models: { drafter: "claude-sonnet-4-6" },
      template_set_version: "2",
    });
  });

  it("no-ops (returns false, no write) when nothing is provided", async () => {
    const { admin, calls } = mockAdmin();
    const ok = await stampRunSnapshot(admin, "run-1", {});
    expect(ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("best-effort: swallows a returned {error} and resolves false", async () => {
    const { admin } = mockAdmin({ error: { message: "denied" } });
    await expect(stampRunSnapshot(admin, "run-1", { models: {} })).resolves.toBe(false);
  });
});

describe("redactRunError — the Inngest failure path never persists a live key", () => {
  it("redacts a provider key echoed back inside the error message", () => {
    const msg = redactRunError(
      new Error("401 from https://api.example.com/v1/x?" + "api_key=" + "abcd1234efgh5678 unauthorized"),
    );
    expect(msg).not.toContain("abcd1234efgh5678");
    expect(msg).toContain("[redacted]");
  });

  it("redacts an sk- shaped secret and an Authorization echo", () => {
    const msg = redactRunError(
      new Error("Bearer abcdefghijklmnopqrstuvwxyz012345 rejected for " + "sk-" + "ant-0123456789abcdefghij"),
    );
    expect(msg).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(msg).not.toContain("sk-" + "ant-0123456789abcdefghij");
  });

  it("redacts BEFORE truncating, so a half-cut key cannot survive the 500-char slice", () => {
    const secret = "sk-ant-" + "z".repeat(60);
    // a real message separates the key from the words around it; the key shapes
    // carry a left boundary so `mask-…`/`task-…` are never eaten
    const msg = redactRunError(new Error("x".repeat(479) + " " + secret));
    expect(msg.length).toBeLessThanOrEqual(500);
    expect(msg).not.toContain("sk-ant-");
    expect(msg).not.toContain("zzzz");
  });

  it("passes an ordinary message through and falls back for a non-Error throw", () => {
    expect(redactRunError(new Error("engine timed out"))).toBe("engine timed out");
    expect(redactRunError("boom")).toBe("unknown error");
    expect(redactRunError(new Error(""))).toBe("unknown error");
  });
});
