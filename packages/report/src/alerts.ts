// Alerts: what changed between a baseline run and the run that just finished,
// as a short list of events a person can act on, and the versioned payload the
// webhook, Slack and email deliveries all carry.
//
// Pure and $0: two runs' stored rows in, events out. No LLM, no network. The
// same function serves `saylent verify --notify` and the app's scheduled runs,
// so a Slack message and a webhook body can never disagree about what moved.
//
// THE RULES (stated once, documented on the Alerts docs page):
//  - recommendation gained / lost: the same question asked of the same engine
//    in both runs, both answered, and the judged mention type moved INTO or OUT
//    OF "recommended". Only when the two runs asked the same frozen question
//    set; otherwise nothing is compared and `comparable` says so.
//  - new rival: a brand the answers name now that no answer named in the
//    baseline (names compared case-insensitively, the brand itself excluded).
//  - new off-site opportunity: a domain on this run's opportunity list
//    (source intelligence: cited in answers that name a rival and not you) that
//    was not on the baseline's list.
//  - crawler errors spike: only when crawler data exists for both sides. AI-bot
//    errors + blocks reach at least CRAWLER_SPIKE_MIN and their share of AI-bot
//    hits at least doubles (or starts from zero).
// Every event carries its receipt: the question and engine, the domain, or the
// crawler window, and a link when the caller can build one.
import { engineLabel } from "@saylent/engine/surfaces";
import { sourcesFor, type SourceOverrides } from "./sources-view";

export const ALERT_SCHEMA = "saylent.alert/v1" as const;

/** Errors + blocks below this count are never called a spike. */
export const CRAWLER_SPIKE_MIN = 5;

export type AlertEventType =
  | "recommendation_gained"
  | "recommendation_lost"
  | "rival_new"
  | "opportunity_new"
  | "crawler_errors_spike";

export const ALERT_EVENT_TYPES: readonly AlertEventType[] = [
  "recommendation_gained",
  "recommendation_lost",
  "rival_new",
  "opportunity_new",
  "crawler_errors_spike",
];

export interface AlertReceipt {
  kind: "answer" | "domain" | "crawler";
  qid?: string;
  engine?: string;
  host?: string;
  /** a link the reader can open, when the caller knows where the report lives */
  url?: string | null;
}

export interface AlertEvent {
  type: AlertEventType;
  /** one plain sentence, safe to show anywhere */
  text: string;
  qid?: string;
  question?: string;
  engine?: string;
  engine_label?: string;
  before?: string;
  after?: string;
  rival?: string;
  host?: string;
  /** answers behind a rival / opportunity event */
  answers?: number;
  receipt: AlertReceipt;
}

export interface AlertAnswer {
  qid: string;
  engine: string;
  question?: string | null;
  qtype?: string | null;
  ok?: boolean | null;
  citations?: { url: string; title?: string | null }[] | null;
  verdict?: unknown;
}

export interface AlertCorpusPage {
  url: string;
  final_url?: string | null;
  title?: string | null;
  page_type?: string | null;
  brand_present?: boolean | null;
  competitors_present?: string[] | null;
}

/** The slice of a crawler report the spike rule reads (CrawlerReport totals). */
export interface AlertCrawlerWindow {
  from: string | null;
  to: string | null;
  aiBotHits: number;
  /** AI-bot responses that were 5xx */
  errors: number;
  /** AI-bot responses that were 401/403/429 or a firewall block/challenge */
  blocked: number;
}

export interface AlertSide {
  runId: string;
  finishedAt: string | null;
  answers: AlertAnswer[];
  corpus?: AlertCorpusPage[];
  crawler?: AlertCrawlerWindow | null;
}

export interface AlertBrand {
  name: string;
  domain: string;
  aliases?: string[] | null;
  competitors?: string[] | null;
}

export interface AlertLinks {
  /** the current run's report (app run page or a local report.html) */
  report?: string | null;
  /** the movement view, when there is one */
  movement?: string | null;
  /** the baseline's report */
  baseline?: string | null;
}

export interface AlertSet {
  comparable: boolean;
  events: AlertEvent[];
  summary: Record<AlertEventType, number>;
}

const mentionOf = (a: AlertAnswer): string | null => {
  const v = a.verdict as { mention_type?: unknown } | null | undefined;
  return typeof v?.mention_type === "string" ? v.mention_type : null;
};

const answered = (a: AlertAnswer) => a.ok !== false && mentionOf(a) !== null;

