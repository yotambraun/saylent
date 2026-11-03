// Alerts over the real Kestrel Uptime capture (fixtures/run.json): the baseline
// is the capture as recorded, the "current" run is the same capture with a few
// verdicts and citations changed, so every event below is traceable to one
// edited row.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALERT_SCHEMA,
  CRAWLER_SPIKE_MIN,
  alertEmailText,
  alertHeadline,
  alertId,
  buildAlertPayload,
  computeAlerts,
  slackMessage,
  type AlertAnswer,
  type AlertSide,
} from "./alerts";

interface Fixture {
  brand: { name: string; domain: string; aliases: string[]; competitors: string[] };
  answers: (AlertAnswer & { verdict: { mention_type?: string; other_brands?: { name: string; why: string }[] } | null })[];
  corpus_pages: { url: string }[];
}
const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), "fixtures/run.json"), "utf8")) as Fixture;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const side = (runId: string, answers = clone(fixture.answers)): AlertSide => ({
  runId,
  finishedAt: "2026-11-01T10:00:00Z",
  answers,
  corpus: clone(fixture.corpus_pages) as AlertSide["corpus"],
});

function edited() {
  const answers = clone(fixture.answers);
  const find = (qid: string, engine: string) => answers.find((a) => a.qid === qid && a.engine === engine)!;
  find("q01", "chatgpt").verdict!.mention_type = "recommended"; // gained
  find("q18", "claude").verdict!.mention_type = "listed"; // lost
  find("q02", "gemini").verdict!.other_brands = [
    ...(find("q02", "gemini").verdict!.other_brands ?? []),
    { name: "Zephyr Watch", why: "cheapest" },
  ]; // a rival no baseline answer named
  return answers;
}

describe("computeAlerts", () => {
  it("is quiet when nothing changed", () => {
    const a = computeAlerts({ brand: fixture.brand, baseline: side("b"), current: side("c") });
    expect(a.comparable).toBe(true);
    expect(a.events).toEqual([]);
  });

  it("names gained and lost recommendations per question and engine, with receipts", () => {
    const a = computeAlerts({
      brand: fixture.brand,
      baseline: side("b"),
      current: side("c", edited()),
      links: { report: "https://app.example/app/run/c?view=full" },
    });
    const gained = a.events.find((e) => e.type === "recommendation_gained")!;
    expect(gained).toMatchObject({ qid: "q01", engine: "chatgpt", engine_label: "ChatGPT", before: "absent", after: "recommended" });
    expect(gained.receipt.url).toBe("https://app.example/app/run/c?view=full#q-q01");
    const lost = a.events.find((e) => e.type === "recommendation_lost")!;
    expect(lost).toMatchObject({ qid: "q18", engine: "claude", before: "recommended", after: "listed" });
    expect(lost.text).toContain("Claude no longer recommends Kestrel Uptime");
    expect(a.summary.recommendation_gained).toBe(1);
    expect(a.summary.recommendation_lost).toBe(1);
  });

  it("flags a rival no baseline answer named", () => {
    const a = computeAlerts({ brand: fixture.brand, baseline: side("b"), current: side("c", edited()) });
    const rival = a.events.find((e) => e.type === "rival_new");
    expect(rival?.rival).toBe("Zephyr Watch");
    expect(rival?.receipt).toMatchObject({ kind: "answer", qid: "q02", engine: "gemini" });
  });

  it("flags a new off-site opportunity when a domain joins the list", () => {
    const base = clone(fixture.answers).map((a) => ({ ...a, citations: [] }));
    const a = computeAlerts({ brand: fixture.brand, baseline: side("b", base), current: side("c") });
    const opps = a.events.filter((e) => e.type === "opportunity_new");
    expect(opps.length).toBeGreaterThan(0);
    expect(opps[0].host).toBeTruthy();
    expect(opps[0].text).toMatch(/is a new off-site opportunity: cited in \d+ answers? that name a rival and not you\./);
  });

  it("never compares recommendations across different question sets", () => {
    const current = clone(edited()).filter((a) => a.qid !== "q10");
    const a = computeAlerts({ brand: fixture.brand, baseline: side("b"), current: side("c", current) });
    expect(a.comparable).toBe(false);
    expect(a.events.some((e) => e.type.startsWith("recommendation_"))).toBe(false);
  });

  it("calls a crawler spike only above the floor and at double the rate", () => {
    const run = (now: { errors: number; blocked: number; aiBotHits: number }, was: { errors: number; blocked: number; aiBotHits: number }) =>
      computeAlerts({
        brand: fixture.brand,
        baseline: { ...side("b"), crawler: { from: null, to: null, ...was } },
        current: { ...side("c"), crawler: { from: null, to: null, ...now } },
      }).events.filter((e) => e.type === "crawler_errors_spike");
    expect(run({ errors: 2, blocked: 2, aiBotHits: 100 }, { errors: 0, blocked: 0, aiBotHits: 100 })).toHaveLength(0);
    expect(run({ errors: CRAWLER_SPIKE_MIN, blocked: 0, aiBotHits: 100 }, { errors: 0, blocked: 0, aiBotHits: 100 })).toHaveLength(1);
    expect(run({ errors: 6, blocked: 0, aiBotHits: 100 }, { errors: 4, blocked: 0, aiBotHits: 100 })).toHaveLength(0);
    const spike = run({ errors: 10, blocked: 10, aiBotHits: 100 }, { errors: 5, blocked: 0, aiBotHits: 100 });
    expect(spike[0].text).toBe("AI bots hit 20 errors or blocks in 100 requests (20%), up from 5 in 100 (5%).");
    // no crawler data on one side: no event
    expect(computeAlerts({ brand: fixture.brand, baseline: side("b"), current: { ...side("c"), crawler: { from: null, to: null, errors: 50, blocked: 0, aiBotHits: 60 } } }).events).toEqual([]);
  });
});

