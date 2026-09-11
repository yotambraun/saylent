// The run bundle v1 — the LOSSLESS on-disk form of one audit or verify run.
//
// This is `run.json`: everything a report needs to render, everything a verify
// run needs to reuse, and everything a reader needs to check our work. It is a
// straight projection of the rows the pipeline persisted (MemoryDbWriter holds
// them in the DB shapes; this module maps them back to the canonical types.ts
// shapes) plus the run header. Nothing is summarized, nothing is dropped: raw
// answer text, EVERY sampled draw, every citation with its position.
//
// Compatibility rule: v1 is additive-only. New optional fields may be added; an
// existing field never changes meaning. A bundle with a different `version` is
// refused rather than guessed at.
import { z } from "zod";
import type {
  MemoryAnswerRow,
  MemoryAnswerSampleRow,
  MemoryCitationRow,
  MemoryCorpusPageRow,
  MemoryDbWriter,
  MemoryDomainCheckRow,
  MemoryFixRow,
} from "./memory-writer";
import type { RunKind } from "./run-audit";
import type { JudgeMode, RoleAssignment } from "./models";
import type { ProfileName, ResolvedSampling } from "./profiles";
import type {
  AnswerRow,
  AnswerSampleRow,
  BrandModel,
  CitationRow,
  CorpusPageRow,
  DomainCheck,
  Engine,
  Fix,
  QType,
  Question,
  Scores,
  SkipStages,
  Verdict,
} from "./types";

export const BUNDLE_VERSION = 1;

/** The run header: what was run, with what, when, and for how much. */
export interface BundleRunMeta {
  id: string;
  kind: RunKind;
  profile: ProfileName;
  status: "done" | "failed";
  brand: { name: string; domain: string };
  /** the FROZEN answer-engine set this run used */
  engines: Engine[];
  /** model id per role: one per engine plus judge_anthropic/judge_openai/brand/drafter */
  models: Record<string, string>;
  /** "cross-family" (two provider keys) or "single-family" (one key served every
   *  judgment role). Optional: bundles written before single-provider mode have
   *  neither field and read back unchanged (v1 is additive-only). */
  judge_mode?: JudgeMode | null;
  /** role name ("brand", "drafter", "judge:for-chatgpt", …) → family + model */
  roles?: Record<string, RoleAssignment> | null;
  /** questions.ts TEMPLATE_SET_VERSION the frozen set was generated from.
   *  A string "<base>+custom" when saylent.config questionTemplates overrode the
   *  shipped library (questions.ts templateSetVersion) — verify refuses to claim
   *  movement across two different template sets. */
  template_set_version: number | string;
  /** the brand's question-set envelope version */
  question_set_version: number;
  /** Samples feature: the resolved run-level sample count/tiebreak/source this
   *  run used for scored questions with no per-question override. Optional:
   *  bundles written before this feature existed have neither field and read
   *  back unchanged (v1 is additive-only) — verify falls back to the
   *  profile's own scoredSamples/scoredTiebreak for those. */
  sampling?: ResolvedSampling | null;
  /** Which costly stages THIS run skipped, so a
   *  reader of run.json (and the report it renders) never mistakes an absent
   *  drafted artifact / cited page / gate check for one that ran and found
   *  nothing. Optional: bundles written before this feature existed have no
   *  field and read back unchanged (v1 is additive-only). */
  skip?: SkipStages | null;
  started_at: string;
  finished_at: string | null;
  est_cost_usd: number | null;
  baseline_run_id?: string | null;
  /** set only when status="failed" */
  failure?: string | null;
}

/** A canonical answer with EVERY draw behind it (empty for single-draw groups). */
export type BundleAnswer = AnswerRow & { samples: AnswerSampleRow[] };

/** corpus_pages carries two additive enrichment columns (0035). */
export type BundleCorpusPage = CorpusPageRow & {
  page_date?: string | null;
  contact?: { mailto?: string; form_url?: string; claim_url?: string } | null;
};

