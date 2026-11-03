// `saylent crawlers <logfile|dir|->` — which AI crawlers actually visit your
// site, from your own access logs. gate-check says what is allowed; this says
// what happens: requests per bot and purpose, the pages they fetch, what they
// were refused or broke on, and (with --run) the cited pages no AI bot fetched.
//
// $0 and offline: the log is read on this machine and never sent anywhere.
// --verify-ips is the one network use, and it only GETs the operators' public
// IP-range files (cached for a day in ~/.saylent/cache/bot-ips).
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { analyzeAccessLogs, type CrawlerReport, type JoinRun } from "@saylent/engine/crawler-analytics";
import { AI_BOTS } from "@saylent/engine/ai-bots";
import {
  PROBLEM_LABEL,
  crawlersLede,
  joinLines,
  problemsLine,
  purposeLabel,
  referralsLine,
  renderCrawlersMarkdown,
  verificationLine,
  windowLine,
} from "@saylent/report/crawlers-view";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";
import { saylentHome } from "../keys";
import { loadBundleFileAsync } from "../run";

const HELP = `saylent crawlers <logfile|dir|-> [options]

Which AI crawlers visit your site, from your own access logs: requests per bot
(GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-SearchBot,
Claude-User, PerplexityBot, Perplexity-User, Googlebot, Bingbot and more),
what each one is for (training, search index, user-triggered fetch), the
pages they fetch, and the requests that were blocked or failed, each with
its log lines. It also counts visits from people that AI assistants sent
(ChatGPT, Perplexity, Claude, Gemini, Copilot and others), by the Referer
host or utm_source. $0. The log never leaves this machine.

Reads nginx/Apache combined logs, Vercel log drains (NDJSON or a JSON
array) and Cloudflare Logpush http_requests (NDJSON); .gz files and whole
directories too. "-" reads plain text from stdin.

Options:
${options([
  opt("--run <run.json>", "Join with an audit: which cited pages no AI bot fetched"),
  opt(
    "--verify-ips",
    "Check each bot's IP against its operator's published ranges",
    "(GETs the public range files; cached 24h). Without it every",
    "bot request is unverified: a user agent is a claim.",
  ),
  opt("--since <date>", "Only requests on or after this date (ISO)"),
  opt("--until <date>", "Only requests up to this date (ISO; a bare date is inclusive)"),
  opt("--bot <id>", "Only one bot, e.g. gptbot, claudebot, perplexitybot"),
  opt("--show-ips", "Keep client IPs in the receipts (redacted by default)"),
  opt("--limit <n>", "Rows per list (default 10, max 50)"),
  opt("--out <dir>", "Write crawlers.json and crawlers.md there"),
  opt("--json", "Print the full report as JSON"),
  HELP_OPTION,
])}`;

const pad = (s: string, w: number) => (s.length >= w ? `${s.slice(0, w - 1)}${glyph("ellipsis")}` : s.padEnd(w));
const num = (x: number) => x.toLocaleString("en-US");

export function formatCrawlers(r: CrawlerReport, limit = 10): string {
  const out: string[] = [];
  out.push(`\nSaylent ${glyph("sep")} crawlers ${glyph("sep")} ${windowLine(r)}\n`);
  out.push(`  ${crawlersLede(r)}`);
  out.push(
    `  ${num(r.totals.lines)} lines ${glyph("sep")} ${num(r.totals.parsed)} parsed ${glyph("sep")} ${num(r.totals.unparsed)} skipped${r.totals.outsideWindow ? ` ${glyph("sep")} ${num(r.totals.outsideWindow)} outside the window` : ""}`,
  );
  const pl = problemsLine(r);
  if (pl) out.push(`  ${pl}`);
  if (r.bots.length) {
    out.push("", `  ${pad("Bot", 22)} ${pad("Purpose", 22)} ${"Requests".padStart(9)} ${"Pages".padStart(6)} ${"Blocked".padStart(8)} ${"5xx".padStart(5)} ${"404".padStart(5)} ${"Verified".padStart(9)}`);
    for (const b of r.bots.slice(0, Math.max(limit, 12))) {
      out.push(
        `  ${pad(b.label + (b.registryVerified ? "" : "*"), 22)} ${pad(b.ai ? purposeLabel(b.purpose) : `${purposeLabel(b.purpose)} (not AI)`, 22)} ${num(b.hits).padStart(9)} ${num(b.distinctPages).padStart(6)} ${num(b.blocked).padStart(8)} ${num(b.errors).padStart(5)} ${num(b.notFound).padStart(5)} ${(r.ipVerification.mode === "on" ? `${num(b.verification.verified)}` : "off").padStart(9)}`,
      );
    }
    if (r.bots.some((b) => !b.registryVerified)) out.push(`  * token from third-party lists; not on the operator's own page`);
  }
  if (r.problems.length) {
    out.push("", "  Problems (AI and search crawlers; most requests first)");
    for (const p of r.problems.slice(0, limit)) {
      out.push(`  ${glyph("dot")} ${p.path}  ${p.botLabel}  ${PROBLEM_LABEL[p.kind]}  x${num(p.count)}`);
      if (p.receipts[0]) out.push(`      ${p.receipts[0].slice(0, 220)}`);
    }
  }
  if (r.spoofed.length) {
    out.push("", "  Spoofed user agents (claimed a bot, IP outside its published ranges)");
    for (const s of r.spoofed.slice(0, limit)) out.push(`  ${glyph("dot")} ${s.botLabel} from ${s.ip}  x${num(s.hits)}`);
  }
  out.push("", `  Visits from AI assistants ${glyph("sep")} ${referralsLine(r)}`);
  for (const a of (r.referrals?.assistants ?? []).slice(0, limit)) {
    const pages = a.pages.slice(0, 3).map((p) => `${p.path} (${num(p.visits)})`).join(", ");
    out.push(`  ${glyph("dot")} ${pad(a.label, 18)} ${num(a.visits).padStart(7)}  ${pages}`);
  }
  const jl = joinLines(r);
  if (jl.length) {
    out.push("", "  Against the audit's citations");
    for (const l of jl) out.push(`  ${glyph("dot")} ${l}`);
  }
  out.push("", `  ${verificationLine(r)}`);
  if (r.referrals?.visits) out.push(`  ${r.referrals.note}`);
  out.push(`  IPs ${r.privacy.ipsRedacted ? "redacted" : "shown"}; query strings dropped (a utm_source value is read); referrers kept as host only; nothing was uploaded.`);
  return `${out.join("\n")}\n`;
}