/** `#q-<qid>` is the dossier's anchor for a question's verdicts. */
export function answerLink(report: string | null | undefined, qid: string): string | null {
  return report ? `${report.split("#")[0]}#q-${qid}` : null;
}

function intelOf(brand: AlertBrand, side: AlertSide, overrides: SourceOverrides | null) {
  return sourcesFor({ brand, answers: side.answers.map((a) => ({ ...a, ok: a.ok !== false })), corpus: side.corpus ?? [], overrides });
}

/** Every rival an answer names (verdict.other_brands, old string[] and new
 *  {name} shapes), uncapped: the voice table keeps the top twelve, but a rival
 *  named once for the first time is exactly what an alert is for. */
function rivalsNamed(brand: AlertBrand, side: AlertSide): Map<string, { name: string; named: number; ref: { qid: string; engine: string } }> {
  const self = new Set([brand.name, ...(brand.aliases ?? [])].map((n) => n.trim().toLowerCase()));
  const out = new Map<string, { name: string; named: number; ref: { qid: string; engine: string } }>();
  const rows = side.answers.filter((a) => a.ok !== false).sort((a, b) => a.qid.localeCompare(b.qid) || a.engine.localeCompare(b.engine));
  for (const a of rows) {
    const ob = (a.verdict as { other_brands?: unknown } | null | undefined)?.other_brands;
    if (!Array.isArray(ob)) continue;
    const seen = new Set<string>();
    for (const item of ob) {
      const name = typeof item === "string" ? item : typeof (item as { name?: unknown })?.name === "string" ? (item as { name: string }).name : "";
      const key = name.trim().toLowerCase();
      if (!key || self.has(key) || seen.has(key)) continue;
      seen.add(key);
      const row = out.get(key) ?? { name: name.trim(), named: 0, ref: { qid: a.qid, engine: a.engine } };
      row.named += 1;
      out.set(key, row);
    }
  }
  return out;
}

export function computeAlerts(input: {
  brand: AlertBrand;
  baseline: AlertSide;
  current: AlertSide;
  links?: AlertLinks;
  sourceOverrides?: SourceOverrides | null;
}): AlertSet {
  const { brand, baseline, current } = input;
  const report = input.links?.report ?? null;
  const events: AlertEvent[] = [];

  // --- recommendation gained / lost (same frozen questions only) -----------
  const qidsOf = (s: AlertSide) => new Set(s.answers.map((a) => a.qid));
  const nowQ = qidsOf(current);
  const wasQ = qidsOf(baseline);
  const comparable = nowQ.size > 0 && nowQ.size === wasQ.size && [...nowQ].every((q) => wasQ.has(q));
  if (comparable) {
    const before = new Map<string, AlertAnswer>();
    for (const a of baseline.answers) if (answered(a)) before.set(`${a.qid}|${a.engine}`, a);
    const rows = current.answers
      .filter(answered)
      .slice()
      .sort((a, b) => a.qid.localeCompare(b.qid) || a.engine.localeCompare(b.engine));
    for (const a of rows) {
      const was = before.get(`${a.qid}|${a.engine}`);
      if (!was) continue;
      const b = mentionOf(was)!;
      const c = mentionOf(a)!;
      if (b === c || (b !== "recommended" && c !== "recommended")) continue;
      const gained = c === "recommended";
      const label = engineLabel(a.engine);
      const q = a.question ?? was.question ?? a.qid;
      events.push({
        type: gained ? "recommendation_gained" : "recommendation_lost",
        text: gained
          ? `${label} now recommends ${brand.name} for "${q}" (was ${b}).`
          : `${label} no longer recommends ${brand.name} for "${q}" (now ${c}).`,
        qid: a.qid,
        question: q,
        engine: a.engine,
        engine_label: label,
        before: b,
        after: c,
        receipt: { kind: "answer", qid: a.qid, engine: a.engine, url: answerLink(report, a.qid) },
      });
    }
  }

  // --- new rivals and new off-site opportunities (source intelligence) -----
  const overrides = input.sourceOverrides ?? null;
  const wasRivals = rivalsNamed(brand, baseline);
  for (const [key, v] of rivalsNamed(brand, current)) {
    if (wasRivals.has(key)) continue;
    const r = v.ref;
    events.push({
      type: "rival_new",
      text: `${v.name} is named in ${v.named} answer${v.named === 1 ? "" : "s"}; no answer named it in the baseline.`,
      rival: v.name,
      answers: v.named,
      qid: r.qid,
      engine: r.engine,
      engine_label: engineLabel(r.engine),
      receipt: { kind: "answer", qid: r.qid, engine: r.engine, url: answerLink(report, r.qid) },
    });
  }
  const nowIntel = intelOf(brand, current, overrides);
  const wasIntel = intelOf(brand, baseline, overrides);
  const wasOpps = new Set(wasIntel.opportunities.map((o) => o.host));
  for (const o of nowIntel.opportunities) {
    if (wasOpps.has(o.host)) continue;
    const r = o.receipts[0];
    events.push({
      type: "opportunity_new",
      text: `${o.host} is a new off-site opportunity: cited in ${o.evidence} answer${o.evidence === 1 ? "" : "s"} that name a rival and not you.`,
      host: o.host,
      answers: o.evidence,
      ...(r ? { qid: r.qid, engine: r.engine, engine_label: engineLabel(r.engine) } : {}),
      receipt: { kind: "domain", host: o.host, ...(r ? { qid: r.qid, engine: r.engine } : {}), url: report ? `${report.split("#")[0]}#sources` : null },
    });
  }

  // --- crawler errors spike (only with crawler data on both sides) ---------
  const cNow = current.crawler;
  const cWas = baseline.crawler;
  if (cNow && cWas && cNow.aiBotHits > 0) {
    const badNow = cNow.errors + cNow.blocked;
    const badWas = cWas.errors + cWas.blocked;
    const rateNow = badNow / cNow.aiBotHits;
    const rateWas = cWas.aiBotHits > 0 ? badWas / cWas.aiBotHits : 0;
    if (badNow >= CRAWLER_SPIKE_MIN && (rateWas === 0 || rateNow >= 2 * rateWas)) {
      events.push({
        type: "crawler_errors_spike",
        text: `AI bots hit ${badNow} errors or blocks in ${cNow.aiBotHits} requests (${pct(rateNow)}), up from ${badWas} in ${cWas.aiBotHits} (${pct(rateWas)}).`,
        receipt: { kind: "crawler", url: null },
      });
    }
  }

  const summary = Object.fromEntries(ALERT_EVENT_TYPES.map((t) => [t, 0])) as Record<AlertEventType, number>;
  for (const e of events) summary[e.type] += 1;
  return { comparable, events, summary };
}

