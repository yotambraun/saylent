// `--notify slack,webhook,email` for `saylent verify` and `saylent history
// --digest`: compute what changed (report alerts.ts), build the versioned
// saylent.alert/v1 payload and deliver it (report alerts-deliver.ts).
//
// WHERE THE TARGETS COME FROM: environment variables, then `.env` in the
// current folder. Webhook URLs are credentials (anyone holding a Slack
// incoming-webhook URL can post to the channel), so they are never read from
// saylent.config, never printed and never written to a file.
//
//   SAYLENT_SLACK_WEBHOOK_URL   Slack incoming webhook
//   SAYLENT_WEBHOOK_URL         your own endpoint (receives the JSON payload)
//   SAYLENT_WEBHOOK_SECRET      optional HMAC secret; adds X-Saylent-Signature
//   SAYLENT_SMTP_URL            smtps://user:pass@host:465 or smtp://...:587
//   SAYLENT_ALERT_EMAIL_FROM    sender address
//   SAYLENT_ALERT_EMAIL_TO      recipient address(es), comma-separated
//
// Webhook and Slack URLs must be https to a public host. A local receiver
// (localhost, 127.0.0.0/8, ::1, http allowed) is refused unless the command
// gets --notify-allow-loopback; nothing else private is ever sent to.
//
// Sent alerts are remembered in ~/.saylent/alerts-sent.json (dedupe key,
// channel, brand domain, time; nothing else) so a re-run never repeats one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import { buildAlertPayload, computeAlerts, type AlertPayload, type AlertSide } from "@saylent/report/alerts";
import {
  ALERT_CHANNELS,
  deliverAlert,
  type AlertChannel,
  type AlertTargets,
  type DeliveryLog,
  type DeliveryRecord,
  type DeliveryResult,
} from "@saylent/report/alerts-deliver";
import { parseDotEnv, saylentHome } from "./keys";

export const NOTIFY_ENV = {
  slack: "SAYLENT_SLACK_WEBHOOK_URL",
  webhook: "SAYLENT_WEBHOOK_URL",
  webhookSecret: "SAYLENT_WEBHOOK_SECRET",
  smtp: "SAYLENT_SMTP_URL",
  emailFrom: "SAYLENT_ALERT_EMAIL_FROM",
  emailTo: "SAYLENT_ALERT_EMAIL_TO",
} as const;

export function parseNotifyFlag(raw: string | undefined): { channels: AlertChannel[] } | { error: string } {
  if (!raw) return { channels: [] };
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const bad = parts.filter((p) => !(ALERT_CHANNELS as readonly string[]).includes(p));
  if (bad.length) return { error: `--notify ${bad.join(",")}: expected ${ALERT_CHANNELS.join(", ")}` };
  return { channels: [...new Set(parts)] as AlertChannel[] };
}

