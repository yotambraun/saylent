// Real questions in: turn what people actually search into a questions.json
// an audit can ask. Pure and browser-safe (no node: imports): the CLI's
// `saylent questions import`, the MCP preview tool and the app's question
// editor all run this same code, so a file reads the same everywhere.
//
// INPUTS
//  - Google Search Console, Performance report export. The export holds
//    Queries, Pages, Countries, Devices, Search appearances and Dates tabs
//    (https://developers.google.com/search/blog/2020/02/data-export) with
//    Clicks, Impressions, CTR and Position
//    (https://support.google.com/webmasters/answer/7576553), checked
//    2026-11-02. Google does not document the CSV header names: exports seen
//    in the wild use "Top queries" (Queries.csv) and "Top pages" (Pages.csv),
//    with CTR written as "4.5%". So headers are matched case-insensitively
//    ("top queries", "query", "queries"), "%" is stripped, and the Search
//    Analytics API's own column names (query, clicks, impressions, ctr as a
//    0-1 fraction, position) are accepted too. A Pages export is refused.
//  - any CSV, with --column naming the question column (and optionally a
//    weight column to rank by);
//  - plain text, one question per line, "#" comments.
//
// WHAT HAPPENS TO A ROW (every step is counted, nothing is dropped silently)
//  1. normalize: NFKC, collapse whitespace, trim;
//  2. filters: empty, too short (< MIN_WORDS words), too long (> MAX_CHARS),
//     below --min-impressions, --include / --exclude patterns, --questions-only;
//  3. dedupe on a key (lowercase, trailing punctuation stripped);
//  4. optional clustering on a token-set key (lowercase words minus a short,
//     stated English stopword list, sorted): the highest-ranked variant stays,
//     the others are recorded on it;
//  5. rank (impressions, then clicks for GSC; the weight column; else file
//     order) and keep the first --max.
// No model is involved. An optional rewrite into natural-language questions
// (questionRewritePrompt) is the caller's to run, behind an explicit flag.

export const IMPORT_MAX_DEFAULT = 20;
export const IMPORT_MAX_CAP = 50;
export const MIN_WORDS = 2;
export const MAX_CHARS = 300;

export type ImportFormat = "gsc" | "csv" | "text" | "questions.json";

export type DropReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "below_min_impressions"
  | "excluded"
  | "not_included"
  | "not_question"
  | "duplicate"
  | "clustered"
  | "over_max";

export const DROP_REASON_LABEL: Readonly<Record<DropReason, string>> = {
  empty: "empty",
  too_short: `shorter than ${MIN_WORDS} words`,
  too_long: `longer than ${MAX_CHARS} characters`,
  below_min_impressions: "below --min-impressions",
  excluded: "matched --exclude",
  not_included: "did not match --include",
  not_question: "not question-shaped (--questions-only)",
  duplicate: "duplicates",
  clustered: "merged into a near-identical query",
  over_max: "beyond --max",
};

export interface ImportOptions {
  format?: ImportFormat | "auto";
  /** CSV: the question column, by header name or 1-based index */
  column?: string | null;
  /** CSV: a numeric column to rank by */
  weightColumn?: string | null;
  minImpressions?: number | null;
  include?: string[];
  exclude?: string[];
  questionsOnly?: boolean;
  cluster?: boolean;
  max?: number;
  /** the question type every kept row gets (default "custom"; see the band rule) */
  type?: string;
  language?: string | null;
  country?: string | null;
}

export interface ImportedQuestion {
  text: string;
  /** GSC metrics when the source had them */
  impressions?: number;
  clicks?: number;
  ctr?: number;
  position?: number;
  weight?: number;
  /** other spellings merged into this one (dedupe + clustering) */
  variants?: string[];
  /** 1-based source row */
  row: number;
}

export interface ImportResult {
  format: ImportFormat;
  /** the column the questions came from */
  column: string | null;
  rows: number;
  kept: ImportedQuestion[];
  dropped: Partial<Record<DropReason, number>>;
  locale: { language?: string; country?: string } | null;
  warnings: string[];
}

/* --------------------------------- CSV ------------------------------------ */

/** RFC 4180 with a sniffed delimiter (comma, semicolon or tab) and a BOM strip. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const d =
    delimiter ??
    [",", ";", "\t"]
      .map((c) => ({ c, n: firstLine.split(c).length }))
      .sort((a, b) => b.n - a.n)[0].c;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQ = true;
    else if (ch === d) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "1,234" / "4.5%" / "0.045" → number, or null. */
