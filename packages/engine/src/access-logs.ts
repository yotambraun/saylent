// Read access logs, line by line, in the formats people actually have:
//
//   combined    nginx's default `combined` and Apache's Combined Log Format:
//               $remote_addr - $remote_user [$time_local] "$request" $status
//               $body_bytes_sent "$http_referer" "$http_user_agent"
//               (https://nginx.org/en/docs/http/ngx_http_log_module.html,
//               https://httpd.apache.org/docs/2.4/logs.html). Extra trailing
//               fields (many configs append $http_x_forwarded_for) are allowed.
//   common      Apache Common: the same without referer and user agent. Parsed
//               and counted, but a line with no user agent names no bot.
//   vercel      Vercel log drains, NDJSON or a JSON array
//               (https://vercel.com/docs/drains/reference/logs): timestamp in
//               Unix ms; proxy.{method,host,path,userAgent[],statusCode,
//               clientIp,wafAction}. The dashboard's "export" format is not
//               documented; such a file is read only if it carries these fields.
//   cloudflare  Cloudflare Logpush http_requests, NDJSON
//               (https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/):
//               ClientIP, ClientRequestHost, ClientRequestMethod,
//               ClientRequestURI/ClientRequestPath, ClientRequestUserAgent,
//               EdgeResponseStatus, EdgeStartTimestamp (unixnano by the API's
//               default, RFC 3339 from the dashboard, or unix s/ms),
//               SecurityAction / SecurityActions.
// (All formats checked 2026-11-02.)
//
// The format is detected per line, so a directory mixing exports still reads.
// Files stream: gzip is detected by its magic bytes, a JSON array is split into
// objects without ever holding the file in memory, and a directory is read
// file by file in name order. The query string is dropped at parse time: it
// can carry tokens and personal data, and the path is what a crawler fetched.
// Two things are kept from a request for AI referral counts (ai-referrers.ts):
// the HOST of its Referer header (never the path or query), and the value of
// its utm_source parameter (nothing else from the query string).
import { createReadStream, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";

export type LogFormat = "combined" | "common" | "vercel" | "cloudflare";

export interface AccessHit {
  format: LogFormat;
  /** ISO timestamp, or null when the line had none we could read */
  time: string | null;
  ip: string | null;
  method: string | null;
  host: string | null;
  /** path only: no query string, no fragment */
  path: string;
  status: number | null;
  userAgent: string | null;
  /** an edge firewall decision on this request, when the log records one */
  waf: "block" | "challenge" | null;
  /** the Referer header's host only, lowercased; null when absent */
  refererHost: string | null;
  /** the request's utm_source value, lowercased; null when absent */
  utmSource: string | null;
  /** the line as read (callers redact before showing it) */
  raw: string;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "10/Oct/2000:13:55:36 -0700" → ISO (UTC). */
export function parseClfTime(s: string): string | null {
  const m = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s);
  if (!m || !MONTHS[m[2]]) return null;
  const iso = `${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${m[7]}${m[8]}:${m[9]}`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Unix seconds, ms, µs or ns (by magnitude), or an RFC 3339 string → ISO. */
export function parseAnyTime(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const ms = v > 1e17 ? v / 1e6 : v > 1e14 ? v / 1e3 : v > 1e11 ? v : v * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string" && v.trim()) {
    if (/^\d+$/.test(v.trim())) return parseAnyTime(Number(v.trim()));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

/** Path without query or fragment; "-" and junk become "/". nginx writes
 *  unprintable bytes as \xXX: decoded back so paths compare as fetched. */
export function cleanPath(target: string | null | undefined): string {
  if (!target) return "/";
  let t = target.replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  // absolute-form request targets ("GET http://host/path HTTP/1.1")
  const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i.exec(t);
  if (abs) t = abs[1] ?? "/";
  const cut = t.search(/[?#]/);
  if (cut >= 0) t = t.slice(0, cut);
  return t.startsWith("/") ? t.slice(0, 2048) : "/";
}

/** The host of a Referer header value, lowercased, or null. The path and
 *  query are never kept. */
export function refererHostOf(v: string | null | undefined): string | null {
  if (!v || v === "-") return null;
  try {
    return new URL(v).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** The utm_source value of a request target, lowercased and capped, or null.
 *  Nothing else in the query string is read. */
export function utmSourceOf(target: string | null | undefined): string | null {
  if (!target) return null;
  const q = target.indexOf("?");
  if (q < 0) return null;
  const end = target.indexOf("#", q);
  try {
    const v = new URLSearchParams(target.slice(q + 1, end < 0 ? undefined : end)).get("utm_source");
    const t = v?.trim().toLowerCase().slice(0, 100);
    return t || null;
  } catch {
    return null;
  }
}

// ip - user [time] "request" status bytes ["referer" "ua"] [anything]
const CLF =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "((?:[^"\\]|\\.)*)" (\d{3}|-) (\S+)(?: "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)")?/;

const unescapeQuoted = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const dash = (s: string | undefined | null) => (s === undefined || s === null || s === "-" || s === "" ? null : s);

function parseClf(line: string): AccessHit | null {
  const m = CLF.exec(line);
  if (!m) return null;
  const req = unescapeQuoted(m[3]);
  const parts = req.split(" ");
  const method = parts.length >= 2 ? parts[0] : null;
  const target = parts.length >= 2 ? parts[1] : null;
  const ua = m[7] !== undefined ? dash(unescapeQuoted(m[7])) : null;
  const referer = m[6] !== undefined ? dash(unescapeQuoted(m[6])) : null;
  return {
    format: m[7] !== undefined ? "combined" : "common",
    time: parseClfTime(m[2]),
    ip: dash(m[1]),
    method,
    host: null,
    path: cleanPath(target),
    status: m[4] === "-" ? null : Number(m[4]),
    userAgent: ua,
    waf: null,
    refererHost: refererHostOf(referer),
    utmSource: utmSourceOf(target),
    raw: line,
  };
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);

function fromCloudflare(o: Record<string, unknown>, raw: string): AccessHit {
  const actions = [str(o.SecurityAction), ...(Array.isArray(o.SecurityActions) ? (o.SecurityActions as unknown[]).map(str) : [])]
    .filter((a): a is string => !!a)
    .map((a) => a.toLowerCase());
  const waf = actions.some((a) => a === "block" || a === "drop")
    ? "block"
    : actions.some((a) => a.includes("challenge"))
      ? "challenge"
      : null;
  return {
    format: "cloudflare",
    time: parseAnyTime(o.EdgeStartTimestamp),
    ip: str(o.ClientIP),
    method: str(o.ClientRequestMethod),
    host: str(o.ClientRequestHost),
    path: cleanPath(str(o.ClientRequestPath) ?? str(o.ClientRequestURI)),
    status: num(o.EdgeResponseStatus),
    userAgent: str(o.ClientRequestUserAgent),
    waf,
    refererHost: refererHostOf(str(o.ClientRequestReferer)),
    // ClientRequestURI carries the query string; ClientRequestPath does not
    utmSource: utmSourceOf(str(o.ClientRequestURI)),
    raw,
  };
}

function fromVercel(o: Record<string, unknown>, raw: string): AccessHit {
  const p = (o.proxy && typeof o.proxy === "object" ? o.proxy : {}) as Record<string, unknown>;
  const uaRaw = p.userAgent;
  const ua = Array.isArray(uaRaw) ? (uaRaw as unknown[]).filter((x) => typeof x === "string").join(" ") : str(uaRaw);
  const wafAction = (str(p.wafAction) ?? "").toLowerCase();
  const status = num(p.statusCode) ?? num(o.statusCode);
  return {
    format: "vercel",
    time: parseAnyTime(p.timestamp ?? o.timestamp),
    ip: str(p.clientIp),
    method: str(p.method),
    host: str(p.host) ?? str(o.host),
    path: cleanPath(str(p.path) ?? str(o.path)),
    // -1 = a background revalidation, not a response anyone received
    status: status !== null && status >= 0 ? status : null,
    userAgent: ua || null,
    waf: wafAction === "deny" ? "block" : wafAction === "challenge" || wafAction === "rate_limit" ? "challenge" : null,
    refererHost: refererHostOf(str(p.referer)),
    // proxy.path is "Request path with query parameters"
    utmSource: utmSourceOf(str(p.path) ?? str(o.path)),
    raw,
  };
}

/** Parse a JSON log record (one NDJSON line or one array element). */
export function parseJsonRecord(o: unknown, raw: string): AccessHit | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if ("ClientRequestUserAgent" in r || "EdgeResponseStatus" in r || "ClientRequestURI" in r) return fromCloudflare(r, raw);
  if ((r.proxy && typeof r.proxy === "object") || ("deploymentId" in r && ("path" in r || "statusCode" in r))) {
    // Vercel build/runtime logs without a request are not access hits
    if (!r.proxy && !("statusCode" in r)) return null;
    return fromVercel(r, raw);
  }
  return null;
}

/** One line of any supported format, or null (counted as unparsed). */
export function parseLogLine(line: string): AccessHit | null {
  const t = line.trim();
  if (!t) return null;
  if (t[0] === "{") {
    try {
      return parseJsonRecord(JSON.parse(t), t);
    } catch {
      return null;
    }
  }
  return parseClf(t);
}

/* ------------------------------ streaming --------------------------------- */

export interface LogFileStats {
  file: string;
  lines: number;
  parsed: number;
  skipped: number;
  formats: Partial<Record<LogFormat, number>>;
}

/** Split a JSON array of objects into one string per object, streaming,
 *  string- and escape-aware. Anything outside objects is ignored. */
export async function* splitJsonArray(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let cur = "";
  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (depth > 0) cur += c;
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        if (depth > 0) inStr = true;
      } else if (c === "{") {
        if (depth === 0) cur = "{";
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
        if (depth === 0) {
          yield cur;
          cur = "";
        }
      }
    }
  }
}

