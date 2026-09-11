"use client";
// COMPARE — the rival head-to-head view. Pure display over the
// compare model (src/lib/compare.ts, $0 deterministic); every number is one tap
// from the SAME AnswerDrawer / PageDrawer the dossier uses. Editorial, house
// tokens, no gauges: the signature is the verdict grid — a matrix of who each
// engine favours, each cell a distinct glyph + word (never colour alone). The
// rival picker is a segmented control that writes ?rival= into the URL.
import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Circle, Minus } from "lucide-react";
import { Favicon } from "@/components/favicon";
import { PendingLink } from "@/components/pending-link";
import { makeRivalOwner } from "@saylent/engine/rival-owner";
import type {
  CellFavor,
  CompareReceipt,
  RivalCompare,
  RivalOption,
} from "@saylent/report/compare";
import { AnswerDrawer, PageDrawer, type AnswerRow, type CorpusRow } from "@saylent/report/components/drawers";

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};
const engineLabel = (e: string) => ENGINE_LABEL[e] ?? e;

/* Each favour token: a glyph + a word + a house colour. The word carries the
 * meaning on its own (WCAG color-not-only) — colour and glyph reinforce it. */
const FAVOR: Record<
  CellFavor,
  { word: string; Icon: typeof Circle; text: string; ring: string; aria: (rival: string) => string }
> = {
  you: {
    word: "You",
    Icon: ArrowUpRight,
    text: "text-signal",
    ring: "border-signal/40 bg-signal/5",
    aria: () => "favours you",
  },
  rival: {
    word: "Them",
    Icon: ArrowDownRight,
    text: "text-pill-dismissed",
    ring: "border-pill-dismissed/40 bg-pill-dismissed/5",
    aria: (r) => `favours ${r}`,
  },
  both: {
    word: "Both",
    Icon: Minus,
    text: "text-ink/70",
    ring: "border-line bg-card",
    aria: (r) => `names both you and ${r}`,
  },
  neither: {
    word: "Neither",
    Icon: Circle,
    text: "text-wire",
    ring: "border-line/60 bg-transparent",
    aria: () => "names neither of you",
  },
};

