// E3c — the Source Map. Pure aggregation for the dossier's "Where each engine
// gets its answers" panel: per engine, sum cited_by[engine] over the corpus
// grouped by page_type (→ a plain-English trust profile) and collect its top
// cited hosts, then compute ONE actionable-divergence synthesis line (the
// lowest-mention engine + the source type it leans on). No Next/Supabase/React
// imports — pure and unit-tested; the dossier wraps this in a useMemo.
// @saylent/engine is a real workspace package (node_modules symlink +
// source-level `exports`), so a VALUE import through it resolves at test
// runtime same as any other import (open-source split, 2026-09-09).
import { unwrapArchiveUrl } from "@saylent/engine/util";

/** The minimal corpus shape this reads. Matches CorpusRow in dossier.tsx. */
export interface SourceMapPage {
  page_type: string;
  cited_by: Record<string, number>;
  final_url: string | null;
  url: string;
  /** whether the brand appears on the page; null = unverified. corpus.ts now
   * ENFORCES null for video pages (JS shells can't verify presence). */
  brand_present?: boolean | null;
}

export interface EngineSourceProfile {
  engine: string;
  /** total citations this engine made across the whole corpus */
  citations: number;
  /** top 3 hosts by citation count, count desc then host asc */
  topHosts: { host: string; count: number }[];
  /** the page_type this engine cites most (by citation weight); null = no data */
  dominantType: string | null;
  /** plain-English trust profile derived from dominantType */
  trustLine: string;
  /** this engine's brand mention_rate (0..1) — null when the run didn't score it */
  mentionRate: number | null;
}

/** One receipt-backed, per-brand channel-mix stat for the whole cited corpus:
 * the largest non-brand_owned source channel, its page share, and how many of
 * those pages the brand actually appears on. Null when there is no cited
 * third-party page (empty corpus, verify runs, all-brand_owned). */
export interface ChannelMix {
  /** the largest non-brand_owned page_type across the cited corpus */
  type: string;
  /** SOURCE_NOUN for `type`, computed (never hardcoded in the view) */
  noun: string;
  /** share (0..1) of cited pages that are this type */
  share: number;
  /** number of cited pages of this type */
  pages: number;
  /** how many of those pages the brand is verified present on */
  brandPresent: number;
  /** how many of those pages we could verify at all (brand_present true or
   * false; null/undefined video shells excluded) */
  verified: number;
  /** how the brand's page-presence reconciles with its answer-presence — the
   * classification the view renders one sentence from, no logic duplicated:
   * - present_not_named: on ≥half the verified pages yet a low overall mention
   *   rate — the killer finding (present on the page, still not named in answers)
   * - counted: verified pages exist; report the plain presence count
   * - unverified: no page could be verified — share sentence only */
  appearance: "present_not_named" | "counted" | "unverified";
  /** the full computed channel-mix line for `appearance`; the view renders this
   * string verbatim so the phrasing lives in one tested place. */
  sentence: string;
}

export interface SourceMap {
  engines: EngineSourceProfile[];
  /** one computed synthesis line naming the actionable divergence; null when
   * no engine has both a dominant source type and a scored mention_rate. */
  synthesis: string | null;
  /** overall channel-mix receipt; null when there is no cited third-party page. */
  channelMix: ChannelMix | null;
}

/** Full profile fragment shown per engine row (dominant page_type → sentence). */
const TRUST_LINE: Record<string, string> = {
  listicle: "builds answers from best-of listicles",
  comparison: "builds answers from head-to-head comparisons",
  review_platform: "builds answers from review-platform listings",
  brand_owned: "leans on your own site and vendor docs",
  docs: "leans on product and vendor documentation",
  forum: "answers from community discussion",
  wiki: "answers from encyclopedic references",
  news: "answers from news coverage",
  video: "answers from video content",
  other: "answers from a scattered mix of sources",
};

/** Short source noun used inside the one-line synthesis. */
const SOURCE_NOUN: Record<string, string> = {
  listicle: "best-of listicles",
  comparison: "head-to-head comparisons",
  review_platform: "review-platform listings",
  brand_owned: "your own site and vendor docs",
  docs: "product documentation",
  forum: "community sources",
  wiki: "encyclopedic references",
  news: "news coverage",
  video: "video content",
  other: "a scattered mix of sources",
};

export const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};
const labelOf = (e: string) => ENGINE_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

/** hostname without www; on a non-URL returns the FULL string (display width is a
 *  CSS concern — the render site truncates with a title=; JS never cuts for width). */