export function parseMetric(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim().replace(/%$/, "").replace(/,(?=\d{3}\b)/g, "");
  if (!t || t === "-" || t === "~") return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const QUERY_HEADERS = ["top queries", "query", "queries", "search query"];
const PAGE_HEADERS = ["top pages", "page", "pages"];

/* ------------------------------ normalizing ------------------------------- */

export function normalizeText(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function dedupeKey(s: string): string {
  return normalizeText(s).toLowerCase().replace(/[\s?.!,;:]+$/g, "");
}

/** The stated stopword list for the token-set key (English only). */
export const STOPWORDS: ReadonlySet<string> = new Set(
  "a an the of for to in on at by with and or is are was be do does can i my me we our you your it its this that what which who how why when where vs versus".split(" "),
);

export function clusterKey(s: string): string {
  const words = dedupeKey(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOPWORDS.has(w));
  return [...new Set(words)].sort().join(" ");
}

const QUESTION_START =
  /^(what|which|who|whom|whose|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will|shall|may|might|must|has|have|had)\b/i;

/** "?" at the end in any language; the English wh-/auxiliary start list only
 *  for text that starts with an English word from that list. */
export function isQuestionShaped(s: string): boolean {
  const t = normalizeText(s);
  return /[?？؟]$/.test(t) || QUESTION_START.test(t);
}

const BCP47 = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;
const COUNTRY = /^[a-zA-Z]{2}$/;

export function validateLocale(language?: string | null, country?: string | null): { language?: string; country?: string } | string {
  const out: { language?: string; country?: string } = {};
  if (language) {
    if (!BCP47.test(language)) return `language "${language}": expected a BCP 47 tag such as en, de or pt-BR`;
    out.language = language;
  }
  if (country) {
    if (!COUNTRY.test(country)) return `country "${country}": expected a two-letter code such as us, de or br`;
    out.country = country.toLowerCase();
  }
  return out;
}

const compileAll = (pats: string[] | undefined, flag: string): RegExp[] =>
  (pats ?? []).map((p) => {
    try {
      return new RegExp(p, "i");
    } catch {
      throw new Error(`${flag} "${p}" is not a valid regular expression`);
    }
  });

/* --------------------------------- import --------------------------------- */

interface RawRow {
  text: string;
  row: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  position?: number;
  weight?: number;
}

export function detectFormat(text: string, filename?: string | null): ImportFormat {
  const t = text.replace(/^\uFEFF/, "").trimStart();
  if (t.startsWith("{")) return "questions.json";
  const name = (filename ?? "").toLowerCase();
  const first = (t.split(/\r?\n/, 1)[0] ?? "").toLowerCase();
  const headerCells = parseCsv(first)[0]?.map((c) => c.trim().toLowerCase()) ?? [];
  const looksGsc = headerCells.some((c) => QUERY_HEADERS.includes(c)) && headerCells.some((c) => c === "impressions" || c === "clicks");
  if (looksGsc) return "gsc";
  if (headerCells.some((c) => PAGE_HEADERS.includes(c)) && headerCells.includes("impressions")) return "gsc";
  if (name.endsWith(".csv") || name.endsWith(".tsv")) return "csv";
  return "text";
}

function columnIndex(header: string[], want: string): number {
  if (/^\d+$/.test(want)) return Number(want) - 1;
  return header.findIndex((h) => h.trim().toLowerCase() === want.trim().toLowerCase());
}

function readRows(text: string, format: ImportFormat, opts: ImportOptions): { rows: RawRow[]; column: string | null } {
  if (format === "text") {
    const rows: RawRow[] = [];
    text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((line, i) => {
      // comments and blank lines are layout, not rows
      if (/^\s*#/.test(line) || line.trim() === "") return;
      rows.push({ text: line, row: i + 1 });
    });
    return { rows, column: null };
  }
  if (format === "questions.json") {
    const doc = JSON.parse(text) as { questions?: { text?: unknown }[] };
    if (!Array.isArray(doc.questions)) throw new Error("a questions.json needs a questions array");
    return { rows: doc.questions.map((q, i) => ({ text: typeof q.text === "string" ? q.text : "", row: i + 1 })), column: "text" };
  }
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], column: null };
  const header = table[0].map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  let qi: number;
  if (opts.column) {
    qi = columnIndex(header, opts.column);
    if (qi < 0 || qi >= header.length) throw new Error(`--column "${opts.column}" is not a column here. Columns: ${header.join(", ")}`);
  } else if (format === "gsc") {
    qi = lower.findIndex((h) => QUERY_HEADERS.includes(h));
    if (qi < 0) {
      if (lower.some((h) => PAGE_HEADERS.includes(h))) {
        throw new Error("This is the Pages tab of a Search Console export. Import the Queries tab (Queries.csv) instead.");
      }
      throw new Error(`No query column found. Columns: ${header.join(", ")}. Pass --column to name it.`);
    }
  } else {
    qi = lower.findIndex((h) => QUERY_HEADERS.includes(h) || h === "question" || h === "questions");
    if (qi < 0) throw new Error(`Which column holds the questions? Pass --column <name or number>. Columns: ${header.join(", ")}`);
  }
  const idx = (name: string) => lower.indexOf(name);
  const wi = opts.weightColumn ? columnIndex(header, opts.weightColumn) : -1;
  if (opts.weightColumn && wi < 0) throw new Error(`--weight-column "${opts.weightColumn}" is not a column here.`);
  const rows: RawRow[] = table.slice(1).map((r, i) => {
    const out: RawRow = { text: r[qi] ?? "", row: i + 2 };
    if (format === "gsc" || idx("impressions") >= 0) {
      const imp = parseMetric(r[idx("impressions")]);
      const clk = parseMetric(r[idx("clicks")]);
      const ctrRaw = r[idx("ctr")];
      const ctr = parseMetric(ctrRaw);
      const pos = parseMetric(r[idx("position")]);
      if (imp !== null && idx("impressions") >= 0) out.impressions = imp;
      if (clk !== null && idx("clicks") >= 0) out.clicks = clk;
      // "4.5%" is a percentage; the API's 0.045 is a fraction: store a fraction
      if (ctr !== null && idx("ctr") >= 0) out.ctr = ctrRaw?.trim().endsWith("%") || ctr > 1 ? ctr / 100 : ctr;
      if (pos !== null && idx("position") >= 0) out.position = pos;
    }
    if (wi >= 0) {
      const w = parseMetric(r[wi]);
      if (w !== null) out.weight = w;
    }
    return out;
  });
  return { rows, column: header[qi] ?? null };
}

export function importQuestions(text: string, opts: ImportOptions = {}, filename?: string | null): ImportResult {
  const format = !opts.format || opts.format === "auto" ? detectFormat(text, filename) : opts.format;
  const locale = validateLocale(opts.language, opts.country);
  if (typeof locale === "string") throw new Error(locale);
  const max = Math.min(Math.max(opts.max ?? IMPORT_MAX_DEFAULT, 1), IMPORT_MAX_CAP);
  const include = compileAll(opts.include, "--include");
  const exclude = compileAll(opts.exclude, "--exclude");
  const { rows, column } = readRows(text, format, opts);
  const dropped: Partial<Record<DropReason, number>> = {};
  const drop = (r: DropReason) => (dropped[r] = (dropped[r] ?? 0) + 1);
  const warnings: string[] = [];
  if (opts.minImpressions && !rows.some((r) => r.impressions !== undefined)) {
    warnings.push("--min-impressions was ignored: this file has no Impressions column.");
  }

  const passed: RawRow[] = [];
  for (const r of rows) {
    const t = normalizeText(r.text);
    if (!t) {
      drop("empty");
      continue;
    }
    if (t.length > MAX_CHARS) {
      drop("too_long");
      continue;
    }
    if (t.split(" ").length < MIN_WORDS) {
      drop("too_short");
      continue;
    }
    if (opts.minImpressions && r.impressions !== undefined && r.impressions < opts.minImpressions) {
      drop("below_min_impressions");
      continue;
    }
    if (exclude.some((re) => re.test(t))) {
      drop("excluded");
      continue;
    }
    if (include.length && !include.some((re) => re.test(t))) {
      drop("not_included");
      continue;
    }
    if (opts.questionsOnly && !isQuestionShaped(t)) {
      drop("not_question");
      continue;
    }
    passed.push({ ...r, text: t });
  }

  // rank first, so dedupe and clustering keep the strongest spelling
  const ranked = passed
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        (b.r.impressions ?? -1) - (a.r.impressions ?? -1) ||
        (b.r.clicks ?? -1) - (a.r.clicks ?? -1) ||
        (b.r.weight ?? -Infinity) - (a.r.weight ?? -Infinity) ||
        a.i - b.i,
    )
    .map((x) => x.r);

  const byKey = new Map<string, ImportedQuestion>();
  const byCluster = new Map<string, ImportedQuestion>();
  const kept: ImportedQuestion[] = [];
  for (const r of ranked) {
    const key = dedupeKey(r.text);
    const dup = byKey.get(key);
    if (dup) {
      drop("duplicate");
      if (dup.text !== r.text && !(dup.variants ?? []).includes(r.text)) dup.variants = [...(dup.variants ?? []), r.text];
      continue;
    }
    if (opts.cluster) {
      const ck = clusterKey(r.text);
      const near = ck ? byCluster.get(ck) : undefined;
      if (near) {
        drop("clustered");
        near.variants = [...(near.variants ?? []), r.text];
        byKey.set(key, near);
        continue;
      }
    }
    const q: ImportedQuestion = { text: r.text, row: r.row };
    for (const k of ["impressions", "clicks", "ctr", "position", "weight"] as const) if (r[k] !== undefined) q[k] = r[k];
    byKey.set(key, q);
    if (opts.cluster) byCluster.set(clusterKey(r.text), q);
    kept.push(q);
  }
  if (kept.length > max) {
    dropped.over_max = kept.length - max;
    kept.length = max;
  }
  return {
    format,
    column,
    rows: rows.length,
    kept,
    dropped,
    locale: locale.language || locale.country ? locale : null,
    warnings,
  };
}

