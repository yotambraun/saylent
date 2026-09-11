// Canonical types (see METHODOLOGY.md) — copied verbatim from the DB schema
// (jsonb columns store these exactly), plus later additions.
// src/engine/ is PURE: no Next/Supabase imports anywhere in this directory.

export type Engine = "chatgpt" | "claude" | "gemini" | "perplexity"; // never variants
// integration/migration/trust are the
// three buyer-risk archetypes (see METHODOLOGY.md). They are NOT scored
// (score.ts SCORED = category+problem only) — the headline stays 12 scored questions.
// "custom" is the type a USER-AUTHORED question gets when the author did not
// tag it with one of the shipped types (CLI `--questions`, or a saylent.config
// questionTemplates key that is not a shipped type). It is asked and judged
// like any other question and is deliberately NOT scored, so adding your own
// questions can never move the recommended band (score.ts SCORED is the one
// definition of what counts).
export type QType =
  | "category"
  | "comparison"
  | "problem"
  | "branded"
  | "integration"
  | "migration"
  | "trust"
  | "custom";

/** Which costly pipeline stages a run skips.
 *  ONE shape used everywhere it travels: RunAuditInput.skip (run-audit.ts),
 *  BundleRunMeta.skip (bundle.ts), saylent.config `skip` (config.ts), and the
 *  CLI's `--skip`/`AUDIT_SKIP` (profiles.ts resolveSkip) all resolve to this.
 *  `drafts` = no drafter LLM calls (diagnose() still runs; fixes list without
 *  artifacts, each honestly "not drafted (skipped by request)"). `corpus` = no
 *  cited-page fetches (presence "unverified (skipped by request)", never a
 *  fabricated absence). `gates` = no site checks (the gates section says so,
 *  never a pass). */
export interface SkipStages {
  drafts?: boolean;
  corpus?: boolean;
  gates?: boolean;
}

export interface Question {
  qid: string;
  text: string;
  qtype: QType;
  /** who wrote it: "template" = generated from the template library,
   *  "user" = typed/edited by the operator in a --questions file. Absent on
   *  every question generated before this field existed (treated as template). */
  source?: "template" | "user";
  /** Samples feature: how many times this ONE question is asked per engine
   *  (1-5). Explicit on a --questions row ⇒ a per-question override that wins
   *  over the run-level --samples/AUDIT_SAMPLES/config default for THIS
   *  question only (profiles.ts sampleCountFor). Stamped with the EFFECTIVE
   *  count at freeze time for every question that lacks its own override, so
   *  the frozen set on disk always records what was actually asked
   *  (profiles.ts freezeSamples) and a later verify reuses it verbatim.
   *  Absent on every question frozen before this field existed. */
  samples?: number;
}

export interface Citation {
  url: string;
  title?: string;
}

/** A single claim the answer makes about the audited brand. `kind` is the
 * claim's OWN polarity toward the brand, independent of whole-answer sentiment
 * (E2a — data gold mine: risk includes reported third-party criticism). */
export interface Claim {
  text: string;
  kind: "praise" | "risk" | "neutral_fact";
}

/** A rival the answer recommends/prefers, plus the answer's STATED reason
 * (`why`, ≤12 words; "" when the answer gives none — never invented). */
export interface OtherBrand {
  name: string;
  why: string;
}

export interface Verdict {
  brand_present: boolean;
  mention_type: "recommended" | "listed" | "compared" | "neutral" | "dismissed" | "absent";
  prominence: "first" | "early" | "buried" | "none";
  sentiment: "positive" | "neutral" | "negative";
  /** E2a: structured claims. Old DB rows hold `string[]` — read via
   * verdict-compat.normClaims which coerces those to kind "neutral_fact". */
  claims: Claim[];
  /** E2a: rival + reason. Old DB rows hold `string[]` — read via
   * verdict-compat.normOtherBrands which coerces those to why "". */
  other_brands: OtherBrand[];
  excerpt: string;
  /** Conditional segmentation the answer states verbatim
   * ("pick {winner} if {segment} — {reason}"). Optional: absent on old rows. */
  segments?: { segment: string; winner: string; reason: string }[];
  /** Specific price/pricing claims the answer makes about the
   * audited brand, quoted. Optional: absent on old rows. */
  pricing_claims?: string[];
  /** True when the engine mostly discussed a different entity that
   * shares the brand's name (golden-set rule R6). Optional. */
  entity_confusion?: boolean;
}

export interface Scores {
  per_engine: Record<
    Engine,
    {
      answered: number;
      recommended: number;
      mentioned: number;
      rec_rate: number | null;
      mention_rate: number | null;
    }
  >;
  overall: {
    answered: number;
    recommended: number;
    mentioned: number;
    rec_rate: number | null;
    mention_rate: number | null;
  };
  share_of_voice: Record<string, number>;
}

// ---- 5.1 additions ----