function sniff(file: string): { gzip: boolean; firstChar: string } {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(512);
    const n = readSync(fd, buf, 0, 512, 0);
    const gzip = n >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    const text = gzip ? "" : buf.subarray(0, n).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    return { gzip, firstChar: text[0] ?? "" };
  } finally {
    closeSync(fd);
  }
}

async function* gunzipFirstChar(file: string): AsyncGenerator<string> {
  const s = createReadStream(file).pipe(createGunzip());
  s.setEncoding("utf8");
  for await (const c of s) yield c as string;
}

/** Every log file a path names: a file, or a directory's regular files in
 *  name order (not recursive; dotfiles skipped). */
export function listLogFiles(target: string): string[] {
  const st = statSync(target);
  if (!st.isDirectory()) return [target];
  return readdirSync(target, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => path.join(target, e.name))
    .sort();
}

/** Stream every hit from a file, a directory, or a Readable ("-" = stdin is
 *  the caller's job: pass process.stdin). `onFile` receives per-file counts. */
export async function* readAccessLog(
  source: string | Readable,
  opts: { onFile?: (s: LogFileStats) => void; onLine?: (n: number) => void } = {},
): AsyncGenerator<AccessHit> {
  const inputs: { name: string; open: () => AsyncIterable<string> | Readable; array: boolean | "sniff" }[] = [];
  if (typeof source !== "string") {
    inputs.push({ name: "stdin", open: () => source, array: "sniff" });
  } else {
    for (const file of listLogFiles(source)) {
      const { gzip, firstChar } = sniff(file);
      let array = firstChar === "[";
      if (gzip) {
        // peek the first decompressed character without reading the whole file
        for await (const c of gunzipFirstChar(file)) {
          array = c.replace(/^\uFEFF/, "").trimStart()[0] === "[";
          if (c.trim()) break;
        }
      }
      inputs.push({
        name: file,
        array,
        open: () => {
          const raw = createReadStream(file);
          const s = gzip ? raw.pipe(createGunzip()) : raw;
          s.setEncoding("utf8");
          return s;
        },
      });
    }
  }
  let total = 0;
  for (const input of inputs) {
    const stats: LogFileStats = { file: input.name, lines: 0, parsed: 0, skipped: 0, formats: {} };
    const record = (hit: AccessHit | null) => {
      stats.lines += 1;
      total += 1;
      if (total % 1_000_000 === 0) opts.onLine?.(total);
      if (hit) {
        stats.parsed += 1;
        stats.formats[hit.format] = (stats.formats[hit.format] ?? 0) + 1;
      } else stats.skipped += 1;
      return hit;
    };
    const parseObjects = async function* (chunks: AsyncIterable<string>) {
      for await (const obj of splitJsonArray(chunks)) {
        let hit: AccessHit | null = null;
        try {
          hit = parseJsonRecord(JSON.parse(obj), obj);
        } catch {
          hit = null;
        }
        yield hit;
      }
    };
    const parseLines = async function* (chunks: AsyncIterable<string>) {
      for await (const line of linesOf(chunks)) {
        if (!line.trim()) continue;
        yield parseLogLine(line.length > 65_536 ? line.slice(0, 65_536) : line);
      }
    };
    let chunks: AsyncIterable<string> = toText(input.open());
    let array = input.array;
    if (array === "sniff") {
      // a Readable (stdin, an upload): the first non-blank character decides
      const peeked = await peekFirstChar(chunks);
      array = peeked.first === "[";
      chunks = peeked.chunks;
    }
    for await (const hit of array ? parseObjects(chunks) : parseLines(chunks)) {
      if (record(hit)) yield hit!;
    }
    opts.onFile?.(stats);
  }
}