/** "kept 18 of 1,204 rows: 900 below --min-impressions, 200 duplicates, ..." */
export function importSummary(r: ImportResult): string {
  const parts = (Object.entries(r.dropped) as [DropReason, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n.toLocaleString("en-US")} ${DROP_REASON_LABEL[k]}`);
  return `Kept ${r.kept.length} of ${r.rows.toLocaleString("en-US")} rows${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/* ------------------------------ questions.json ---------------------------- */

export interface QuestionsJsonDoc {
  brand: string;
  domain?: string;
  version: number | string;
  locale?: { language?: string; country?: string };
  import?: {
    file: string | null;
    format: ImportFormat;
    column: string | null;
    rows: number;
    kept: number;
    dropped: Partial<Record<DropReason, number>>;
    generated_at: string;
  };
  questions: {
    id: string;
    type: string;
    text: string;
    source: "user";
    /** the query it came from, when a rewrite changed the wording */
    from?: string;
    impressions?: number;
    clicks?: number;
  }[];
}

export function toQuestionsJson(
  r: ImportResult,
  opts: { brand?: string; domain?: string; file?: string | null; type?: string; now?: Date; rewritten?: Map<string, string> } = {},
): QuestionsJsonDoc {
  const type = opts.type ?? "custom";
  return {
    brand: opts.brand ?? "",
    ...(opts.domain ? { domain: opts.domain } : {}),
    version: "import",
    ...(r.locale ? { locale: r.locale } : {}),
    import: {
      file: opts.file ?? null,
      format: r.format,
      column: r.column,
      rows: r.rows,
      kept: r.kept.length,
      dropped: r.dropped,
      generated_at: (opts.now ?? new Date()).toISOString(),
    },
    questions: r.kept.map((q, i) => {
      const rewritten = opts.rewritten?.get(q.text);
      return {
        id: `u${String(i + 1).padStart(2, "0")}`,
        type,
        text: rewritten ?? q.text,
        source: "user" as const,
        ...(rewritten && rewritten !== q.text ? { from: q.text } : {}),
        ...(q.impressions !== undefined ? { impressions: q.impressions } : {}),
        ...(q.clicks !== undefined ? { clicks: q.clicks } : {}),
      };
    }),
  };
}

/** The MCP preview: parse + filter, never write. */
export function previewQuestionImport(input: { text: string; filename?: string | null; options?: ImportOptions }) {
  const r = importQuestions(input.text, input.options ?? {}, input.filename);
  return {
    format: r.format,
    column: r.column,
    rows: r.rows,
    kept: r.kept,
    dropped: r.dropped,
    summary: importSummary(r),
    locale: r.locale,
    warnings: r.warnings,
  };
}

/* ------------------------------ optional rewrite -------------------------- */

/** The one prompt the optional --rewrite sends: search queries in, one natural
 *  question per line out, same order, same language, no new facts. */
export function questionRewritePrompt(queries: string[], language?: string | null): string {
  return [
    "Rewrite each search query below as the question a buyer would ask an AI assistant.",
    `Keep the meaning and the ${language ? `language (${language})` : "original language"}; do not add brand names, numbers or facts that are not in the query.`,
    "Return exactly one question per line, in the same order, with no numbering and nothing else.",
    "",
    ...queries,
  ].join("\n");
}

/** Pair the model's lines back to the queries; any mismatch keeps the query. */
export function parseRewrite(queries: string[], output: string): Map<string, string> {
  const lines = output
    .split(/\r?\n/)
    .map((l) => normalizeText(l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "")))
    .filter(Boolean);
  const out = new Map<string, string>();
  if (lines.length !== queries.length) return out;
  queries.forEach((q, i) => {
    const l = lines[i];
    if (l && l.length <= MAX_CHARS) out.set(q, l);
  });
  return out;
}
