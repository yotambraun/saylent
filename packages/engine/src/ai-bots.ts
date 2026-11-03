// The AI crawler registry for log analytics: which user agents in YOUR access
// logs belong to which AI operator, and what each one is for.
//
// gate-check (domainChecks.ts) answers "what is allowed"; this registry lets
// `saylent crawlers` answer "what actually happens". Every entry names the
// operator's own documentation and the date it was checked. An entry whose UA
// token we could only find on third-party sites is kept with `verified: false`
// and says so wherever it is shown; nothing here is guessed silently.
//
// PURPOSE (the operator's stated use, not ours):
//   training     collects pages to train models
//   search       builds the index an AI answer cites from
//   user         fetches a page live because a person asked the assistant
//   robots_only  a robots.txt token with no crawler of its own (never in logs)
//   other        previews, ads checks; counted, never called "AI"
// Googlebot and Bingbot are classic search crawlers, kept for context: Google's
// AI Overviews and Microsoft Copilot answer from those indexes.
//
// MATCHING: case-insensitive product-token match on the User-Agent, most
// specific token first ("ChatGPT-User" before "GPTBot", "Claude-SearchBot"
// before "ClaudeBot"). A UA is a claim, not an identity: bot-ip-ranges.ts
// checks the source IP against the operator's published ranges where they
// publish them.
import type { ExtraBot } from "./config";

export type BotPurpose = "training" | "search" | "user" | "robots_only" | "other";
export type BotOperator =
  | "openai"
  | "anthropic"
  | "perplexity"
  | "google"
  | "microsoft"
  | "apple"
  | "commoncrawl"
  | "meta"
  | "amazon"
  | "duckduckgo"
  | "mistral"
  | "you"
  | "bytedance"
  | "cohere"
  | "custom";

export interface AiBot {
  id: string;
  label: string;
  operator: BotOperator;
  purpose: BotPurpose;
  /** product tokens matched case-insensitively against the User-Agent */
  tokens: string[];
  /** the operator's page the facts come from */
  docsUrl: string | null;
  /** the operator's published IP-range JSON files, or null when none exist */
  ipRanges: string[] | null;
  /** true when the UA token is on the operator's own page */
  verified: boolean;
  /** when the facts were last checked against docsUrl */
  checked: string;
  note?: string;
  /** an AI crawler (false for Googlebot/Bingbot context and previews) */
  ai: boolean;
}

export const REGISTRY_CHECKED = "2026-11-02";

const OPENAI_DOCS = "https://developers.openai.com/api/docs/bots";
const ANTHROPIC_DOCS =
  "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const ANTHROPIC_IPS = ["https://claude.com/crawling/bots.json"];
const PPLX_DOCS = "https://docs.perplexity.ai/guides/bots";
const GOOGLE_COMMON = "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers";
const GOOGLE_USER = "https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers";
const GIP = "https://developers.google.com/static/crawling/ipranges/";
const GOOGLE_USER_IPS = [`${GIP}user-triggered-fetchers.json`, `${GIP}user-triggered-fetchers-google.json`, `${GIP}user-triggered-agents.json`];
const META_DOCS = "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers";
const AMAZON_DOCS = "https://developer.amazon.com/amazonbot";
const APPLE_DOCS = "https://support.apple.com/en-us/119829";

const bot = (b: Omit<AiBot, "checked" | "ai"> & { ai?: boolean }): AiBot => ({ checked: REGISTRY_CHECKED, ai: true, ...b });

