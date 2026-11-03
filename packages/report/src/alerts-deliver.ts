// Alert delivery: a signed generic webhook, a Slack incoming webhook and plain
// SMTP email, for one AlertPayload (alerts.ts). Node-only (crypto, net, tls):
// the CLI's `verify --notify` and the app's Inngest functions import it; the
// browser never does.
//
// SAFETY RULES
//  - The payload is built from whitelisted fields (buildAlertPayload); nothing
//    here adds config, env or key material to a body.
//  - A webhook URL is a secret (Slack's is a bearer credential), so no error
//    message, log line or result ever contains a URL or a password.
//  - A webhook or Slack URL is typed in by a person, and the server that sends
//    to it must not become a way into the network it runs in. https only;
//    private, loopback, link-local, reserved and encoded-IP hosts are refused
//    when the URL is checked (checkTargetUrl), and again at send time by the
//    engine's guarded safePost, which resolves the host, refuses a private
//    answer and pins the socket to the vetted address. Redirects are never
//    followed: a 3xx is a failed delivery. Loopback (127.0.0.0/8, ::1,
//    localhost, http allowed) opens only with an explicit opt-in for local
//    development, `allowLoopback`: the CLI sets it from
//    --notify-allow-loopback, the app from SAYLENT_ALERTS_ALLOW_LOOPBACK.
//  - Dedupe: the same payload id is never sent twice on one channel. Rate
//    limit: at most `maxPerHour` sends per channel per brand.
//  - Delivery never throws: every channel returns {ok, error?} and the caller
//    reports it; a failed alert must never fail a run.
import { createHmac, randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import {
  checkHostResolvesPublic,
  isBlockedHost,
  isLoopbackHost,
  safePost,
  type HostLookup,
  type SafePostResult,
} from "@saylent/engine/util";
import { alertEmailText, alertHeadline, slackMessage, type AlertPayload } from "./alerts";

export type AlertChannel = "webhook" | "slack" | "email";
export const ALERT_CHANNELS: readonly AlertChannel[] = ["webhook", "slack", "email"];

export interface DeliveryResult {
  channel: AlertChannel;
  ok: boolean;
  /** "sent", "duplicate" (already sent), "rate_limited", "not_configured" */
  status: "sent" | "duplicate" | "rate_limited" | "not_configured" | "failed";
  error?: string;
}

/** What webhook and Slack delivery take besides the target: the loopback
 *  opt-in, and seams for tests (a resolver, the retry wait). There is no
 *  transport seam: every send goes through the guarded safePost. */
export interface PostDeps {
  /** let loopback targets through (local development only); default false */
  allowLoopback?: boolean;
  lookup?: HostLookup;
  wait?: (ms: number) => Promise<void>;
}

/* ------------------------------- signing ---------------------------------- */

export const SIGNATURE_HEADER = "X-Saylent-Signature";

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. A receiver
 *  recomputes v1 with its copy of the secret, compares in constant time and
 *  rejects a timestamp older than its tolerance (we suggest 5 minutes). */
export function signBody(body: string, secret: string, t: number = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** The receiver side, exported for tests and for the docs' example. */
export function verifySignature(body: string, header: string, secret: string, opts: { now?: number; toleranceSec?: number } = {}): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header.trim());
  if (!m) return false;
  const t = Number(m[1]);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? 300)) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  if (expected.length !== m[2].length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}

/* ------------------------------ url safety -------------------------------- */

export interface TargetUrlPolicy {
  /** accept loopback targets (http allowed) for local development; default false */
  allowLoopback?: boolean;
}

/** The synchronous check of a webhook or Slack URL, when it is saved and
 *  again before every send. null when the URL may be used, else the reason,
 *  phrased to follow the field's name ("Webhook URL must be an https URL").
 *  It judges the URL as parsed, so decimal, octal and hex spellings of an
 *  address (2130706433, 0177.0.0.1, 0x7f.1) are judged as the address they
 *  are. */
export function checkTargetUrl(raw: string, policy: TargetUrlPolicy = {}): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "is not a valid URL";
  }
  if (isLoopbackHost(u.hostname)) {
    if (!policy.allowLoopback) {
      return "points at a loopback address (this machine), which is refused unless loopback alerts are turned on for local development";
    }
    return u.protocol === "https:" || u.protocol === "http:" ? null : "must be an http or https URL";
  }
  if (u.protocol !== "https:") return "must be an https URL";
  if (isBlockedHost(u.hostname)) return "points at a private, link-local or reserved address";
  return null;
}

