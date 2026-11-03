// Alerts & digest in the app (migration 0047). The rules, the payload and the
// transports are the packages' (@saylent/report/alerts, alerts-deliver), so a
// Slack message from the app and one from `saylent verify --notify` say the
// same thing about the same two runs. This file only reads rows, picks the
// baseline, opens the sealed targets and records what was sent.
//
// Called from Inngest (src/inngest/functions.ts): after every finished run of a
// brand whose owner turned alerts on, and from the Monday digest cron. Never
// throws into a run: every path returns a status the step logs.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  alertHeadline,
  buildAlertPayload,
  computeAlerts,
  type AlertCrawlerWindow,
  type AlertPayload,
  type AlertSide,
} from "@saylent/report/alerts";
import {
  deliverAlert,
  type AlertChannel,
  type AlertTargets,
  type DeliveryLog,
  type DeliveryRecord,
  type DeliveryResult,
} from "@saylent/report/alerts-deliver";
import { alertsAllowLoopback } from "./alert-targets";
import { sendEmail } from "./email";
import { log } from "./log";
import { open } from "./secret-box";
import { readSourceOverrides } from "./source-history";

export interface AlertSettingsRow {
  brand_id: string;
  user_id: string;
  on_run: boolean;
  weekly_digest: boolean;
  email: boolean;
  slack_url_sealed: string | null;
  webhook_url_sealed: string | null;
  webhook_secret_sealed: string | null;
}

export interface RunRow {
  id: string;
  brand_id: string;
  user_id: string;
  kind: string;
  status: string;
  profile: string;
  created_at: string;
  finished_at: string | null;
  baseline_run_id?: string | null;
}

/** The baseline a finished run is compared with: its own verify baseline, else
 *  the newest earlier done run of the same brand and profile. */
export function pickBaseline(run: RunRow, earlier: RunRow[]): RunRow | null {
  if (run.baseline_run_id) {
    const b = earlier.find((r) => r.id === run.baseline_run_id);
    if (b) return b;
  }
  const t = run.finished_at ?? run.created_at;
  return (
    earlier
      .filter((r) => r.id !== run.id && r.status === "done" && r.profile === run.profile && (r.finished_at ?? r.created_at) < t)
      .sort((a, b) => (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at))[0] ?? null
  );
}

/** The digest pair: the newest done run, and the newest done run at least
 *  `days` older (else the oldest). Null without a run in the last `days`. */
export function pickDigestPair(runs: RunRow[], now: Date, days = 7): { current: RunRow; baseline: RunRow } | null {
  const done = runs
    .filter((r) => r.status === "done")
    .sort((a, b) => (a.finished_at ?? a.created_at).localeCompare(b.finished_at ?? b.created_at));
  if (done.length < 2) return null;
  const current = done[done.length - 1];
  const at = Date.parse(current.finished_at ?? current.created_at);
  if (now.getTime() - at > days * 86_400_000) return null;
  const cutoff = at - days * 86_400_000;
  const older = done.slice(0, -1).filter((r) => Date.parse(r.finished_at ?? r.created_at) <= cutoff);
  const baseline = (older.length ? older[older.length - 1] : done[0]) ?? null;
  return baseline && baseline.id !== current.id ? { current, baseline } : null;
}

export function targetsFromSettings(s: AlertSettingsRow): AlertTargets {
  const slack = open(s.slack_url_sealed);
  const webhook = open(s.webhook_url_sealed);
  return {
    slack: slack ? { url: slack } : null,
    webhook: webhook ? { url: webhook, secret: open(s.webhook_secret_sealed) } : null,
    email: null,
  };
}

export function channelsFor(s: AlertSettingsRow, t: AlertTargets): AlertChannel[] {
  const out: AlertChannel[] = [];
  if (s.email) out.push("email");
  if (t.slack) out.push("slack");
  if (t.webhook) out.push("webhook");
  return out;
}

/** The delivery log on alert_deliveries: dedupe on sent keys, the hourly
 *  limit on this brand's sent rows. */
export function dbDeliveryLog(
  admin: SupabaseClient,
  ctx: { brandId: string; domain: string; userId: string; runId: string | null; kind: AlertPayload["type"] | "test"; payloadId: string },
): DeliveryLog {
  return {
    async list() {
      const since = new Date(Date.now() - 3_600_000).toISOString();
      const [recent, same] = await Promise.all([
        admin.from("alert_deliveries").select("key,channel,created_at").eq("brand_id", ctx.brandId).eq("status", "sent").gte("created_at", since),
        admin.from("alert_deliveries").select("key,channel,created_at").eq("status", "sent").like("key", `%:${ctx.payloadId}`),
      ]);
      const rows = [...(recent.data ?? []), ...(same.data ?? [])] as { key: string; channel: AlertChannel; created_at: string }[];
      return rows.map((r): DeliveryRecord => ({ key: r.key, channel: r.channel, brand: ctx.domain, at: r.created_at }));
    },
    async add(rec) {
      await admin.from("alert_deliveries").insert({
        brand_id: ctx.brandId,
        user_id: ctx.userId,
        run_id: ctx.runId,
        key: rec.key,
        channel: rec.channel,
        kind: ctx.kind,
        status: "sent",
      });
    },
  };
}