export function hostOf(u: string | null | undefined): string {
  if (!u) return "";
  try {
    // unwrap Wayback snapshots so top-host lists show the real host, not web.archive.org
    return new URL(unwrapArchiveUrl(u)).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

export function buildSourceMap(
  corpus: SourceMapPage[],
  engineMentionRates: Record<string, number | null | undefined> = {},
  order: readonly string[] = ["chatgpt", "claude", "gemini", "perplexity"],
): SourceMap {
  // engines actually present in the data, canonical order first then any extras
  const seen = new Set<string>();
  for (const p of corpus) for (const [e, n] of Object.entries(p.cited_by)) if ((n ?? 0) > 0) seen.add(e);
  const engines = [...order.filter((e) => seen.has(e)), ...[...seen].filter((e) => !order.includes(e))];

  const profiles: EngineSourceProfile[] = engines.map((engine) => {
    const typeCount = new Map<string, number>();
    const hostCount = new Map<string, number>();
    let citations = 0;
    for (const p of corpus) {
      const n = p.cited_by[engine] ?? 0;
      if (n <= 0) continue;
      citations += n;
      typeCount.set(p.page_type, (typeCount.get(p.page_type) ?? 0) + n);
      const host = hostOf(p.final_url ?? p.url);
      if (host) hostCount.set(host, (hostCount.get(host) ?? 0) + n);
    }
    const topHosts = [...hostCount.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([host, count]) => ({ host, count }));
    const dominant = [...typeCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const dominantType = dominant?.[0] ?? null;
    const rate = engineMentionRates[engine];
    return {
      engine,
      citations,
      topHosts,
      dominantType,
      trustLine: dominantType ? (TRUST_LINE[dominantType] ?? TRUST_LINE.other) : "no cited pages captured",
      mentionRate: rate === undefined ? null : rate,
    };
  });

  // Synthesis: the engine where the brand is LEAST present, plus the source
  // type it leans on — computed, never hardcoded. Only engines that have both
  // a dominant source type and a scored mention_rate can carry it.
  const candidates = profiles.filter((p) => p.dominantType && p.mentionRate !== null);
  let synthesis: string | null = null;
  if (candidates.length > 0) {
    const weakest = [...candidates].sort(
      (a, b) => (a.mentionRate ?? 0) - (b.mentionRate ?? 0) || b.citations - a.citations,
    )[0];
    const noun = SOURCE_NOUN[weakest.dominantType as string] ?? SOURCE_NOUN.other;
    const where = weakest.mentionRate === 0 ? "where you're absent" : "where you're least present";
    synthesis = `${labelOf(weakest.engine)} leans on ${noun}: ${where}.`;
  }

  // Channel mix: the honest, per-brand answer to "68% of AI answers cite X".
  // Over the cited corpus (pages behind these answers), find the largest
  // non-brand_owned page_type by page count, its share, and how many of those
  // pages the brand is verified present on. Null when there's no cited
  // third-party page (empty/verify corpus, all-brand_owned).
  const citedCorpus = corpus.filter((p) =>
    Object.values(p.cited_by).some((n) => (n ?? 0) > 0),
  );
  let channelMix: ChannelMix | null = null;
  if (citedCorpus.length > 0) {
    const byType = new Map<string, { pages: number; present: number; verified: number }>();
    for (const p of citedCorpus) {
      const e = byType.get(p.page_type) ?? { pages: 0, present: 0, verified: 0 };
      e.pages += 1;
      if (p.brand_present === true) e.present += 1;
      if (p.brand_present === true || p.brand_present === false) e.verified += 1;
      byType.set(p.page_type, e);
    }
    const largest = [...byType.entries()]
      .filter(([type]) => type !== "brand_owned")
      .sort((a, b) => b[1].pages - a[1].pages || a[0].localeCompare(b[0]))[0];
    if (largest) {
      const [type, { pages, present, verified }] = largest;
      const noun = SOURCE_NOUN[type] ?? SOURCE_NOUN.other;
      // overall mention rate = mean of the scored (non-null) engine rates; null
      // when the run scored none. The "present but not named" finding needs it.
      const scored = Object.values(engineMentionRates).filter(
        (r): r is number => typeof r === "number",
      );
      const overallRate = scored.length
        ? scored.reduce((s, r) => s + r, 0) / scored.length
        : null;
      const base = `${Math.round((pages / citedCorpus.length) * 100)}% of the pages behind these answers are ${noun}`;
      let appearance: ChannelMix["appearance"];
      let sentence: string;
      if (
        verified > 0 &&
        present / verified >= 0.5 &&
        overallRate !== null &&
        overallRate < 0.34
      ) {
        appearance = "present_not_named";
        // graduated, never absolute: "don't" only when the scored rate is
        // exactly zero — at any positive rate the engines DO sometimes name
        // the brand, so the honest word is "rarely".
        const naming = overallRate === 0 ? "don't" : "rarely";
        sentence = `${base}. You appear on ${present} of the ${verified} we could verify, yet the engines still ${naming} name you.`;
      } else if (verified > 0) {
        appearance = "counted";
        sentence = `${base}. You appear on ${present} of the ${verified} we could verify.`;
      } else {
        appearance = "unverified";
        sentence = `${base}.`;
      }
      channelMix = {
        type,
        noun,
        share: pages / citedCorpus.length,
        pages,
        brandPresent: present,
        verified,
        appearance,
        sentence,
      };
    }
  }

  return { engines: profiles, synthesis, channelMix };
}