export interface RunBundleV1 {
  version: typeof BUNDLE_VERSION;
  run: BundleRunMeta;
  brand_model: BrandModel;
  /** the FROZEN question set — a verify run reuses this verbatim */
  questions: Question[];
  answers: BundleAnswer[];
  citations: CitationRow[];
  corpus_pages: BundleCorpusPage[];
  domain_checks: DomainCheck[];
  fixes: Fix[];
  scores: Scores | null;
  /** the run-health "birth certificate" when the caller graded one */
  health: Record<string, unknown> | null;
}

/** Everything the bundle needs that is NOT a persisted row. */
export interface BundleMeta {
  run: BundleRunMeta;
  brand_model: BrandModel;
  questions: Question[];
  health?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// schema — validation only. readBundle returns the ORIGINAL object so an
// unknown-but-present field survives a round trip untouched (forward compat).
// ---------------------------------------------------------------------------

const citationSchema = z.object({ url: z.string(), title: z.string().optional() });
const usageSchema = z.object({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  searches: z.number().optional(),
});
const verdictSchema = z.object({
  brand_present: z.boolean(),
  mention_type: z.string(),
  prominence: z.string(),
  sentiment: z.string(),
  claims: z.array(z.unknown()),
  other_brands: z.array(z.unknown()),
  excerpt: z.string(),
});

const answerSchema = z.object({
  qid: z.string(),
  qtype: z.string(),
  question: z.string(),
  engine: z.string(),
  ok: z.boolean(),
  raw_text: z.string(),
  citations: z.array(citationSchema),
  verdict: verdictSchema.optional(),
  error: z.string().optional(),
  usage: usageSchema.optional(),
  samples: z.array(
    z.object({
      runId: z.string(),
      qid: z.string(),
      engine: z.string(),
      sampleIdx: z.number(),
      raw_text: z.string(),
      citations: z.array(citationSchema),
      verdict: verdictSchema.nullable(),
      usage: usageSchema.nullable(),
    }),
  ),
});

const citationRowSchema = z.object({
  runId: z.string(),
  brandId: z.string(),
  qid: z.string(),
  engine: z.string(),
  url: z.string(),
  normUrl: z.string(),
  host: z.string(),
  position: z.number().nullable(),
});

const corpusPageSchema = z.object({
  url: z.string(),
  final_url: z.string().nullable(),
  title: z.string().nullable(),
  page_type: z.string(),
  cited_by: z.record(z.string(), z.number()),
  cited_for_qids: z.array(z.string()),
  fetch_status: z.number().nullable(),
  brand_present: z.boolean().nullable(),
  brand_context: z.string().nullable(),
  competitors_present: z.array(z.string()),
  opportunity: z.boolean(),
  thin: z.boolean().optional(),
});

const domainCheckSchema = z.object({
  check: z.string(),
  status: z.enum(["pass", "warn", "fail", "info"]),
  detail: z.string(),
  factor: z.string().optional(),
});

const fixSchema = z.object({
  fixKey: z.string(),
  title: z.string(),
  factor: z.string(),
  weight: z.number(),
  effort: z.enum(["S", "M", "L"]),
  timeToImpact: z.string(),
  engines: z.array(z.string()),
  evidence: z.array(z.string()),
  artifact: z.string().optional(),
});

const brandModelSchema = z.object({
  brand: z.string(),
  domain: z.string(),
  aliases: z.array(z.string()),
  category: z.string(),
  icp: z.string(),
  products: z.array(z.string()),
  value_props: z.array(z.string()),
  problems: z.array(z.string()),
  competitors: z.array(z.string()),
  language: z.string(),
  confidence: z.enum(["ok", "low"]).optional(),
});

const runMetaSchema = z.object({
  id: z.string(),
  kind: z.enum(["audit", "verify"]),
  profile: z.enum(["full", "smoke"]),
  status: z.enum(["done", "failed"]),
  brand: z.object({ name: z.string(), domain: z.string() }),
  engines: z.array(z.string()),
  models: z.record(z.string(), z.string()),
  judge_mode: z.enum(["cross-family", "single-family"]).nullable().optional(),
  roles: z
    .record(z.string(), z.object({ family: z.string(), model: z.string() }))
    .nullable()
    .optional(),
  template_set_version: z.union([z.number(), z.string()]),
  question_set_version: z.number(),
  sampling: z
    .object({
      samples: z.number(),
      tiebreak: z.boolean(),
      source: z.enum(["flag", "env", "config", "profile"]),
    })
    .nullable()
    .optional(),
  skip: z
    .object({
      drafts: z.boolean().optional(),
      corpus: z.boolean().optional(),
      gates: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  est_cost_usd: z.number().nullable(),
  baseline_run_id: z.string().nullable().optional(),
  failure: z.string().nullable().optional(),
});

export const runBundleSchema = z.object({
  version: z.literal(BUNDLE_VERSION),
  run: runMetaSchema,
  brand_model: brandModelSchema,
  questions: z.array(
    z.object({
      qid: z.string(),
      text: z.string(),
      qtype: z.string(),
      source: z.enum(["template", "user"]).optional(),
      samples: z.number().min(1).max(5).optional(),
    }),
  ),
  answers: z.array(answerSchema),
  citations: z.array(citationRowSchema),
  corpus_pages: z.array(corpusPageSchema),
  domain_checks: z.array(domainCheckSchema),
  fixes: z.array(fixSchema),
  scores: z.unknown().nullable(),
  health: z.record(z.string(), z.unknown()).nullable(),
});

// ---------------------------------------------------------------------------
// row → canonical-type mappers, shared by toBundle (a MemoryDbWriter's arrays)
// and bundleFromRows (already-persisted app rows read back from the DB). Both
// sources use the SAME snake_case column shapes (memory-writer.ts mirrors
// src/lib/db.ts field-for-field), so one mapper serves both.
// ---------------------------------------------------------------------------

function mapAnswerRow(a: Omit<MemoryAnswerRow, "run_id">, samples: AnswerSampleRow[]): BundleAnswer {
  return {
    qid: a.qid,
    qtype: a.qtype as QType,
    question: a.question,
    engine: a.engine,
    ok: a.ok,
    raw_text: a.raw_text,
    citations: a.citations,
    ...(a.verdict ? { verdict: a.verdict as Verdict } : {}),
    ...(a.error ? { error: a.error } : {}),
    ...(a.usage ? { usage: a.usage } : {}),
    samples,
  };
}

function mapSampleRow(s: Omit<MemoryAnswerSampleRow, "run_id">, runId: string): AnswerSampleRow {
  return {
    runId,
    qid: s.qid,
    engine: s.engine,
    sampleIdx: s.sample_idx,
    raw_text: s.raw_text,
    citations: s.citations,
    verdict: s.verdict,
    usage: s.usage ?? null,
  };
}

function mapCitationRow(c: Omit<MemoryCitationRow, "run_id">, runId: string): CitationRow {
  return {
    runId,
    brandId: c.brand_id,
    qid: c.qid,
    engine: c.engine,
    url: c.url,
    normUrl: c.norm_url,
    host: c.host,
    position: c.position,
  };
}

function mapCorpusPageRow(p: Omit<MemoryCorpusPageRow, "run_id">): BundleCorpusPage {
  return {
    url: p.url,
    final_url: p.final_url,
    title: p.title,
    page_type: p.page_type,
    cited_by: p.cited_by,
    cited_for_qids: p.cited_for_qids,
    fetch_status: p.fetch_status,
    brand_present: p.brand_present,
    brand_context: p.brand_context,
    competitors_present: p.competitors_present,
    opportunity: p.opportunity,
    thin: p.thin,
    page_date: p.page_date,
    contact: p.contact,
  };
}

function mapDomainCheckRow(c: Omit<MemoryDomainCheckRow, "run_id">): DomainCheck {
  return {
    check: c.check_name,
    status: c.status,
    detail: c.detail,
    ...(c.factor ? { factor: c.factor } : {}),
  };
}

function mapFixRow(f: Omit<MemoryFixRow, "run_id">): Fix {
  return {
    fixKey: f.fix_key,
    title: f.title,
    factor: f.factor,
    weight: f.weight,
    effort: f.effort,
    timeToImpact: f.time_to_impact,
    engines: f.engines,
    evidence: f.evidence,
    ...(f.artifact ? { artifact: f.artifact } : {}),
  };
}

/** Group samples by (qid, engine) and sort each bucket in draw order. */
function groupSamples(
  samples: Omit<MemoryAnswerSampleRow, "run_id">[],
  runId: string,
): Map<string, AnswerSampleRow[]> {
  const byAnswer = new Map<string, AnswerSampleRow[]>();
  for (const s of samples) {
    const key = `${s.qid}|${s.engine}`;
    const bucket = byAnswer.get(key);
    const row = mapSampleRow(s, runId);
    if (bucket) bucket.push(row);
    else byAnswer.set(key, [row]);
  }
  for (const bucket of byAnswer.values()) bucket.sort((a, b) => a.sampleIdx - b.sampleIdx);
  return byAnswer;
}

// ---------------------------------------------------------------------------
// build / read / write
// ---------------------------------------------------------------------------

/** Project the rows a MemoryDbWriter collected, plus the header, into a bundle. */
export function toBundle(writer: MemoryDbWriter, meta: BundleMeta): RunBundleV1 {
  const runId = meta.run.id;
  const mine = <T extends { run_id: string }>(rows: T[]): T[] =>
    rows.filter((r) => r.run_id === runId);

  const samplesByAnswer = groupSamples(mine(writer.answer_samples), runId);
  const answers: BundleAnswer[] = mine(writer.answers).map((a) =>
    mapAnswerRow(a, samplesByAnswer.get(`${a.qid}|${a.engine}`) ?? []),
  );
  const citations: CitationRow[] = mine(writer.citations).map((c) => mapCitationRow(c, runId));
  const corpus_pages: BundleCorpusPage[] = mine(writer.corpus_pages).map(mapCorpusPageRow);
  const domain_checks: DomainCheck[] = mine(writer.domain_checks).map(mapDomainCheckRow);
  const fixes: Fix[] = mine(writer.fixes).map(mapFixRow);

  const run = writer.run(runId);
  return {
    version: BUNDLE_VERSION,
    run: {
      ...meta.run,
      finished_at: meta.run.finished_at ?? run?.finished_at ?? null,
      est_cost_usd: meta.run.est_cost_usd ?? run?.est_cost_usd ?? null,
    },
    brand_model: meta.brand_model,
    questions: meta.questions,
    answers,
    citations,
    corpus_pages,
    domain_checks,
    fixes,
    scores: (run?.scores as Scores | null) ?? null,
    health: meta.health ?? null,
  };
}

/** Row inputs for {@link bundleFromRows}: the SAME snake_case shapes the app
 *  reads back from Postgres (answers/answer_samples/citations/corpus_pages/
 *  domain_checks/fixes), already scoped to one run (no `run_id` column needed —
 *  the caller already filtered `.eq("run_id", id)` / RLS did). `run` and
 *  `brand_model` are the header pieces the DB doesn't hand back in one shape
 *  (a caller assembles `run` from the `runs` row + whatever it derives; see
 *  bundleFromRowsMeta below for the pieces the app must derive itself). */
export interface BundleRowsInput {
  run: BundleRunMeta;
  /** the pipeline-built BrandModel for this run (runs.brand_model, 0034); falls
   *  back to `meta.brand_model` when the row itself doesn't carry one (older
   *  runs predating that column). */
  brand_model?: BrandModel;
  /** the FROZEN question set this run asked (runs.question_set.questions). */
  questions: Question[];
  answers: Omit<MemoryAnswerRow, "run_id">[];
  samples?: Omit<MemoryAnswerSampleRow, "run_id">[];
  citations?: Omit<MemoryCitationRow, "run_id">[];
  corpus_pages: Omit<MemoryCorpusPageRow, "run_id">[];
  domain_checks: Omit<MemoryDomainCheckRow, "run_id">[];
  fixes: Omit<MemoryFixRow, "run_id">[];
  /** runs.scores. */
  scores?: Scores | null;
  /** runs.health (the run-health "birth certificate"), when graded. */
  health?: Record<string, unknown> | null;
}

/** Fallbacks for the pieces {@link BundleRowsInput} allows to be omitted. */
export interface BundleRowsMeta {
  brand_model?: BrandModel;
  health?: Record<string, unknown> | null;
}

/** Build a bundle from rows the app ALREADY persisted and read back (the
 *  Supabase dossier read + the flattened citations/answer_samples tables) —
 *  no MemoryDbWriter involved. This is what lets a run downloaded from the app
 *  become the same lossless `run.json` the CLI produces: same shape, same
 *  schema, re-renderable and re-importable the same way. Additive: does not
 *  change {@link toBundle}'s behavior or signature. */
export function bundleFromRows(rows: BundleRowsInput, meta?: BundleRowsMeta): RunBundleV1 {
  const runId = rows.run.id;
  const brand_model = rows.brand_model ?? meta?.brand_model;
  if (!brand_model) {
    throw new Error("bundleFromRows: brand_model is required (rows.brand_model or meta.brand_model)");
  }

  const samplesByAnswer = groupSamples(rows.samples ?? [], runId);
  const answers: BundleAnswer[] = rows.answers.map((a) =>
    mapAnswerRow(a, samplesByAnswer.get(`${a.qid}|${a.engine}`) ?? []),
  );
  const citations: CitationRow[] = (rows.citations ?? []).map((c) => mapCitationRow(c, runId));
  const corpus_pages: BundleCorpusPage[] = rows.corpus_pages.map(mapCorpusPageRow);
  const domain_checks: DomainCheck[] = rows.domain_checks.map(mapDomainCheckRow);
  const fixes: Fix[] = rows.fixes.map(mapFixRow);

  return {
    version: BUNDLE_VERSION,
    run: rows.run,
    brand_model,
    questions: rows.questions,
    answers,
    citations,
    corpus_pages,
    domain_checks,
    fixes,
    scores: rows.scores ?? null,
    health: rows.health !== undefined ? rows.health : (meta?.health ?? null),
  };
}

/** Serialize a bundle for `run.json`. Stable key order, human-diffable. */
export function writeBundle(bundle: RunBundleV1): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** Parse + validate a bundle. Accepts the parsed JSON or the raw string.
 *  Throws an honest error on a version mismatch or a malformed bundle; returns
 *  the ORIGINAL object so unknown-but-present fields survive the round trip. */
export function readBundle(json: unknown): RunBundleV1 {
  const value: unknown = typeof json === "string" ? JSON.parse(json) : json;
  if (typeof value !== "object" || value === null) {
    throw new Error("run bundle: expected a JSON object");
  }
  const version = (value as { version?: unknown }).version;
  if (version !== BUNDLE_VERSION) {
    throw new Error(
      `run bundle: unsupported version ${String(version)} (this build reads version ${BUNDLE_VERSION})`,
    );
  }
  const parsed = runBundleSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") || "(root)";
    throw new Error(`run bundle: invalid at ${where}: ${first?.message ?? "unknown error"}`);
  }
  return value as RunBundleV1;
}
