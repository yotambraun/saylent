// One reading of a CrawlerReport (engine crawler-analytics.ts) for every
// surface: the CLI text summary, crawlers.md, the MCP `crawlers` tool and the
// app's brand page all take their sentences from here, so they cannot word the
// same numbers two ways. Pure; counts first, every sentence names its window.
import { PURPOSE_LABEL, type BotPurpose } from "@saylent/engine/ai-bots";
import type { CrawlerReport, ProblemKind } from "@saylent/engine/crawler-analytics";
import { engineLabel } from "@saylent/engine/surfaces";

export type { CrawlerReport };

export const PROBLEM_LABEL: Readonly<Record<ProblemKind, string>> = {
  blocked: "Blocked (401/403/429 or firewall)",
  error: "Server error (5xx)",
  not_found: "Not found (404/410)",
  client_error: "Other 4xx",
};

export const purposeLabel = (p: string) => (PURPOSE_LABEL as Record<string, string>)[p] ?? p;

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "?");

export function windowLine(r: CrawlerReport): string {
  if (!r.window.from) return "No timestamps in the log, so no window.";
  return `${day(r.window.from)} to ${day(r.window.to)} (UTC)`;
}

/** The lede: what came, in one or two sentences. */
export function crawlersLede(r: CrawlerReport): string {
  const t = r.totals;
  if (t.parsed === 0) return `No line in ${plural(t.lines, "line")} was a log format saylent reads (nginx/Apache combined, Vercel, Cloudflare).`;
  const ai = r.bots.filter((b) => b.ai);
  if (ai.length === 0) {
    return `No AI crawler visited in ${plural(t.parsed, "request")} from ${windowLine(r)}.${t.searchBotHits ? ` Googlebot and Bingbot made ${plural(t.searchBotHits, "request")}.` : ""}`;
  }
  const top = ai[0];
  const lead = `${plural(ai.length, "AI crawler")} made ${plural(t.aiBotHits, "request")} from ${windowLine(r)}`;
  // A tie at the top names no single bot "the most".
  if (ai.length === 1 || ai[1].hits < top.hits) return `${lead}; ${top.label} the most, ${plural(top.hits, "request")} to ${plural(top.distinctPages, "page")}.`;
  return `${lead}.`;
}

/** Problems in one line: refused and broken requests, AI bots only. */
export function problemsLine(r: CrawlerReport): string | null {
  const t = r.totals;
  if (t.aiBlocked === 0 && t.aiErrors === 0) return null;
  const parts = [t.aiBlocked ? `${plural(t.aiBlocked, "request")} blocked` : null, t.aiErrors ? `${plural(t.aiErrors, "server error")}` : null].filter(Boolean);
  return `AI crawlers met ${parts.join(" and ")}; each problem below carries the log lines.`;
}

export function verificationLine(r: CrawlerReport): string {
  const t = r.totals;
  if (r.ipVerification.mode === "off") return r.ipVerification.note;
  return `${n(t.verified)} bot request${t.verified === 1 ? "" : "s"} came from the operator's published ranges, ${n(t.unverified)} could not be checked${t.spoofed ? `, and ${plural(t.spoofed, "request")} claimed a bot's name from outside its ranges (spoofed)` : ""}. ${r.ipVerification.note}`;
}

export function joinLines(r: CrawlerReport): string[] {
  const j = r.join;
  if (!j) return [];
  const out: string[] = [];
  out.push(`${plural(j.cited.length, "page")} of ${j.brandDomain} ${j.cited.length === 1 ? "is" : "are"} cited in the run's answers.`);
  if (j.citedNotFetched.length) out.push(`${plural(j.citedNotFetched.length, "cited page")} had no AI-crawler request in this window: ${j.citedNotFetched.slice(0, 5).join(", ")}${j.citedNotFetched.length > 5 ? ", ..." : ""}.`);
  if (j.citedWithProblems.length) out.push(`${plural(j.citedWithProblems.length, "cited page")} gave an AI crawler an error or a block: ${j.citedWithProblems.slice(0, 5).join(", ")}.`);
  const notByOwn = j.cited.flatMap((c) => Object.entries(c.operatorFetched).filter(([, f]) => !f).map(([e]) => `${c.path} (${engineLabel(e)})`));
  if (notByOwn.length) out.push(`Cited by an engine whose own crawlers did not fetch it in this window: ${notByOwn.slice(0, 5).join(", ")}${notByOwn.length > 5 ? ", ..." : ""}.`);
  if (j.readNotFetched.length) out.push(`${plural(j.readNotFetched.length, "page")} the audit read on your site had no AI-crawler request in this window.`);
  out.push(j.note);
  return out;
}

/** AI referral visits in one sentence, or the reason there is no count: a
 *  report written before 0.2.0 never counted them, which is not zero. */
export function referralsLine(r: CrawlerReport): string {
  const ref = r.referrals;
  if (!ref) return "AI referral visits were not counted in this report (it was made before saylent 0.2.0); upload the log again to count them.";
  if (ref.visits === 0) return `No visit in ${windowLine(r)} came with an AI assistant's referrer or utm_source.`;
  const [top, second] = ref.assistants;
  // as in the crawler lede, a tie at the top names no single assistant
  const named = !second ? `all from ${top.label}` : second.visits < top.visits ? `${top.label} the most (${n(top.visits)})` : `from ${n(ref.assistants.length)} assistants`;
  return `${plural(ref.visits, "visit")} from AI assistants in ${windowLine(r)}, ${named}.`;
}

