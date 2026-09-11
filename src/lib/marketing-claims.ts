// The one dated home for every SOURCED, external market
// stat we show on public pages. Project rule for marketing pages:
// a stat shown to a buyer is a RANGE WITH ATTRIBUTION and a linkable source,
// never a cherry-picked single multiplier — auditor-brand credibility.
// This is the ONLY place these numbers live; pages import, never re-type them.
// This domain moves in months — re-verify anything load-bearing before a page
// leans on it, and bump `datedAt` when you do.

export interface MarketingClaim {
  /** Stable id — how a page references a claim without re-typing the number. */
  id: string;
  /** Plain-English, honest one-liner (no hype). What the stat means for a buyer. */
  claim: string;
  /** The figure(s) — a RANGE WITH ATTRIBUTION where studies disagree, not one number. */
  statRange: string;
  /** Who measured it — shown next to the stat. */
  sourceName: string;
  /** Linkable source. Must be https so the claim is checkable. */
  sourceUrl: string;
  /** When the stat/source is dated (year, ISO date, or a future effective date). */
  datedAt: string;
}

export const MARKETING_CLAIMS: readonly MarketingClaim[] = [
  {
    id: "cdn-silent-block",
    claim:
      "B2B sites silently block AI crawlers at the CDN layer — robots.txt says allow, the CDN returns a 403. The site works fine for humans and Google, so no one notices.",
    statRange:
      "~27% of B2B SaaS & e-commerce sites (Otterly's 1M-citation analysis put technical AI-crawler barriers at 73%)",
    sourceName: "Anagram — 2026 crawlability report",
    sourceUrl:
      "https://www.anagram.ai/blog/what-is-blocking-ai-crawlers-from-seeing-your-site-2026-crawlability-checklist",
    datedAt: "2026",
  },
  {
    id: "cloudflare-defaults",
    claim:
      "Cloudflare (~20% of the web) moves to category defaults: Training and Agent crawlers blocked by default on ad-bearing pages of new domains, and multi-purpose crawlers judged by their most restrictive rule. Silent blocking gets worse, not better.",
    statRange: "Effective September 15, 2026",
    sourceName: "Cloudflare — Content Independence Day",
    sourceUrl: "https://blog.cloudflare.com/content-independence-day-ai-options/",
    datedAt: "2026-09-15",
  },
  {
    id: "ai-referral-conversion",
    claim:
      "Visitors who arrive from an AI answer convert far better than the same volume from organic search — small traffic, disproportionate revenue. Every blocked bot is your highest-intent channel returning a 403.",
    statRange:
      "4.4x–23x higher conversion than organic, depending on study and industry",
    sourceName: "Semrush (4.4x) & Ahrefs (23x) — 2026",
    sourceUrl: "https://emarketed.com/aeo/ai-referral-traffic-conversion-value-2026/",
    datedAt: "2026",
  },
  {
    id: "citation-concentration",
    claim:
      "AI answers are written from a tiny set of pages, far tighter than a page of search results. Being in that set is winner-take-most — which is exactly what an audit moves you into.",
    statRange:
      "Fewer than 10 distinct URLs appear in 80% of answers across six LLM search systems",
    sourceName: "arXiv source-coverage study",
    sourceUrl: "https://arxiv.org/html/2512.09483v1",
    datedAt: "2025",
  },
  {
    id: "wikipedia-reddit-share",
    claim:
      "User-generated and reference sites dominate what ChatGPT cites — your own pages compete for what's left, so where you appear off-site matters as much as your site.",
    statRange:
      "Wikipedia (13.15%) + Reddit (11.97%) = over 25% of US ChatGPT citations",
    sourceName: "5W Research",
    sourceUrl:
      "https://www.prnewswire.com/news-releases/wikipedia-and-reddit-now-drive-over-25-of-chatgpt-citations-in-the-us-new-5w-research-finds--wsj-nyt-and-bloomberg-do-not-appear-in-the-top-20-302768339.html",
    datedAt: "2026",
  },
  {
    id: "chatgpt-ads",
    claim:
      "Ads have arrived inside ChatGPT answers. As paid placements grow, the organic citation slots an audit optimizes get scarcer and more valuable.",
    statRange: "Launched February 9, 2026 (US Free & Go tiers)",
    sourceName: "OpenAI",
    sourceUrl: "https://openai.com/index/testing-ads-in-chatgpt/",
    datedAt: "2026-02-09",
  },
] as const;

/** Look up a single claim by id — pages use this so a number lives in one place. */
export function claim(id: string): MarketingClaim {
  const found = MARKETING_CLAIMS.find((c) => c.id === id);
  if (!found) throw new Error(`Unknown marketing claim id: ${id}`);
  return found;
}
