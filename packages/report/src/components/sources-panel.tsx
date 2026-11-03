"use client";
// SOURCES & OPPORTUNITIES — where the answers come from, who they name, and the
// off-site pages worth winning. Pure display over the engine's source
// intelligence (@saylent/engine/sources via ../sources-view): every count opens
// the exact answers behind it (AnswerDrawer) and every page chip opens the page
// we read (PageDrawer). Counts, never scores; the domain type always shows the
// rule that decided it.
import { type ReactNode, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { engineLabel } from "@saylent/engine/surfaces";
import type { DomainSource, Opportunity, SourceIntelligence, VoiceEntry } from "@saylent/engine/sources";
import { Badge } from "../ui/badge";
import { Favicon } from "./favicon";
import type { AnswerRow, CorpusRow } from "./drawers";
import { decodeEntities } from "../entities";
import { stripMarkdownForPreview } from "../strip-md";
import { pageKey } from "@saylent/engine/sources";
import { receiptLabel, sharePct, sourcesLede, typeLabel } from "../sources-view";

const shortLabel = (e: string) => engineLabel(e).replace(/^Google /, "").replace(/^Microsoft /, "");

const TYPE_TONE: Record<string, string> = {
  own_site: "border-success/50 text-success",
  rival_site: "border-pill-dismissed/50 text-pill-dismissed",
};

function TypeChip({ type, rule }: { type: string; rule: string }) {
  return (
    <Badge
      variant="outline"
      title={`Why: ${rule}`}
      className={`border-line font-mono text-[10px] font-normal ${TYPE_TONE[type] ?? "text-wire"}`}
    >
      {typeLabel(type)}
    </Badge>
  );
}

function ReceiptButton({
  r,
  answer,
  onOpen,
  openAnswerId,
}: {
  r: { qid: string; engine: string };
  answer: AnswerRow | undefined;
  onOpen: (a: AnswerRow) => void;
  openAnswerId?: string | null;
}) {
  return (
    <button
      type="button"
      disabled={!answer}
      onClick={() => answer && onOpen(answer)}
      aria-haspopup="dialog"
      aria-expanded={!!answer && openAnswerId === answer.id}
      aria-label={`Read the ${engineLabel(r.engine)} answer to ${r.qid}`}
      className="inline-flex min-h-[28px] items-center rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink transition-colors enabled:cursor-pointer enabled:hover:border-signal enabled:hover:text-signal disabled:text-wire pointer-coarse:min-h-11"
    >
      {receiptLabel(r)}
    </button>
  );
}

export function SourcesPanel({
  intel,
  answers,
  corpus,
  onAnswerOpen,
  onPageOpen,
  openAnswerId,
  openPageId,
  title,
  corpusSkipped = false,
}: {
  intel: SourceIntelligence;
  answers: AnswerRow[];
  corpus: CorpusRow[];
  onAnswerOpen: (a: AnswerRow) => void;
  onPageOpen: (p: CorpusRow) => void;
  openAnswerId?: string | null;
  openPageId?: string | null;
  /** the numbered section heading, rendered by the dossier */
  title: ReactNode;
  corpusSkipped?: boolean;
}) {
  const answerByRef = useMemo(() => {
    const m = new Map<string, AnswerRow>();
    for (const a of answers) m.set(`${a.qid}|${a.engine}`, a);
    return m;
  }, [answers]);
  const resolve = (r: { qid: string; engine: string }) => answerByRef.get(`${r.qid}|${r.engine}`);
  const pageByKey = useMemo(() => {
    const m = new Map<string, CorpusRow>();
    for (const p of corpus) {
      m.set(pageKey(p.url), p);
      if (p.final_url) m.set(pageKey(p.final_url), p);
    }
    return m;
  }, [corpus]);
  const lede = sourcesLede(intel);
  const engines = intel.engines.map((e) => e.engine);

  return (
    <section id="sources">
      {title}
      {lede ? (
        <p className="mb-4 max-w-3xl text-sm text-wire">{lede}</p>
      ) : (
        <p className="mb-4 text-sm text-wire">The answers on this run cited no pages, so there is nothing to trace yet.</p>
      )}
      <Opportunities
        intel={intel}
        resolve={resolve}
        pageByKey={pageByKey}
        onAnswerOpen={onAnswerOpen}
        onPageOpen={onPageOpen}
        openAnswerId={openAnswerId}
        openPageId={openPageId}
        corpusSkipped={corpusSkipped}
      />
      {intel.domains.length > 0 && (
        <CitationShare
          intel={intel}
          engines={engines}
          resolve={resolve}
          pageByKey={pageByKey}
          onAnswerOpen={onAnswerOpen}
          onPageOpen={onPageOpen}
          openAnswerId={openAnswerId}
        />
      )}
      {intel.voice.some((v) => v.named > 0) && (
        <VoiceByEngine voice={intel.voice} engines={engines} resolve={resolve} onAnswerOpen={onAnswerOpen} openAnswerId={openAnswerId} />
      )}
      <p className="mt-4 max-w-3xl text-xs text-wire">
        Counted once per question and engine, over the answer this report shows. A domain&apos;s type comes
        from a short public rule list (hover a type to see the rule that fired); set your own with{" "}
        <code className="font-mono">sources.domainTypes</code> in saylent.config or the brand&apos;s run
        options in the app.
      </p>
    </section>
  );
}

function Opportunities({
  intel,
  resolve,
  pageByKey,
  onAnswerOpen,
  onPageOpen,
  openAnswerId,
  openPageId,
  corpusSkipped,
}: {
  intel: SourceIntelligence;
  resolve: (r: { qid: string; engine: string }) => AnswerRow | undefined;
  pageByKey: Map<string, CorpusRow>;
  onAnswerOpen: (a: AnswerRow) => void;
  onPageOpen: (p: CorpusRow) => void;
  openAnswerId?: string | null;
  openPageId?: string | null;
  corpusSkipped: boolean;
}) {
  const [all, setAll] = useState(false);
  const list = all ? intel.opportunities : intel.opportunities.slice(0, 5);
  return (
    <div className="rounded-lg border border-signal/40 bg-signal/5 p-4 sm:p-5">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">Off-site opportunities</h3>
      <p className="mb-3 max-w-3xl text-sm text-wire">
        Domains the answers cite when they name a rival and not you (non-branded questions only), where we did
        not find you on any page we read. Ranked by how many of those answers cite them. A listing, review or
        mention here is the off-site move with the most receipts behind it.
        {corpusSkipped && " Cited pages were not read on this run (skipped by request), so on-page presence is unverified."}
      </p>
      {intel.opportunities.length === 0 ? (
        <p className="text-sm text-ink">
          {intel.totals.rivalWonAnswers === 0
            ? "No answer named a rival while leaving you out, so there is no off-site gap on this run."
            : "Every domain cited in the answers that skip you is your own site, a rival's, or a page you already appear on."}
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-line">
          {list.map((o, i) => (
            <OpportunityRow
              key={o.host}
              o={o}
              rank={i + 1}
              resolve={resolve}
              pageByKey={pageByKey}
              onAnswerOpen={onAnswerOpen}
              onPageOpen={onPageOpen}
              openAnswerId={openAnswerId}
              openPageId={openPageId}
            />
          ))}
        </ol>
      )}
      {intel.opportunities.length > 5 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="mt-2 cursor-pointer text-xs text-signal underline underline-offset-2 hover:text-ink print:hidden"
        >
          {all ? "Show the top 5" : `Show all ${intel.opportunities.length}`}
        </button>
      )}
    </div>
  );
}

