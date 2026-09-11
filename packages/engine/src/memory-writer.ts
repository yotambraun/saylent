// An in-memory DbWriter (types.ts port). It is what the CLI, the GitHub Action
// and the tests hand to runAudit() instead of the Supabase service-role writer:
// every method appends the row the real writer would have INSERTed, in the same
// snake_case shape and with the same columns (mirrored from src/lib/db.ts —
// never imported from there; this package stays free of Supabase).
//
// Nothing here touches the network or the filesystem. The arrays ARE the run:
// bundle.ts turns them into the lossless run bundle v1.
import type {
  AnswerRow,
  AnswerSampleRow,
  CitationRow,
  CorpusPageRow,
  DbWriter,
  DomainCheck,
  Engine,
  Fix,
  Scores,
  Verdict,
} from "./types";
import type { RunAuditHooks } from "./run-audit";

export interface MemoryRunRow {
  id: string;
  stage: string | null;
  status: "running" | "done" | "failed";
  error: string | null;
  scores: Scores | null;
  est_cost_usd: number | null;
  finished_at: string | null;
}

export interface MemoryAnswerRow {
  run_id: string;
  qid: string;
  qtype: string;
  question: string;
  engine: Engine;
  ok: boolean;
  raw_text: string;
  citations: AnswerRow["citations"];
  verdict: Verdict | null;
  error: string | null;
  usage: AnswerRow["usage"] | null;
}

export interface MemoryAnswerSampleRow {
  run_id: string;
  qid: string;
  engine: Engine;
  sample_idx: number;
  raw_text: string;
  citations: AnswerRow["citations"];
  verdict: Verdict | null;
  usage: AnswerRow["usage"] | null;
}

export interface MemoryCitationRow {
  run_id: string;
  brand_id: string;
  qid: string;
  engine: Engine;
  url: string;
  norm_url: string;
  host: string;
  position: number | null;
}

/** The corpus_pages columns (0030/0035). Column names already match
 *  CorpusPageRow field-for-field; the two enrichment columns are additive. */
export type MemoryCorpusPageRow = Omit<CorpusPageRow, "thin"> & {
  run_id: string;
  thin: boolean;
  page_date: string | null;
  contact: { mailto?: string; form_url?: string; claim_url?: string } | null;
};

export interface MemoryDomainCheckRow {
  run_id: string;
  check_name: string;
  status: DomainCheck["status"];
  detail: string;
  factor: string | null;
}

export interface MemoryFixRow {
  run_id: string;
  fix_key: string;
  title: string;
  factor: string;
  weight: number;
  effort: Fix["effort"];
  time_to_impact: string;
  engines: Engine[];
  evidence: string[];
  artifact: string | null;
}

export interface MemoryNotificationRow {
  run_id: string;
  type: "audit_ready" | "verify_ready" | "run_failed";
  title: string;
  href: string;
}

export class MemoryDbWriter implements DbWriter {
  readonly runs: MemoryRunRow[] = [];
  readonly answers: MemoryAnswerRow[] = [];
  readonly answer_samples: MemoryAnswerSampleRow[] = [];
  readonly citations: MemoryCitationRow[] = [];
  readonly corpus_pages: MemoryCorpusPageRow[] = [];
  readonly domain_checks: MemoryDomainCheckRow[] = [];
  readonly fixes: MemoryFixRow[] = [];
  readonly notifications: MemoryNotificationRow[] = [];
  /** every stage label written, in order — the CLI's progress transcript */
  readonly stages: string[] = [];

  private runRow(runId: string): MemoryRunRow {
    const found = this.runs.find((r) => r.id === runId);
    if (found) return found;
    const fresh: MemoryRunRow = {
      id: runId,
      stage: null,
      status: "running",
      error: null,
      scores: null,
      est_cost_usd: null,
      finished_at: null,
    };
    this.runs.push(fresh);
    return fresh;
  }

  /** The run row for this id (created on first write), or undefined. */
  run(runId: string): MemoryRunRow | undefined {
    return this.runs.find((r) => r.id === runId);
  }

  async setStage(runId: string, label: string): Promise<void> {
    const run = this.runRow(runId);
    // .neq guard mirror: a cancelled/failed run is never clobbered back to running.
    if (run.status === "failed") return;
    run.stage = label;
    run.status = "running";
    this.stages.push(label);
  }