async function* toText(src: AsyncIterable<string> | Readable): AsyncGenerator<string> {
  // a streaming decoder, so a multi-byte character split across two Buffer
  // chunks (stdin, an upload) is decoded whole
  const dec = new TextDecoder("utf-8");
  for await (const c of src as AsyncIterable<string | Uint8Array>) {
    const t = typeof c === "string" ? c : dec.decode(c, { stream: true });
    if (t) yield t;
  }
  const tail = dec.decode();
  if (tail) yield tail;
}

/** Lines from text chunks, without readline (works on any async iterable). A
 *  single line is capped at 1 MB so one runaway line cannot exhaust memory. */
async function* linesOf(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let buf = "";
  for await (const c of chunks) {
    buf += c;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
    }
    if (buf.length > 1_000_000) {
      yield buf;
      buf = "";
    }
  }
  if (buf) yield buf.replace(/\r$/, "");
}

/** Read until the first non-blank character, then hand back every chunk. */
async function peekFirstChar(chunks: AsyncIterable<string>): Promise<{ first: string; chunks: AsyncIterable<string> }> {
  const it = chunks[Symbol.asyncIterator]();
  const head: string[] = [];
  let first = "";
  while (!first) {
    const n = await it.next();
    if (n.done) break;
    head.push(n.value);
    first = n.value.replace(/^\uFEFF/, "").trimStart()[0] ?? "";
  }
  async function* rest() {
    yield* head;
    for (;;) {
      const n = await it.next();
      if (n.done) return;
      yield n.value;
    }
  }
  return { first, chunks: rest() };
}
