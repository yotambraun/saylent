// Implements METHODOLOGY.md (brand model) — one call to MODEL_BRAND with the METHODOLOGY.md (brand model)
// prompt over the top-8 pages (≤16k chars). Pure: the LLM call is injected
// (engine has no provider clients). MERGE rule: user-provided category/
// competitors always win; aliases/problems/competitors guaranteed non-empty.
// icp/problems OVERRIDES (migration 0031, context_source='user'): when the owner
// has edited the buyer context in settings, the stored icp/problems are passed in
// and WIN over the freshly-derived model — the LLM call is unchanged (it still
// runs for aliases/category/products/value_props/competitors). A user edit
// permanently wins until they clear the field (an empty override falls back to the
// model-derived value). Missing key / failed call ⇒ fallback model, never a throw.
import type { BrandModel, SitePage } from "./types";
import { parseJsonLoosely } from "./util";

/** Injected by the orchestration layer; resolves to raw model text or null on any failure. */
export type LlmCall = (args: {
  system: string;
  user: string;
  maxTokens: number;
}) => Promise<string | null>;

export interface BrandInput {
  brand: string;
  domain: string;
  category?: string;
  competitors?: string[];
}

/** Owner-edited buyer context that WINS over the derived model (context_source='user').
 *  Empty/undefined fields fall back to the model-derived value (a cleared field re-derives). */
export interface BrandModelOverrides {
  icp?: string;
  problems?: string[];
}

const SYSTEM =
  "You extract a structured brand model from website text. Respond with ONLY a JSON object, no prose.";

function buildUserPrompt(input: BrandInput, pages: SitePage[]): string {
  const blocks: string[] = [];
  let total = 0;
  for (const p of pages.slice(0, 8)) {
    const block = `URL: ${p.url}\nTITLE: ${p.title}\nTEXT: ${p.text.slice(0, 2500)}`;
    if (total + block.length > 16000) break;
    blocks.push(block);
    total += block.length;
  }
  const categoryHint = input.category ? `, user says: ${input.category}` : "";
  return (
    `Brand: ${input.brand}\nDomain: ${input.domain}\nWebsite text (may be partial):\n` +
    blocks.join("\n\n") +
    `\n\nReturn JSON with keys: category (short noun phrase${categoryHint}), ` +
    `icp (who it is for, as a short PLURAL noun phrase that reads correctly right ` +
    `after the word "for" — e.g. "software engineering teams" — no leading article), ` +
    `products (<=6), value_props (<=6, short), ` +
    `problems (concrete problems the product solves, each a lowercase gerund noun ` +
    `phrase that reads correctly after "for" or "solve:" — e.g. "tracking email ` +
    `delivery and opens in real time" — NOT a full sentence, no leading "Need to", ` +
    `not capitalized, no trailing period, <=5), ` +
    `aliases (name variants people/AI might use, incl. the domain word, <=5), ` +
    `competitors (competitor BRAND NAMES mentioned or clearly implied, <=6), ` +
    `language (2-letter code), ` +
    `confidence ("ok" or "low"): return "low" when the website text is too thin, ` +
    `generic, or ambiguous to model the brand reliably — e.g. you cannot identify ` +
    `concrete products or value props from the text — otherwise "ok".`
  );
}

// Deterministic low-confidence heuristic (belt-and-braces alongside the model's
// self-report). Pure + tested. "low" when the crawl signals show the site was too
// thin/ambiguous to model reliably: too little readable text, barely any pages, no
// concrete products AND value props, or two+ identity fields fell back to a generic
// sentinel. Sentinels mirror the guaranteed-non-empty fallbacks below.
const CATEGORY_FALLBACK = "product";
const ICP_FALLBACK = "teams evaluating options";
const COMPETITOR_FALLBACK = "the leading alternative";