  async saveAnswer(row: AnswerRow & { runId: string }): Promise<void> {
    this.answers.push({
      run_id: row.runId,
      qid: row.qid,
      qtype: row.qtype,
      question: row.question,
      engine: row.engine,
      ok: row.ok,
      raw_text: row.raw_text,
      citations: row.citations,
      verdict: row.verdict ?? null,
      error: row.error ?? null,
      usage: row.usage ?? null,
    });
  }

  async saveVerdict(runId: string, qid: string, engine: Engine, verdict: Verdict): Promise<void> {
    for (const a of this.answers) {
      if (a.run_id === runId && a.qid === qid && a.engine === engine) a.verdict = verdict;
    }
  }

  async saveCorpusPage(row: CorpusPageRow & { runId: string }): Promise<void> {
    const enriched = row as typeof row & {
      page_date?: string | null;
      contact?: MemoryCorpusPageRow["contact"];
    };
    this.corpus_pages.push({
      run_id: row.runId,
      url: row.url,
      final_url: row.final_url,
      title: row.title,
      page_type: row.page_type,
      cited_by: row.cited_by,
      cited_for_qids: row.cited_for_qids,
      fetch_status: row.fetch_status,
      brand_present: row.brand_present,
      brand_context: row.brand_context,
      competitors_present: row.competitors_present,
      opportunity: row.opportunity,
      thin: row.thin ?? false,
      page_date: enriched.page_date ?? null,
      contact: enriched.contact ?? null,
    });
  }

  async saveCheck(row: DomainCheck & { runId: string }): Promise<void> {
    this.domain_checks.push({
      run_id: row.runId,
      check_name: row.check,
      status: row.status,
      detail: row.detail,
      factor: row.factor ?? null,
    });
  }

  async saveFix(row: Fix & { runId: string }): Promise<void> {
    this.fixes.push({
      run_id: row.runId,
      fix_key: row.fixKey,
      title: row.title,
      factor: row.factor,
      weight: row.weight,
      effort: row.effort,
      time_to_impact: row.timeToImpact,
      engines: row.engines,
      evidence: row.evidence,
      artifact: row.artifact ?? null,
    });
  }

  async finishRun(runId: string, scores: Scores, cost: number): Promise<void> {
    const run = this.runRow(runId);
    run.status = "done";
    run.stage = "done";
    run.scores = scores;
    run.est_cost_usd = cost;
    run.finished_at = new Date().toISOString();
  }

  async failRun(runId: string, error: string): Promise<void> {
    const run = this.runRow(runId);
    run.status = "failed";
    run.error = error;
  }

  /** Never throws, exactly like the real writer. */
  async notify(
    runId: string,
    type: MemoryNotificationRow["type"],
    title: string,
    href: string,
  ): Promise<void> {
    // upsert on (run_id, type) with ignoreDuplicates — at most one row per pair.
    if (this.notifications.some((n) => n.run_id === runId && n.type === type)) return;
    this.notifications.push({ run_id: runId, type, title, href });
  }

  // ---- the two flattened projections (0032/0033) + delete-first idempotency.
  // These are not DbWriter methods (the app persists them alongside the writer);
  // runAudit reaches them through `hooks` below.

  clearRunRows(runId: string): void {
    const drop = <T extends { run_id: string }>(rows: T[]) => {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].run_id === runId) rows.splice(i, 1);
    };
    drop(this.citations);
    drop(this.answer_samples);
    drop(this.answers);
  }

  saveAnswerSamples(rows: AnswerSampleRow[]): void {
    for (const r of rows) {
      this.answer_samples.push({
        run_id: r.runId,
        qid: r.qid,
        engine: r.engine,
        sample_idx: r.sampleIdx,
        raw_text: r.raw_text,
        citations: r.citations ?? [],
        verdict: r.verdict ?? null,
        usage: r.usage ?? null,
      });
    }
  }

  saveCitations(rows: CitationRow[]): void {
    for (const r of rows) {
      this.citations.push({
        run_id: r.runId,
        brand_id: r.brandId,
        qid: r.qid,
        engine: r.engine,
        url: r.url,
        norm_url: r.normUrl,
        host: r.host,
        position: r.position,
      });
    }
  }

  /** Hooks that wire the three projection seams into this writer. Pass as
   *  `runAudit(input, { db: mem, hooks: mem.hooks(), ... })`. */
  hooks(): RunAuditHooks {
    return {
      beforePersistAnswers: (runId) => this.clearRunRows(runId),
      onAnswerSamples: (rows) => this.saveAnswerSamples(rows),
      onCitations: (rows) => this.saveCitations(rows),
    };
  }
}