/** Ordered most-specific first: matchBot returns the first hit. */
export const AI_BOTS: readonly AiBot[] = [
  // OpenAI
  bot({ id: "chatgpt-user", label: "ChatGPT-User", operator: "openai", purpose: "user", tokens: ["ChatGPT-User"], docsUrl: OPENAI_DOCS, ipRanges: ["https://openai.com/chatgpt-user.json"], verified: true, note: "OpenAI: robots.txt rules may not apply to user-initiated fetches." }),
  bot({ id: "oai-searchbot", label: "OAI-SearchBot", operator: "openai", purpose: "search", tokens: ["OAI-SearchBot"], docsUrl: OPENAI_DOCS, ipRanges: ["https://openai.com/searchbot.json"], verified: true }),
  bot({ id: "oai-adsbot", label: "OAI-AdsBot", operator: "openai", purpose: "other", tokens: ["OAI-AdsBot"], docsUrl: OPENAI_DOCS, ipRanges: ["https://openai.com/adsbot.json"], verified: true, ai: false, note: "Checks ad landing pages; OpenAI says it is not used for training." }),
  bot({ id: "gptbot", label: "GPTBot", operator: "openai", purpose: "training", tokens: ["GPTBot"], docsUrl: OPENAI_DOCS, ipRanges: ["https://openai.com/gptbot.json"], verified: true }),
  // Anthropic (one IP file for all three)
  bot({ id: "claude-user", label: "Claude-User", operator: "anthropic", purpose: "user", tokens: ["Claude-User"], docsUrl: ANTHROPIC_DOCS, ipRanges: ANTHROPIC_IPS, verified: true }),
  bot({ id: "claude-searchbot", label: "Claude-SearchBot", operator: "anthropic", purpose: "search", tokens: ["Claude-SearchBot"], docsUrl: ANTHROPIC_DOCS, ipRanges: ANTHROPIC_IPS, verified: true }),
  bot({ id: "claudebot", label: "ClaudeBot", operator: "anthropic", purpose: "training", tokens: ["ClaudeBot"], docsUrl: ANTHROPIC_DOCS, ipRanges: ANTHROPIC_IPS, verified: true }),
  // Perplexity
  bot({ id: "perplexity-user", label: "Perplexity-User", operator: "perplexity", purpose: "user", tokens: ["Perplexity-User"], docsUrl: PPLX_DOCS, ipRanges: ["https://www.perplexity.ai/perplexity-user.json"], verified: true, note: "Perplexity: generally ignores robots.txt, as the user asked for the page." }),
  bot({ id: "perplexitybot", label: "PerplexityBot", operator: "perplexity", purpose: "search", tokens: ["PerplexityBot"], docsUrl: PPLX_DOCS, ipRanges: ["https://www.perplexity.ai/perplexitybot.json"], verified: true }),
  // Google
  bot({ id: "google-extended", label: "Google-Extended", operator: "google", purpose: "robots_only", tokens: [], docsUrl: GOOGLE_COMMON, ipRanges: null, verified: true, note: "A robots.txt token only: it has no user agent of its own, so it never appears in a log. Googlebot does the fetching." }),
  bot({ id: "google-agent", label: "Google-Agent", operator: "google", purpose: "user", tokens: ["Google-Agent"], docsUrl: GOOGLE_USER, ipRanges: GOOGLE_USER_IPS, verified: true }),
  bot({ id: "google-gemininotebook", label: "Google-GeminiNotebook", operator: "google", purpose: "user", tokens: ["Google-GeminiNotebook", "Google-NotebookLM"], docsUrl: GOOGLE_USER, ipRanges: GOOGLE_USER_IPS, verified: true, note: "Formerly Google-NotebookLM." }),
  bot({ id: "google-cloudvertexbot", label: "Google-CloudVertexBot", operator: "google", purpose: "search", tokens: ["Google-CloudVertexBot"], docsUrl: GOOGLE_COMMON, ipRanges: [`${GIP}common-crawlers.json`, `${GIP}special-crawlers.json`], verified: true, note: "Crawls that site owners request for Vertex AI Agents." }),
  bot({ id: "googlebot", label: "Googlebot", operator: "google", purpose: "search", tokens: ["Googlebot"], docsUrl: GOOGLE_COMMON, ipRanges: [`${GIP}common-crawlers.json`], verified: true, ai: false, note: "Google Search's crawler; AI Overviews and AI Mode answer from this index." }),
  // Microsoft
  bot({ id: "bingbot", label: "Bingbot", operator: "microsoft", purpose: "search", tokens: ["bingbot"], docsUrl: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0", ipRanges: ["https://www.bing.com/toolbox/bingbot.json"], verified: false, ai: false, note: "Bing's crawler; Copilot answers from its index. The IP list is official; the UA page could not be read (it renders in JavaScript), so the token is from widely published UAs." }),
  // Apple
  bot({ id: "applebot-extended", label: "Applebot-Extended", operator: "apple", purpose: "robots_only", tokens: [], docsUrl: APPLE_DOCS, ipRanges: null, verified: true, note: "A robots.txt token only: Apple says it does not crawl webpages." }),
  bot({ id: "applebot", label: "Applebot", operator: "apple", purpose: "search", tokens: ["Applebot"], docsUrl: APPLE_DOCS, ipRanges: ["https://search.developer.apple.com/applebot.json"], verified: true, note: "Spotlight, Siri and Safari search; Apple says content may also help train its models." }),
  // Common Crawl
  bot({ id: "ccbot", label: "CCBot", operator: "commoncrawl", purpose: "training", tokens: ["CCBot"], docsUrl: "https://commoncrawl.org/ccbot", ipRanges: ["https://index.commoncrawl.org/ccbot.json"], verified: true, note: "An open crawl corpus widely used for model training." }),
  // Meta (no IP list)
  bot({ id: "meta-externalfetcher", label: "Meta-ExternalFetcher", operator: "meta", purpose: "user", tokens: ["meta-externalfetcher"], docsUrl: META_DOCS, ipRanges: null, verified: true }),
  bot({ id: "meta-webindexer", label: "Meta-WebIndexer", operator: "meta", purpose: "search", tokens: ["meta-webindexer"], docsUrl: META_DOCS, ipRanges: null, verified: true }),
  bot({ id: "meta-externalagent", label: "Meta-ExternalAgent", operator: "meta", purpose: "training", tokens: ["meta-externalagent"], docsUrl: META_DOCS, ipRanges: null, verified: true }),
  bot({ id: "facebookexternalhit", label: "facebookexternalhit", operator: "meta", purpose: "other", tokens: ["facebookexternalhit"], docsUrl: META_DOCS, ipRanges: null, verified: true, ai: false, note: "Link previews." }),
  // Amazon (ranges are published as web pages, not machine-readable files)
  bot({ id: "amzn-user", label: "Amzn-User", operator: "amazon", purpose: "user", tokens: ["Amzn-User"], docsUrl: AMAZON_DOCS, ipRanges: null, verified: true }),
  bot({ id: "amzn-searchbot", label: "Amzn-SearchBot", operator: "amazon", purpose: "search", tokens: ["Amzn-SearchBot"], docsUrl: AMAZON_DOCS, ipRanges: null, verified: true }),
  bot({ id: "amazonbot", label: "Amazonbot", operator: "amazon", purpose: "training", tokens: ["Amazonbot"], docsUrl: AMAZON_DOCS, ipRanges: null, verified: true, note: "Amazon says it may be used to train its AI models." }),
  // others
  bot({ id: "duckassistbot", label: "DuckAssistBot", operator: "duckduckgo", purpose: "user", tokens: ["DuckAssistBot"], docsUrl: "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot", ipRanges: ["https://duckduckgo.com/duckassistbot.json"], verified: true, note: "Real-time fetches for DuckDuckGo's AI answers; not used for training." }),
  bot({ id: "mistralai-user", label: "MistralAI-User", operator: "mistral", purpose: "user", tokens: ["MistralAI-User"], docsUrl: "https://docs.mistral.ai/robots", ipRanges: ["https://mistral.ai/mistralai-user-ips.json"], verified: true }),
  bot({ id: "youbot", label: "YouBot", operator: "you", purpose: "search", tokens: ["YouBot"], docsUrl: "https://you.com/docs/youbot", ipRanges: null, verified: true }),
  bot({ id: "bytespider", label: "Bytespider", operator: "bytedance", purpose: "training", tokens: ["Bytespider"], docsUrl: null, ipRanges: null, verified: false, note: "No official page found; the token and purpose come from third-party lists." }),
  bot({ id: "cohere-ai", label: "cohere-ai", operator: "cohere", purpose: "training", tokens: ["cohere-training-data-crawler", "cohere-ai"], docsUrl: null, ipRanges: null, verified: false, note: "No official page found; the token and purpose come from third-party lists." }),
];

export const PURPOSE_LABEL: Readonly<Record<BotPurpose, string>> = {
  training: "Training",
  search: "Search index",
  user: "User-triggered fetch",
  robots_only: "robots.txt token only",
  other: "Other",
};

/** Which operator's crawlers stand behind an answer engine or surface, for the
 *  "did the engine that cited this page ever fetch it" join. */
export const ENGINE_OPERATOR: Readonly<Record<string, BotOperator>> = {
  chatgpt: "openai",
  claude: "anthropic",
  gemini: "google",
  google_ai_overview: "google",
  google_ai_mode: "google",
  perplexity: "perplexity",
  copilot: "microsoft",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The registry plus saylent.config `extraBots` (the same entries gate-check
 *  reads). An extra bot whose agent matches a shipped token replaces nothing:
 *  ours keep their documented purpose; a NEW agent is appended as `custom`. */
export function botRegistry(extra?: ExtraBot[] | null): AiBot[] {
  const list = AI_BOTS.slice();
  for (const e of extra ?? []) {
    const known = list.some((b) => b.tokens.some((t) => t.toLowerCase() === e.agent.toLowerCase()));
    if (known) continue;
    list.push({
      id: e.agent.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label: e.agent,
      operator: "custom",
      purpose: e.kind,
      tokens: [e.agent],
      docsUrl: null,
      ipRanges: null,
      verified: false,
      checked: REGISTRY_CHECKED,
      ai: true,
      note: "Added in saylent.config extraBots.",
    });
  }
  return list;
}

export interface BotMatcher {
  (userAgent: string | null | undefined): AiBot | null;
}

/** One compiled matcher over a registry. Tokens match at a word boundary so
 *  "GPTBot" never matches inside an unrelated longer product name. */
export function makeBotMatcher(registry: readonly AiBot[] = AI_BOTS): BotMatcher {
  const compiled = registry
    .filter((b) => b.tokens.length > 0)
    .map((b) => ({ bot: b, re: new RegExp(`(?:^|[^a-z0-9-])(?:${b.tokens.map(escapeRe).join("|")})(?:$|[^a-z0-9-])`, "i") }));
  return (ua) => {
    if (!ua) return null;
    for (const c of compiled) if (c.re.test(ua)) return c.bot;
    return null;
  };
}

export const matchBot: BotMatcher = makeBotMatcher();
