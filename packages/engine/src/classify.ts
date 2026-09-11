// The spec (see METHODOLOGY.md) — corpus classification: host lists first, then
// brand_owned, then title/url patterns, else "other". Pure + unit-tested.
const REVIEW_HOSTS = [
  "g2.com",
  "capterra.com",
  "trustpilot.com",
  "gartner.com",
  "trustradius.com",
  "producthunt.com",
  "clutch.co",
  "sourceforge.net",
];
const FORUM_HOSTS = [
  "reddit.com",
  "news.ycombinator.com",
  "quora.com",
  "stackoverflow.com",
  "stackexchange.com", // any *.stackexchange.com
  "indiehackers.com",
];
const WIKI_HOSTS = ["wikipedia.org", "wikidata.org"];
const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com"];

const LISTICLE = /\b(best|top\s*\d+|\d+\s+best)\b/i;
const COMPARISON = /\b(vs\.?|versus|compared?|alternatives?)\b/i;
const DOCS = /\b(docs?|documentation|api|guide)\b/i;
const NEWS = /\b(news|announc|launch|raises|funding)\b/i;

// Exact-or-subdomain only — a substring fallback let "youtu.be" match unrelated
// hosts like "youtu.beauty". Every list entry now carries its full domain.
const hostMatches = (host: string, needle: string) =>
  host === needle || host.endsWith(`.${needle}`);

export function classifyPage(args: {
  host: string;
  title: string;
  url: string;
  brandDomain: string;
}): string {
  const host = args.host.toLowerCase();
  const brandHost = args.brandDomain.toLowerCase().replace(/^www\./, "");
  if (REVIEW_HOSTS.some((h) => hostMatches(host, h))) return "review_platform";
  if (FORUM_HOSTS.some((h) => hostMatches(host, h))) return "forum";
  if (WIKI_HOSTS.some((h) => hostMatches(host, h))) return "wiki";
  // brand_owned BEFORE video: a brand whose own domain is youtube/vimeo keeps it.
  if (brandHost && host.includes(brandHost)) return "brand_owned";
  if (VIDEO_HOSTS.some((h) => hostMatches(host, h))) return "video";
  const haystack = `${args.title} ${args.url}`;
  if (LISTICLE.test(haystack)) return "listicle";
  if (COMPARISON.test(haystack)) return "comparison";
  if (DOCS.test(haystack)) return "docs";
  if (NEWS.test(haystack)) return "news";
  return "other";
}