const ANSWER_COLS = "qid,engine,question,qtype,ok,citations,verdict";
const PAGE_COLS = "url,final_url,title,page_type,brand_present,competitors_present";

async function sideOf(admin: SupabaseClient, run: RunRow, crawler: AlertCrawlerWindow | null): Promise<AlertSide> {
  const [{ data: answers }, { data: corpus }] = await Promise.all([
    admin.from("answers").select(ANSWER_COLS).eq("run_id", run.id),
    admin.from("corpus_pages").select(PAGE_COLS).eq("run_id", run.id),
  ]);
  return {
    runId: run.id,
    finishedAt: run.finished_at,
    answers: (answers ?? []) as AlertSide["answers"],
    corpus: (corpus ?? []) as AlertSide["corpus"],
    crawler,
  };
}

/** The crawler windows for the spike rule: the newest uploaded report and the
 *  one before it, only when the newest arrived after the baseline finished
 *  (so the same two uploads never re-alert on every run). */
async function crawlerPair(admin: SupabaseClient, brandId: string, baselineFinished: string | null) {
  const { data } = await admin
    .from("crawler_reports")
    .select("created_at,window_from,window_to,ai_bot_hits,ai_errors,ai_blocked")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(2);
  const rows = (data ?? []) as { created_at: string; window_from: string | null; window_to: string | null; ai_bot_hits: number; ai_errors: number; ai_blocked: number }[];
  if (rows.length < 2 || (baselineFinished && rows[0].created_at < baselineFinished)) return { now: null, was: null };
  const w = (r: (typeof rows)[number]): AlertCrawlerWindow => ({ from: r.window_from, to: r.window_to, aiBotHits: r.ai_bot_hits, errors: r.ai_errors, blocked: r.ai_blocked });
  return { now: w(rows[0]), was: w(rows[1]) };
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

async function deliver(
  admin: SupabaseClient,
  payload: AlertPayload,
  settings: AlertSettingsRow,
  ctx: { runId: string | null; kind: AlertPayload["type"] | "test" },
): Promise<DeliveryResult[]> {
  const targets = targetsFromSettings(settings);
  const channels = channelsFor(settings, targets);
  if (channels.length === 0) return [];
  const { data: prof } = await admin.from("profiles").select("email").eq("id", settings.user_id).maybeSingle();
  const to = (prof as { email?: string } | null)?.email ?? null;
  const results = await deliverAlert(payload, channels, targets, {
    allowLoopback: alertsAllowLoopback(),
    log: ctx.kind === "test" ? null : dbDeliveryLog(admin, { brandId: settings.brand_id, domain: payload.brand.domain, userId: settings.user_id, runId: ctx.runId, kind: ctx.kind, payloadId: payload.id }),
    sendEmail: async (p) =>
      !!to &&
      sendEmail({
        to,
        template: "alert",
        props: {
          appUrl: appUrl(),
          brandId: settings.brand_id,
          headline: alertHeadline(p),
          events: p.events.map((e) => ({ text: e.text, url: e.receipt.url ?? null })),
          moreEvents: p.more_events,
          reportUrl: p.links.report ?? null,
          comparable: p.comparable,
          digest: p.type === "digest.weekly",
        },
      }),
  });
  for (const r of results.filter((x) => x.status === "failed")) {
    await admin.from("alert_deliveries").insert({
      brand_id: settings.brand_id,
      user_id: settings.user_id,
      run_id: ctx.runId,
      key: `${r.channel}:${payload.id}:failed:${Date.now()}`,
      channel: r.channel,
      kind: ctx.kind,
      status: "failed",
      error: (r.error ?? "failed").slice(0, 300),
    });
  }
  return results;
}

async function brandOf(admin: SupabaseClient, brandId: string) {
  const { data } = await admin.from("brands").select("id,name,domain,aliases,competitors,run_options").eq("id", brandId).maybeSingle();
  return data as { id: string; name: string; domain: string; aliases: string[] | null; competitors: string[] | null; run_options: unknown } | null;
}

async function payloadFor(
  admin: SupabaseClient,
  current: RunRow,
  baseline: RunRow,
  type: AlertPayload["type"],
): Promise<AlertPayload | null> {
  const brand = await brandOf(admin, current.brand_id);
  if (!brand) return null;
  const pair = await crawlerPair(admin, brand.id, baseline.finished_at);
  const report = appUrl() ? `${appUrl()}/app/run/${current.id}?view=full` : null;
  const links = {
    report,
    movement: current.kind === "verify" && appUrl() ? `${appUrl()}/app/run/${current.id}/verify` : null,
    baseline: appUrl() ? `${appUrl()}/app/run/${baseline.id}?view=full` : null,
  };
  const b = { name: brand.name, domain: brand.domain, aliases: brand.aliases, competitors: brand.competitors };
  const [cur, base] = await Promise.all([sideOf(admin, current, pair.now), sideOf(admin, baseline, pair.was)]);
  const alerts = computeAlerts({ brand: b, baseline: base, current: cur, links, sourceOverrides: readSourceOverrides(brand.run_options) });
  return buildAlertPayload({
    type,
    brand: b,
    run: { id: current.id, finishedAt: current.finished_at, kind: current.kind },
    baseline: { id: baseline.id, finishedAt: baseline.finished_at },
    alerts,
    links,
  });
}

const RUN_COLS = "id,brand_id,user_id,kind,status,profile,created_at,finished_at,baseline_run_id";

/** After a run finishes: alert on what changed, when the owner asked for it. */
export async function alertsForRun(admin: SupabaseClient, runId: string): Promise<{ status: string; results?: DeliveryResult[] }> {
  const { data: run } = await admin.from("runs").select(RUN_COLS).eq("id", runId).maybeSingle();
  if (!run || (run as RunRow).status !== "done") return { status: "not-done" };
  const r = run as RunRow;
  const { data: settings } = await admin.from("brand_alerts").select("*").eq("brand_id", r.brand_id).maybeSingle();
  if (!settings || !(settings as AlertSettingsRow).on_run) return { status: "off" };
  const { data: earlier } = await admin.from("runs").select(RUN_COLS).eq("brand_id", r.brand_id).eq("status", "done").order("finished_at", { ascending: false }).limit(50);
  const baseline = pickBaseline(r, (earlier ?? []) as RunRow[]);
  if (!baseline) return { status: "no-baseline" };
  const payload = await payloadFor(admin, r, baseline, "run.changed");
  if (!payload) return { status: "no-brand" };
  if (payload.events.length === 0) return { status: "nothing-changed" };
  const results = await deliver(admin, payload, settings as AlertSettingsRow, { runId: r.id, kind: "run.changed" });
  log.info("alerts delivered", { runId, results: results.map((x) => `${x.channel}:${x.status}`).join(",") });
  return { status: "delivered", results };
}

/** Monday digest: every brand with weekly_digest on and a run this week. */
export async function weeklyDigests(admin: SupabaseClient, now = new Date()): Promise<{ brands: number; sent: number }> {
  const { data: rows } = await admin.from("brand_alerts").select("*").eq("weekly_digest", true);
  let sent = 0;
  for (const s of (rows ?? []) as AlertSettingsRow[]) {
    try {
      const { data: runs } = await admin.from("runs").select(RUN_COLS).eq("brand_id", s.brand_id).eq("status", "done").order("finished_at", { ascending: false }).limit(50);
      const pair = pickDigestPair((runs ?? []) as RunRow[], now);
      if (!pair) continue;
      const payload = await payloadFor(admin, pair.current, pair.baseline, "digest.weekly");
      if (!payload) continue;
      const results = await deliver(admin, payload, s, { runId: pair.current.id, kind: "digest.weekly" });
      if (results.some((r) => r.status === "sent")) sent += 1;
    } catch (err) {
      log.warn("weekly digest failed for a brand", { brandId: s.brand_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { brands: rows?.length ?? 0, sent };
}

/** The "Send a test" button: a one-event payload, never deduped or logged. */
export async function sendTestAlert(admin: SupabaseClient, settings: AlertSettingsRow, brand: { name: string; domain: string }) {
  const payload = buildAlertPayload({
    brand,
    run: { id: "test", finishedAt: new Date().toISOString() },
    baseline: null,
    alerts: {
      comparable: true,
      summary: { recommendation_gained: 0, recommendation_lost: 0, rival_new: 0, opportunity_new: 0, crawler_errors_spike: 0 },
      events: [],
    },
    links: { report: appUrl() ? `${appUrl()}/app/brand/${settings.brand_id}` : null },
  });
  return deliver(admin, payload, settings, { runId: null, kind: "test" });
}
