// The scripted sample report: a FICTIONAL brand ("Acme Cloud") with fictional
// rivals and .example sources, written to show the full customer journey
// (the judge, the source map, the intelligence panels): losing where it hurts,
// per-claim perception (praise vs doubts), a competitor-owned cited page,
// opportunity pages, a CDN-blocked bot caught live, and drafted artifacts with
// the shipped fix-title style. Clearly labelled as scripted on the page.
//
// The dataset lights up EVERY panel the Dossier renders — conditional steers (verdict.segments), quoted pricing incl. a
// deliberate $0.04-vs-$0.06 inconsistency (verdict.pricing_claims), an ACME-protocol
// entity confusion (verdict.entity_confusion), the 3× confidence band
// (scores.recommended_band), a healthy run (runs.health, so the degraded caveat
// correctly stays quiet), the crawled own-site coverage map (runs.site_pages), the
// brand-model value props (runs.brand_model), plus executable "Submit via:" + depth
// evidence (corpus contact/page_date) and a citation-longtail fix. Shapes mirror the
// SHIPPED dossier exactly: verdict.claims = {text, kind}[] (kind ∈ praise|risk|
// neutral_fact), verdict.other_brands = {name, why}[], verdict.segments =
// {segment, winner, reason}[]; fixes carry the outcome-first titles + anchored [qid]
// evidence + citation-mix line that src/engine/fixes.ts (diagnose) now produces.
import type { RunRow } from "@saylent/report/components/run-view";

export const SAMPLE_BRAND = {
  name: "Acme Cloud",
  domain: "acmecloud.example",
  aliases: ["Acme Cloud", "acmecloud"],
  competitors: ["Nimbus", "StratoCDN", "Fleetly"],
};

// The run carries the run-level snapshots the pipeline writes onto runs.* —
// RunRow proper does not type them (the Dossier reads them via tolerant casts, so
// old runs self-hide every panel). We widen the sample's type so they type-check
// here; the /demo page passes it back as `run as RunRow`.
type SampleRun = RunRow & {
  health?: { answers?: Record<string, { got?: number; expected?: number }> | null } | null;
  site_pages?: { url: string; title: string; date?: string }[] | null;
  brand_model?: { value_props?: string[]; confidence?: string } | null;
};

export const SAMPLE_RUN: SampleRun = {
  id: "sample",
  kind: "audit",
  status: "done",
  stage: "done",
  profile: "full",
  est_cost_usd: 3.1,
  error: null,
  created_at: "2026-06-18T09:00:00Z",
  finished_at: "2026-06-18T09:09:32Z",
  scores: {
    per_engine: {
      chatgpt: { answered: 12, recommended: 0, mentioned: 3, rec_rate: 0, mention_rate: 0.25 },
      claude: { answered: 12, recommended: 1, mentioned: 5, rec_rate: 0.08, mention_rate: 0.42 },
      gemini: { answered: 12, recommended: 0, mentioned: 4, rec_rate: 0, mention_rate: 0.33 },
      perplexity: { answered: 12, recommended: 2, mentioned: 7, rec_rate: 0.17, mention_rate: 0.58 },
    },
    overall: { answered: 48, recommended: 3, mentioned: 19, rec_rate: 0.06, mention_rate: 0.4 },
    share_of_voice: { Nimbus: 31, StratoCDN: 22, Fleetly: 14, "Acme Cloud": 6, EdgeBox: 4 },
    // 3× sampling variance (score.ts::recommendedBand). A real range (min≠max) tells
    // the honest story: "recommended in 2–5 of 48 — the number moves when we re-ask".
    // Straddles the point estimate (overall.recommended = 3); per-engine straddles each.
    recommended_band: {
      overall: { min: 2, max: 5 },
      per_engine: {
        chatgpt: { min: 0, max: 1 },
        claude: { min: 1, max: 2 },
        gemini: { min: 0, max: 1 },
        perplexity: { min: 1, max: 3 },
      },
    },
  },
  // A HEALTHY run: every engine delivered all 12 → degradedEngines() = [] → the
  // low-confidence caveat correctly does NOT fire (the band + panels carry the story).
  health: {
    answers: {
      chatgpt: { got: 12, expected: 12 },
      claude: { got: 12, expected: 12 },
      gemini: { got: 12, expected: 12 },
      perplexity: { got: 12, expected: 12 },
    },
  },
  // Crawled own-site pages (runs.site_pages, meta only) — feeds the own-site coverage
  // map. Most carry a sitemap <lastmod>; one is deliberately undated. Only the /docs
  // page is actually cited by an engine (see SAMPLE_CORPUS p8), so coverage is 1 of 5.
  site_pages: [
    { url: "https://acmecloud.example/", title: "Acme Cloud — edge delivery for high-traffic SaaS", date: "2026-05-02" },
    { url: "https://acmecloud.example/docs", title: "Acme Cloud documentation", date: "2026-06-10" },
    { url: "https://acmecloud.example/pricing", title: "Pricing — flat, public, per-GB — Acme Cloud", date: "2026-04-18" },
    { url: "https://acmecloud.example/product/edge-network", title: "The Acme Cloud edge network", date: "2026-03-27" },
    { url: "https://acmecloud.example/blog/cache-hit-ratio", title: "Cut origin egress: raising your cache-hit ratio", date: "2026-06-28" },
    { url: "https://acmecloud.example/security", title: "Security & compliance at Acme Cloud" },
  ],
  // How the engines COULD describe Acme from its own site (runs.brand_model) — the
  // top-of-report honesty line. confidence "high" ⇒ no thin-crawl warning.
  brand_model: {
    value_props: [
      "flat, public pricing",
      "unusually fast human support",
      "p95 latency within 4% of the market leader",
      "18-month clean incident record",
    ],
    confidence: "high",
  },
};