/** checkTargetUrl, then resolve the host and refuse it when it does not
 *  resolve or answers with a private, loopback or link-local address. A
 *  usability check when a URL is saved: DNS can change afterwards, so the
 *  send-time check in safePost stays the real defence. */
export async function checkTargetUrlResolved(
  raw: string,
  policy: TargetUrlPolicy & { lookup?: HostLookup } = {},
): Promise<string | null> {
  const bad = checkTargetUrl(raw, policy);
  if (bad) return bad;
  const judged = await checkHostResolvesPublic(new URL(raw).hostname, policy);
  if (judged === "unresolved") return "has a host that does not resolve";
  if (judged === "private_address") return "has a host that resolves to a private, loopback or link-local address";
  return null;
}

const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  // strip anything URL- or credential-shaped from a transport error
  return m.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>").slice(0, 200);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One guarded POST (10s timeout, redirects not followed), with one retry on
 *  429/5xx honouring Retry-After up to 5 seconds. A refused or failed send
 *  (status 0) and a 3xx are not retried. */
async function postWithRetry(url: string, headers: () => Record<string, string>, body: string, deps: PostDeps): Promise<SafePostResult> {
  const send = () => safePost(url, { headers: headers(), body, timeoutMs: 10_000, lookup: deps.lookup, allowLoopback: deps.allowLoopback });
  let res = await send();
  if (res.status === 429 || res.status >= 500) {
    const ra = Number(res.headers?.get("retry-after") ?? "1");
    await (deps.wait ?? sleep)(Math.min(5, Number.isFinite(ra) && ra > 0 ? ra : 1) * 1000);
    res = await send();
  }
  return res;
}

/** The error for a send that was refused, failed in transport or was
 *  redirected; null for any other status. */
function guardError(label: string, res: SafePostResult): string | null {
  if (res.status === 0) return `${label} not sent: ${errText(res.error ?? "unknown error")}`;
  if (res.status >= 300 && res.status < 400) {
    return `${label} answered HTTP ${res.status}, a redirect; alerts do not follow redirects, so use the final URL`;
  }
  return null;
}

/* ------------------------------- channels --------------------------------- */

export async function sendWebhook(
  payload: AlertPayload,
  target: { url: string; secret?: string | null },
  deps: PostDeps = {},
): Promise<DeliveryResult> {
  const bad = checkTargetUrl(target.url, deps);
  if (bad) return { channel: "webhook", ok: false, status: "failed", error: `webhook URL ${bad}` };
  const body = JSON.stringify(payload);
  const res = await postWithRetry(
    target.url,
    () => ({
      "content-type": "application/json",
      "user-agent": "saylent-alerts/1",
      "x-saylent-event": payload.type,
      "x-saylent-delivery": payload.id,
      "x-saylent-schema": payload.schema,
      ...(target.secret ? { [SIGNATURE_HEADER.toLowerCase()]: signBody(body, target.secret) } : {}),
    }),
    body,
    deps,
  );
  if (res.status >= 200 && res.status < 300) return { channel: "webhook", ok: true, status: "sent" };
  const error = guardError("webhook", res) ?? `webhook answered HTTP ${res.status}`;
  return { channel: "webhook", ok: false, status: "failed", error };
}

export async function sendSlack(
  payload: AlertPayload,
  target: { url: string },
  deps: PostDeps = {},
): Promise<DeliveryResult> {
  const bad = checkTargetUrl(target.url, deps);
  if (bad) return { channel: "slack", ok: false, status: "failed", error: `Slack webhook URL ${bad}` };
  const body = JSON.stringify(slackMessage(payload));
  const res = await postWithRetry(target.url, () => ({ "content-type": "application/json" }), body, deps);
  if (res.status === 200) return { channel: "slack", ok: true, status: "sent" };
  const guarded = guardError(res.status === 0 ? "Slack webhook" : "Slack", res);
  if (guarded) return { channel: "slack", ok: false, status: "failed", error: guarded };
  // Slack's error bodies are short codes (invalid_payload, no_service, ...)
  const text = res.text.trim();
  return { channel: "slack", ok: false, status: "failed", error: `Slack answered HTTP ${res.status}${/^[a-z_]{2,40}$/.test(text) ? ` ${text}` : ""}` };
}

/* --------------------------------- SMTP ----------------------------------- */

export interface SmtpTarget {
  /** smtps://user:pass@host:465 (implicit TLS) or smtp://user:pass@host:587
   *  (STARTTLS required, except on localhost) */
  url: string;
  from: string;
  to: string[];
}

