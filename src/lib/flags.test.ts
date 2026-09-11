// Env-driven feature flags.
import { describe, expect, it } from "vitest";
import { FLAG_DEFAULTS, LEGACY_ENV_ALIASES, resolveFlag } from "./flags";

describe("resolveFlag", () => {
  it("returns the typed default when the env var is unset", () => {
    expect(resolveFlag("emails", {})).toBe(FLAG_DEFAULTS.emails);
    expect(resolveFlag("scheduledRuns", {})).toBe(FLAG_DEFAULTS.scheduledRuns);
  });

  it("maps camelCase flag names to FLAG_UPPER_SNAKE env vars", () => {
    expect(resolveFlag("scheduledRuns", { FLAG_SCHEDULED_RUNS: "0" })).toBe(false);
    expect(resolveFlag("scheduledRuns", { FLAG_SCHEDULED_RUNS: "1" })).toBe(true);
  });

  it("honors every truthy spelling", () => {
    for (const v of ["1", "true", "on", "yes", "TRUE", "On"]) {
      expect(resolveFlag("emails", { FLAG_EMAILS: v })).toBe(true);
    }
  });

  it("honors every falsy spelling", () => {
    for (const v of ["0", "false", "off", "no", "FALSE", "Off"]) {
      expect(resolveFlag("emails", { FLAG_EMAILS: v })).toBe(false);
    }
  });

  it("falls back to the default (fail-safe) on an unrecognized value", () => {
    expect(resolveFlag("emails", { FLAG_EMAILS: "maybe" })).toBe(FLAG_DEFAULTS.emails);
  });

  it("treats a blank value as unset", () => {
    expect(resolveFlag("scheduledRuns", { FLAG_SCHEDULED_RUNS: "   " })).toBe(
      FLAG_DEFAULTS.scheduledRuns,
    );
  });

  it("honors the one-release legacy alias for the renamed scheduled-runs flag", () => {
    const legacy = LEGACY_ENV_ALIASES.scheduledRuns![0];
    expect(resolveFlag("scheduledRuns", { [legacy]: "1" })).toBe(true);
    expect(resolveFlag("scheduledRuns", { [legacy]: "0" })).toBe(false);
    // The canonical name wins whenever it is set.
    expect(resolveFlag("scheduledRuns", { FLAG_SCHEDULED_RUNS: "0", [legacy]: "1" })).toBe(false);
    expect(resolveFlag("scheduledRuns", { FLAG_SCHEDULED_RUNS: "1", [legacy]: "0" })).toBe(true);
    // A blank canonical value falls through to the alias.
    expect(resolveFlag("scheduledRuns", { FLAG_SCHEDULED_RUNS: "", [legacy]: "1" })).toBe(true);
  });

  it("coveAudit defaults OFF and is driven by FLAG_COVE_AUDIT", () => {
    expect(FLAG_DEFAULTS.coveAudit).toBe(false);
    expect(resolveFlag("coveAudit", {})).toBe(false);
    expect(resolveFlag("coveAudit", { FLAG_COVE_AUDIT: "1" })).toBe(true);
    expect(resolveFlag("coveAudit", { FLAG_COVE_AUDIT: "off" })).toBe(false);
  });
});
