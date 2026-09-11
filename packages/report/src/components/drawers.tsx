"use client";
// THE RECEIPTS — the two evidence drawers extracted from dossier.tsx for reuse.
// AnswerDrawer opens a single stored engine answer (verdict card + raw + citations
// + resources); PageDrawer opens a single crawled corpus page. Both are pure
// display over RLS-fetched rows. Kept byte-identical to their dossier originals.
import { decodeEntities } from "../entities";
import { type ReactNode } from "react";
import { Badge } from "../ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { normClaims, normOtherBrands } from "@saylent/engine/verdict-compat";
import { answerCents, formatCents, hasRecordedUsage } from "@saylent/engine/answer-cost";
import { pageOwner, type RivalOwnerFn } from "../report-intel";
import { trimEdgeFragments } from "../strip-md";

/* ---------- row types (DB snake_case, RLS-fetched) ---------- */
export interface AnswerRow {
  id: string;
  qid: string;
  qtype: string;
  question: string;
  engine: string;
  ok: boolean;
  raw_text: string;
  citations: { url: string; title?: string }[];
  verdict: {
    brand_present: boolean;
    mention_type: string;
    prominence: string;
    sentiment: string;
    // E2a: both shapes coexist in the DB — old `string[]`, new
    // `{text,kind}[]` / `{name,why}[]`. Read via normClaims/normOtherBrands.
    claims: unknown;
    other_brands: unknown;
    excerpt: string;
  } | null;
  error: string | null;
  created_at?: string;
  // exact provider usage (answers.usage jsonb, migration 0011) — flows here via
  // get_dossier's to_jsonb(a); null on pre-0011 runs. Powers the drawer resources line.
  usage?: { input_tokens?: number; output_tokens?: number; searches?: number } | null;
}
export interface CorpusRow {
  id: string;
  url: string;
  final_url: string | null;
  title: string | null;
  page_type: string;
  cited_by: Record<string, number>;
  cited_for_qids: string[];
  fetch_status: number | null;
  brand_present: boolean | null;
  brand_context: string | null;
  competitors_present: string[];
  opportunity: boolean;
  thin?: boolean;
}

export const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

export const hostOf = (u: string | null) => {
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u.slice(0, 40);
  }
};

/* ---------- drawers (THE RECEIPTS) ---------- */

/* E3d — claim kinds → grouped evidence chips. risk is NEVER hidden; it gets the
 * warn/ink-outline treatment so a reported doubt reads as loudly as praise. */
const CLAIM_KIND: { key: "praise" | "risk" | "neutral_fact"; label: string; chip: string }[] = [
  { key: "praise", label: "What they praise", chip: "border-success/50 bg-success/5 text-ink" },
  { key: "risk", label: "What buyers hear as doubts", chip: "border-signal bg-signal/10 text-ink" },
  { key: "neutral_fact", label: "Facts they repeat", chip: "border-line text-wire" },
];

/* Highlight the brand + its aliases inline in an excerpt (safe literal match,
 * case-insensitive) so the reader sees exactly where the answer names them. */
