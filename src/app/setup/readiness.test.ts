import { describe, expect, it } from "vitest";
import { computeReadiness, setupRequiresAdmin, type ReadinessInput } from "./readiness";

const PROVIDERS: ReadinessInput["providers"] = [
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", present: true },
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", present: false },
  { id: "gemini", label: "Gemini", envVar: "GEMINI_API_KEY", present: false },
  { id: "perplexity", label: "Perplexity", envVar: "PERPLEXITY_API_KEY", present: false },
];

function baseInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    db: "up",
    migrations: { total: 42, applied: 42, latest: "0042_foo.sql", missing: [] },
    authMethods: ["password", "magic-link"],
    providers: PROVIDERS,
    admins: { known: true, count: 1, anyProfiles: true },
    inngest: { configuredKeys: false, reachable: true, target: "http://localhost:8288" },
    email: { resendApiKey: false, emailFrom: false },
    budget: { dailySpendCapUsd: 50, brandLimit: 5 },
    ...overrides,
  };
}

describe("computeReadiness", () => {
  it("is ready when the database is up, migrations are applied, and one required provider key is set", () => {
    const { ready, rows } = computeReadiness(baseInput());
    expect(ready).toBe(true);
    expect(rows.find((r) => r.id === "database")?.status).toBe("ok");
    expect(rows.find((r) => r.id === "migrations")?.status).toBe("ok");
    // an absent optional provider (gemini/perplexity) never blocks readiness
    expect(rows.find((r) => r.id === "provider-gemini")?.status).toBe("warn");
  });

  it("is not ready when the database is down, and names the exact env vars", () => {
    const { ready, rows } = computeReadiness(baseInput({ db: "down", migrations: null }));
    expect(ready).toBe(false);
    const dbRow = rows.find((r) => r.id === "database");
    expect(dbRow?.status).toBe("error");
    expect(dbRow?.fix?.envVar).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(dbRow?.fix?.href).toMatch(/^https:\/\//);
    // migrations can't be checked when the db itself is down — warn, not error
    expect(rows.find((r) => r.id === "migrations")?.status).toBe("warn");
  });

  it("flags missing migrations as an error naming the exact files and the apply command", () => {
    const { ready, rows } = computeReadiness(
      baseInput({
        migrations: { total: 42, applied: 40, latest: "0042_foo.sql", missing: ["0041_a.sql", "0042_foo.sql"] },
      }),
    );
    expect(ready).toBe(false);
    const row = rows.find((r) => r.id === "migrations");
    expect(row?.status).toBe("error");
    expect(row?.detail).toContain("0041_a.sql");
    expect(row?.detail).toContain("0042_foo.sql");
    expect(row?.fix?.command).toBe("npm run db:migrate");
  });

  it("warns (does not fail) when the migrations marker table itself is missing", () => {
    const { rows } = computeReadiness(
      baseInput({
        migrations: { total: 42, applied: 0, latest: "0042_foo.sql", missing: [], note: "public._migrations not found" },
      }),
    );
    const row = rows.find((r) => r.id === "migrations");
    expect(row?.status).toBe("warn");
    expect(row?.detail).toBe("public._migrations not found");
  });

  it("errors when neither required provider key is set, and is fine when only one is", () => {
    const noneSet = computeReadiness(
      baseInput({
        providers: PROVIDERS.map((p) => ({ ...p, present: false })),
      }),
    );
    expect(noneSet.ready).toBe(false);
    expect(noneSet.rows.find((r) => r.id === "provider-openai")?.status).toBe("error");
    expect(noneSet.rows.find((r) => r.id === "provider-anthropic")?.status).toBe("error");

    const oneSet = computeReadiness(baseInput()); // openai present, anthropic absent
    expect(oneSet.ready).toBe(true);
    expect(oneSet.rows.find((r) => r.id === "provider-anthropic")?.status).toBe("warn");
  });

  it("marks an unreachable Inngest as a warning in local dev (no keys configured)", () => {
    const { ready, rows } = computeReadiness(
      baseInput({ inngest: { configuredKeys: false, reachable: false, target: "http://localhost:8288" } }),
    );
    expect(ready).toBe(true);
    expect(rows.find((r) => r.id === "inngest")?.status).toBe("warn");
  });

  it("marks an unreachable Inngest as an error once keys are configured", () => {
    const { ready, rows } = computeReadiness(
      baseInput({ inngest: { configuredKeys: true, reachable: false, target: "Inngest Cloud" } }),
    );
    expect(ready).toBe(false);
    const row = rows.find((r) => r.id === "inngest");
    expect(row?.status).toBe("error");
    expect(row?.fix?.envVar).toContain("INNGEST_SIGNING_KEY");
  });

  it("never blocks readiness on email being unconfigured", () => {
    const { ready, rows } = computeReadiness(baseInput({ email: { resendApiKey: false, emailFrom: false } }));
    expect(ready).toBe(true);
    const row = rows.find((r) => r.id === "email");
    expect(row?.status).toBe("warn");
    expect(row?.detail).toContain("RESEND_API_KEY");
    expect(row?.detail).toContain("EMAIL_FROM");
  });

  it("always reports auth methods and budget defaults as informational ok rows", () => {
    const { rows } = computeReadiness(baseInput());
    expect(rows.find((r) => r.id === "auth-methods")?.status).toBe("ok");
    const budget = rows.find((r) => r.id === "budget");
    expect(budget?.status).toBe("ok");
    expect(budget?.detail).toContain("$50");
  });
});

describe("setupRequiresAdmin — /setup fails closed", () => {
  it("is open with no auth ONLY on a fresh deployment: profiles readable and empty", () => {
    expect(setupRequiresAdmin({ readable: true, empty: true })).toBe(false);
  });

  it("requires an admin once anybody has signed up", () => {
    expect(setupRequiresAdmin({ readable: true, empty: false })).toBe(true);
  });

  it("requires an admin when the probe failed — a DB error is never 'fresh deployment'", () => {
    expect(setupRequiresAdmin({ readable: false })).toBe(true);
  });
});

// A deployment with accounts but NO admin is one stranger's
// sign-up away from handing /admin over (migration 0040 is still armed).
describe("the operator row (#2)", () => {
  const row = (admins: ReadinessInput["admins"]) =>
    computeReadiness(baseInput({ admins })).rows.find((r) => r.id === "operator");

  it("blocks readiness when accounts exist but no admin does", () => {
    const admins = { known: true, count: 0, anyProfiles: true };
    expect(row(admins)?.status).toBe("error");
    expect(row(admins)?.detail).toMatch(/next person who signs up/i);
    expect(row(admins)?.fix?.command).toContain("grant-admin");
    expect(computeReadiness(baseInput({ admins })).ready).toBe(false);
  });

  it("is a warning, not an error, on a brand-new deployment with no accounts", () => {
    const admins = { known: true, count: 0, anyProfiles: false };
    expect(row(admins)?.status).toBe("warn");
    expect(computeReadiness(baseInput({ admins })).ready).toBe(true);
  });

  it("is ok once at least one admin exists", () => {
    expect(row({ known: true, count: 1, anyProfiles: true })?.status).toBe("ok");
    expect(row({ known: true, count: 2, anyProfiles: true })?.detail).toContain("2 admin accounts");
  });

  it("never reports a reassuring zero when the probe failed", () => {
    expect(row({ known: false, count: 0, anyProfiles: false })?.status).toBe("warn");
    expect(row({ known: false, count: 0, anyProfiles: false })?.detail).toContain("Not checked");
  });
});
