"use client";
// The verify view's per-engine before→after table, each row expandable to the
// answers whose verdict CHANGED vs baseline (qid · question · before→after),
// each linking to that answer's anchor in the baseline audit dossier (the verify
// run itself redirects to this page, so the baseline dossier is where the answer
// receipt actually renders). No page jump — client disclosure state.
import { useState } from "react";
import type { DiffSentence } from "../answer-diff";
import { useReportHost } from "../host";

export interface EngineChange {
  qid: string;
  question: string;
  before: string;
  after: string;
  /** whole sentences this engine ADDED / REMOVED for this qid vs baseline
   * (≤3 each — the sentence receipt shown under the row). */
  entered?: DiffSentence[];
  departed?: DiffSentence[];
}

export interface EngineRow {
  engine: string;
  flagged: boolean;
  beforeRecommended: number;
  afterRecommended: number;
  beforeMentioned: number;
  afterMentioned: number;
  changes: EngineChange[];
}

export function PerEngineTable({
  engines,
  rows,
  baselineRunId,
}: {
  engines: string[];
  rows: EngineRow[];
  baselineRunId: string | null;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const byEngine = new Map(rows.map((r) => [r.engine, r]));

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left font-mono text-xs uppercase text-wire">
          <th className="py-2">Engine</th>
          <th className="py-2">Recommended</th>
          <th className="py-2">Mentioned</th>
          <th className="py-2 text-right">Changed</th>
        </tr>
      </thead>
      <tbody>
        {engines.map((e) => {
          const r = byEngine.get(e);
          if (!r) return null;
          const canExpand = r.changes.length > 0;
          const isOpen = open[e] ?? false;
          return (
            <ExpandableRow
              key={e}
              row={r}
              isOpen={isOpen}
              canExpand={canExpand}
              baselineRunId={baselineRunId}
              onToggle={() => setOpen((s) => ({ ...s, [e]: !(s[e] ?? false) }))}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function ExpandableRow({
  row,
  isOpen,
  canExpand,
  baselineRunId,
  onToggle,
}: {
  row: EngineRow;
  isOpen: boolean;
  canExpand: boolean;
  baselineRunId: string | null;
  onToggle: () => void;
}) {
  // In the app this is next/link (client transition into the baseline dossier);
  // in a static movement.html it is a plain anchor to the same fragment.
  const { Link } = useReportHost();
  return (
    <>
      <tr className="border-b border-line">
        <td className="py-2 font-mono">
          {canExpand ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-controls={`changes-${row.engine}`}
              className="inline-flex items-center gap-1.5 hover:text-ink"
            >
              <span className="text-wire">{isOpen ? "▾" : "▸"}</span>
              {row.engine}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-line">·</span>
              {row.engine}
            </span>
          )}
        </td>
        {row.flagged ? (
          <td colSpan={3} className="py-2 text-wire">
            flagged: partial coverage this run
          </td>
        ) : (
          <>
            <td className="py-2">
              {row.beforeRecommended} → <strong>{row.afterRecommended}</strong>
            </td>
            <td className="py-2">
              {row.beforeMentioned} → <strong>{row.afterMentioned}</strong>
            </td>
            <td className="py-2 text-right font-mono text-xs text-wire">
              {canExpand ? `${row.changes.length} changed` : "—"}
            </td>
          </>
        )}
      </tr>
      {isOpen && canExpand && (
        <tr id={`changes-${row.engine}`} className="border-b border-line bg-paper">
          <td colSpan={4} className="px-0 py-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-wire">
              Answers that changed vs your first audit
            </p>
            <ul className="flex flex-col gap-2">
              {row.changes.map((c) => {
                const body = (
                  <>
                    <span className="font-mono text-xs text-wire">{c.qid}</span>{" "}
                    <span className="text-ink/80">{c.question}</span>
                    <span className="ml-2 whitespace-nowrap font-mono text-xs">
                      <span className="text-wire">{c.before}</span>
                      <span className="mx-1 text-signal">→</span>
                      <span
                        className={
                          c.after === "recommended" || c.after === "listed" || c.after === "compared"
                            ? "text-success"
                            : "text-ink"
                        }
                      >
                        {c.after}
                      </span>
                    </span>
                  </>
                );
                const entered = c.entered ?? [];
                const departed = c.departed ?? [];
                return (
                  <li key={c.qid} className="text-sm">
                    {baselineRunId ? (
                      <Link
                        href={`/app/run/${baselineRunId}#q-${c.qid}`}
                        className="block hover:underline"
                      >
                        {body}
                      </Link>
                    ) : (
                      <span className="block">{body}</span>
                    )}
                    {(entered.length > 0 || departed.length > 0) && (
                      <div className="mt-2 flex flex-col gap-1.5 pl-3">
                        {entered.map((s, i) => (
                          <blockquote
                            key={`e${i}`}
                            className={`rounded-md border-l-2 py-1.5 pr-3 pl-3 leading-relaxed ${
                              s.mentionsBrand
                                ? "border-success bg-success/10 font-medium text-ink"
                                : "border-line bg-paper text-ink/80"
                            }`}
                          >
                            {s.text}
                          </blockquote>
                        ))}
                        {departed.map((s, i) => (
                          <p
                            key={`d${i}`}
                            className={`pl-3 leading-relaxed text-wire line-through ${
                              s.mentionsBrand ? "decoration-signal" : "decoration-wire"
                            }`}
                          >
                            {s.text}
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