const pct = (r: number) => {
  const p = r * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};

/* ------------------------------ the payload ------------------------------- */

export interface AlertPayload {
  schema: typeof ALERT_SCHEMA;
  /** stable for the same brand, run and events: the dedupe key */
  id: string;
  type: "run.changed" | "digest.weekly";
  sent_at: string;
  brand: { name: string; domain: string };
  run: { id: string; finished_at: string | null; kind?: string };
  baseline: { id: string; finished_at: string | null } | null;
  comparable: boolean;
  summary: Record<AlertEventType, number>;
  events: AlertEvent[];
  /** events beyond the cap, counted, never silently dropped */
  more_events: number;
  links: AlertLinks;
}

/** Events per payload. The rest are counted in `more_events`. */
export const MAX_EVENTS = 25;

/** The deterministic identity of an alert: FNV-1a over brand, run and the
 *  event keys. Pure (no crypto), so the browser bundle can import this file. */
export function alertId(parts: { domain: string; runId: string; type: string; events: AlertEvent[] }): string {
  const key = [
    parts.type,
    parts.domain,
    parts.runId,
    ...parts.events.map((e) => [e.type, e.qid ?? "", e.engine ?? "", e.rival ?? "", e.host ?? ""].join(":")),
  ].join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `al_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function buildAlertPayload(input: {
  type?: AlertPayload["type"];
  brand: AlertBrand;
  run: { id: string; finishedAt: string | null; kind?: string };
  baseline: { id: string; finishedAt: string | null } | null;
  alerts: AlertSet;
  links?: AlertLinks;
  now?: Date;
}): AlertPayload {
  const type = input.type ?? "run.changed";
  const events = input.alerts.events.slice(0, MAX_EVENTS);
  return {
    schema: ALERT_SCHEMA,
    id: alertId({ domain: input.brand.domain, runId: input.run.id, type, events: input.alerts.events }),
    type,
    sent_at: (input.now ?? new Date()).toISOString(),
    // whitelisted fields only: nothing from config, env or keys can ride along
    brand: { name: input.brand.name, domain: input.brand.domain },
    run: { id: input.run.id, finished_at: input.run.finishedAt, ...(input.run.kind ? { kind: input.run.kind } : {}) },
    baseline: input.baseline ? { id: input.baseline.id, finished_at: input.baseline.finishedAt } : null,
    comparable: input.alerts.comparable,
    summary: input.alerts.summary,
    events,
    more_events: Math.max(0, input.alerts.events.length - events.length),
    links: {
      report: input.links?.report ?? null,
      movement: input.links?.movement ?? null,
      baseline: input.links?.baseline ?? null,
    },
  };
}

/** One headline for every channel: counts first, never a score. */
export function alertHeadline(p: AlertPayload): string {
  if (p.run.id === "test") return `${p.brand.name}: a test alert from saylent. Delivery works.`;
  const s = p.summary;
  const parts: string[] = [];
  if (s.recommendation_gained) parts.push(`${s.recommendation_gained} recommendation${s.recommendation_gained === 1 ? "" : "s"} gained`);
  if (s.recommendation_lost) parts.push(`${s.recommendation_lost} lost`);
  if (s.rival_new) parts.push(`${s.rival_new} new rival${s.rival_new === 1 ? "" : "s"}`);
  if (s.opportunity_new) parts.push(`${s.opportunity_new} new off-site opportunit${s.opportunity_new === 1 ? "y" : "ies"}`);
  if (s.crawler_errors_spike) parts.push("AI-bot errors spiked");
  const what = p.type === "digest.weekly" ? "this week" : "since the baseline";
  return parts.length
    ? `${p.brand.name}: ${parts.join(", ")} ${what}`
    : `${p.brand.name}: nothing moved ${what}`;
}

/* ------------------------------ Slack blocks ------------------------------ */

const SLACK_TEXT_MAX = 3000;
const SLACK_HEADER_MAX = 150;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const EVENT_MARK: Record<AlertEventType, string> = {
  recommendation_gained: "▲",
  recommendation_lost: "▼",
  rival_new: "＋",
  opportunity_new: "◆",
  crawler_errors_spike: "!",
};

/** A Slack incoming-webhook message (Block Kit). Limits per Slack's docs
 *  (checked 2026-11-02): 50 blocks, header text 150 chars, section text 3000;
 *  `text` is the notification fallback. */
export function slackMessage(p: AlertPayload): { text: string; blocks: unknown[] } {
  const headline = alertHeadline(p);
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: clip(headline, SLACK_HEADER_MAX), emoji: false } },
  ];
  if (!p.comparable && p.type === "run.changed") {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "The two runs did not ask the same questions, so recommendations were not compared." }],
    });
  }
  for (const e of p.events.slice(0, 20)) {
    const link = e.receipt.url ? ` <${e.receipt.url}|receipt>` : e.qid ? ` (${e.qid}${e.engine_label ? ` · ${e.engine_label}` : ""})` : "";
    blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(`${EVENT_MARK[e.type]} ${slackEscape(e.text)}${link}`, SLACK_TEXT_MAX) } });
  }
  const more = p.more_events + Math.max(0, p.events.length - 20);
  if (more > 0) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `+${more} more in the report.` }] });
  const linkParts = [
    p.links.movement ? `<${p.links.movement}|Movement>` : null,
    p.links.report ? `<${p.links.report}|Report>` : null,
  ].filter(Boolean);
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `${linkParts.length ? `${linkParts.join(" · ")} · ` : ""}saylent · ${p.brand.domain} · run ${p.run.id.slice(0, 8)}` }],
  });
  return { text: clip(headline, 3900), blocks };
}

/* --------------------------------- email ---------------------------------- */

/** Plain-text email body (the subject is alertHeadline). */
export function alertEmailText(p: AlertPayload): string {
  const lines = [alertHeadline(p), ""];
  if (!p.comparable && p.type === "run.changed") {
    lines.push("The two runs did not ask the same questions, so recommendations were not compared.", "");
  }
  for (const e of p.events) lines.push(`- ${e.text}${e.receipt.url ? `\n  ${e.receipt.url}` : e.qid ? ` (${e.qid}${e.engine_label ? `, ${e.engine_label}` : ""})` : ""}`);
  if (p.more_events) lines.push(`- +${p.more_events} more in the report`);
  lines.push("");
  if (p.links.movement) lines.push(`Movement: ${p.links.movement}`);
  if (p.links.report) lines.push(`Report: ${p.links.report}`);
  lines.push(`Run ${p.run.id} · ${p.brand.domain}`);
  return lines.join("\n");
}
