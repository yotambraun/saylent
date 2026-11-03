// App alerts: which baseline a finished run is compared with, the digest pair,
// and which channels a brand's settings turn on.
import { describe, expect, it } from "vitest";
import { channelsFor, pickBaseline, pickDigestPair, type AlertSettingsRow, type RunRow } from "./alerts";

const run = (id: string, finished: string, extra: Partial<RunRow> = {}): RunRow => ({
  id,
  brand_id: "b",
  user_id: "u",
  kind: "audit",
  status: "done",
  profile: "smoke",
  created_at: finished,
  finished_at: finished,
  ...extra,
});

describe("pickBaseline", () => {
  const runs = [run("r1", "2026-10-01T00:00:00Z"), run("r2", "2026-10-10T00:00:00Z"), run("f1", "2026-10-12T00:00:00Z", { profile: "full" })];
  it("uses a verify's own baseline", () => {
    expect(pickBaseline(run("v", "2026-11-01T00:00:00Z", { kind: "verify", baseline_run_id: "r1" }), runs)?.id).toBe("r1");
  });
  it("else the newest earlier done run of the same profile", () => {
    expect(pickBaseline(run("r3", "2026-11-01T00:00:00Z"), runs)?.id).toBe("r2");
    expect(pickBaseline(run("r0", "2026-09-01T00:00:00Z"), runs)).toBeNull();
  });
});

describe("pickDigestPair", () => {
  const runs = [run("a", "2026-10-01T00:00:00Z"), run("b", "2026-10-25T00:00:00Z"), run("c", "2026-10-30T00:00:00Z"), run("d", "2026-11-01T00:00:00Z")];
  it("pairs the newest run with the newest one a week older", () => {
    const p = pickDigestPair(runs, new Date("2026-11-02T09:30:00Z"))!;
    expect([p.baseline.id, p.current.id]).toEqual(["b", "d"]);
  });
  it("skips a brand with no run this week, or a single run", () => {
    expect(pickDigestPair(runs, new Date("2026-11-20T00:00:00Z"))).toBeNull();
    expect(pickDigestPair([runs[0]], new Date("2026-10-02T00:00:00Z"))).toBeNull();
  });
});

describe("channelsFor", () => {
  const s = (over: Partial<AlertSettingsRow>): AlertSettingsRow => ({
    brand_id: "b", user_id: "u", on_run: true, weekly_digest: false, email: false,
    slack_url_sealed: null, webhook_url_sealed: null, webhook_secret_sealed: null, ...over,
  });
  it("includes only the channels that are on and opened", () => {
    expect(channelsFor(s({ email: true }), { slack: null, webhook: null })).toEqual(["email"]);
    expect(channelsFor(s({}), { slack: { url: "https://h" }, webhook: { url: "https://w" } })).toEqual(["slack", "webhook"]);
  });
});