export function brandModelConfidence(pages: SitePage[], model: BrandModel): "ok" | "low" {
  const totalChars = pages.reduce((n, p) => n + (typeof p.text === "string" ? p.text.length : 0), 0);
  const readablePages = pages.filter((p) => typeof p.text === "string" && p.text.trim().length > 0).length;

  let fallbacks = 0;
  if (model.category === CATEGORY_FALLBACK) fallbacks++;
  if (model.icp === ICP_FALLBACK) fallbacks++;
  if (model.competitors.length === 1 && model.competitors[0] === COMPETITOR_FALLBACK) fallbacks++;
  if (model.problems.length === 1 && model.problems[0].startsWith("choosing the right ")) fallbacks++;

  // couldn't name what the brand sells OR why to buy it → no concrete offering
  const noConcreteOffering = model.products.length === 0 && model.value_props.length === 0;

  const low =
    totalChars < 600 || // site text too thin to read
    readablePages < 2 || // barely anything crawled
    noConcreteOffering ||
    fallbacks >= 2; // two+ identity fields defaulted

  return low ? "low" : "ok";
}

const strArr = (v: unknown, cap: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, cap) : [];

// METHODOLOGY.md (brand model) post-processing safety net: the prompt asks for lowercase gerund
// problem phrases, but models drift back to capitalized sentence fragments with
// trailing punctuation. Deterministically trim + collapse whitespace, strip
// trailing punctuation, and lowercase the first letter — acronym-safe: leave it
// alone when the second char is already uppercase ("API rate limits …").
const tidyProblem = (p: string): string => {
  const cleaned = p.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
  if (cleaned.length === 0) return cleaned;
  const second = cleaned[1];
  const secondIsLower = !!second && second === second.toLowerCase() && second !== second.toUpperCase();
  return secondIsLower ? cleaned[0].toLowerCase() + cleaned.slice(1) : cleaned;
};

export async function buildBrandModel(
  input: BrandInput,
  pages: SitePage[],
  callLlm: LlmCall,
  overrides?: BrandModelOverrides,
): Promise<BrandModel> {
  const raw = await callLlm({
    system: SYSTEM,
    user: buildUserPrompt(input, pages),
    maxTokens: 1000,
  }).catch(() => null);
  const j = raw ? parseJsonLoosely(raw) : {};

  // MERGE rule: user-provided category/competitors always win
  const category =
    input.category?.trim() ||
    (typeof j.category === "string" && j.category.trim()) ||
    "product";
  const competitorsFromUser = (input.competitors ?? []).filter((c) => c.trim());
  const competitors =
    competitorsFromUser.length > 0 ? competitorsFromUser : strArr(j.competitors, 6);

  // guaranteed non-empty fields (METHODOLOGY.md (brand model))
  const domainWord = input.domain.replace(/^www\./, "").split(".")[0];
  const aliases = Array.from(
    new Set([input.brand, ...strArr(j.aliases, 5), domainWord].filter((a) => a.trim())),
  ).slice(0, 6);

  // icp/problems OVERRIDE (context_source='user'): a non-empty owner edit wins
  // VERBATIM; an empty/absent override falls through to the model-derived value.
  const userIcp = overrides?.icp?.trim();
  const derivedIcp = (typeof j.icp === "string" && j.icp.trim()) || "teams evaluating options";
  const icp = userIcp || derivedIcp;

  const userProblems = (overrides?.problems ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
  let problems: string[];
  if (userProblems.length > 0) {
    problems = userProblems.slice(0, 5); // owner's words, kept verbatim (bounds already validated)
  } else {
    problems = strArr(j.problems, 5)
      .map(tidyProblem)
      .filter((p) => p.length > 0);
    if (problems.length === 0) problems.push(`choosing the right ${category}`);
  }

  const built: BrandModel = {
    brand: input.brand,
    domain: input.domain,
    aliases,
    category,
    icp,
    products: strArr(j.products, 6),
    value_props: strArr(j.value_props, 6),
    problems,
    competitors: competitors.length > 0 ? competitors : ["the leading alternative"],
    language: (typeof j.language === "string" && j.language.trim().slice(0, 2)) || "en",
  };

  // Combined low-confidence signal: LOW if EITHER the model self-reports "low"
  // OR the deterministic heuristic flags the crawl as too thin/ambiguous.
  const modelSaysLow = typeof j.confidence === "string" && j.confidence.trim().toLowerCase() === "low";
  built.confidence = modelSaysLow || brandModelConfidence(pages, built) === "low" ? "low" : "ok";
  return built;
}