export interface SmtpConnect {
  (opts: { host: string; port: number; tls: boolean }): Promise<net.Socket | tls.TLSSocket>;
}

const defaultConnect: SmtpConnect = ({ host, port, tls: useTls }) =>
  new Promise((resolve, reject) => {
    const s = useTls ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    s.once(useTls ? "secureConnect" : "connect", () => resolve(s));
    s.once("error", reject);
  });

/** RFC 2047 encoded-word for a non-ASCII subject. */
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const ADDRESS = /^[^\s<>@,;:"]+@[^\s<>@,;:"]+$/;

class SmtpSession {
  private buf = "";
  private waiters: ((line: string) => void)[] = [];
  private lines: string[] = [];
  constructor(public sock: net.Socket | tls.TLSSocket) {
    this.attach();
  }
  attach() {
    this.sock.setEncoding("utf8");
    this.sock.on("data", (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        const w = this.waiters.shift();
        if (w) w(line);
        else this.lines.push(line);
      }
    });
  }
  private nextLine(timeoutMs: number): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("SMTP server timed out")), timeoutMs);
      this.waiters.push((l) => {
        clearTimeout(t);
        resolve(l);
      });
    });
  }
  /** a full (possibly multi-line) reply: code + text lines */
  async reply(timeoutMs = 20_000): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      const l = await this.nextLine(timeoutMs);
      lines.push(l.slice(4));
      if (l.length < 4 || l[3] !== "-") return { code: Number(l.slice(0, 3)), lines };
    }
  }
  async cmd(line: string, expect: number[]): Promise<{ code: number; lines: string[] }> {
    this.sock.write(`${line}\r\n`);
    const r = await this.reply();
    if (!expect.includes(r.code)) {
      const verb = line.split(" ")[0].replace(/:.*/, "");
      throw new Error(`SMTP ${verb} refused (${r.code})`);
    }
    return r;
  }
}