function highlightBrand(text: string, terms: string[]): ReactNode {
  const uniq = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!text || uniq.length === 0) return text;
  const escaped = uniq.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const lower = new Set(uniq.map((u) => u.toLowerCase()));
  return text.split(re).map((part, i) =>
    lower.has(part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-signal/20 px-0.5 font-medium text-ink">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

// A stored page excerpt is often nav-link soup; when it actually names the brand
// or an alias, show a ±170-char window around the FIRST match (ellipsized) so the
// receipt reads as evidence. No match ⇒ caller renders the raw excerpt as before.
// Pure display — never touches stored data.
const EXCERPT_RADIUS = 170;
function excerptWindow(
  text: string,
  terms: string[],
): { matched: boolean; text: string; leadEllipsis: boolean; trailEllipsis: boolean } {
  const uniq = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const lower = text.toLowerCase();
  let idx = -1;
  for (const t of uniq) {
    const i = lower.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return { matched: false, text, leadEllipsis: false, trailEllipsis: false };
  let start = Math.max(0, idx - EXCERPT_RADIUS);
  let end = Math.min(text.length, idx + EXCERPT_RADIUS);
  // snap the window to word boundaries — a raw character slice opens/closes the
  // quote mid-word ("…ansfer service for peop…"), which reads as sloppy trimming
  if (start > 0) {
    const nextSpace = text.indexOf(" ", start);
    if (nextSpace !== -1 && nextSpace < idx) start = nextSpace + 1;
  }
  if (end < text.length) {
    const lastSpace = text.lastIndexOf(" ", end);
    if (lastSpace > idx) end = lastSpace;
  }
  return {
    matched: true,
    text: text.slice(start, end),
    leadEllipsis: start > 0,
    trailEllipsis: end < text.length,
  };
}

// Edge-tidy (`trimEdgeFragments`) + the whole preview pipeline live in
// @saylent/report/strip-md — the one home. The page-excerpt receipt is edge-tidied only
// (no markdown strip) so the captured text stays as verbatim as an ellipsized
// window allows.
function PageExcerpt({ text, terms }: { text: string; terms: string[] }) {
  const win = excerptWindow(text, terms);
  if (!win.matched) return <p>“…{trimEdgeFragments(text)}…”</p>;
  return (
    <p>
      {win.leadEllipsis ? "“…" : "“"}
      {highlightBrand(win.text, terms)}
      {win.trailEllipsis ? "…”" : "”"}
    </p>
  );
}

export function AnswerDrawer({
  answer,
  engineModels,
  brand,
  onClose,
}: {
  answer: AnswerRow | null;
  engineModels?: Record<string, string>;
  brand: { name: string; aliases: string[] };
  onClose: () => void;
}) {
  return (
    <Sheet open={!!answer} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {answer && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display">
                {ENGINE_LABEL[answer.engine]} · {answer.qid}
              </SheetTitle>
              <SheetDescription>{answer.question}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-8">
              {/* source chip — provenance of this single stored answer */}
              <p className="font-mono text-[10px] uppercase tracking-wider text-wire tabular-nums" suppressHydrationWarning>
                {[
                  ENGINE_LABEL[answer.engine] ?? answer.engine,
                  engineModels?.[answer.engine],
                  answer.created_at &&
                    new Date(answer.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {/* EVIDENCE CARD (E3d) — the designed verdict, in reading order
                  before the raw dump. Honest states first-class; risk never hidden. */}
              {answer.verdict &&
                (() => {
                  const v = answer.verdict;
                  const claims = normClaims(v);
                  const others = normOtherBrands(v);
                  const brandTerms = [brand.name, ...(brand.aliases ?? [])];
                  const sentClass =
                    v.sentiment === "positive"
                      ? "border-success/50 text-success"
                      : v.sentiment === "negative"
                        ? "border-pill-dismissed/50 text-pill-dismissed"
                        : "border-line text-wire";
                  return (
                    <div className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
                      <h4 className="font-mono text-xs uppercase text-wire">
                        What we found in this answer
                      </h4>
                      {/* (a) verdict chips */}
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="border-line">
                          {v.brand_present ? "seen" : "not seen"}
                        </Badge>
                        <Badge variant="outline" className="border-line">
                          mention: {v.mention_type}
                        </Badge>
                        <Badge variant="outline" className="border-line">
                          prominence: {v.prominence}
                        </Badge>
                        <Badge variant="outline" className={sentClass}>
                          sentiment: {v.sentiment}
                        </Badge>
                      </div>
                      {/* (b) excerpt, brand highlighted inline */}
                      {v.excerpt ? (
                        <p className="border-l-2 border-line pl-3 text-sm italic text-ink/80">
                          &ldquo;{highlightBrand(v.excerpt, brandTerms)}&rdquo;
                        </p>
                      ) : (
                        <p className="text-sm text-wire">
                          No excerpt captured. The engine didn&apos;t name {brand.name} in a
                          quotable line.
                        </p>
                      )}
                      {/* (c) claims grouped by kind — risk shown as loudly as praise */}
                      {claims.length > 0 && (
                        <div className="flex flex-col gap-2">
                          {CLAIM_KIND.map(({ key, label, chip }) => {
                            const items = claims.filter((c) => c.kind === key);
                            if (items.length === 0) return null;
                            return (
                              <div key={key}>
                                <div className="mb-1 font-mono text-[10px] uppercase text-wire">
                                  {label}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {items.map((c, i) => (
                                    <span
                                      key={i}
                                      className={`rounded border px-2 py-1 text-sm break-words ${chip}`}
                                    >
                                      {c.text}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {/* (d) rivals the answer named, with the stated reason when given */}
                      {others.length > 0 && (
                        <div>
                          <div className="mb-1 font-mono text-[10px] uppercase text-wire">
                            Rivals the answer named
                          </div>
                          <ul className="flex flex-col gap-0.5 text-sm">
                            {others.map((o, i) => (
                              <li key={i}>
                                <span className="font-medium">{o.name}</span>
                                {o.why && <span className="text-wire">: {o.why}</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })()}
              <div>
                <h4 className="mb-1 font-mono text-xs uppercase text-wire">Raw answer (stored)</h4>
                <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded border border-line bg-paper p-3 font-mono text-xs">
                  {answer.raw_text || "(empty)"}
                </pre>
              </div>
              <div>
                <h4 className="mb-1 font-mono text-xs uppercase text-wire tabular-nums">
                  Citations ({answer.citations.length})
                </h4>
                {answer.citations.length === 0 ? (
                  <p className="text-sm text-wire">No sources cited in this answer.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm">
                    {answer.citations.map((c, i) => (
                      <li key={i}>
                        <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                          {(c.title && decodeEntities(c.title)) || hostOf(c.url)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {/* RESOURCES — per-answer cost explorer (answers.usage, migration
                  0011). Honest: measured tokens/searches + the est cost computed
                  with the SAME pricing the engine bills the run with
                  (@saylent/engine/answer-cost, mirrors src/inngest/functions.ts). Old runs
                  (pre-0011) never recorded usage — we say so rather than guess. */}
              <AnswerResources answer={answer} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** The one small "resources" footer line in the AnswerDrawer. */
function AnswerResources({ answer }: { answer: AnswerRow }) {
  const usage = answer.usage;
  const recorded = hasRecordedUsage(usage);
  return (
    <div className="border-t border-line pt-3">
      <h4 className="mb-1 font-mono text-[10px] uppercase tracking-wider text-wire">Resources</h4>
      {recorded ? (
        <p className="font-mono text-xs text-wire tabular-nums">
          {(usage.input_tokens ?? 0).toLocaleString()} in ·{" "}
          {(usage.output_tokens ?? 0).toLocaleString()} out tokens
          {usage.searches
            ? ` · ${usage.searches} web ${usage.searches === 1 ? "search" : "searches"}`
            : ""}{" "}
          · est{" "}
          <span className="text-ink">
            {formatCents(answerCents({ engine: answer.engine, ok: answer.ok, usage }))}
          </span>
        </p>
      ) : (
        <p className="font-mono text-xs text-wire">Usage not recorded for this run.</p>
      )}
    </div>
  );
}

export function PageDrawer({
  page,
  brand,
  rivalOwner,
  onClose,
}: {
  page: CorpusRow | null;
  brand: { name: string; aliases?: string[] };
  rivalOwner: RivalOwnerFn;
  onClose: () => void;
}) {
  const owner = page ? pageOwner(page, rivalOwner) : null;
  return (
    <Sheet open={!!page} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {page && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display">
                {(page.title && decodeEntities(page.title)) ||
                  hostOf(page.final_url ?? page.url)}
              </SheetTitle>
              <SheetDescription>
                <a
                  href={page.final_url ?? page.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all underline"
                >
                  {page.final_url ?? page.url}
                </a>
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-8 text-sm">
              {owner && (
                <p className="rounded border border-line bg-wire/5 px-4 py-2 text-ink/80">
                  This is {owner}&apos;s own site. You can&apos;t be added here. The counter-move
                  is your own page answering the same questions (see your{" "}
                  <a href="#fix-plan" onClick={onClose} className="text-signal underline">
                    fix plan
                  </a>
                  ).
                </p>
              )}
              {page.thin && (
                <p className="rounded border border-signal/40 bg-signal/5 px-4 py-2 text-ink/80">
                  Thin page. Mostly loads via JavaScript; answer engines may not read it.
                </p>
              )}
              <div>
                <h4 className="mb-1 font-mono text-xs uppercase text-wire">
                  {brand.name} on this page
                </h4>
                {page.brand_present === null ? (
                  <p className="text-wire">
                    We couldn&apos;t fetch this page (status {page.fetch_status ?? "—"}). Stored
                    as unverified, never guessed.
                  </p>
                ) : page.brand_present ? (
                  <PageExcerpt
                    text={page.brand_context ?? ""}
                    terms={[brand.name, ...(brand.aliases ?? [])]}
                  />
                ) : (
                  <p className="text-signal">brand not found on this page</p>
                )}
              </div>
              <div>
                <h4 className="mb-1 font-mono text-xs uppercase text-wire">Cited for</h4>
                {page.cited_for_qids.length === 0 ? (
                  <p className="text-wire">Not cited by name in any single answer on this run.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {page.cited_for_qids.map((q) => (
                      <a key={q} href={`#q-${q}`} onClick={onClose} className="text-signal underline">
                        [{q}]
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <h4 className="mb-1 font-mono text-xs uppercase text-wire">Competitors present</h4>
                <p>{page.competitors_present.join(", ") || "none detected"}</p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