export function joinRunFromBundle(b: Awaited<ReturnType<typeof loadBundleFileAsync>>): JoinRun {
  return {
    runId: b.run.id,
    brandDomain: b.brand_model.domain || b.run.brand.domain,
    answers: b.answers.map((a) => ({ qid: a.qid, engine: a.engine, ok: a.ok, citations: a.citations })),
    corpus: b.corpus_pages.map((p) => ({ url: p.url, final_url: p.final_url })),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      run: { type: "string" },
      "verify-ips": { type: "boolean", default: false },
      since: { type: "string" },
      until: { type: "string" },
      bot: { type: "string" },
      "show-ips": { type: "boolean", default: false },
      limit: { type: "string" },
      out: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  const target = positionals[0];
  if (!target) {
    process.stderr.write(`Missing <logfile|dir|->.\n\n${HELP}\n`);
    return 1;
  }
  if (target !== "-" && !existsSync(target)) {
    process.stderr.write(`\n  ${target}: no such file or directory.\n`);
    return 1;
  }
  for (const k of ["since", "until"] as const) {
    if (values[k] && !ISO_DATE.test(values[k]!)) {
      process.stderr.write(`\n  --${k} ${values[k]}: expected an ISO date like 2026-11-01.\n`);
      return 1;
    }
  }
  if (values.bot && !AI_BOTS.some((b) => b.id === values.bot)) {
    process.stderr.write(`\n  --bot ${values.bot}: unknown bot id. Known: ${AI_BOTS.filter((b) => b.tokens.length).map((b) => b.id).join(", ")}\n`);
    return 1;
  }
  const limit = values.limit === undefined ? 10 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    process.stderr.write(`\n  --limit ${values.limit}: expected a whole number 1-50.\n`);
    return 1;
  }
  let joinRun: JoinRun | null = null;
  if (values.run) {
    try {
      const p = path.resolve(values.run);
      joinRun = joinRunFromBundle(await loadBundleFileAsync(existsSync(p) && statSync(p).isDirectory() ? path.join(p, "run.json") : p));
    } catch (e) {
      process.stderr.write(`\n  --run ${values.run}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }
  let extraBots = null;
  try {
    const { loadConfig } = await import("@saylent/engine/config");
    extraBots = (await loadConfig(process.cwd(), { allowExecutable: false })).config.extraBots ?? null;
  } catch {
    extraBots = null;
  }
  const tty = Boolean(process.stderr.isTTY);
  let report: CrawlerReport;
  try {
    report = await analyzeAccessLogs(target === "-" ? process.stdin : target, {
      verifyIps: values["verify-ips"],
      cacheDir: path.join(saylentHome(), "cache", "bot-ips"),
      includeIps: values["show-ips"],
      since: values.since ?? null,
      until: values.until ?? null,
      bot: values.bot ?? null,
      extraBots,
      run: joinRun,
      onLine: tty ? (n) => process.stderr.write(`  read ${n.toLocaleString("en-US")} lines\r`) : undefined,
    });
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  if (values.out) {
    const dir = path.resolve(values.out);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "crawlers.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(path.join(dir, "crawlers.md"), renderCrawlersMarkdown(report));
  }
  if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stdout.write(formatCrawlers(report, limit));
    if (values.out) process.stdout.write(`\n  Wrote     ${path.join(path.resolve(values.out), "crawlers.json")} and crawlers.md\n`);
  }
  return 0;
}