// E2a shapes: claims carry their OWN polarity ({text, kind}); other_brands
// carry the answer's STATED reason ({name, why}) — never invented.
type Claim = { text: string; kind: "praise" | "risk" | "neutral_fact" };
type Rival = { name: string; why: string };
// The conditional-steer structure the judge mines verbatim
// ("pick {winner} if {segment} — {reason}"). winner === the audited brand ⇒ an
// "own segment"; a rival ⇒ a steer the engines send that buyer elsewhere.
type Segment = { segment: string; winner: string; reason: string };
type VExtra = { segments?: Segment[]; pricing_claims?: string[]; entity_confusion?: boolean };
const V = (
  present: boolean,
  mention: string,
  prominence: string,
  sentiment: string,
  others: Rival[],
  excerpt: string,
  claims: Claim[] = [],
  extra: VExtra = {},
) => ({
  brand_present: present,
  mention_type: mention,
  prominence,
  sentiment,
  claims,
  other_brands: others,
  excerpt,
  ...extra,
});

const C = (url: string, title: string) => ({ url, title });

export const SAMPLE_ANSWERS = [
  // q01 — the headline loss
  {
    id: "s1", qid: "q01", qtype: "category",
    question: "What is the best edge CDN platform for a high-traffic SaaS?",
    engine: "chatgpt", ok: true,
    raw_text:
      "For a high-traffic SaaS, the strongest options today are:\n\n1. **Nimbus** — the most complete platform: global network, built-in WAF and DDoS protection, and a generous free tier. The default choice for most SaaS teams.\n2. **StratoCDN** — enterprise-grade with the largest points-of-presence footprint; best when compliance and SLAs dominate.\n3. **Fleetly** — developer-first, programmable edge logic, sub-second cache purge.\n\nFor most SaaS teams, Nimbus offers the best balance of performance, security and cost.",
    citations: [C("https://cloudreview.example/best-edge-cdn", "Best Edge CDNs compared"), C("https://stackship.example/cdn-guide", "The SaaS CDN buyer's guide")],
    verdict: V(false, "absent", "none", "neutral",
      [
        { name: "Nimbus", why: "the most complete platform" },
        { name: "StratoCDN", why: "enterprise-grade, largest points-of-presence footprint" },
        { name: "Fleetly", why: "developer-first, programmable edge logic" },
      ],
      "For a high-traffic SaaS, the strongest options today are: 1. Nimbus — the most complete platform…",
      [],
      {
        segments: [
          { segment: "most SaaS teams wanting one all-in-one default", winner: "Nimbus", reason: "the most complete platform" },
          { segment: "compliance-heavy, SLA-driven enterprises", winner: "StratoCDN", reason: "deeper audit tooling and the largest PoP footprint" },
          { segment: "teams writing custom edge logic", winner: "Fleetly", reason: "developer-first, programmable edge" },
        ],
      }),
    error: null,
  },
  {
    id: "s2", qid: "q01", qtype: "category",
    question: "What is the best edge CDN platform for a high-traffic SaaS?",
    engine: "claude", ok: true,
    raw_text:
      "Several platforms fit a high-traffic SaaS well:\n\n- **Nimbus**: broadest feature set and ecosystem; strong security defaults.\n- **StratoCDN**: enterprise SLAs, strongest compliance story.\n- **Acme Cloud**: a smaller player worth a look for its transparent pricing and unusually fast support — though its network is more limited than the leaders'.\n\nIf raw scale matters most, Nimbus or StratoCDN; if cost predictability and support matter, Acme Cloud is a credible pick.",
    citations: [C("https://cloudreview.example/best-edge-cdn", "Best Edge CDNs compared"), C("https://devforum.example/t/cdn-for-saas", "Which CDN for a growing SaaS? (thread)")],
    verdict: V(true, "listed", "buried", "positive",
      [
        { name: "Nimbus", why: "broadest feature set and ecosystem" },
        { name: "StratoCDN", why: "enterprise SLAs, strongest compliance story" },
      ],
      "…Acme Cloud: a smaller player worth a look for its transparent pricing and unusually fast support…",
      [
        { text: "transparent pricing", kind: "praise" },
        { text: "unusually fast support", kind: "praise" },
        { text: "smaller network than the market leaders", kind: "risk" },
      ],
      {
        pricing_claims: ["flat, published pricing"],
        segments: [
          { segment: "teams optimizing for predictable cost and fast support", winner: "Acme Cloud", reason: "transparent pricing and unusually fast support" },
          { segment: "teams that need raw global scale", winner: "Nimbus", reason: "broadest feature set and ecosystem" },
          { segment: "enterprises with strict compliance", winner: "StratoCDN", reason: "strongest compliance story" },
        ],
      }),
    error: null,
  },
  {
    id: "s3", qid: "q01", qtype: "category",
    question: "What is the best edge CDN platform for a high-traffic SaaS?",
    engine: "gemini", ok: true,
    raw_text:
      "Top edge CDN platforms for high-traffic SaaS in 2026:\n\n**Nimbus** — most popular overall; excellent developer experience.\n**StratoCDN** — the enterprise pick.\n**Fleetly** — best programmable edge.\n**EdgeBox** — budget option.\n\nThe right choice depends on traffic profile and compliance needs; Nimbus is the safest default.",
    citations: [C("https://cloudreview.example/best-edge-cdn", "Best Edge CDNs compared"), C("https://saastools.example/cdn-category", "CDN category — SaaSTools directory")],
    verdict: V(false, "absent", "none", "neutral",
      [
        { name: "Nimbus", why: "most popular; excellent developer experience" },
        { name: "StratoCDN", why: "the enterprise pick" },
        { name: "Fleetly", why: "best programmable edge" },
        { name: "EdgeBox", why: "budget option" },
      ],
      "Top edge CDN platforms for high-traffic SaaS in 2026: Nimbus — most popular overall…",
      [],
      {
        segments: [
          { segment: "teams wanting the safest popular default", winner: "Nimbus", reason: "most popular, excellent developer experience" },
          { segment: "budget-first buyers", winner: "EdgeBox", reason: "the cheapest option" },
        ],
      }),
    error: null,
  },
  {
    id: "s4", qid: "q01", qtype: "category",
    question: "What is the best edge CDN platform for a high-traffic SaaS?",
    engine: "perplexity", ok: true,
    raw_text:
      "Based on recent comparisons and community discussion, the leading options are Nimbus (most complete), StratoCDN (enterprise) and Acme Cloud, which multiple recent threads recommend for SaaS teams that want predictable pricing — public rates land around $0.06 per GB of egress, and one developer benchmark measured Acme's cache-hit latency within 4% of Nimbus at roughly 60% of the cost.",
    citations: [C("https://devforum.example/t/cdn-for-saas", "Which CDN for a growing SaaS? (thread)"), C("https://benchmarks.example/cdn-latency-2026", "Independent CDN latency benchmark 2026")],
    verdict: V(true, "recommended", "early", "positive",
      [
        { name: "Nimbus", why: "the most complete platform" },
        { name: "StratoCDN", why: "enterprise" },
      ],
      "…and Acme Cloud, which multiple recent threads recommend for SaaS teams that want predictable pricing…",
      [
        { text: "predictable pricing", kind: "praise" },
        { text: "cache-hit latency within 4% of Nimbus", kind: "praise" },
        { text: "roughly 60% of the cost of Nimbus", kind: "praise" },
      ],
      {
        pricing_claims: ["$0.06 per GB of egress", "about 60% of Nimbus's cost"],
        segments: [
          { segment: "SaaS teams that want predictable pricing", winner: "Acme Cloud", reason: "flat public rates at ~60% of Nimbus's cost" },
        ],
      }),
    error: null,
  },
  // q05 — reliability question, Acme mostly absent
  {
    id: "s5", qid: "q05", qtype: "category",
    question: "Most reliable edge CDN platform for a high-traffic SaaS?",
    engine: "chatgpt", ok: true,
    raw_text: "Reliability leaders: **StratoCDN** (99.999% SLA, strongest track record) and **Nimbus** (excellent status transparency). Fleetly has improved after its 2025 incidents. For mission-critical SaaS, StratoCDN is the conservative choice.",
    citations: [C("https://uptimewatch.example/cdn-report", "CDN reliability report"), C("https://cloudreview.example/best-edge-cdn", "Best Edge CDNs compared")],
    verdict: V(false, "absent", "none", "neutral",
      [
        { name: "StratoCDN", why: "99.999% SLA, strongest track record" },
        { name: "Nimbus", why: "excellent status transparency" },
        { name: "Fleetly", why: "improved after its 2025 incidents" },
      ],
      "Reliability leaders: StratoCDN (99.999% SLA, strongest track record) and Nimbus…",
      [],
      {
        segments: [
          { segment: "mission-critical SaaS that cannot take an outage", winner: "StratoCDN", reason: "99.999% SLA and the strongest track record" },
          { segment: "teams that value live status transparency", winner: "Nimbus", reason: "excellent status transparency" },
        ],
      }),
    error: null,
  },
  {
    id: "s6", qid: "q05", qtype: "category",
    question: "Most reliable edge CDN platform for a high-traffic SaaS?",
    engine: "perplexity", ok: true,
    raw_text: "StratoCDN and Nimbus top the independent uptime trackers. Community threads also note Acme Cloud's 18-month clean incident record, though its tracker history is shorter.",
    citations: [C("https://uptimewatch.example/cdn-report", "CDN reliability report"), C("https://devforum.example/t/cdn-for-saas", "Which CDN for a growing SaaS? (thread)")],
    verdict: V(true, "listed", "buried", "positive",
      [
        { name: "StratoCDN", why: "top of independent uptime trackers" },
        { name: "Nimbus", why: "top of independent uptime trackers" },
      ],
      "…Acme Cloud's 18-month clean incident record, though its tracker history is shorter.",
      [
        { text: "18-month clean incident record", kind: "praise" },
        { text: "shorter tracker history than incumbents", kind: "risk" },
      ],
      {
        segments: [
          { segment: "buyers who want the longest proven uptime history", winner: "StratoCDN", reason: "top of the independent uptime trackers" },
        ],
      }),
    error: null,
  },
  // q09 — comparison
  {
    id: "s7", qid: "q09", qtype: "comparison",
    question: "Acme Cloud vs Nimbus: which is better for a high-traffic SaaS?",
    engine: "chatgpt", ok: true,
    raw_text: "**Nimbus** is the more complete platform: bigger network, integrated security suite, larger ecosystem. **Acme Cloud** counters with simpler, predictable pricing — a flat $0.04 per GB of egress — and strong support. For most high-traffic SaaS, Nimbus is the safer choice; Acme Cloud suits teams optimizing for cost clarity.",
    citations: [C("https://cloudreview.example/acme-vs-nimbus", "Acme Cloud vs Nimbus"), C("https://saastools.example/cdn-category", "CDN category — SaaSTools directory")],
    verdict: V(true, "compared", "early", "neutral",
      [{ name: "Nimbus", why: "the most complete platform" }],
      "Acme Cloud counters with simpler, predictable pricing and strong support.",
      [
        { text: "simpler, predictable pricing", kind: "praise" },
        { text: "strong support", kind: "praise" },
      ],
      {
        pricing_claims: ["$0.04 per GB of egress"],
        segments: [
          { segment: "teams optimizing for cost clarity", winner: "Acme Cloud", reason: "simpler, predictable pricing and strong support" },
          { segment: "most high-traffic SaaS wanting the safer, more complete platform", winner: "Nimbus", reason: "bigger network and an integrated security suite" },
        ],
      }),
    error: null,
  },
  {
    id: "s8", qid: "q09", qtype: "comparison",
    question: "Acme Cloud vs Nimbus: which is better for a high-traffic SaaS?",
    engine: "gemini", ok: true,
    raw_text: "Nimbus generally wins on network size and features. Acme Cloud's advantages are pricing transparency and support quality. Verdict: Nimbus for scale, Acme Cloud for predictable costs.",
    citations: [C("https://cloudreview.example/acme-vs-nimbus", "Acme Cloud vs Nimbus"), C("https://nimbus.example/why-nimbus-beats", "Why Nimbus beats the alternatives")],
    verdict: V(true, "compared", "early", "neutral",
      [{ name: "Nimbus", why: "wins on network size and features" }],
      "Acme Cloud's advantages are pricing transparency and support quality.",
      [
        { text: "pricing transparency", kind: "praise" },
        { text: "support quality", kind: "praise" },
      ],
      {
        pricing_claims: ["flat, published pricing"],
        segments: [
          { segment: "teams prioritizing network size and features", winner: "Nimbus", reason: "wins on network size and features" },
          { segment: "teams prioritizing predictable costs", winner: "Acme Cloud", reason: "pricing transparency and support quality" },
        ],
      }),
    error: null,
  },
  // q14 — problem question, Acme invisible
  {
    id: "s9", qid: "q14", qtype: "problem",
    question: "How do I cut origin egress costs at peak traffic? Which providers help?",
    engine: "claude", ok: true,
    raw_text: "Origin egress at peak is usually solved with tiered caching and origin shielding. Nimbus and Fleetly both offer origin shield included; StratoCDN prices it as an add-on. Start by measuring your cache-hit ratio — below 85% there's usually easy headroom.",
    citations: [C("https://stackship.example/cdn-guide", "The SaaS CDN buyer's guide"), C("https://devforum.example/t/cdn-for-saas", "Which CDN for a growing SaaS? (thread)")],
    verdict: V(false, "absent", "none", "neutral",
      [
        { name: "Nimbus", why: "origin shield included" },
        { name: "Fleetly", why: "origin shield included" },
        { name: "StratoCDN", why: "prices origin shield as an add-on" },
      ],
      "Nimbus and Fleetly both offer origin shield included; StratoCDN prices it as an add-on…",
      [],
      {
        segments: [
          { segment: "teams that want origin shield included by default", winner: "Nimbus", reason: "origin shield included, no add-on" },
          { segment: "teams already running programmable edge logic", winner: "Fleetly", reason: "origin shield included" },
        ],
      }),
    error: null,
  },
  // q18 — branded
  {
    id: "s10", qid: "q18", qtype: "branded",
    question: "What is Acme Cloud? Is it any good?",
    engine: "chatgpt", ok: true,
    raw_text: "Acme Cloud is an edge CDN platform aimed at SaaS teams. It's known for transparent flat pricing — flat monthly plans starting at $49/mo — and responsive support. Reviews describe it as a solid mid-market option; its network is smaller than the market leaders', which can matter for globally distributed audiences.",
    citations: [C("https://saastools.example/cdn-category", "CDN category — SaaSTools directory"), C("https://acmecloud.example/docs", "Acme Cloud documentation")],
    verdict: V(true, "listed", "first", "positive", [],
      "Acme Cloud is an edge CDN platform aimed at SaaS teams. It's known for transparent flat pricing…",
      [
        { text: "transparent flat pricing", kind: "praise" },
        { text: "responsive support", kind: "praise" },
        { text: "a solid mid-market option", kind: "neutral_fact" },
        { text: "smaller network than the market leaders", kind: "risk" },
      ],
      { pricing_claims: ["flat plans from $49/mo"] }),
    error: null,
  },
  // q18 — the entity-confusion case: "Acme" collides with the ACME certificate
  // certificate-management protocol, so Gemini answers about the WRONG entity. Pairs with
  // the c7 homepage-entity-clarity warn + the f9 entity_unclear fix (coherent story:
  // the homepage never says "CDN", so an engine guesses the protocol).
  {
    id: "s11", qid: "q18", qtype: "branded",
    question: "What is Acme Cloud? Is it any good?",
    engine: "gemini", ok: true,
    raw_text:
      "\"ACME\" most commonly refers to the Automated Certificate Management Environment — the open protocol used to issue and renew TLS certificates automatically. If you mean a specific product called \"Acme Cloud,\" I don't have enough reliable detail; the name overlaps with the certificate-management protocol and with several unrelated companies that use \"Acme\" as a placeholder brand.",
    citations: [C("https://certguide.example/acme-protocol", "The ACME certificate protocol, explained")],
    verdict: V(false, "absent", "none", "neutral", [],
      "\"ACME\" most commonly refers to the Automated Certificate Management Environment — the open protocol used to issue and renew TLS certificates…",
      [],
      { entity_confusion: true }),
    error: null,
  },
] as const;