describe("the payload", () => {
  const alerts = computeAlerts({
    brand: fixture.brand,
    baseline: side("b"),
    current: side("c", edited()),
    links: { report: "https://app.example/app/run/run-c" },
  });
  const payload = buildAlertPayload({
    brand: { ...fixture.brand, secret: "sk-should-never-appear" } as never,
    run: { id: "run-c", finishedAt: "2026-11-02T09:00:00Z", kind: "verify" },
    baseline: { id: "run-b", finishedAt: "2026-10-01T09:00:00Z" },
    alerts,
    links: { report: "https://app.example/app/run/run-c" },
    now: new Date("2026-11-02T09:01:00Z"),
  });

  it("is versioned, whitelisted and deterministic", () => {
    expect(payload.schema).toBe(ALERT_SCHEMA);
    expect(payload.brand).toEqual({ name: "Kestrel Uptime", domain: fixture.brand.domain });
    expect(JSON.stringify(payload)).not.toContain("sk-");
    expect(payload.id).toBe(alertId({ domain: fixture.brand.domain, runId: "run-c", type: "run.changed", events: alerts.events }));
    expect(payload.id).toMatch(/^al_[0-9a-f]{16}$/);
    expect(Object.keys(payload).sort()).toEqual(
      ["baseline", "brand", "comparable", "events", "id", "links", "more_events", "run", "schema", "sent_at", "summary", "type"].sort(),
    );
  });

  it("reads as counts in the headline, Slack blocks and email", () => {
    expect(alertHeadline(payload)).toBe("Kestrel Uptime: 1 recommendation gained, 1 lost, 1 new rival since the baseline");
    const slack = slackMessage(payload);
    expect(slack.text).toBe(alertHeadline(payload));
    expect((slack.blocks[0] as { type: string }).type).toBe("header");
    expect(slack.blocks.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(slack.blocks)).toContain("<https://app.example/app/run/run-c#q-q01|receipt>");
    const email = alertEmailText(payload);
    expect(email).toContain("https://app.example/app/run/run-c#q-q01");
    expect(email).toContain("Run run-c");
  });

  it("caps events and counts the rest", () => {
    const many = { ...alerts, events: Array.from({ length: 40 }, () => alerts.events[0]) };
    const p = buildAlertPayload({ brand: fixture.brand, run: { id: "r", finishedAt: null }, baseline: null, alerts: many });
    expect(p.events).toHaveLength(25);
    expect(p.more_events).toBe(15);
  });
});
