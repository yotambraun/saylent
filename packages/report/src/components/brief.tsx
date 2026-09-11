"use client";
// THE BRIEF — the answer-first lead layer. The dossier's
// calm sibling: a hero + a deck of self-hiding buyer-question cards. Each card
// side-peeks its answer; every number in that peek opens the SAME stored-answer
// / crawled-page receipt drawer the dossier uses. Pure display over the exact
// RLS-fetched rows the page already holds — buildBrief (src/lib/brief.ts, $0,
// deterministic) does all the composing; this view invents no statistic.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight, CircleCheck, CircleX, Minus, TriangleAlert, X } from "lucide-react";
import { CountUp } from "./reveal";
import { Favicon } from "./favicon";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import {
  buildBrief,
  type Brief as BriefModel,
  type BriefBlock,
  type BriefReceipt,
  type BriefScores,
  type BriefAnswer,
  type BriefPage,
  type BriefCheck,
  type BriefFix,
  type BriefPrevious,
} from "../brief";
import { makeRivalOwner } from "@saylent/engine/rival-owner";
import { useReportHost } from "../host";
import { AnswerDrawer, PageDrawer, type AnswerRow, type CorpusRow } from "./drawers";
import type { RunRow } from "./run-view";

/* ---------- SSR-safe desktop breakpoint (lg = 1024px) ----------
   Mirrors reveal/tour-kit's useReducedMotion: server snapshot is false (mobile
   branch), the client reads + live-tracks the real width. No setState-in-effect,
   no hydration mismatch — the desktop master-detail mounts after commit. */
const DESKTOP_MQ = "(min-width: 1024px)";
function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia(DESKTOP_MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_MQ).matches,
    () => false,
  );
}

/** SINGLE-PROVIDER MODE: the one sentence a run judged by a single model family
 *  must carry — what is weaker, and the exact thing the reader can do about it.
 *  Rendered in the Brief's verdict/band area and in the static report masthead;
 *  absent entirely on a cross-family run (two provider keys). */
export const SINGLE_FAMILY_JUDGE_NOTE =
  "Judged by a single model family (one provider key). Cross-family judging lowers self-preference bias; add a second key for it.";

