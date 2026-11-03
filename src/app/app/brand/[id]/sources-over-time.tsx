// SOURCES OVER TIME — the brand page's view of where the answers come from,
// across the last few finished runs. Server component; the page does the reads
// (answers without raw_text + corpus_pages, under the owner's RLS session) and
// src/lib/source-history.ts does the shaping. Counts only, never percentages:
// citations per run, how many runs a domain was an off-site opportunity in, and
// answers naming each brand per run. The receipts live in the latest run's
// report, section #sources.
import { PendingLink } from "@/components/pending-link";
import { opportunityBadge, type SourceHistoryResult } from "@/lib/source-history";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** UTC, so the server-rendered header never drifts from the client. */
function runDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function Count({ n, strong = false }: { n: number; strong?: boolean }) {
  return (
    <td className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${n === 0 ? "text-wire/60" : strong ? "text-signal" : "text-ink"}`}>
      {n}
    </td>
  );
}

export function SourcesOverTime({ result, brandName }: { result: SourceHistoryResult; brandName: string }) {
  if (!result.ok) {
    return (
      <section>
        <p className="font-mono text-xs uppercase tracking-wider text-wire">Sources</p>
        <h2 className="font-display text-lg">Sources over time</h2>
        <p className="text-sm text-wire">
          {result.reason === "no_runs"
            ? "Where the answers get their facts appears here once an audit finishes."
            : "None of the recent finished runs' answers cited a page, so there are no sources to track yet."}
        </p>
      </section>
    );
  }

  const { view } = result;
  const n = view.runs.length;
  const runHeads = view.runs.map((r) => (
    <th key={r.runId} className="px-2 py-2 text-right font-normal" suppressHydrationWarning>
      {runDate(r.date)}
    </th>
  ));

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs uppercase tracking-wider text-wire">Sources</p>
        <h2 className="font-display text-lg">Sources over time</h2>
        <p className="max-w-[65ch] text-sm text-wire">
          The domains the answers cite, counted per run across your last{" "}
          {n === 1 ? "finished run" : `${n} finished runs`}. An off-site opportunity is a page
          that answers naming a rival and not {brandName} keep citing: the place to get listed or
          reviewed.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">Citations per domain per run</caption>
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
              <th className="px-4 py-2 font-normal">Domain</th>
              <th className="py-2 font-normal">Type</th>
              {runHeads}
              <th className="py-2 pr-4 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {view.domains.map((d) => {
              const badge = opportunityBadge(d.opportunityRuns, n);
              return (
                <tr key={d.host} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-ink">{d.host}</span>
                      {badge && (
                        <span className="rounded bg-signal/10 px-1.5 py-0.5 font-mono text-[10px] text-signal">
                          {badge}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-wire">{d.typeLabel}</td>
                  {d.citations.map((c, i) => (
                    <Count key={view.runs[i]?.runId ?? i} n={c} />
                  ))}
                  <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums text-ink">{d.total}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-mono text-[10px] text-wire">
              <td className="px-4 py-2" colSpan={2}>
                every citation, every domain
              </td>
              {view.runs.map((r) => (
                <td key={r.runId} className="px-2 py-2 text-right tabular-nums">
                  {r.citations}
                </td>
              ))}
              <td className="py-2 pr-4" />
            </tr>
          </tfoot>
        </table>
      </div>

      {view.voice.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-display text-base">Who the answers name</h3>
          <p className="max-w-[65ch] text-sm text-wire">
            Answers naming each brand, per run: one answer per question and engine, the one the
            report shows.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">Answers naming each brand per run</caption>
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                  <th className="px-4 py-2 font-normal">Brand</th>
                  {runHeads}
                </tr>
              </thead>
              <tbody>
                {view.voice.map((v) => (
                  <tr key={`${v.isBrand ? "brand" : "rival"}:${v.name}`} className="border-b border-line last:border-0">
                    <td className={`px-4 py-2 text-sm ${v.isBrand ? "text-signal" : "text-ink"}`}>
                      {v.isBrand ? `${brandName} (you)` : v.name}
                    </td>
                    {v.named.map((c, i) => (
                      <Count key={view.runs[i]?.runId ?? i} n={c} strong={v.isBrand} />
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-mono text-[10px] text-wire">
                  <td className="px-4 py-2">answers counted</td>
                  {view.runs.map((r) => (
                    <td key={r.runId} className="px-2 py-2 text-right tabular-nums">
                      {r.answers}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <p className="text-sm text-wire">
        Every count has its receipts, the exact answers and cited pages, in{" "}
        <PendingLink
          href={`/app/run/${view.latestRunId}?view=full#sources`}
          className="text-signal underline underline-offset-2 hover:text-ink"
        >
          the latest report&apos;s Sources &amp; opportunities
        </PendingLink>
        .
      </p>
    </section>
  );
}