export function VsClient({
  brandId,
  brand,
  options,
  compare,
  answers,
  corpus,
  engineModels,
  runId,
  runDate,
  rivalHrefBase = "?rival=",
}: {
  brandId: string;
  brand: { name: string; domain: string; aliases: string[]; competitors: string[] };
  options: RivalOption[];
  compare: RivalCompare;
  answers: AnswerRow[];
  corpus: CorpusRow[];
  engineModels?: Record<string, string>;
  runId: string;
  runDate: string;
  /** picker href prefix — /app/compare passes its own so ?brand= survives */
  rivalHrefBase?: string;
}) {
  const { rival } = compare;

  // Receipt resolution — mirror compare.ts's keying (id → `qid|engine` → url) so
  // either handle opens the right stored-row drawer.
  const answerIndex = useMemo(() => {
    const m = new Map<string, AnswerRow>();
    for (const a of answers) {
      if (a.id) m.set(a.id, a);
      m.set(`${a.qid}|${a.engine}`, a);
    }
    return m;
  }, [answers]);
  const pageIndex = useMemo(() => {
    const m = new Map<string, CorpusRow>();
    for (const p of corpus) {
      if (p.id) m.set(p.id, p);
      m.set(p.url, p);
      if (p.final_url) m.set(p.final_url, p);
    }
    return m;
  }, [corpus]);
  const rivalOwner = useMemo(
    () => makeRivalOwner(brand.competitors, corpus),
    [brand.competitors, corpus],
  );

  const [answerOpen, setAnswerOpen] = useState<AnswerRow | null>(null);
  const [pageOpen, setPageOpen] = useState<CorpusRow | null>(null);

  const openReceipt = (r: CompareReceipt) => {
    if (r.kind === "answer") {
      const a = answerIndex.get(r.id);
      if (a) setAnswerOpen(a);
    } else {
      const p = pageIndex.get(r.id);
      if (p) setPageOpen(p);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 pb-24">
      {/* HEADER + RIVAL PICKER */}
      <header className="flex flex-col gap-5">
        <PendingLink
          href={`/app/brand/${brandId}`}
          className="w-fit font-mono text-xs text-wire underline underline-offset-2 hover:text-ink"
        >
          ← {brand.name} movement
        </PendingLink>
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-wider text-wire">
            Head-to-head · one audit · {runDate}
          </p>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">
            {brand.name} <span className="text-wire">vs</span> {rival}
          </h1>
        </div>

        {/* SEGMENTED PICKER — one chip per real mined rival; the URL carries the
            choice (?rival=), so it's shareable + back/forward safe. */}
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-wire">
            Compare against
          </span>
          <div
            role="group"
            aria-label="Pick a rival to compare against"
            className="flex flex-wrap gap-2"
          >
            {options.map((o) => {
              const active = o.name === rival;
              return (
                <PendingLink
                  key={o.name}
                  href={`${rivalHrefBase}${encodeURIComponent(o.name)}`}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-line text-ink/80 hover:border-ink/40 hover:text-ink"
                  }`}
                >
                  <span>{o.name}</span>
                  <span
                    className={`font-mono text-[10px] tabular-nums ${active ? "text-paper/70" : "text-wire"}`}
                  >
                    {o.mentions}
                  </span>
                </PendingLink>
              );
            })}
          </div>
          <p className="font-mono text-[11px] text-wire">
            The number is how many times the engines named that rival in this run. Every cell
            below opens the exact saved answer it came from.
          </p>
        </div>
      </header>

      {/* 1. HEAD-TO-HEAD VERDICT GRID */}
      {compare.grid && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl">Question by question, who do the engines favour?</h2>
            <p className="text-sm text-wire">
              Each scored question, across the four engines. Tap any cell to read that answer.
            </p>
          </div>

          {/* legend — the four tokens spelled out (glyph + word, never colour alone) */}
          <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg border border-line bg-card px-4 py-3">
            {(["you", "rival", "both", "neither"] as CellFavor[]).map((f) => {
              const t = FAVOR[f];
              return (
                <span key={f} className="inline-flex items-center gap-1.5 text-xs">
                  <t.Icon className={`size-3.5 ${t.text}`} aria-hidden />
                  <span className="text-ink/80">
                    {t.word}
                    {f === "rival" ? ` = ${rival}` : ""}
                    {f === "you" ? ` = ${brand.name}` : ""}
                  </span>
                </span>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                  <th scope="col" className="px-4 py-3 font-normal">
                    Question
                  </th>
                  {compare.grid.engines.map((e) => (
                    <th key={e} scope="col" className="px-3 py-3 text-center font-normal">
                      {engineLabel(e)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compare.grid.rows.map((row) => (
                  <tr key={row.qid} className="border-b border-line last:border-0 align-top">
                    <th
                      scope="row"
                      className="max-w-[22rem] px-4 py-3 text-left align-top font-normal"
                    >
                      <span className="line-clamp-3 text-ink/90">{row.question}</span>
                    </th>
                    {compare.grid!.engines.map((engine) => {
                      const cell = row.cells.find((c) => c.engine === engine);
                      if (!cell || cell.favor === null) {
                        return (
                          <td key={engine} className="px-3 py-3 text-center">
                            <span className="font-mono text-xs text-wire/50" aria-label="no answer">
                              ·
                            </span>
                          </td>
                        );
                      }
                      const t = FAVOR[cell.favor];
                      const recommended = cell.recommended && cell.favor === "you";
                      return (
                        <td key={engine} className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => cell.receipt && openReceipt(cell.receipt)}
                            aria-label={`${engineLabel(engine)} ${t.aria(rival)}. Read this answer.`}
                            className={`inline-flex min-h-[44px] w-full min-w-[5.5rem] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md border px-2 py-1.5 transition-colors hover:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal ${t.ring}`}
                          >
                            <span className={`inline-flex items-center gap-1 ${t.text}`}>
                              <t.Icon className="size-3.5" aria-hidden />
                              <span className="text-xs font-medium">{t.word}</span>
                              {recommended && <Check className="size-3" aria-hidden />}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {compare.grid.more > 0 && (
            <p className="font-mono text-[11px] text-wire">
              +{compare.grid.more} more scored question{compare.grid.more === 1 ? "" : "s"} in the{" "}
              <PendingLink
                href={`/app/run/${runId}?view=full`}
                className="text-signal underline underline-offset-2 hover:text-ink"
              >
                full report
              </PendingLink>
              .
            </p>
          )}
        </section>
      )}

      {/* 2. COUNTS STRIP */}
      {compare.counts && (
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl">The counts</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {compare.counts.map((c) => (
              <div key={c.metric} className="flex flex-col gap-3 rounded-lg border border-line bg-card p-5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-wire">{c.metric}</p>
                <div className="flex items-end justify-between gap-4">
                  <CountSide
                    label={brand.name}
                    value={c.you}
                    receipt={c.youReceipt}
                    onReceipt={openReceipt}
                    highlight
                  />
                  <span className="pb-1 font-mono text-xs text-wire">vs</span>
                  <CountSide
                    label={rival}
                    value={c.rival}
                    receipt={c.rivalReceipt}
                    onReceipt={openReceipt}
                    alignEnd
                  />
                </div>
                {c.note && <p className="text-xs leading-relaxed text-wire">{c.note}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2b. PROMINENCE DUEL — when you both appear, who leads? */}
      {compare.prominence && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl">When you both appear, who leads?</h2>
            <p className="text-sm text-wire">
              The {compare.prominence.coAppearances} scored answer
              {compare.prominence.coAppearances === 1 ? "" : "s"} that name both {brand.name} and{" "}
              {rival}, and where {brand.name} lands in each. Tap a row to read that answer.
            </p>
          </div>
          <div className="flex flex-col rounded-lg border border-line bg-card">
            {compare.prominence.lines.map((line) => (
              <div
                key={line.key}
                className="flex items-center justify-between gap-4 border-b border-line px-4 py-3 last:border-0"
              >
                <span className="flex items-baseline gap-3">
                  <span className="font-display text-2xl tabular-nums text-ink">{line.count}</span>
                  <span className="text-sm text-ink/90">{line.label}</span>
                </span>
                {line.receipt && <ReceiptChip receipt={line.receipt} onReceipt={openReceipt} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. PAGES THEY OWN THAT YOU DON'T */}
      {compare.pagesTheyOwn && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl">Pages {rival} is on that you&apos;re not</h2>
            <p className="text-sm text-wire">
              Cited third-party pages where the engines found {rival} and not {brand.name}. Tap to
              open the page.
            </p>
          </div>
          <div className="flex flex-col rounded-lg border border-line bg-card">
            {compare.pagesTheyOwn.pages.map((p) => (
              <button
                key={p.url}
                type="button"
                onClick={() => openReceipt(p.receipt)}
                className="flex min-h-[44px] cursor-pointer items-center justify-between gap-4 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Favicon host={p.host} />
                    <span className="truncate text-sm text-ink/90" title={p.host}>
                      {p.host}
                    </span>
                  </span>
                  {p.decides.length > 0 && (
                    <span className="pl-6 font-mono text-[10px] text-wire">
                      decides {p.decides.join(" · ")}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-wire">
                  cited {p.cited}× · {p.engines} engine{p.engines === 1 ? "" : "s"}
                </span>
              </button>
            ))}
          </div>
          {compare.pagesTheyOwn.more > 0 && (
            <p className="font-mono text-[11px] text-wire">
              +{compare.pagesTheyOwn.more} more page{compare.pagesTheyOwn.more === 1 ? "" : "s"} in the
              full report.
            </p>
          )}
        </section>
      )}

      {/* 4. WHERE THEY TAKE YOUR BUYERS */}
      {compare.steers && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl">Where the engines steer buyers to {rival}</h2>
            <p className="text-sm text-wire">
              The conditions under which the engines named {rival} as the better pick.
            </p>
          </div>
          <ul className="flex flex-col gap-3">
            {compare.steers.items.map((s, i) => (
              <li
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4"
              >
                <p className="text-sm text-ink/90">
                  <span className="font-medium">{s.segment}</span>
                  {s.reason ? <span className="text-wire">: {s.reason}</span> : null}
                </p>
                {s.receipt && (
                  <ReceiptChip receipt={s.receipt} onReceipt={openReceipt} />
                )}
              </li>
            ))}
          </ul>
          {compare.steers.more > 0 && (
            <p className="font-mono text-[11px] text-wire">
              +{compare.steers.more} more steer{compare.steers.more === 1 ? "" : "s"} in the full report.
            </p>
          )}
        </section>
      )}

      {/* FOOTER — the honest comparability line */}
      <p className="border-t border-line pt-6 font-mono text-[11px] leading-relaxed text-wire">
        {compare.snapshotNote}
      </p>

      {/* THE RECEIPTS — the dossier's own drawers, reused verbatim */}
      <AnswerDrawer
        answer={answerOpen}
        engineModels={engineModels}
        brand={brand}
        onClose={() => setAnswerOpen(null)}
      />
      <PageDrawer
        page={pageOpen}
        brand={brand}
        rivalOwner={rivalOwner}
        onClose={() => setPageOpen(null)}
      />
    </div>
  );
}

/* ---------- one side of a count pair ---------- */
function CountSide({
  label,
  value,
  receipt,
  onReceipt,
  highlight,
  alignEnd,
}: {
  label: string;
  value: number;
  receipt?: CompareReceipt;
  onReceipt: (r: CompareReceipt) => void;
  highlight?: boolean;
  alignEnd?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${alignEnd ? "items-end text-right" : "items-start"}`}>
      <span className="truncate font-mono text-[10px] uppercase tracking-wide text-wire">
        {label}
      </span>
      <span
        className={`font-display text-3xl tabular-nums ${highlight ? "text-signal" : "text-ink"}`}
      >
        {value}
      </span>
      {receipt && <ReceiptChip receipt={receipt} onReceipt={onReceipt} />}
    </div>
  );
}

/* ---------- receipt chip — opens the stored-row drawer ---------- */
function ReceiptChip({
  receipt,
  onReceipt,
}: {
  receipt: CompareReceipt;
  onReceipt: (r: CompareReceipt) => void;
}) {
  const text = receipt.kind === "answer" ? `Read ${receipt.label}'s answer` : "See the cited page";
  const ariaLabel =
    receipt.kind === "answer" ? text : `Open the cited page: ${receipt.label}`;
  return (
    <button
      type="button"
      onClick={() => onReceipt(receipt)}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      className="inline-flex min-h-[44px] w-fit cursor-pointer items-center gap-1 rounded border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-wire transition-colors hover:border-signal hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
    >
      <span aria-hidden>{text}</span>
    </button>
  );
}