export function Brief({
  run,
  brand,
  answers,
  corpus,
  checks,
  fixes,
  demo = false,
  engineModels,
  judgeMode,
  previous = null,
}: {
  run: RunRow;
  brand: { name: string; domain: string; aliases: string[]; competitors: string[] };
  answers: AnswerRow[];
  corpus: CorpusRow[];
  checks: BriefCheck[];
  fixes: BriefFix[];
  /** public /demo rendering: skip the engagement analytics (project rule: no tracking on public samples) */
  demo?: boolean;
  /** per-engine model id (from the model registry, packages/engine/src/models.ts) for the answer-drawer source chip */
  engineModels?: Record<string, string>;
  /** how the answers were judged. "single-family" (one provider key served every
   *  judgment role) adds one honest caveat under the hero; undefined/"cross-family"
   *  renders nothing. */
  judgeMode?: "cross-family" | "single-family";
  /** previous done audit of this brand — the progress story; buildBrief folds it
   *  in upstream. Shape is the composer's BriefPrevious (recommended count + date);
   *  the run page constructs it when wiring the pass-through. */
  previous?: BriefPrevious | null;
}) {
  // Everything app-shaped comes from the report host: `Link` is the app's
  // PendingLink (client transition + pending spinner) and a plain <a> in a
  // static report.html; `track` is the analytics beacon and a no-op off-app.
  const { Link, track } = useReportHost();
  // Run-level snapshots ride along on the run row (get_dossier to_jsonb(r));
  // all optional — old runs read null and cards self-hide.
  const health =
    (run as { health?: { answers?: Record<string, { got?: number; expected?: number }> | null } | null })
      .health ?? null;
  const brandModel =
    (run as { brand_model?: { value_props?: unknown } | null }).brand_model ?? null;
  const sitePages =
    (run as { site_pages?: { url: string; title: string; date?: string }[] | null }).site_pages ??
    null;
  const valueProps = useMemo(() => {
    const vp = brandModel?.value_props;
    return Array.isArray(vp)
      ? vp.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  }, [brandModel]);

  const dateStr = new Date(run.finished_at ?? run.created_at).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const brief = useMemo<BriefModel>(
    () =>
      buildBrief({
        brand,
        scores: (run.scores as BriefScores | null) ?? null,
        answers: answers as unknown as BriefAnswer[],
        corpus: corpus as unknown as BriefPage[],
        checks: checks as unknown as BriefCheck[],
        fixes: fixes as unknown as BriefFix[],
        health,
        sitePages,
        valueProps,
        kind: run.kind,
        runDate: dateStr,
        // Previous-audit summary the composer folds into the progress story
        // (BriefInput.previous).
        previous,
      }),
    [
      brand,
      run.scores,
      run.kind,
      dateStr,
      answers,
      corpus,
      checks,
      fixes,
      health,
      sitePages,
      valueProps,
      previous,
    ],
  );

  // Receipt resolution — mirror brief.ts's keying: an answer receipt id is
  // answers.id OR the `qid|engine` composite; a page receipt id is the corpus
  // row id OR its url. Index both so either handle opens the right drawer.
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

  // Deep-link: open the card named in ?card on first render (if it rendered).
  // Lazy initializer, not an effect — the Sheet portals OUTSIDE #brief so an
  // open-on-load peek never diverges from the server-rendered inline tree.
  const [openCardId, setOpenCardId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const c = new URLSearchParams(window.location.search).get("card");
    return c && brief.cards.some((k) => k.id === c) ? c : null;
  });
  const [answerOpen, setAnswerOpen] = useState<AnswerRow | null>(null);
  const [pageOpen, setPageOpen] = useState<CorpusRow | null>(null);
  const [fading, setFading] = useState(false);

  // Presentation split (project rule): desktop (lg+) shows an in-place
  // master-detail (question rail + answer canvas); mobile/tablet keeps the Sheet.
  // Both are driven by the SAME openCardId + ?card URL state. isDesktop reads the
  // breakpoint via useSyncExternalStore (server snapshot false, like useReducedMotion)
  // so hydration renders the mobile branch and the desktop canvas mounts only after
  // commit — no setState-in-effect, no hydration warning; the Sheet still portals
  // outside #brief so an open-on-load deep link never diverges the inline tree.
  const canvasHeadingRef = useRef<HTMLHeadingElement>(null);
  const sheetBodyRef = useRef<HTMLDivElement>(null);
  const isDesktop = useIsDesktop();

  const activeCard = openCardId ? (brief.cards.find((c) => c.id === openCardId) ?? null) : null;
  const showMasterDetail = isDesktop && activeCard !== null;
  const showSheet = !isDesktop && activeCard !== null;
  // Desktop: move focus to the answer headline on open / card switch (a11y — the
  // Sheet's Radix auto-focus fix is applied on its own onOpenAutoFocus below).
  useEffect(() => {
    if (showMasterDetail) canvasHeadingRef.current?.focus();
  }, [showMasterDetail, openCardId]);
  // POWER MOMENT: the leading hero stat becomes the first receipt — a tap opens
  // the am-i-in-the-answer peek. Only wire it when that card actually rendered
  // (dominant runs with no band self-hide it), else the tile stays static.
  const amInExists = brief.cards.some((c) => c.id === "am-i-in-the-answer");

  // URL state — no server roundtrip: ?view=brief&card=<id> on open, drop `card`
  // on close. history.replaceState so Back doesn't fill with card toggles.
  const writeCardParam = (id: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "brief");
    if (id) url.searchParams.set("card", id);
    else url.searchParams.delete("card");
    window.history.replaceState(null, "", url.toString());
  };

  const handleOpenCard = (id: string) => {
    setOpenCardId(id);
    writeCardParam(id);
    if (!demo) track("brief_card_opened", { card: id });
  };
  const handleCloseCard = () => {
    setOpenCardId(null);
    writeCardParam(null);
  };
  // Desktop master-detail is not a Radix Dialog, so wire Escape ourselves to
  // return to the grid — but only when no receipt drawer is open above it (the
  // drawer, a real dialog, owns Escape first). Mobile's Sheet handles its own.
  useEffect(() => {
    if (!showMasterDetail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !answerOpen && !pageOpen) handleCloseCard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // handleCloseCard is stable in behaviour; re-subscribing per render is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMasterDetail, answerOpen, pageOpen]);
  // Follow-up: crossfade the peek content in place (transform/opacity only, and
  // motion-reduce short-circuits the fade so the swap is instant).
  const handleSwitchCard = (id: string) => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const commit = () => {
      setOpenCardId(id);
      writeCardParam(id);
      setFading(false);
      if (!demo) track("brief_card_opened", { card: id });
    };
    if (reduce) return commit();
    setFading(true);
    window.setTimeout(commit, 130);
  };

  // Resolve a receipt to the same drawer the dossier opens. The drawers are
  // rendered as siblings BELOW the card Sheet and stack over it (Radix layer
  // stack; see file-tail note) — the peek stays open underneath.
  const openReceipt = (r: BriefReceipt, cardId: string) => {
    if (!demo) track("brief_receipt_opened", { card: cardId, kind: r.kind });
    if (r.kind === "answer") {
      const a = answerIndex.get(r.id);
      if (a) setAnswerOpen(a);
    } else {
      const p = pageIndex.get(r.id);
      if (p) setPageOpen(p);
    }
  };

  return (
    // overflow-x-clip: nothing inside the summary may widen the document (a
    // wide card, a table, a long unbroken token) — measured at 390px.
    <div id="brief" className="mx-auto flex w-full max-w-5xl flex-col gap-12 overflow-x-clip pb-24">
      {/* HERO */}
      <header data-report-header className="flex flex-col gap-6">
        <p
          className="font-mono text-xs uppercase tracking-wider text-wire"
          suppressHydrationWarning
        >
          SAYLENT · THE SUMMARY · {dateStr} · SNAPSHOT (single run)
        </p>
        <h1 className="max-w-4xl font-display text-3xl leading-tight sm:text-4xl">
          {brief.hero.headline}
        </h1>
        <p className="max-w-3xl text-lg leading-relaxed text-wire">{brief.hero.sub}</p>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          {brief.hero.stats.map((s, i) => {
            const primary = i === 0;
            const inner = (
              <>
                <div className="font-display text-2xl tabular-nums sm:text-3xl">
                  {primary ? <CountUp value={s.value} /> : s.value}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-wire">
                  {s.label}
                </div>
              </>
            );
            if (primary && amInExists) {
              return (
                <button
                  key={s.label}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => handleOpenCard("am-i-in-the-answer")}
                  className="group flex min-h-11 cursor-pointer flex-col items-start rounded text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                >
                  {inner}
                  <span className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-wire transition-colors group-hover:text-ink">
                    See the answers <ArrowRight className="size-3" aria-hidden />
                  </span>
                </button>
              );
            }
            // Non-primary tiles that carry an anchor (Mentioned → the verdict
            // table, Top rival → share of voice) still deep-link into their
            // receipt — same ?view=full#anchor contract as the card follow-ups
            // above, just without the "See the answers" arrow (that copy is
            // specific to the am-i-in-the-answer card).
            if (s.href) {
              return (
                <Link
                  key={s.label}
                  href={`?view=full#${s.href}`}
                  onClick={() => {
                    if (!demo) track("brief_hero_stat_to_dossier", { stat: s.label });
                  }}
                  className="group flex min-h-11 flex-col items-start rounded text-left transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                >
                  {inner}
                </Link>
              );
            }
            return <div key={s.label}>{inner}</div>;
          })}
        </div>
        {/* Facts measured on another base sit BESIDE the tiles, never inside
            them: a hairline rule marks them as a margin note, and each sentence
            states its own denominator. */}
        {brief.hero.notes.length > 0 ? (
          <div className="flex max-w-[60ch] flex-col gap-1 border-l border-line pl-4 text-sm leading-relaxed text-wire">
            {brief.hero.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        ) : null}
        {/* The denominator rule and the receipt promise are the two sentences a
            stranger most needs; they used to be the smallest type on the page. */}
        <div className="flex max-w-[70ch] flex-col gap-1.5 text-[14px] leading-relaxed text-ink/80">
          <p>Every number opens its receipt: the exact saved answer it came from.</p>
          <p>{brief.hero.basis}</p>
        </div>
        {judgeMode === "single-family" ? (
          <p className="max-w-[70ch] text-[13px] leading-relaxed text-wire">
            {SINGLE_FAMILY_JUDGE_NOTE}
          </p>
        ) : null}
      </header>

      {/* QUESTION DECK — grid of buyer questions. On desktop, opening a card
          swaps the grid for an in-place master-detail (rail + canvas); on
          mobile/tablet the card side-peeks in a Sheet. */}
      {brief.cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-wire">
          This run captured too little to brief on.{" "}
          <Link
            href="?view=full"
            className="text-signal underline underline-offset-2 hover:text-ink"
          >
            Open the full report →
          </Link>
        </div>
      ) : (
        <>
          {/* GRID — hidden on desktop while a card is open (canvas replaces it) */}
          <div className={showMasterDetail ? "lg:hidden" : undefined}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {brief.cards.map((card, i) => (
                <button
                  key={card.id}
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => handleOpenCard(card.id)}
                  className="group flex min-h-[7.5rem] cursor-pointer flex-col gap-3 rounded-lg border border-line bg-card p-5 text-left transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-paper motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <span className="font-mono text-[10px] uppercase tracking-widest text-signal">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-lg leading-snug">{card.question}</span>
                  <span className="text-sm text-wire">{card.teaser}</span>
                  <span className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-wire transition-colors group-hover:text-ink">
                    Open the answer <ArrowRight className="size-3.5" aria-hidden />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* MASTER-DETAIL — desktop only, when a card is open */}
          {showMasterDetail && activeCard && (
            <div className="hidden animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[20rem_minmax(0,1fr)] xl:gap-10">
              {/* RAIL — the deck as a vertical index; active item is the nav state */}
              <nav
                aria-label="Buyer questions"
                className="flex flex-col gap-1 self-start border-r border-line pr-4"
              >
                {brief.cards.map((card, i) => {
                  const active = card.id === activeCard.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => (active ? handleCloseCard() : handleOpenCard(card.id))}
                      className={`flex min-h-[44px] cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal motion-reduce:transition-none ${
                        active
                          ? "border-line bg-card font-medium text-ink"
                          : "border-transparent text-wire hover:bg-card/50 hover:text-ink"
                      }`}
                    >
                      <span className="font-mono text-[10px] uppercase tracking-widest text-signal">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-sm leading-snug">{card.question}</span>
                    </button>
                  );
                })}
              </nav>

              {/* CANVAS — the answer, room to breathe */}
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h2
                      ref={canvasHeadingRef}
                      tabIndex={-1}
                      className="font-display text-2xl leading-tight focus-visible:outline-none"
                    >
                      {activeCard.question}
                    </h2>
                    <p className="max-w-[65ch] text-wire">{activeCard.teaser}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCloseCard}
                    aria-label="Close answer and return to the questions"
                    className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line text-wire transition-colors duration-150 hover:border-ink/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal motion-reduce:transition-none"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
                <div className="mt-7 flex flex-col gap-6">
                  {activeCard.blocks.map((b, i) => (
                    <Block
                      key={i}
                      block={b}
                      wide
                      onReceipt={(r) => openReceipt(r, activeCard.id)}
                    />
                  ))}
                  <div className="border-t border-line pt-5">
                    <Link
                      href={`?view=full#${activeCard.anchor}`}
                      onClick={() => {
                        if (!demo) track("brief_to_dossier", { card: activeCard.id });
                      }}
                      className="inline-flex min-h-[44px] items-center font-mono text-xs text-signal underline underline-offset-2 hover:text-ink"
                    >
                      Read this in the full report →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ANSWER SIDE-PEEK — mobile/tablet only; receipts stack over it */}
      <Sheet
        open={showSheet}
        onOpenChange={(o) => {
          if (!o) handleCloseCard();
        }}
      >
        <SheetContent
          // Radix auto-focuses the first tabbable child (a follow-up chip) on open,
          // parking a stray focus ring; move initial focus to the sheet body/title
          // instead. Escape + tab order stay intact (we only redirect, not trap).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            requestAnimationFrame(() => sheetBodyRef.current?.focus());
          }}
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          {activeCard && (
            <div
              ref={sheetBodyRef}
              tabIndex={-1}
              className={`transition-opacity duration-150 focus:outline-none motion-reduce:transition-none ${
                fading ? "opacity-0" : "opacity-100"
              }`}
            >
              <SheetHeader>
                <SheetTitle className="font-display text-xl leading-snug">
                  {activeCard.question}
                </SheetTitle>
                <SheetDescription>{activeCard.teaser}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-5 px-4 pb-8">
                {activeCard.blocks.map((b, i) => (
                  <Block
                    key={i}
                    block={b}
                    onReceipt={(r) => openReceipt(r, activeCard.id)}
                  />
                ))}

                {/* THE EVIDENCE break → follow-ups + the deep link. The labelled
                    hairline only appears on evidence-dense answers (≥3 blocks). */}
                <div className="flex flex-col gap-4 pt-1">
                  {activeCard.blocks.length >= 3 ? (
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-wire">
                        Keep going
                      </span>
                      <span className="h-px flex-1 bg-line" aria-hidden />
                    </div>
                  ) : (
                    <span className="h-px w-full bg-line" aria-hidden />
                  )}
                  {activeCard.followups.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {activeCard.followups.map((fid) => {
                        const fc = brief.cards.find((c) => c.id === fid);
                        if (!fc) return null;
                        return (
                          <button
                            key={fid}
                            type="button"
                            onClick={() => handleSwitchCard(fid)}
                            className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border border-line px-3.5 py-1.5 text-left text-xs text-ink/90 transition-colors hover:border-ink/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                          >
                            {fc.question} →
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* Client transition (host Link → next/link) instead of a full
                      document reload; the relative ?view=full#anchor href resolves
                      against the current URL (works on /app/run, /demo, /share) and
                      Next scrolls to the dossier anchor after the view mounts —
                      resolveHref bases query/hash hrefs on asPath, and <Link> scrolls
                      to a #id like a native <a>. Switching views unmounts this Sheet. */}
                  <Link
                    href={`?view=full#${activeCard.anchor}`}
                    onClick={() => {
                      if (!demo) track("brief_to_dossier", { card: activeCard.id });
                    }}
                    className="inline-flex min-h-[44px] items-center font-mono text-xs text-signal underline underline-offset-2 hover:text-ink"
                  >
                    Read this in the full report →
                  </Link>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

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

/* ---------- one BriefBlock ----------------------------------------------------
   Renders src/lib/brief.ts's BriefBlock union (text/stat/bars/list + the enriched
   quote/status/pages/moves/kv kinds). Each renderer is built to read as a small,
   scannable answer, not a text dump: one idea per block, hairline rhythm, tabular
   numerals, and quiet receipts a reader taps to see the exact stored row. */
type StatusState = "pass" | "fail" | "warn" | "info";

const STATUS_VISUAL: Record<StatusState, { Icon: typeof CircleCheck; cls: string; word: string }> =
  {
    pass: { Icon: CircleCheck, cls: "text-success", word: "Pass" },
    fail: { Icon: CircleX, cls: "text-signal", word: "Fail" },
    warn: { Icon: TriangleAlert, cls: "text-signal", word: "Needs work" },
    info: { Icon: Minus, cls: "text-wire", word: "Info" },
  };

function Block({
  block,
  onReceipt,
  wide = false,
}: {
  block: BriefBlock;
  onReceipt: (r: BriefReceipt) => void;
  /** true only in the desktop canvas — lets dense grids use 2 columns at xl */
  wide?: boolean;
}) {
  if (block.kind === "text") {
    return <p className="max-w-[70ch] text-sm leading-relaxed text-ink/90">{block.text}</p>;
  }

  if (block.kind === "stat") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="font-mono text-[10px] uppercase tracking-wide text-wire">{block.label}</div>
        <div className="font-display text-3xl tabular-nums leading-none">{block.value}</div>
        {block.receipt && (
          <ReceiptChip receipt={block.receipt} onReceipt={onReceipt} className="mt-1" />
        )}
      </div>
    );
  }

  if (block.kind === "bars") {
    const max = Math.max(1, ...block.rows.map((r) => r.count));
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2.5">
          {block.rows.map((row, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className={row.highlight ? "font-medium text-ink" : "text-ink/90"}>
                  {row.label}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-wire">
                  {row.count}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-line/40">
                <div
                  className={`h-1.5 rounded-full ${row.highlight ? "bg-signal" : "bg-wire"}`}
                  style={{ width: `${Math.max(3, Math.round((row.count / max) * 100))}%` }}
                />
              </div>
              {row.receipt && (
                <ReceiptChip receipt={row.receipt} onReceipt={onReceipt} className="mt-0.5" />
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-wire">{block.takeaway}</p>
      </div>
    );
  }

  // QUOTE — a pulled evidence quote from an engine's own answer. A 2px left rule,
  // the words in the reader's ink, then a quiet caption: who said it, on how many
  // engines, and the receipt to read the whole answer.
  if (block.kind === "quote") {
    const showCount = typeof block.count === "number" && block.count >= 2;
    return (
      <figure className="flex max-w-[70ch] flex-col gap-2 border-l-2 border-line pl-4">
        <blockquote className="text-sm not-italic leading-relaxed text-ink/90">
          {block.text}
        </blockquote>
        {(block.attribution || showCount || block.receipt) && (
          <figcaption className="flex flex-wrap items-center gap-2">
            {block.attribution && (
              <span className="font-mono text-[10px] tracking-wide text-wire">
                {block.attribution}
              </span>
            )}
            {showCount && <Chip>×{block.count} engines</Chip>}
            {block.receipt && (
              <ReceiptChip receipt={block.receipt} onReceipt={onReceipt} className="ml-auto" />
            )}
          </figcaption>
        )}
      </figure>
    );
  }

  // STATUS — a gate checklist. Glyph carries the state by shape AND colour, and the
  // detail line spells it in words (never colour-alone). Hairline-separated rows.
  if (block.kind === "status") {
    return (
      <div
        className={`grid grid-cols-1 gap-x-8 ${wide ? "xl:grid-cols-2" : ""}`}
        role="list"
      >
        {block.rows.map((row, i) => {
          const v = STATUS_VISUAL[row.state];
          return (
            <div
              key={i}
              role="listitem"
              className="flex items-center gap-3 border-b border-line/60 py-2"
            >
              <v.Icon className={`size-4 shrink-0 ${v.cls}`} aria-hidden />
              <span className="shrink-0 text-sm font-medium text-ink">{row.label}</span>
              <span
                className="min-w-0 flex-1 truncate text-xs text-wire"
                title={row.detail ? `${v.word} · ${row.detail}` : v.word}
              >
                {row.detail ?? v.word}
              </span>
              {row.receipt && (
                <ReceiptChip receipt={row.receipt} onReceipt={onReceipt} className="ml-auto shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // PAGES — the citation battlefield. Favicon + host + title, then the verdict on
  // the right: how many times cited, on how many engines, and present/absent. The
  // whole row is the receipt (opens the crawled page), so it's one big tap target.
  if (block.kind === "pages") {
    return (
      <div className="flex flex-col" role="list">
        {block.rows.map((row, i) => {
          // `decides` is an optional companion the composer may attach ("decides
          // q01 · q07"); read tolerantly so this compiles with or without it.
          const decides = (row as { decides?: string }).decides;
          const inner = (
            <>
              <Favicon host={row.host} />
              <span
                className="hidden max-w-[12rem] shrink-0 self-center truncate font-mono text-xs text-wire sm:inline-block"
                title={row.host}
              >
                {row.host}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm text-ink/90" title={row.title || row.url}>
                  {row.title || row.url}
                </span>
                {decides && (
                  <span className="truncate font-mono text-[10px] text-wire" title={decides}>
                    {decides}
                  </span>
                )}
              </span>
              <span className="shrink-0 self-center font-mono text-xs tabular-nums text-wire">
                cited ×{row.cited}
              </span>
              <span className="self-center">
                <Chip>{row.engines.length} eng</Chip>
              </span>
              <span className="shrink-0 self-center">
                <PresenceChip present={row.present} />
              </span>
            </>
          );
          const cls =
            "flex min-h-[44px] items-center gap-2.5 border-b border-line/60 py-2 text-left";
          // listitem wrapper is display:contents so the interactive <button> keeps
          // its own button role (aria-haspopup is invalid on role=listitem).
          return (
            <div key={i} role="listitem" className="contents">
              {row.receipt ? (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`Open the cited page: ${row.host}`}
                  onClick={() => onReceipt(row.receipt!)}
                  className={`${cls} cursor-pointer transition-colors hover:bg-card/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal motion-reduce:transition-none`}
                >
                  {inner}
                </button>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // MOVES — the money block. Each move is its own bordered card: rank, the verb-led
  // action (wraps, never truncates), then a meta row (effort / time-to-impact /
  // engines it moves / whether a draft is ready to paste).
  if (block.kind === "moves") {
    return (
      <div className="flex flex-col gap-3">
        {block.rows.map((row, i) => (
          <div key={i} className="flex flex-col gap-2.5 rounded-lg border border-line p-4">
            <div className="flex items-baseline gap-2.5">
              <span className="shrink-0 font-mono text-sm tabular-nums text-signal">
                #{row.rank}
              </span>
              <span className="text-sm font-medium leading-snug text-ink">{row.title}</span>
            </div>
            {(row.effort || row.timeToImpact || row.engines?.length || row.draftReady) && (
              <div className="flex flex-wrap gap-1.5">
                {row.effort && <Chip>effort {row.effort}</Chip>}
                {row.timeToImpact && <Chip>{row.timeToImpact}</Chip>}
                {row.engines && row.engines.length > 0 && <Chip>{row.engines.length} engines</Chip>}
                {row.draftReady && <Chip tone="signal">draft ready to copy</Chip>}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // KV — a definition table. Mono label / value, value tabular where it's a number.
  if (block.kind === "kv") {
    return (
      <dl className={`grid grid-cols-1 gap-x-10 ${wide ? "xl:grid-cols-2" : ""}`}>
        {block.rows.map((row, i) => (
          <div
            key={i}
            className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2"
          >
            <dt className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-wire">
              {row.k}
            </dt>
            <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-sm text-ink/90">
              <span className={/\d/.test(row.v) ? "tabular-nums" : undefined}>{row.v}</span>
              {row.receipt && (
                <ReceiptChip receipt={row.receipt} onReceipt={onReceipt} className="shrink-0" />
              )}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  // LIST — receipt-linked bullet lines. A 3px ink dot (not a dash), receipt inline.
  return (
    <ul className="flex flex-col gap-2.5">
      {block.items.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/90">
          <span
            aria-hidden
            className="mt-[0.55em] size-[3px] shrink-0 rounded-full bg-ink/25"
          />
          <span className="min-w-0 flex-1">{it.text}</span>
          {it.receipt && (
            <ReceiptChip receipt={it.receipt} onReceipt={onReceipt} className="shrink-0 self-start" />
          )}
        </li>
      ))}
    </ul>
  );
}

/* ---------- small non-interactive meta chip (mono, uppercase) ---------- */

function Chip({
  children,
  tone = "wire",
}: {
  children: React.ReactNode;
  tone?: "wire" | "signal";
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide tabular-nums ${
        tone === "signal" ? "border-signal/40 text-signal" : "border-line text-wire"
      }`}
    >
      {children}
    </span>
  );
}

/* ---------- presence verdict chip (colour + word, never colour-alone) ---------- */

function PresenceChip({ present }: { present: boolean | null }) {
  const [word, cls] =
    present === true
      ? (["present", "text-success"] as const)
      : present === false
        ? (["absent", "text-signal"] as const)
        : (["unverified", "text-wire"] as const);
  return (
    <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wide ${cls}`}>{word}</span>
  );
}

/* ---------- receipt chip — opens the stored-row drawer over the peek ---------- */

function ReceiptChip({
  receipt,
  onReceipt,
  className = "",
}: {
  receipt: BriefReceipt;
  onReceipt: (r: BriefReceipt) => void;
  className?: string;
}) {
  // Verb-led, self-teaching chip text. For an answer the label is the engine
  // name ("ChatGPT") so we build "Read ChatGPT's answer"; a page chip says what
  // the tap does, with the cited host kept in the accessible name.
  const text = receipt.kind === "answer" ? `Read ${receipt.label}'s answer` : "See the cited page";
  const ariaLabel =
    receipt.kind === "answer" ? text : `Open the cited page: ${receipt.label}`;
  return (
    <button
      type="button"
      onClick={() => onReceipt(receipt)}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      className={`inline-flex min-h-[44px] w-fit cursor-pointer items-center gap-1 rounded border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-wire transition-colors hover:border-signal hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal motion-reduce:transition-none ${className}`}
    >
      <span aria-hidden>{text}</span>
    </button>
  );
}

// NESTED-SHEET DECISION (spec asks for the simplest working behavior, noted):
// receipts STACK OVER the open card peek — both are Radix Dialog (Sheet)
// instances rendered as siblings; Radix's DismissableLayer/FocusScope stack
// makes the later-opened receipt the topmost layer, so Escape / overlay-click
// dismiss only the receipt and the peek stays open underneath (no z-index
// override needed). We do NOT close+reopen the peek — stacking is cleaner UX and
// is the spec's stated primary behavior.
