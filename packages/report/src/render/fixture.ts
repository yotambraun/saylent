// Turn a captured fixture (scripts/capture-fixture.ts output, the same payload
// scripts/seed-fixture-run.ts inserts) into the ReportData the renderers take.
// Kept in the package so the $0 fixture render and its golden test read one
// mapping, and the CLI can reuse it for a bundle captured off a live run.
import type { ReportData } from "./types";

/** The captured fixture is the raw insert payload: no DB-generated ids, no
 *  run id, no created_at. Give every row a stable synthetic id so receipts
 *  resolve exactly as they do against a seeded run. */
export function fixtureToReportData(fx: Record<string, unknown>): ReportData {
  const run = fx.run as Record<string, unknown>;
  const brand = fx.brand as Record<string, unknown>;
  const captured = (fx.captured_at as string) ?? new Date().toISOString();
  const finished = (run.finished_at as string) ?? captured;

  const answers = (fx.answers as Record<string, unknown>[]).map((a, i) => ({
    ...a,
    id: `a${String(i).padStart(3, "0")}`,
    created_at: (a.created_at as string) ?? finished,
  }));
  const corpus = (fx.corpus_pages as Record<string, unknown>[]).map((p, i) => ({
    ...p,
    id: `p${String(i).padStart(3, "0")}`,
  }));
  const checks = (fx.domain_checks as Record<string, unknown>[]).map((c, i) => ({
    ...c,
    id: `c${String(i).padStart(3, "0")}`,
  }));
  const fixes = (fx.fixes as Record<string, unknown>[]).map((f, i) => ({
    ...f,
    id: `f${String(i).padStart(3, "0")}`,
  }));

  return {
    run: {
      ...run,
      id: "fixture-run",
      created_at: captured,
      finished_at: finished,
      error: (run.error as string) ?? null,
    },
    brand: {
      name: brand.name as string,
      domain: brand.domain as string,
      aliases: (brand.aliases as string[]) ?? [],
      competitors: (brand.competitors as string[]) ?? [],
      authorized_at: null,
    },
    answers,
    corpus,
    checks,
    fixes,
  } as unknown as ReportData;
}