// Pitch-target rows carry `contact` (mailto / write-for-us form /
// review-platform claim URL) + `page_date` (the winning page's freshness), the
// enrichment src/engine/corpus.ts scrapes. The Dossier view ignores them, but they
// are the source the fix engine turns into the "Submit via:" + depth evidence lines
// baked into SAMPLE_FIXES below — kept here so the demo's data + fixes stay coherent.
export const SAMPLE_CORPUS = [
  {
    id: "p1", url: "https://cloudreview.example/best-edge-cdn", final_url: "https://cloudreview.example/best-edge-cdn",
    title: "Best Edge CDNs compared (2026)", page_type: "listicle",
    cited_by: { chatgpt: 6, gemini: 4, claude: 3 }, cited_for_qids: ["q01", "q05", "q09"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["Nimbus", "StratoCDN", "Fleetly"], opportunity: true,
    page_date: "2026-05-14", contact: { form_url: "https://cloudreview.example/write-for-us" },
  },
  {
    id: "p2", url: "https://devforum.example/t/cdn-for-saas", final_url: "https://devforum.example/t/cdn-for-saas",
    title: "Which CDN for a growing SaaS? (thread)", page_type: "forum",
    cited_by: { perplexity: 5, claude: 2 }, cited_for_qids: ["q01", "q05"],
    fetch_status: 200, brand_present: true,
    brand_context: "…third vote for Acme Cloud here — their support actually answers within the hour and the bill never surprises us…",
    competitors_present: ["Nimbus", "Fleetly"], opportunity: false,
    page_date: "2026-06-05",
  },
  {
    id: "p3", url: "https://stackship.example/cdn-guide", final_url: "https://stackship.example/cdn-guide",
    title: "The SaaS CDN buyer's guide", page_type: "listicle",
    cited_by: { chatgpt: 3, gemini: 2 }, cited_for_qids: ["q01", "q14"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["Nimbus", "StratoCDN"], opportunity: true,
    page_date: "2026-04-02", contact: { mailto: "editors@stackship.example" },
  },
  {
    id: "p4", url: "https://saastools.example/cdn-category", final_url: "https://saastools.example/cdn-category",
    title: "CDN category — SaaSTools directory", page_type: "review_platform",
    cited_by: { gemini: 3, chatgpt: 2 }, cited_for_qids: ["q01", "q09"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["Nimbus", "StratoCDN", "Fleetly"], opportunity: true,
    page_date: "2026-06-01", contact: { claim_url: "https://saastools.example/claim" },
  },
  {
    id: "p5", url: "https://benchmarks.example/cdn-latency-2026", final_url: "https://benchmarks.example/cdn-latency-2026",
    title: "Independent CDN latency benchmark 2026", page_type: "comparison",
    cited_by: { perplexity: 3 }, cited_for_qids: ["q01"],
    fetch_status: 200, brand_present: true,
    brand_context: "…Acme Cloud's p95 cache-hit latency landed within 4% of Nimbus across EU and US regions…",
    competitors_present: ["Nimbus", "StratoCDN"], opportunity: false,
    page_date: "2026-06-15",
  },
  {
    id: "p6", url: "https://uptimewatch.example/cdn-report", final_url: "https://uptimewatch.example/cdn-report",
    title: "CDN reliability report", page_type: "comparison",
    cited_by: { chatgpt: 2, perplexity: 2 }, cited_for_qids: ["q05"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["StratoCDN", "Nimbus", "Fleetly"], opportunity: true,
    page_date: "2026-05-20", contact: { mailto: "hello@uptimewatch.example" },
  },
  {
    // competitor-OWNED cited page (host nimbus.example → owned by rival Nimbus).
    // Drives the "Counter the competitor pages" fix — you can't pitch a rival's
    // own page, so the fix drafts an answer page instead.
    id: "p7", url: "https://nimbus.example/why-nimbus-beats", final_url: "https://nimbus.example/why-nimbus-beats",
    title: "Why Nimbus beats the alternatives", page_type: "comparison",
    cited_by: { chatgpt: 2, gemini: 1 }, cited_for_qids: ["q09", "q01"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["Nimbus"], opportunity: true,
    page_date: "2026-03-19",
  },
  {
    id: "p8", url: "https://acmecloud.example/docs", final_url: "https://acmecloud.example/docs",
    title: "Acme Cloud documentation", page_type: "brand_owned",
    cited_by: { claude: 1 }, cited_for_qids: ["q18"],
    fetch_status: 200, brand_present: true, brand_context: "Official documentation.",
    competitors_present: [], opportunity: false,
    page_date: "2026-06-10",
  },
  // The long tail: single-engine opportunity outlets beyond the top-4 pitches —
  // they roll into ONE "work the long tail" fix (fix_key citation-longtail) instead
  // of being silently dropped. Low citation depth ⇒ they never outrank the consensus
  // pages in the battlefield / loss map, and single-engine ⇒ they stay out of the
  // consensus strip. One carries no contact (the honest "no channel found" case).
  {
    id: "p9", url: "https://reviewsignal.example/cdn-roundup", final_url: "https://reviewsignal.example/cdn-roundup",
    title: "The 2026 edge-CDN roundup", page_type: "listicle",
    cited_by: { perplexity: 2 }, cited_for_qids: ["q01"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["Nimbus", "Fleetly"], opportunity: true,
    page_date: "2026-06-12", contact: { mailto: "tips@reviewsignal.example" },
  },
  {
    id: "p10", url: "https://apidigest.example/edge-cdns", final_url: "https://apidigest.example/edge-cdns",
    title: "Edge CDNs for API-heavy products", page_type: "news",
    cited_by: { claude: 1 }, cited_for_qids: ["q14"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["Nimbus"], opportunity: true,
    page_date: "2026-05-30",
  },
  {
    id: "p11", url: "https://cdncompare.example/2026", final_url: "https://cdncompare.example/2026",
    title: "CDN comparison 2026", page_type: "comparison",
    cited_by: { gemini: 2 }, cited_for_qids: ["q09"],
    fetch_status: 200, brand_present: false, brand_context: null,
    competitors_present: ["Nimbus", "StratoCDN"], opportunity: true,
    page_date: "2026-04-22", contact: { form_url: "https://cdncompare.example/contribute" },
  },
] as const;

export const SAMPLE_CHECKS = [
  { id: "c1", check_name: "live fetch as PerplexityBot", status: "fail", factor: "access_blocked",
    detail: "HTTP 403 while robots.txt allows it. A CDN/WAF \"AI bots\" toggle is overriding your robots.txt. Perplexity cannot cite what it cannot read." },
  { id: "c2", check_name: "content coverage", status: "fail", factor: "coverage_gap",
    detail: "No page on acmecloud.example answers 3 of your 17 buyer questions. Top gaps: [q05] Most reliable edge CDN platform? · [q14] How do I cut origin egress costs at peak? · [q01] best edge CDN for high-traffic SaaS" },
  { id: "c3", check_name: "robots: GPTBot", status: "pass", factor: null, detail: "allowed" },
  { id: "c4", check_name: "robots: OAI-SearchBot", status: "pass", factor: null, detail: "allowed" },
  { id: "c5", check_name: "JSON-LD Organization", status: "pass", factor: null, detail: "present" },
  { id: "c6", check_name: "JSON-LD FAQPage", status: "warn", factor: "schema_missing", detail: "No FAQPage schema found on crawled pages." },
  { id: "c7", check_name: "homepage entity clarity", status: "warn", factor: "entity_unclear",
    detail: "The homepage's first 800 chars never say \"CDN\": engines must guess what Acme Cloud is." },
  { id: "c8", check_name: "live-fetch caveat", status: "info", factor: null,
    detail: "IP-verifying CDNs may treat our test differently than real bots; your server logs are ground truth." },
] as const;

// The citation-mix line diagnose() appends to every source/coverage fix
// (7 of 8 engine-cited pages are third-party; only acmecloud.example/docs is owned).
const MIX = "91% of the pages the engines cited are third-party. 9% are acmecloud.example";

export const SAMPLE_FIXES = [
  {
    id: "f1", fix_key: "access", title: "Unblock the AI crawlers your buyers' engines depend on",
    factor: "access_blocked", weight: 9.5, effort: "S",
    time_to_impact: "days–2 weeks (bots recrawl quickly once allowed)",
    engines: ["chatgpt", "gemini", "claude"],
    evidence: [
      "live fetch as PerplexityBot: HTTP 403 while robots.txt allows it. A CDN/WAF \"AI bots\" toggle is overriding your robots.txt. Perplexity cannot cite what it cannot read.",
      "Perplexity is your STRONGEST engine (recommended 2/12), and it's the one being blocked",
    ],
    artifact:
      "# robots.txt: AI crawler block (paste, then check the CDN toggle)\nUser-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: ChatGPT-User\nAllow: /\n\nUser-agent: Claude-SearchBot\nAllow: /\n\nUser-agent: Claude-User\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Perplexity-User\nAllow: /\n\n# Your choice: training crawlers (blocking is legitimate):\n# User-agent: GPTBot\n# Disallow: /\n# User-agent: ClaudeBot\n# Disallow: /\n\n## Verify the real gate (robots.txt is only a request):\n1. CDN dashboard → Security → Bot management → disable the \"Block AI bots\" preset (or allowlist PerplexityBot).\n2. Re-test: curl -A \"PerplexityBot\" https://acmecloud.example/ → expect 200.\n3. Watch server logs for PerplexityBot hits over the next 48h.",
    published_at: null,
  },
  {
    id: "f2", fix_key: "source-cloudreview.example",
    title: "Get added to \"Best Edge CDNs compared (2026)\" (cloudreview.example): the engines cite it and you're not on it",
    factor: "citation_source_gap", weight: 9.3, effort: "M",
    time_to_impact: "2–4 weeks (ChatGPT) → 4–8 weeks (Gemini)",
    engines: ["chatgpt", "gemini", "claude"],
    evidence: [
      "Cited chatgpt×6, gemini×4, claude×3 for q01, q05, q09",
      "Competitors on the page: Nimbus, StratoCDN, Fleetly",
      "URL: https://cloudreview.example/best-edge-cdn",
      "Submit via: https://cloudreview.example/write-for-us",
      "The page winning this question runs ~2,400 words / 12 sections. Match its depth.",
      MIX,
    ],
    artifact:
      "Subject: A data point for your Edge CDN comparison\n\nHi {author name},\n\nYour \"Best Edge CDNs compared\" guide is one of the most-cited pages when AI assistants answer CDN questions. We measured it used 13 times across ChatGPT, Gemini and Claude answers.\n\nOne gap you might find worth closing: Acme Cloud. The independent 2026 latency benchmark measured our p95 cache-hit latency within 4% of Nimbus at ~60% of the cost, and we publish flat, public pricing: a genuinely different trade-off from the three platforms you cover.\n\nHappy to send benchmark data, a test account, or answer anything directly. No expectations. The guide is excellent either way.\n\nDisclosure: I work at Acme Cloud.\n\n{maintainer name}, Acme Cloud",
    published_at: null,
  },
  {
    id: "f3", fix_key: "source-stackship.example",
    title: "Get added to \"The SaaS CDN buyer's guide\" (stackship.example): the engines cite it and you're not on it",
    factor: "citation_source_gap", weight: 9.3, effort: "M",
    time_to_impact: "2–4 weeks (ChatGPT) → 4–8 weeks (Gemini)",
    engines: ["chatgpt", "gemini"],
    evidence: [
      "Cited chatgpt×3, gemini×2 for q01, q14",
      "Competitors on the page: Nimbus, StratoCDN",
      "URL: https://stackship.example/cdn-guide",
      "Submit via: email editors@stackship.example",
      "The page winning this question runs ~1,800 words / 9 sections. Match its depth.",
      MIX,
    ],
    artifact: null,
    published_at: null,
  },
  {
    id: "f4", fix_key: "source-saastools.example",
    title: "Claim your presence on \"CDN category: SaaSTools directory\" (saastools.example): the engines cite it and you're not on it",
    factor: "citation_source_gap", weight: 9.3, effort: "M",
    time_to_impact: "2–4 weeks (ChatGPT) → 4–8 weeks (Gemini)",
    engines: ["gemini", "chatgpt"],
    evidence: [
      "Cited gemini×3, chatgpt×2 for q01, q09",
      "Competitors on the page: Nimbus, StratoCDN, Fleetly",
      "URL: https://saastools.example/cdn-category",
      "Submit via: claim your profile at https://saastools.example/claim",
      MIX,
    ],
    artifact:
      "# Claim & complete your SaaSTools directory profile (checklist)\n\nWhy: this directory is cited by Gemini and ChatGPT for CDN questions, and every rival is listed. You are not.\n\n1. Verify ownership: request the claim link at saastools.example/claim, confirm via the DNS TXT record or the admin@acmecloud.example email.\n2. Fill every field the engines read: one-line category (\"Edge CDN for high-traffic SaaS\"), founding year, HQ, pricing model (flat/public), and a 40-word description whose FIRST sentence says \"Acme Cloud is an edge CDN platform.\"\n3. Feature 3 factual differentiators (from your own data only): flat public pricing; p95 latency within 4% of Nimbus at ~60% of cost; 18-month clean incident record.\n4. Add the direct product URL and a current logo.\n5. Invite reviews compliantly: email recent customers a neutral request; never incentivize or script the wording.\n\nJSON-LD the profile page should carry: Organization.",
    published_at: null,
  },
  {
    id: "f5", fix_key: "source-uptimewatch.example",
    title: "Get into \"CDN reliability report\" (uptimewatch.example): the engines cite it and you're not on it",
    factor: "citation_source_gap", weight: 9.2, effort: "M",
    time_to_impact: "hours–days (Perplexity) → 2–4 weeks (ChatGPT)",
    engines: ["chatgpt", "perplexity"],
    evidence: [
      "Cited chatgpt×2, perplexity×2 for q05",
      "Competitors on the page: StratoCDN, Nimbus, Fleetly",
      "URL: https://uptimewatch.example/cdn-report",
      "Submit via: email hello@uptimewatch.example",
      "The page winning this question runs ~2,100 words / 10 sections. Match its depth.",
      MIX,
    ],
    artifact:
      "Subject: Adding Acme Cloud to your CDN reliability report\n\nHi {author name},\n\nYour CDN reliability report is one of the pages AI assistants cite when buyers ask which CDN is most reliable. Acme Cloud is missing from it, and here are exactly 3 factual differentiators you can verify:\n\n1. 18-month clean incident record across all regions (public status page: status.acmecloud.example).\n2. Published SLA with credits, no support-tier gating.\n3. Independent 2026 benchmark: p95 cache-hit latency within 4% of Nimbus.\n\nHappy to share the raw uptime data. No expectations either way.\n\nDisclosure: I work at Acme Cloud.\n\n{maintainer name}, Acme Cloud",
    published_at: null,
  },
  {
    id: "f6", fix_key: "citation-competitor-owned",
    title: "Counter the competitor pages the engines trust: 1 cited page is owned by your rivals",
    factor: "citation_source_gap", weight: 9.1, effort: "M",
    time_to_impact: "2–4 weeks (ChatGPT) → 4–8 weeks (Gemini)",
    engines: ["chatgpt", "gemini"],
    evidence: [
      "You can't pitch a rival's own page. Publish your own answer the engines can cite instead.",
      "nimbus.example (owned by Nimbus): cited chatgpt×2, gemini×1 for q09, q01",
      "Engines' stated reason Nimbus wins: \"the most complete platform\" (×3)",
      MIX,
    ],
    artifact:
      "# Page outline: \"Acme Cloud vs Nimbus: an honest, sourced comparison\"\n\nH1: Acme Cloud vs Nimbus: where each one actually wins\n\nOpening (≤60 words, answer-first): Nimbus has the larger network and a broader security suite; Acme Cloud wins on flat public pricing, support responsiveness, and cost-for-performance. For globally distributed, compliance-heavy workloads, Nimbus. For predictable cost and fast human support at high traffic, Acme Cloud. Here is the sourced, side-by-side detail.\n\nH2: Network & points of presence (state the gap honestly)\nH2: Pricing: flat and public vs usage-metered (with a worked example)\nH2: Performance: the independent 2026 benchmark (within 4% of Nimbus at ~60% cost)\nH2: Support & reliability: 18-month clean incident record, published SLA\n\nFAQ (4 Q&As): Is Acme Cloud cheaper than Nimbus? · Is Acme Cloud's network big enough for global SaaS? · Which has better support? · Can I migrate from Nimbus to Acme Cloud?\n\n+ JSON-LD FAQPage stub with the four questions above. (Do NOT pitch nimbus.example: this is your own citable answer page.)",
    published_at: null,
  },
  {
    // The "top-4 cliff" killer — every opportunity outlet
    // beyond the pitch slots that no rival owns rolls into ONE honest long-tail fix
    // (fix_key "citation-longtail" ⇒ renders as its own card, never clustered). No
    // LLM artifact: the drafted pitches above ARE the template. Weight sits just
    // below the lowest pitch so it never displaces a top-3 move.
    id: "f11", fix_key: "citation-longtail",
    title: "Work the long tail: 3 more outlets the engines cite, same playbook",
    factor: "citation_source_gap", weight: 9.0, effort: "M",
    time_to_impact: "hours–days (Perplexity) → 4–8 weeks (Gemini)",
    engines: ["perplexity", "gemini", "claude"],
    evidence: [
      "Beyond the pitches above, 3 more third-party pages the engines cite lack Acme Cloud. The SAME outreach playbook applies to each.",
      "reviewsignal.example: cited perplexity×2 · email tips@reviewsignal.example",
      "cdncompare.example: cited gemini×2 · https://cdncompare.example/contribute",
      "apidigest.example: cited claude×1",
      MIX,
    ],
    artifact:
      "Same playbook as the pitches above: reuse those drafts, swapping in each outlet's angle and the contact channel listed in the evidence. No separate draft is needed. The pitches above ARE the template for these outlets.",
    published_at: null,
  },
  {
    id: "f7", fix_key: "coverage-hub",
    title: "Take back the 3 questions the engines answer without you",
    factor: "coverage_gap", weight: 7.3, effort: "M",
    time_to_impact: "2–4 weeks (ChatGPT) → 4–8 weeks (Gemini)",
    engines: ["chatgpt", "gemini", "claude"],
    evidence: [
      "[q01] \"What is the best edge CDN platform for a high-traffic SaaS?\": no matching page on acmecloud.example (absent on: chatgpt, gemini). Engines answer this from cloudreview.example (cited ×13)",
      "[q05] \"Most reliable edge CDN platform for a high-traffic SaaS?\": no matching page on acmecloud.example (absent on: chatgpt). Engines answer this from cloudreview.example (cited ×13)",
      "[q14] \"How do I cut origin egress costs at peak traffic? Which providers help?\": no matching page on acmecloud.example (absent on: claude). Engines answer this from stackship.example (cited ×5)",
      "The page winning this question runs ~2,400 words / 12 sections. Match its depth.",
      MIX,
    ],
    artifact:
      "# Hub page outline: \"Acme Cloud for high-traffic SaaS: the questions buyers ask\"\n\nH1: Acme Cloud for high-traffic SaaS\n\nOpening (≤60 words, answer-first): Acme Cloud is an edge CDN for high-traffic SaaS teams that want flat, public pricing and fast human support, with p95 latency within 4% of the market leader at ~60% of the cost and an 18-month clean incident record. This page answers the questions buyers actually ask.\n\nH2: What is the best edge CDN for a high-traffic SaaS? (≤60-word direct answer, then the honest trade-offs)\nH2: How reliable is Acme Cloud? (≤60-word answer: 18-month clean record, published SLA, live status page)\nH2: How does Acme Cloud cut origin egress costs at peak? (≤60-word answer: tiered caching + origin shield included, worked example)\n\nFAQ (4 Q&As mirroring the H2s + pricing).\n\n+ JSON-LD FAQPage stub covering the four questions.",
    published_at: null,
  },
  {
    id: "f8", fix_key: "claims",
    title: "Correct the record: engines repeat negative or wrong claims about Acme Cloud",
    factor: "negative_or_wrong", weight: 7.0, effort: "M",
    time_to_impact: "2–4 weeks (ChatGPT)",
    engines: ["chatgpt"],
    evidence: [
      "[q18] chatgpt: \"smaller network than the market leaders\"",
      "This rides on an otherwise positive answer: a doubt a buyer hears even when you're praised. If it's outdated, the fix is a page that states your current PoP footprint, sourced.",
    ],
    artifact:
      "# FAQ / About section: address the \"smaller network\" doubt with facts\n\nAnswer-first (≤60 words): Acme Cloud operates {N} points of presence across {regions}: publish the current number and map. Where AI answers still call the network \"smaller,\" it's citing older coverage; this page is the sourced, current record.\n\nQ: How large is Acme Cloud's network?\nA: {N} PoPs across {regions}, with p95 cache-hit latency within 4% of Nimbus in the independent 2026 benchmark.\n\nQ: Is Acme Cloud's network big enough for global SaaS?\nA: {factual coverage statement: no spin, no invented figures}.\n\n+ JSON-LD FAQPage stub. Fill every {placeholder} with your real, verifiable data before publishing. Never invent coverage numbers.",
    published_at: null,
  },
  {
    id: "f9", fix_key: "entity_unclear",
    title: "Rewrite your homepage hero to state what you are, machine-readably",
    factor: "entity_unclear", weight: 7.0, effort: "S",
    time_to_impact: "2–6 weeks",
    engines: ["chatgpt", "gemini", "claude"],
    evidence: [
      "homepage entity clarity: The homepage's first 800 chars never say \"CDN\": engines must guess what Acme Cloud is.",
    ],
    artifact: null,
    published_at: null,
  },
  {
    id: "f10", fix_key: "schema_missing",
    title: "Add Organization and Product JSON-LD to acmecloud.example",
    factor: "schema_missing", weight: 5.5, effort: "S",
    time_to_impact: "2–6 weeks",
    engines: ["chatgpt", "gemini", "claude"],
    evidence: ["JSON-LD FAQPage: No FAQPage schema found on crawled pages."],
    artifact: null,
    published_at: null,
  },
] as const;

// "Two weeks later" — the verify teaser (illustrative). Notes reference the
// shipped fix titles so the loop reads as the real re-measure.
export const SAMPLE_VERIFY = {
  before: "1/12",
  after: "3/12",
  notes: [
    { fix: "Unblock the AI crawlers", note: "+2 questions now name you on Perplexity, including \"most reliable edge CDN\"" },
    { fix: "Take back the 3 questions", note: "your new reliability page is now cited by Perplexity for [q05]" },
    { fix: "Get added to Best Edge CDNs compared", note: "no movement yet, within the stated 2–8 weeks" },
  ],
};
