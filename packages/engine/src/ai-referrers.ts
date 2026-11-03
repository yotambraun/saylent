// AI referral visits: the ONE list of AI assistants whose links send people to
// a site, by the host a browser names in its Referer header. Matching is data,
// not conditionals: add an assistant here and every surface (saylent crawlers,
// crawlers.md, the MCP tool, the app's brand page, the export) counts it.
//
// HOW A VISIT IS MATCHED (aiReferral below):
//   1. the request's Referer host is one of `hosts`, or a subdomain of one; or
//   2. the request's utm_source value is one of `hosts` (ChatGPT adds
//      `utm_source=chatgpt.com` to the links it shows, per OpenAI's
//      Publishers and developers FAQ, help.openai.com/en/articles/12627856).
// Only requests whose user agent is not a known bot are counted.
//
// LIMITS, said wherever the number is shown: many visits from an assistant
// carry no Referer at all (native apps, privacy settings, a link copied into
// a new tab) and no utm_source, so they look like direct traffic. The count is
// a floor, never a total. Hosts are each assistant's public web address as of
// 2026-11-02; an older address that now redirects stays listed, because
// older links and some browsers still send it (copilot.microsoft.com now
// redirects to copilot.com, chat.openai.com to chatgpt.com).

export interface AiAssistant {
  id: string;
  label: string;
  operator: string;
  /** the assistant's own web hosts (lowercase, no www.) */
  hosts: readonly string[];
}

export const AI_REFERRERS_CHECKED = "2026-11-02";

export const AI_ASSISTANTS: readonly AiAssistant[] = [
  { id: "chatgpt", label: "ChatGPT", operator: "OpenAI", hosts: ["chatgpt.com", "chat.openai.com"] },
  { id: "perplexity", label: "Perplexity", operator: "Perplexity", hosts: ["perplexity.ai"] },
  { id: "claude", label: "Claude", operator: "Anthropic", hosts: ["claude.ai"] },
  { id: "gemini", label: "Gemini", operator: "Google", hosts: ["gemini.google.com"] },
  { id: "copilot", label: "Microsoft Copilot", operator: "Microsoft", hosts: ["copilot.com", "copilot.microsoft.com"] },
  { id: "deepseek", label: "DeepSeek", operator: "DeepSeek", hosts: ["chat.deepseek.com"] },
  { id: "mistral", label: "Le Chat", operator: "Mistral AI", hosts: ["chat.mistral.ai"] },
  { id: "grok", label: "Grok", operator: "xAI", hosts: ["grok.com"] },
  { id: "meta-ai", label: "Meta AI", operator: "Meta", hosts: ["meta.ai"] },
];

export type ReferralVia = "referrer" | "utm_source";

const bare = (h: string) => h.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");

function byHost(host: string): AiAssistant | null {
  const h = bare(host);
  if (!h) return null;
  for (const a of AI_ASSISTANTS) {
    if (a.hosts.some((x) => h === x || h.endsWith(`.${x}`))) return a;
  }
  return null;
}

/** Which assistant a request came from, and how we know, or null. The
 *  Referer host wins over utm_source when both name one. */
export function aiReferral(refererHost: string | null, utmSource: string | null): { assistant: AiAssistant; via: ReferralVia } | null {
  const fromRef = refererHost ? byHost(refererHost) : null;
  if (fromRef) return { assistant: fromRef, via: "referrer" };
  const fromUtm = utmSource ? byHost(utmSource) : null;
  if (fromUtm) return { assistant: fromUtm, via: "utm_source" };
  return null;
}
