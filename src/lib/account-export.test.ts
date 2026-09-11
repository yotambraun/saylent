// The GDPR data-export manifest is pure, so pin it.
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES, buildExportFilename } from "./account-export";

describe("EXPORT_TABLES", () => {
  it("covers every user-owned table the spec lists", () => {
    // profile is exported separately (keyed by id); these are the user_id tables.
    expect([...EXPORT_TABLES]).toEqual([
      "brands",
      "runs",
      "answers",
      "corpus_pages",
      "domain_checks",
      "fixes",
      "notifications",
      "credit_ledger",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(EXPORT_TABLES).size).toBe(EXPORT_TABLES.length);
  });
});

describe("buildExportFilename", () => {
  it("date-stamps the filename (YYYY-MM-DD)", () => {
    const name = buildExportFilename(new Date("2026-07-16T09:30:00Z"));
    expect(name).toBe("saylent-export-2026-07-16.json");
  });

  it("always ends in .json", () => {
    expect(buildExportFilename()).toMatch(/^saylent-export-\d{4}-\d{2}-\d{2}\.json$/);
  });
});