function OpportunityRow({
  o,
  rank,
  resolve,
  pageByKey,
  onAnswerOpen,
  onPageOpen,
  openAnswerId,
  openPageId,
}: {
  o: Opportunity;
  rank: number;
  resolve: (r: { qid: string; engine: string }) => AnswerRow | undefined;
  pageByKey: Map<string, CorpusRow>;
  onAnswerOpen: (a: AnswerRow) => void;
  onPageOpen: (p: CorpusRow) => void;
  openAnswerId?: string | null;
  openPageId?: string | null;
}) {
  const [more, setMore] = useState(false);
  const receipts = more ? o.receipts : o.receipts.slice(0, 3);
  const topCorpus = o.topPage ? pageByKey.get(pageKey(o.topPage.url)) : undefined;
  const topTitle = o.topPage ? decodeEntities(o.topPage.title ?? "") || o.topPage.url : "";
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-xs text-signal tabular-nums">{String(rank).padStart(2, "0")}</span>
          <Favicon host={o.host} />
          <span className="truncate font-display text-lg" title={o.host}>
            {o.host}
          </span>
          <TypeChip type={o.type} rule={o.typeRule} />
        </div>
        <span className="shrink-0 font-mono text-xs text-wire tabular-nums">
          in {o.evidence} answer{o.evidence === 1 ? "" : "s"} that skip you
        </span>
      </div>
      <p className="text-sm text-ink">{o.why}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-wire">
        {o.engines.map((e) => (
          <span key={e} className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink">
            {engineLabel(e)}
          </span>
        ))}
        {o.brandNamedAnswers > 0 && (
          <span className="font-mono text-[10px]">
            · also cited in {o.brandNamedAnswers} answer{o.brandNamedAnswers === 1 ? "" : "s"} that name you
          </span>
        )}
      </div>
      {o.topPage &&
        (topCorpus ? (
          <button
            type="button"
            onClick={() => onPageOpen(topCorpus)}
            aria-haspopup="dialog"
            aria-expanded={openPageId === topCorpus.id}
            className="flex min-h-[32px] w-fit max-w-full cursor-pointer items-center gap-1.5 rounded border border-line bg-card px-2 py-1 text-left text-xs transition-colors hover:border-signal pointer-coarse:min-h-11"
          >
            <span className="font-mono text-[10px] text-wire">top page</span>
            <span className="truncate">{topTitle}</span>
          </button>
        ) : (
          <a
            href={o.topPage.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="flex w-fit max-w-full items-center gap-1.5 text-xs text-ink underline-offset-2 hover:underline"
          >
            <span className="font-mono text-[10px] text-wire">top page</span>
            <span className="truncate">{topTitle}</span>
          </a>
        ))}
      <ul className="flex flex-col gap-1.5">
        {receipts.map((r) => {
          const why = r.rivals.find((x) => x.why)?.why;
          return (
            <li key={`${r.qid}|${r.engine}`} className="grid grid-cols-[auto_1fr] items-baseline gap-2 text-sm">
              <ReceiptButton r={r} answer={resolve(r)} onOpen={onAnswerOpen} openAnswerId={openAnswerId} />
              <span className="min-w-0 text-wire">
                <span className="text-ink">{r.rivals.map((x) => x.name).join(", ")}</span>
                {why && <span className="italic"> &ldquo;{stripMarkdownForPreview(why)}&rdquo;</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {o.receipts.length > 3 && (
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="w-fit cursor-pointer text-xs text-wire underline underline-offset-2 hover:text-ink print:hidden"
        >
          {more ? "fewer receipts" : `+${o.receipts.length - 3} more receipt${o.receipts.length - 3 === 1 ? "" : "s"}`}
        </button>
      )}
    </li>
  );
}

function CitationShare({
  intel,
  engines,
  resolve,
  pageByKey,
  onAnswerOpen,
  onPageOpen,
  openAnswerId,
}: {
  intel: SourceIntelligence;
  engines: string[];
  resolve: (r: { qid: string; engine: string }) => AnswerRow | undefined;
  pageByKey: Map<string, CorpusRow>;
  onAnswerOpen: (a: AnswerRow) => void;
  onPageOpen: (p: CorpusRow) => void;
  openAnswerId?: string | null;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const rows = all ? intel.domains : intel.domains.slice(0, 10);
  const max = Math.max(1, ...intel.domains.map((d) => d.citations));
  return (
    <div className="mt-8">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">Citation share by domain</h3>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-wire">
        {intel.byType.map((t) => (
          <span key={t.type}>
            <span className="text-ink">{typeLabel(t.type)}</span>{" "}
            <span className="font-mono tabular-nums">
              {t.citations} · {t.domains} domain{t.domains === 1 ? "" : "s"}
            </span>
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm sm:min-w-[600px]">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
              <th scope="col" className="py-2 pr-3 font-normal">Domain</th>
              <th scope="col" className="hidden py-2 pr-3 font-normal sm:table-cell">Type</th>
              <th scope="col" className="py-2 pr-3 font-normal">Citations</th>
              {/* The two verdict columns sit beside the count, so a run with many
                  answer sources never pushes them past the scroll edge; the
                  per-engine split comes after. */}
              <th
                scope="col"
                className="whitespace-nowrap py-2 pr-3 text-right font-normal"
                title="answers citing it that name a rival and not you"
              >
                Skip you
              </th>
              <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-normal" title="answers citing it that name you">
                Name you
              </th>
              {engines.map((e, i) => (
                <th
                  key={e}
                  scope="col"
                  className={`whitespace-nowrap py-2 text-right font-normal ${i === engines.length - 1 ? "pr-1" : "pr-2"}`}
                  title={engineLabel(e)}
                >
                  {shortLabel(e)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <DomainRow
                key={d.host}
                d={d}
                max={max}
                engines={engines}
                expanded={open === d.host}
                onToggle={() => setOpen(open === d.host ? null : d.host)}
                resolve={resolve}
                pageByKey={pageByKey}
                onAnswerOpen={onAnswerOpen}
                onPageOpen={onPageOpen}
                openAnswerId={openAnswerId}
              />
            ))}
          </tbody>
        </table>
      </div>
      {intel.domains.length > 10 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="mt-2 cursor-pointer text-xs text-signal underline underline-offset-2 hover:text-ink print:hidden"
        >
          {all ? "Show the top 10" : `Show all ${intel.domains.length} domains`}
        </button>
      )}
    </div>
  );
}

function DomainRow({
  d,
  max,
  engines,
  expanded,
  onToggle,
  resolve,
  pageByKey,
  onAnswerOpen,
  onPageOpen,
  openAnswerId,
}: {
  d: DomainSource;
  max: number;
  engines: string[];
  expanded: boolean;
  onToggle: () => void;
  resolve: (r: { qid: string; engine: string }) => AnswerRow | undefined;
  pageByKey: Map<string, CorpusRow>;
  onAnswerOpen: (a: AnswerRow) => void;
  onPageOpen: (p: CorpusRow) => void;
  openAnswerId?: string | null;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className={`border-b border-line align-middle ${d.type === "own_site" ? "bg-signal/10" : ""}`}>
        <td className="py-2 pr-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} the pages and answers behind ${d.host}`}
            className="flex min-h-[32px] max-w-[11rem] cursor-pointer items-center gap-1.5 text-left hover:text-signal pointer-coarse:min-h-11 sm:max-w-[13rem] lg:max-w-[16rem]"
          >
            <Chevron className="h-3 w-3 shrink-0 text-wire" aria-hidden />
            <Favicon host={d.host} />
            <span className="truncate" title={d.host}>
              {d.host}
            </span>
          </button>
          {/* on a phone the type rides under the domain, so the first screen
              holds the domain, its count and the two verdict columns */}
          <div className="pb-1 pl-[1.125rem] sm:hidden">
            <TypeChip type={d.type} rule={d.typeRule} />
          </div>
        </td>
        <td className="hidden py-2 pr-3 sm:table-cell">
          <TypeChip type={d.type} rule={d.typeRule} />
        </td>
        <td className="py-2 pr-3">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-12 shrink-0 rounded-full bg-line lg:w-20">
              <div
                className={`h-1.5 rounded-full ${d.type === "own_site" ? "bg-signal" : "bg-wire"}`}
                style={{ width: `${Math.max(4, Math.round((d.citations / max) * 100))}%` }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums">{d.citations}</span>
            <span className="font-mono text-[10px] text-wire tabular-nums">{sharePct(d.share)}</span>
          </div>
        </td>
        <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{d.rivalWonAnswers || "·"}</td>
        <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{d.brandNamedAnswers || "·"}</td>
        {engines.map((e, i) => (
          <td
            key={e}
            className={`py-2 text-right font-mono text-xs tabular-nums text-wire ${i === engines.length - 1 ? "pr-1" : "pr-2"}`}
          >
            {d.byEngine[e] ? <span className="text-ink">{d.byEngine[e]}</span> : "·"}
          </td>
        ))}
      </tr>
      {expanded && (
        <tr className="border-b border-line">
          <td colSpan={5 + engines.length} className="pb-4 pt-1">
            <div className="flex flex-col gap-3 rounded-md bg-paper p-3 text-sm">
              <p className="text-xs text-wire">
                {typeLabel(d.type)}: {d.typeRule}. Cited {d.citations} time{d.citations === 1 ? "" : "s"} in {d.answers}{" "}
                answer{d.answers === 1 ? "" : "s"}.
              </p>
              <ul className="flex flex-col gap-1">
                {d.pages.map((p) => {
                  const row = pageByKey.get(pageKey(p.url));
                  const label = decodeEntities(p.title ?? "") || p.url;
                  const presence =
                    p.brandOnPage === null ? "not read" : p.brandOnPage ? "you are on it" : "you are not on it";
                  return (
                    <li key={p.url} className="flex flex-wrap items-baseline gap-2">
                      {row ? (
                        <button
                          type="button"
                          onClick={() => onPageOpen(row)}
                          aria-haspopup="dialog"
                          className="min-w-0 cursor-pointer truncate text-left text-ink underline-offset-2 hover:underline"
                        >
                          {label}
                        </button>
                      ) : (
                        <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 truncate text-ink underline-offset-2 hover:underline">
                          {label}
                        </a>
                      )}
                      <span className="font-mono text-[10px] text-wire tabular-nums">
                        ×{p.citations} · {presence}
                        {p.rivalsOnPage.length > 0 ? ` · ${p.rivalsOnPage.join(", ")} on it` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-1.5">
                {d.refs.slice(0, 12).map((r) => (
                  <ReceiptButton key={`${r.qid}|${r.engine}`} r={r} answer={resolve(r)} onOpen={onAnswerOpen} openAnswerId={openAnswerId} />
                ))}
                {d.refs.length > 12 && <span className="font-mono text-[10px] text-wire">+{d.refs.length - 12} more</span>}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function VoiceByEngine({
  voice,
  engines,
  resolve,
  onAnswerOpen,
  openAnswerId,
}: {
  voice: VoiceEntry[];
  engines: string[];
  resolve: (r: { qid: string; engine: string }) => AnswerRow | undefined;
  onAnswerOpen: (a: AnswerRow) => void;
  openAnswerId?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = voice.filter((v) => v.named > 0 || v.isBrand).slice(0, 10);
  return (
    <div className="mt-8">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">Who the answers name, by engine</h3>
      <p className="mb-3 max-w-3xl text-sm text-wire">
        Answers naming each brand, split by engine. You count when the judge found you in the answer; a rival
        counts when the answer lists it among the options it prefers. Open a count for the answers behind it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
              <th scope="col" className="py-2 pr-3 font-normal">Brand</th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">Named in</th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">Recommended</th>
              {engines.map((e) => (
                <th key={e} scope="col" className="py-2 pr-2 text-right font-normal" title={engineLabel(e)}>
                  {shortLabel(e)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const key = v.isBrand ? "\u0000brand" : v.name;
              const expanded = open === key;
              return (
                <tr key={key} className={`border-b border-line align-top ${v.isBrand ? "bg-signal/10 font-medium" : ""}`}>
                  <td className="py-2 pr-3">
                    <div>{v.name}</div>
                    {expanded && (
                      <div className="mt-2 flex flex-wrap gap-1.5 font-normal">
                        {v.refs.map((r) => (
                          <ReceiptButton key={`${r.qid}|${r.engine}`} r={r} answer={resolve(r)} onOpen={onAnswerOpen} openAnswerId={openAnswerId} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {v.named > 0 ? (
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : key)}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} the ${v.named} answers naming ${v.name}`}
                        className="cursor-pointer font-mono text-xs tabular-nums text-ink underline decoration-line underline-offset-2 hover:text-signal"
                      >
                        {v.named}
                      </button>
                    ) : (
                      <span className="font-mono text-xs tabular-nums text-wire">0</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-wire">
                    {v.recommended === null ? "·" : <span className="text-ink">{v.recommended}</span>}
                  </td>
                  {engines.map((e) => (
                    <td key={e} className="py-2 pr-2 text-right font-mono text-xs tabular-nums text-wire">
                      {v.byEngine[e] ? <span className="text-ink">{v.byEngine[e]}</span> : "·"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