export async function sendSmtp(
  payload: AlertPayload,
  target: SmtpTarget,
  deps: { connect?: SmtpConnect; now?: Date } = {},
): Promise<DeliveryResult> {
  let u: URL;
  try {
    u = new URL(target.url);
  } catch {
    return { channel: "email", ok: false, status: "failed", error: "SMTP URL is not valid (smtps://user:pass@host:465 or smtp://user:pass@host:587)" };
  }
  if (u.protocol !== "smtps:" && u.protocol !== "smtp:") {
    return { channel: "email", ok: false, status: "failed", error: "SMTP URL must start with smtps:// or smtp://" };
  }
  if (!ADDRESS.test(target.from) || target.to.length === 0 || !target.to.every((t) => ADDRESS.test(t))) {
    return { channel: "email", ok: false, status: "failed", error: "email from/to must be plain addresses (name@example.com)" };
  }
  const implicitTls = u.protocol === "smtps:";
  const host = u.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const port = Number(u.port || (implicitTls ? 465 : 587));
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  const connect = deps.connect ?? defaultConnect;
  let session: SmtpSession | null = null;
  try {
    session = new SmtpSession(await connect({ host, port, tls: implicitTls }));
    const greet = await session.reply();
    if (greet.code !== 220) throw new Error(`SMTP greeting ${greet.code}`);
    let ehlo = await session.cmd("EHLO saylent", [250]);
    if (!implicitTls) {
      const canStartTls = ehlo.lines.some((l) => /^STARTTLS\b/i.test(l));
      if (canStartTls) {
        await session.cmd("STARTTLS", [220]);
        const plain = session.sock;
        plain.removeAllListeners("data");
        const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
          const s = tls.connect({ socket: plain as net.Socket, servername: host });
          s.once("secureConnect", () => resolve(s));
          s.once("error", reject);
        });
        session = new SmtpSession(secure);
        ehlo = await session.cmd("EHLO saylent", [250]);
      } else if (!local) {
        throw new Error("SMTP server offers no STARTTLS; refusing to send credentials in clear text (use smtps://)");
      }
    }
    if (user) {
      const token = Buffer.from(`\0${user}\0${pass}`, "utf8").toString("base64");
      await session.cmd(`AUTH PLAIN ${token}`, [235]);
    }
    await session.cmd(`MAIL FROM:<${target.from}>`, [250]);
    for (const to of target.to) await session.cmd(`RCPT TO:<${to}>`, [250, 251]);
    await session.cmd("DATA", [354]);
    const date = (deps.now ?? new Date()).toUTCString();
    const body = alertEmailText(payload)
      .replace(/\r?\n/g, "\r\n")
      .split("\r\n")
      .map((l) => (l.startsWith(".") ? `.${l}` : l))
      .join("\r\n");
    const msg = [
      `From: ${target.from}`,
      `To: ${target.to.join(", ")}`,
      `Subject: ${encodeHeader(alertHeadline(payload))}`,
      `Date: ${date}`,
      `Message-ID: <${randomUUID()}@saylent.local>`,
      `X-Saylent-Delivery: ${payload.id}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      body,
      ".",
    ].join("\r\n");
    await session.cmd(msg, [250]);
    await session.cmd("QUIT", [221]).catch(() => undefined);
    session.sock.end();
    return { channel: "email", ok: true, status: "sent" };
  } catch (e) {
    session?.sock.destroy();
    return { channel: "email", ok: false, status: "failed", error: errText(e) };
  }
}

/* ------------------------- dedupe and rate limit -------------------------- */

export interface DeliveryRecord {
  key: string;
  channel: AlertChannel;
  brand: string;
  at: string;
}

/** Where sent alerts are remembered: a JSON file for the CLI, a table in the
 *  app. Only the dedupe key, channel, brand domain and time are stored. */
export interface DeliveryLog {
  list(): Promise<DeliveryRecord[]>;
  add(rec: DeliveryRecord): Promise<void>;
}

export const DEFAULT_MAX_PER_HOUR = 6;

export async function gate(
  log: DeliveryLog,
  channel: AlertChannel,
  payload: AlertPayload,
  opts: { maxPerHour?: number; now?: Date } = {},
): Promise<"ok" | "duplicate" | "rate_limited"> {
  const now = (opts.now ?? new Date()).getTime();
  const recs = await log.list();
  const key = `${channel}:${payload.id}`;
  if (recs.some((r) => r.key === key)) return "duplicate";
  const recent = recs.filter((r) => r.channel === channel && r.brand === payload.brand.domain && now - Date.parse(r.at) < 3_600_000);
  if (recent.length >= (opts.maxPerHour ?? DEFAULT_MAX_PER_HOUR)) return "rate_limited";
  return "ok";
}

export interface AlertTargets {
  webhook?: { url: string; secret?: string | null } | null;
  slack?: { url: string } | null;
  email?: SmtpTarget | null;
}

/** Send one payload to every requested channel, through the dedupe/rate gate.
 *  `send.email` lets the app hand email to its own provider instead of SMTP. */
export async function deliverAlert(
  payload: AlertPayload,
  channels: AlertChannel[],
  targets: AlertTargets,
  deps: {
    log?: DeliveryLog | null;
    /** loopback webhook/Slack targets, for local development; default false */
    allowLoopback?: boolean;
    lookup?: HostLookup;
    connect?: SmtpConnect;
    wait?: (ms: number) => Promise<void>;
    maxPerHour?: number;
    now?: Date;
    sendEmail?: (payload: AlertPayload) => Promise<boolean>;
  } = {},
): Promise<DeliveryResult[]> {
  const out: DeliveryResult[] = [];
  for (const channel of [...new Set(channels)]) {
    const configured =
      channel === "webhook" ? !!targets.webhook?.url : channel === "slack" ? !!targets.slack?.url : !!(targets.email || deps.sendEmail);
    if (!configured) {
      out.push({ channel, ok: false, status: "not_configured" });
      continue;
    }
    if (deps.log) {
      const g = await gate(deps.log, channel, payload, { maxPerHour: deps.maxPerHour, now: deps.now });
      if (g !== "ok") {
        out.push({ channel, ok: g === "duplicate", status: g });
        continue;
      }
    }
    let r: DeliveryResult;
    if (channel === "webhook") r = await sendWebhook(payload, targets.webhook!, deps);
    else if (channel === "slack") r = await sendSlack(payload, targets.slack!, deps);
    else if (deps.sendEmail && !targets.email) {
      const ok = await deps.sendEmail(payload).catch(() => false);
      r = ok ? { channel, ok, status: "sent" } : { channel, ok, status: "failed", error: "the email provider did not accept the message" };
    } else r = await sendSmtp(payload, targets.email!, deps);
    if (r.ok && deps.log) {
      await deps.log.add({ key: `${channel}:${payload.id}`, channel, brand: payload.brand.domain, at: (deps.now ?? new Date()).toISOString() });
    }
    out.push(r);
  }
  return out;
}