export const PURPOSE_ORDER: readonly BotPurpose[] = ["search", "user", "training", "other"];

/* ------------------------------- markdown --------------------------------- */

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
function table(head: string[], rows: string[][]): string[] {
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)];
}

/** crawlers.md: the same data as crawlers.json, readable. */
export function renderCrawlersMarkdown(r: CrawlerReport, opts: { title?: string } = {}): string {
  const out: string[] = [];
  out.push(`# ${opts.title ?? "AI crawlers"}`, "");
  out.push(crawlersLede(r), "");
  out.push(`Window: ${windowLine(r)} · ${plural(r.totals.lines, "line")} read, ${n(r.totals.parsed)} parsed, ${n(r.totals.unparsed)} skipped${r.totals.outsideWindow ? `, ${n(r.totals.outsideWindow)} outside --since/--until` : ""}.`, "");
  const pl = problemsLine(r);
  if (pl) out.push(pl, "");
  out.push(verificationLine(r), "");
  if (r.bots.length) {
    out.push("## Bots", "");
    out.push(
      ...table(
        ["Bot", "Purpose", "Requests", "Pages", "2xx", "Blocked", "5xx", "404", "Verified", "Last seen"],
        r.bots.map((b) => [
          `${b.label}${b.registryVerified ? "" : " (token not on the operator's own page)"}`,
          b.ai ? purposeLabel(b.purpose) : `${purposeLabel(b.purpose)} (not AI)`,
          n(b.hits),
          n(b.distinctPages),
          n(b.status["2xx"]),
          n(b.blocked),
          n(b.errors),
          n(b.notFound),
          r.ipVerification.mode === "on" ? `${n(b.verification.verified)} of ${n(b.hits)}` : "off",
          day(b.lastSeen),
        ]),
      ),
      "",
    );
  }
  if (r.problems.length) {
    out.push("## Problems", "");
    for (const p of r.problems.slice(0, 20)) {
      const codes = Object.entries(p.statuses).map(([c, k]) => `${c} x${k}`).join(", ");
      out.push(`- **${p.path}** · ${p.botLabel} · ${PROBLEM_LABEL[p.kind]} · ${plural(p.count, "request")} (${codes})`);
      for (const rc of p.receipts.slice(0, 1)) out.push(`  \`${rc.replace(/`/g, "'")}\``);
    }
    if (r.problems.length > 20) out.push(`- +${r.problems.length - 20} more in crawlers.json`);
    out.push("");
  }
  if (r.spoofed.length) {
    out.push("## Spoofed user agents", "");
    out.push(...r.spoofed.slice(0, 10).map((s) => `- ${s.botLabel} from ${s.ip}: ${plural(s.hits, "request")}`), "");
  }
  if (r.join) {
    out.push("## Against the audit's citations", "", ...joinLines(r).map((l) => `- ${l}`), "");
    if (r.join.cited.length) {
      out.push(
        ...table(
          ["Cited page", "Cited by", "AI-crawler requests", "Problems"],
          r.join.cited.slice(0, 20).map((c) => [c.path, c.engines.map(engineLabel).join(", "), n(c.aiBotHits), n(c.problems)]),
        ),
        "",
      );
    }
  }
  out.push("## Visits from AI assistants", "", referralsLine(r), "");
  if (r.referrals?.assistants.length) {
    out.push(
      ...table(
        ["Assistant", "Visits", "By referrer", "By utm_source", "Top landing pages", "Last seen"],
        r.referrals.assistants.map((a) => [
          a.label,
          n(a.visits),
          n(a.viaReferrer),
          n(a.viaUtmSource),
          a.pages.slice(0, 3).map((p) => `${p.path} (${n(p.visits)})`).join(", "),
          day(a.lastSeen),
        ]),
      ),
      "",
    );
    const rc = r.referrals.assistants[0].receipts[0];
    if (rc) out.push(`Receipt: \`${rc.replace(/`/g, "'")}\``, "");
  }
  if (r.referrals) out.push(r.referrals.note, "");
  if (r.pages.length) {
    out.push("## Most-fetched pages", "");
    out.push(
      ...table(
        ["Path", "Requests", "Bots"],
        r.pages.slice(0, 15).map((p) => [p.path, n(p.hits), Object.keys(p.bots).join(", ")]),
      ),
      "",
    );
    if (r.otherPaths) out.push(`${plural(r.otherPaths, "more path")} were counted but not tracked (the report keeps 50,000).`, "");
  }
  out.push(
    `robots.txt-only tokens (never in a log): ${r.robotsOnly.map((b) => b.label).join(", ")}.`,
    "",
    `IPs ${r.privacy.ipsRedacted ? "are redacted" : "are shown as logged"}; query strings are dropped (only a utm_source value is read), and of a Referer only its host is kept. The log never left this machine.`,
  );
  return `${out.join("\n")}\n`;
}
