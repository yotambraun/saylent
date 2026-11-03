// The MCP `crawlers` tool: AI-crawler analytics over an access log on disk,
// as a compact summary an agent can reason over. $0 and read-only; the same
// engine function and the same sentences (report crawlers-view.ts) as
// `saylent crawlers`. Never returns a raw client IP.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import { analyzeAccessLogs } from "@saylent/engine/crawler-analytics";
import { crawlersLede, joinLines, problemsLine, referralsLine, verificationLine, windowLine } from "@saylent/report/crawlers-view";
import { joinRunFromBundle } from "../commands/crawlers";
import { saylentHome } from "../keys";

export interface CrawlersToolArgs {
  log_path: string;
  run_path?: string;
  verify_ips?: boolean;
  since?: string;
  until?: string;
  limit?: number;
}

/** A log path must sit inside the server's working directory: access logs
 *  carry visitors' data, and an agent should not be able to read one from
 *  anywhere on the machine. */
export function resolveInside(p: string, cwd = process.cwd(), what = "log_path"): string {
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${what} must be inside the server's working directory (${cwd}).`);
  }
  if (!existsSync(abs)) throw new Error(`${p}: no such file or directory.`);
  return abs;
}

export async function crawlersTool(
  args: CrawlersToolArgs,
  deps: { loadBundle: (file: string) => Promise<RunBundleV1>; cwd?: string },
): Promise<Record<string, unknown>> {
  const cwd = deps.cwd ?? process.cwd();
  const logPath = resolveInside(args.log_path, cwd);
  let run = null;
  if (args.run_path) {
    const rp = resolveInside(args.run_path, cwd, "run_path");
    run = joinRunFromBundle(await deps.loadBundle(statSync(rp).isDirectory() ? path.join(rp, "run.json") : rp));
  }
  const r = await analyzeAccessLogs(logPath, {
    verifyIps: !!args.verify_ips,
    cacheDir: path.join(saylentHome(), "cache", "bot-ips"),
    since: args.since ?? null,
    until: args.until ?? null,
    run,
  });
  const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
  return {
    log_path: logPath,
    window: windowLine(r),
    summary: crawlersLede(r),
    problems_line: problemsLine(r),
    verification: verificationLine(r),
    totals: r.totals,
    bots: r.bots.map((b) => ({
      id: b.id,
      label: b.label,
      purpose: b.purpose,
      ai: b.ai,
      requests: b.hits,
      pages: b.distinctPages,
      blocked: b.blocked,
      server_errors: b.errors,
      not_found: b.notFound,
      verified: b.verification.verified,
      last_seen: b.lastSeen,
      top_pages: b.topPages.slice(0, 5),
    })),
    problems: r.problems.slice(0, limit).map((p) => ({ path: p.path, bot: p.botLabel, kind: p.kind, count: p.count, statuses: p.statuses, receipt: p.receipts[0] ?? null })),
    spoofed: r.spoofed.slice(0, limit).map((s) => ({ bot: s.botLabel, ip: s.ip, requests: s.hits })),
    join: r.join
      ? {
          lines: joinLines(r),
          cited_not_fetched: r.join.citedNotFetched.slice(0, limit),
          cited_with_problems: r.join.citedWithProblems.slice(0, limit),
          read_not_fetched: r.join.readNotFetched.slice(0, limit),
        }
      : null,
    ai_referrals: {
      line: referralsLine(r),
      visits: r.referrals?.visits ?? 0,
      assistants: (r.referrals?.assistants ?? []).slice(0, limit).map((a) => ({
        id: a.id,
        label: a.label,
        visits: a.visits,
        via_referrer: a.viaReferrer,
        via_utm_source: a.viaUtmSource,
        top_pages: a.pages.slice(0, 5),
        receipt: a.receipts[0] ?? null,
      })),
      note: r.referrals?.note ?? null,
    },
    privacy: "Client IPs are redacted and query strings dropped (only a utm_source value is read); of a Referer only its host is kept; the log was read locally and sent nowhere.",
    cost_usd: 0,
  };
}