export function targetsFromEnv(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): AlertTargets {
  let dot: Record<string, string> = {};
  const file = path.join(cwd, ".env");
  if (existsSync(file)) {
    try {
      dot = parseDotEnv(readFileSync(file, "utf8"));
    } catch {
      dot = {};
    }
  }
  const get = (k: string) => (env[k]?.trim() || dot[k]?.trim() || "") || null;
  const to = (get(NOTIFY_ENV.emailTo) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const smtp = get(NOTIFY_ENV.smtp);
  const from = get(NOTIFY_ENV.emailFrom);
  return {
    slack: get(NOTIFY_ENV.slack) ? { url: get(NOTIFY_ENV.slack)! } : null,
    webhook: get(NOTIFY_ENV.webhook) ? { url: get(NOTIFY_ENV.webhook)!, secret: get(NOTIFY_ENV.webhookSecret) } : null,
    email: smtp && from && to.length ? { url: smtp, from, to } : null,
  };
}

/** What is missing for a channel, named by env var, or null when ready. */
export function missingFor(channel: AlertChannel, t: AlertTargets): string | null {
  if (channel === "slack") return t.slack ? null : NOTIFY_ENV.slack;
  if (channel === "webhook") return t.webhook ? null : NOTIFY_ENV.webhook;
  return t.email ? null : `${NOTIFY_ENV.smtp}, ${NOTIFY_ENV.emailFrom} and ${NOTIFY_ENV.emailTo}`;
}

export function fileDeliveryLog(file = path.join(saylentHome(), "alerts-sent.json")): DeliveryLog {
  const read = (): DeliveryRecord[] => {
    try {
      const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
      return Array.isArray(v) ? (v as DeliveryRecord[]) : [];
    } catch {
      return [];
    }
  };
  return {
    list: async () => read(),
    add: async (rec) => {
      const all = [...read(), rec].slice(-500);
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

export function bundleSide(b: RunBundleV1): AlertSide {
  return {
    runId: b.run.id,
    finishedAt: b.run.finished_at ?? b.run.started_at ?? null,
    answers: b.answers.map((a) => ({
      qid: a.qid,
      engine: a.engine,
      question: a.question,
      qtype: a.qtype,
      ok: a.ok,
      citations: a.citations,
      verdict: a.verdict,
    })),
    corpus: b.corpus_pages,
  };
}

export function payloadForBundles(input: {
  baseline: RunBundleV1;
  current: RunBundleV1;
  type?: AlertPayload["type"];
  reportPath?: string | null;
  movementPath?: string | null;
  baselinePath?: string | null;
  now?: Date;
}): AlertPayload {
  const fileUrl = (p: string | null | undefined) => (p ? pathToFileURL(path.resolve(p)).href : null);
  const bm = input.current.brand_model;
  const brand = { name: bm.brand, domain: bm.domain, aliases: bm.aliases, competitors: bm.competitors };
  const links = {
    report: fileUrl(input.reportPath),
    movement: fileUrl(input.movementPath),
    baseline: fileUrl(input.baselinePath),
  };
  const alerts = computeAlerts({
    brand,
    baseline: bundleSide(input.baseline),
    current: bundleSide(input.current),
    links,
    sourceOverrides: input.current.sources?.overrides ?? null,
  });
  return buildAlertPayload({
    type: input.type,
    brand,
    run: { id: input.current.run.id, finishedAt: input.current.run.finished_at ?? null, kind: input.current.run.kind },
    baseline: { id: input.baseline.run.id, finishedAt: input.baseline.run.finished_at ?? null },
    alerts,
    links,
    now: input.now,
  });
}

export function formatDelivery(results: DeliveryResult[]): string[] {
  return results.map((r) => {
    const what =
      r.status === "sent"
        ? "sent"
        : r.status === "duplicate"
          ? "already sent for this run, skipped"
          : r.status === "rate_limited"
            ? "skipped: hourly limit for this brand reached"
            : r.status === "not_configured"
              ? "not configured"
              : `failed: ${r.error ?? "unknown error"}`;
    return `  Notify    ${r.channel} ${what}`;
  });
}

/** Deliver, unless nothing changed and `always` is off. Returns the lines to
 *  print. A failed delivery never changes the command's exit code. */
export async function notify(
  payload: AlertPayload,
  channels: AlertChannel[],
  opts: {
    targets?: AlertTargets;
    log?: DeliveryLog | null;
    always?: boolean;
    /** --notify-allow-loopback: let a webhook or Slack URL on this machine through */
    allowLoopback?: boolean;
    deliver?: typeof deliverAlert;
  } = {},
): Promise<string[]> {
  if (channels.length === 0) return [];
  if (payload.events.length === 0 && !opts.always) {
    return [`  Notify    nothing changed since the baseline; no alert sent`];
  }
  const targets = opts.targets ?? targetsFromEnv();
  const lines: string[] = [];
  for (const c of channels) {
    const miss = missingFor(c, targets);
    if (miss) lines.push(`  Notify    ${c} needs ${miss}`);
  }
  const ready = channels.filter((c) => !missingFor(c, targets));
  if (ready.length === 0) return lines;
  const results = await (opts.deliver ?? deliverAlert)(payload, ready, targets, {
    log: opts.log === undefined ? fileDeliveryLog() : opts.log,
    allowLoopback: opts.allowLoopback ?? false,
  });
  return [...lines, ...formatDelivery(results)];
}