export interface SitePage {
  url: string;
  status: number;
  title: string;
  text: string;
  /** The next three are extracted AT FETCH TIME from the FULL document (any
   * position in the page — zero loss). Raw HTML never travels through job
   * state: Inngest caps step output at 4MB, and one real brand's page set
   * came in at ≈4.7MB — proved it the hard way. */
  ldTypes: string[];
  metaRobots: string;
  links: string[];
  /** true when the page was read from the Internet Archive because the site's
   * WAF blocks declared bots (legal fallback — we never impersonate browsers;
   * project rule) */
  archived?: boolean;
  /** Crawler v2 (TODO "Crawler v2") — true when extracted text is under the
   * word threshold AND the raw HTML is a script-heavy / empty-root JS shell:
   * the page renders client-side, so answer engines likely can't read it.
   * Optional so pre-v2 SitePage literals stay valid. */
  thin?: boolean;
}

export interface BrandModel {
  brand: string;
  domain: string;
  aliases: string[];
  category: string;
  icp: string;
  products: string[];
  value_props: string[];
  problems: string[];
  competitors: string[];
  language: string;
  /** "low" when the crawled site is too
   *  thin/ambiguous to model the brand reliably — the combined signal of the
   *  LLM self-report AND the deterministic brandModelConfidence() heuristic (thin
   *  text, no concrete products/value_props, or generic-fallback fields). Optional so
   *  the verify-path / old-data BrandModel literals default to "ok". Persisted-model
   *  wiring is a follow-up (no brand-model jsonb blob exists today — see report). */
  confidence?: "ok" | "low";
}

export interface DomainCheck {
  check: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
  factor?: string;
}

export interface Fix {
  fixKey: string;
  title: string;
  factor: string;
  weight: number;
  effort: "S" | "M" | "L";
  timeToImpact: string;
  engines: Engine[];
  evidence: string[];
  artifact?: string;
  /** Extra drafter-task sentences the
   * diagnosis mines from stored data (rival whys, winning-host targeting,
   * format-matched outlines). Transient — appended to the drafter TASK at draft
   * time only; never persisted (saveFix ignores it) and never rendered as-is. */
  drafterHints?: string[];
}

/** Rows as the engine hands them to persistence — DB mapping happens outside src/engine. */
export interface AnswerRow {
  qid: string;
  qtype: QType;
  question: string;
  engine: Engine;
  ok: boolean;
  raw_text: string;
  citations: Citation[];
  verdict?: Verdict;
  error?: string;
  /** exact provider usage (tokens + search calls) — the honest cost record */
  usage?: { input_tokens?: number; output_tokens?: number; searches?: number };
}

export interface CorpusPageRow {
  url: string;
  final_url: string | null;
  title: string | null;
  page_type: string;
  cited_by: Partial<Record<Engine, number>>;
  cited_for_qids: string[];
  fetch_status: number | null;
  brand_present: boolean | null;
  brand_context: string | null;
  competitors_present: string[];
  opportunity: boolean;
  /** Crawler v2 (TODO "Crawler v2") — honest SPA/thin-page flag (see SitePage.thin).
   * Surfaced in the PageDrawer so the reader knows a cited page loads via JS and
   * may not be readable by answer engines. Optional so pre-v2 row literals stay
   * valid; the DB column is `not null default false` (migration 0030). */
  thin?: boolean;
}

export interface DbWriter {
  setStage(runId: string, label: string): Promise<void>;
  saveAnswer(row: AnswerRow & { runId: string }): Promise<void>;
  /** judge step persists verdicts onto already-saved answers (keyed qid+engine) */
  saveVerdict(runId: string, qid: string, engine: Engine, verdict: Verdict): Promise<void>;
  saveCorpusPage(row: CorpusPageRow & { runId: string }): Promise<void>;
  saveCheck(row: DomainCheck & { runId: string }): Promise<void>;
  saveFix(row: Fix & { runId: string }): Promise<void>;
  finishRun(runId: string, scores: Scores, cost: number): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
  /** Best-effort in-app notification. Upsert on (run_id,type) with
   * ignoreDuplicates so retryable emits are idempotent. MUST NEVER throw: a
   * notification failure must not fail a run (the impl swallows + logs). */
  notify(
    runId: string,
    type: "audit_ready" | "verify_ready" | "run_failed",
    title: string,
    href: string,
  ): Promise<void>;
}

// ---- run-bundle projections (migrations 0032/0033) ----
// The two flattened projections the pipeline derives from the sampled draws.
// They live here (not in the app) so the pure runAudit() pipeline, the memory
// writer and the run bundle all speak ONE shape; the app maps them to columns.

/** One per-sample evidence draw behind a canonical answers row (0033). */
export interface AnswerSampleRow {
  runId: string;
  qid: string;
  engine: Engine;
  sampleIdx: number;
  raw_text: string;
  citations: Citation[];
  verdict: Verdict | null;
  usage: { input_tokens?: number; output_tokens?: number; searches?: number } | null;
}

/** One flattened citation row (0032): one row per citation, in answer order. */
export interface CitationRow {
  runId: string;
  brandId: string;
  qid: string;
  engine: Engine;
  url: string;
  normUrl: string;
  host: string;
  position: number | null;
}
