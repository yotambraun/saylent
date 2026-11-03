// Server-side shaping of a stored CrawlerReport (migration 0046) into the
// brand page's plain props. The sentences are @saylent/report crawlers-view's.
import type { CrawlerReport } from "@saylent/engine/crawler-analytics";
import { PROBLEM_LABEL, crawlersLede, joinLines, problemsLine, purposeLabel, referralsLine, verificationLine, windowLine } from "@saylent/report/crawlers-view";

export interface CrawlerBotView {
  label: string;
  purpose: string;
  requests: number;
  pages: number;
  blocked: number;
  errors: number;
  notFound: number;
  verified: number | null;
  lastSeen: string | null;
}

export interface CrawlerProblemView {
  path: string;
  bot: string;
  kind: string;
  count: number;
  receipt: string | null;
}

export interface CrawlerReferralView {
  label: string;
  visits: number;
  viaReferrer: number;
  viaUtmSource: number;
  pages: string;
  receipt: string | null;
}

export interface CrawlerReportView {
  id: string;
  sourceName: string;
  createdAt: string;
  window: string;
  lede: string;
  problems: string | null;
  verification: string;
  bots: CrawlerBotView[];
  topProblems: CrawlerProblemView[];
  join: string[];
  /** AI referral visits: the sentence, the rows, and the floor caveat (null on
   *  a report made before referrals were counted) */
  referrals: { line: string; rows: CrawlerReferralView[]; note: string | null };
}

export interface CrawlerUploadRow {
  id: string;
  sourceName: string;
  createdAt: string;
  aiBotHits: number;
}


export function crawlerReportView(row: { id: string; source_name: string; created_at: string; report: unknown }): CrawlerReportView | null {
  const r = row.report as CrawlerReport | null;
  if (!r || r.schema_version !== 1) return null;
  return {
    id: row.id,
    sourceName: row.source_name,
    createdAt: row.created_at,
    window: windowLine(r),
    lede: crawlersLede(r),
    problems: problemsLine(r),
    verification: verificationLine(r),
    bots: r.bots.slice(0, 10).map((b) => ({
      label: b.label,
      purpose: b.ai ? purposeLabel(b.purpose) : `${purposeLabel(b.purpose)} (not AI)`,
      requests: b.hits,
      pages: b.distinctPages,
      blocked: b.blocked,
      errors: b.errors,
      notFound: b.notFound,
      verified: r.ipVerification.mode === "on" ? b.verification.verified : null,
      lastSeen: b.lastSeen,
    })),
    topProblems: r.problems.slice(0, 5).map((p) => ({ path: p.path, bot: p.botLabel, kind: PROBLEM_LABEL[p.kind], count: p.count, receipt: p.receipts[0] ?? null })),
    join: joinLines(r),
    referrals: {
      line: referralsLine(r),
      rows: (r.referrals?.assistants ?? []).slice(0, 10).map((a) => ({
        label: a.label,
        visits: a.visits,
        viaReferrer: a.viaReferrer,
        viaUtmSource: a.viaUtmSource,
        pages: a.pages.slice(0, 3).map((p) => p.path).join(", "),
        receipt: a.receipts[0] ?? null,
      })),
      note: r.referrals?.note ?? null,
    },
  };
}
