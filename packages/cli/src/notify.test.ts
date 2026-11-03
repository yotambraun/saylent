// The CLI side of alerts: flag parsing, targets from env/.env (never config),
// the payload built from two saved runs, the file-backed dedupe log, and the
// digest's run pairing.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { readBundle } from "@saylent/engine/bundle";
import { digestPair } from "./commands/history";
import { fileDeliveryLog, missingFor, notify, parseNotifyFlag, payloadForBundles, targetsFromEnv } from "./notify";

// A report path as the platform spells it ("/tmp/x" is "D:\tmp\x" on Windows).
const reportFile = path.resolve("/tmp/x/report.html");
const reportUrl = pathToFileURL(reportFile).href;

const kestrel = () => readBundle(JSON.parse(readFileSync(path.resolve(process.cwd(), "examples/kestrel/run.json"), "utf8")));
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "saylent-notify-"));

describe("parseNotifyFlag", () => {
  it("accepts the three channels, dedupes, and names a bad one", () => {
    expect(parseNotifyFlag("slack, webhook,slack")).toEqual({ channels: ["slack", "webhook"] });
    expect(parseNotifyFlag(undefined)).toEqual({ channels: [] });
    expect(parseNotifyFlag("slack,sms")).toEqual({ error: "--notify sms: expected webhook, slack, email" });
  });
});

describe("targetsFromEnv", () => {
  it("reads env first, then .env, and needs all three email settings", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, ".env"), "SAYLENT_WEBHOOK_URL=https://dotenv.example/hook\nSAYLENT_SMTP_URL=smtps://u:p@mail.example\n");
    const t = targetsFromEnv({ SAYLENT_SLACK_WEBHOOK_URL: "https://hooks.slack.com/x", SAYLENT_ALERT_EMAIL_FROM: "a@b.example" }, dir);
    expect(t.slack).toEqual({ url: "https://hooks.slack.com/x" });
    expect(t.webhook).toEqual({ url: "https://dotenv.example/hook", secret: null });
    expect(t.email).toBeNull();
    expect(missingFor("email", t)).toBe("SAYLENT_SMTP_URL, SAYLENT_ALERT_EMAIL_FROM and SAYLENT_ALERT_EMAIL_TO");
    const full = targetsFromEnv({ SAYLENT_ALERT_EMAIL_FROM: "a@b.example", SAYLENT_ALERT_EMAIL_TO: "x@y.example, z@y.example" }, dir);
    expect(full.email).toEqual({ url: "smtps://u:p@mail.example", from: "a@b.example", to: ["x@y.example", "z@y.example"] });
  });
});

describe("payloadForBundles", () => {
  it("is quiet for the same run twice and links receipts to the local report", () => {
    const b = kestrel();
    const p = payloadForBundles({ baseline: b, current: b, reportPath: reportFile });
    expect(p.events).toEqual([]);
    expect(p.links.report).toBe(reportUrl);
    if (process.platform !== "win32") expect(reportUrl).toBe("file:///tmp/x/report.html");
  });

  it("names a lost recommendation with a file:// receipt", () => {
    const base = kestrel();
    const cur = kestrel();
    const rec = cur.answers.find((a) => a.verdict?.mention_type === "recommended")!;
    rec.verdict = { ...rec.verdict!, mention_type: "listed" };
    const p = payloadForBundles({ baseline: base, current: cur, reportPath: reportFile });
    const lost = p.events.find((e) => e.type === "recommendation_lost")!;
    expect(lost.qid).toBe(rec.qid);
    expect(lost.receipt.url).toBe(`${reportUrl}#q-${rec.qid}`);
  });
});

describe("notify", () => {
  const payload = () => {
    const base = kestrel();
    const cur = kestrel();
    const rec = cur.answers.find((a) => a.verdict?.mention_type === "recommended")!;
    rec.verdict = { ...rec.verdict!, mention_type: "absent" };
    return payloadForBundles({ baseline: base, current: cur });
  };

  it("sends nothing when nothing changed, unless asked to", async () => {
    const b = kestrel();
    const quiet = payloadForBundles({ baseline: b, current: b });
    let calls = 0;
    const deliver = (async () => (calls++, [])) as never;
    expect(await notify(quiet, ["slack"], { targets: { slack: { url: "https://h.example" } }, deliver, log: null })).toEqual([
      "  Notify    nothing changed since the baseline; no alert sent",
    ]);
    await notify(quiet, ["slack"], { targets: { slack: { url: "https://h.example" } }, deliver, log: null, always: true });
    expect(calls).toBe(1);
  });

  it("reports missing configuration by env var and delivers the rest", async () => {
    const lines = await notify(payload(), ["slack", "webhook"], {
      targets: { webhook: { url: "https://h.example" } },
      log: null,
      deliver: (async () => [{ channel: "webhook", ok: true, status: "sent" }]) as never,
    });
    expect(lines).toEqual(["  Notify    slack needs SAYLENT_SLACK_WEBHOOK_URL", "  Notify    webhook sent"]);
  });

  it("passes the loopback opt-in to delivery only when asked (--notify-allow-loopback)", async () => {
    const seen: unknown[] = [];
    const deliver = (async (_p: unknown, _c: unknown, _t: unknown, deps: { allowLoopback?: boolean }) => {
      seen.push(deps.allowLoopback);
      return [{ channel: "webhook", ok: true, status: "sent" }];
    }) as never;
    const targets = { webhook: { url: "http://localhost:8787/hook" } };
    await notify(payload(), ["webhook"], { targets, deliver, log: null });
    await notify(payload(), ["webhook"], { targets, deliver, log: null, allowLoopback: true });
    expect(seen).toEqual([false, true]);
  });

  it("remembers only the dedupe key, channel, brand and time", async () => {
    const file = path.join(tmp(), "alerts-sent.json");
    const log = fileDeliveryLog(file);
    await log.add({ key: "slack:al_1", channel: "slack", brand: "acme.example", at: "2026-11-02T00:00:00Z" });
    expect(await log.list()).toEqual([{ key: "slack:al_1", channel: "slack", brand: "acme.example", at: "2026-11-02T00:00:00Z" }]);
  });
});

describe("digestPair", () => {
  it("pairs the newest run with the newest one at least N days older", () => {
    const dir = tmp();
    for (const d of ["2026-10-01", "2026-10-20", "2026-10-28", "2026-11-02"]) {
      mkdirSync(path.join(dir, d));
      writeFileSync(path.join(dir, d, "run.json"), "{}");
    }
    const p = digestPair(dir, 7)!;
    expect(path.basename(path.dirname(p.current))).toBe("2026-11-02");
    expect(path.basename(path.dirname(p.baseline))).toBe("2026-10-20");
    expect(path.basename(path.dirname(digestPair(dir, 60)!.baseline))).toBe("2026-10-01");
    expect(digestPair(tmp(), 7)).toBeNull();
  });
});
