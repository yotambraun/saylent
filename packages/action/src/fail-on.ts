// fail_on input parsing + the job-failure decision: fails the job
// only when search-index or user-fetch bots are blocked; training-bot blocks are a
// WARN — a legitimate choice. Deliberately narrower than `overall` in GateResult:
// `overall` (badge/output "result") reflects EVERY finding (JSON-LD, meta, etc. too),
// but the job's exit code only ever reacts to a "fail" status on a class the caller
// opted into via fail_on - never to a "warn", and never to JSON-LD/meta findings
// directly (those already show up in a class's own findings when they overlap, and
// in `other` otherwise).
import type { ClassKind, ClassRow } from "./types";

export const VALID_CLASSES: ClassKind[] = ["training", "search", "user"];
export const DEFAULT_FAIL_ON = "search,user";

export function parseFailOn(input: string): Set<ClassKind> {
  const set = new Set<ClassKind>();
  for (const raw of (input || "").split(",")) {
    const kind = raw.trim().toLowerCase();
    if ((VALID_CLASSES as string[]).includes(kind)) set.add(kind as ClassKind);
  }
  return set;
}

/** true only when a class the caller listed in fail_on is actually BLOCKED
 *  (status "fail"); an unreachable/inconclusive probe ("warn") never fails the job. */
export function shouldFailJob(classes: ClassRow[], failOn: Set<ClassKind>): boolean {
  return classes.some((c) => failOn.has(c.kind) && c.status === "fail");
}
