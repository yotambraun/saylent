// Movement charts. Server-rendered SVG,
// no chart library (METHODOLOGY.md: no new packages). Honesty rules encoded: dots per
// run, ONE gray noise ribbon (±1 answer, the METHODOLOGY.md verify noise rule), line
// BREAKS at re-baseline events (points across them aren't comparable), rim
// markers that never occlude data, direct labels instead of legends, native
// <title> tooltips. Accessibility (WCAG): every chart is
// backed by BOTH a one-sentence plain-language takeaway (headline fact in words,
// direction as "up"/"down" + ▲/▼ glyphs — never color alone, WCAG 1.4.1) AND a
// native <details> "View as table" disclosure holding the same numbers as real
// text in a <table> with <caption> + <th scope>. The takeaway sentences are
// built by exported pure functions (recTakeaway / sovTakeaway) so they're unit-
// testable without rendering SVG.
import { PendingLink } from "@/components/pending-link";
import type { RunEvent, TrendPoint } from "@saylent/report/trend";

const W = 640;
const H = 180;
const PAD = { top: 16, right: 96, bottom: 34, left: 34 };

// ── Plain-text takeaway builders (pure, exported for tests) ──────────────────

/** Minimal shape a takeaway needs from a recommended-count series point. */
type RecPoint = { rec: number; answered: number };

/**
 * One honest sentence for a recommended-count series (Movement + per-engine).
 * `subject` is the sentence's noun phrase start, e.g. "Recommended" or
 * "GPT-4 recommended you". Direction is stated in words and a ▲/▼ glyph; the
 * ±1-answer noise band (METHODOLOGY.md verify rule) is called out as "flat" so a
 * within-noise wobble is never dressed up as a trend. Returns "" for no data.
 */
export function recTakeaway(points: RecPoint[], subject = "Recommended"): string {
  if (points.length === 0) return "";
  const last = points[points.length - 1];
  const head = `${subject} in ${last.rec} of ${last.answered} answer${last.answered === 1 ? "" : "s"}`;
  if (points.length === 1) return `${head}: first run on record, nothing earlier to compare against yet.`;
  const prev = points[points.length - 2];
  const d = last.rec - prev.rec;
  if (d === 0) return `${head}, unchanged from ${prev.rec} in the last run.`;
  if (Math.abs(d) === 1)
    return `${head}, ${d > 0 ? "up" : "down"} ${Math.abs(d)} vs the last run (${prev.rec}), but inside the ±1-answer noise band, so treat it as flat.`;
  return `${head}, ${d > 0 ? `up ▲ from ${prev.rec}` : `down ▼ from ${prev.rec}`} in the last run.`;
}

/** Minimal shape a takeaway needs from a share-of-voice series. */
type SovSeries = { name: string; points: { t: string; count: number }[] };

/**
 * One honest sentence for share-of-voice — the brand's own mention count in the
 * latest run and its movement vs the previous run. SOV is a mention count, not
 * a recommended-answer count, so the ±1 recommended-noise band does NOT apply.
 * Absence is stated plainly rather than shown as a silent gap.
 */
export function sovTakeaway(series: SovSeries[], brandName: string): string {
  const brand = series.find(
    (s) => s.name.toLowerCase() === brandName.toLowerCase() && s.points.length > 0,
  );
  if (!brand)
    return `${brandName} wasn't mentioned in any scored answer across these runs.`;
  const pts = brand.points;
  const last = pts[pts.length - 1];
  const head = `${brandName} was mentioned ${last.count} time${last.count === 1 ? "" : "s"} in the latest run`;
  if (pts.length < 2) return `${head}: first run on record, nothing earlier to compare against yet.`;
  const prev = pts[pts.length - 2];
  const d = last.count - prev.count;
  if (d === 0) return `${head}, unchanged from ${prev.count} in the previous run.`;
  return `${head}, ${d > 0 ? `up ▲ from ${prev.count}` : `down ▼ from ${prev.count}`} in the previous run.`;
}

function scales(points: TrendPoint[], yMax: number) {
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const n = Math.max(1, points.length - 1);
  return {
    x: (i: number) => PAD.left + (points.length === 1 ? iw / 2 : (i / n) * iw),
    y: (v: number) => PAD.top + ih - (Math.min(v, yMax) / yMax) * ih,
  };
}

const fmtDate = (t: string) =>
  new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

/** Headline chart: recommended count per run, ±1-answer noise ribbon, rim
 *  markers for events, segments broken at re-baselines. */
export function MovementChart({
  points,
  events,
  seriesLabel,
}: {
  points: TrendPoint[];
  events: RunEvent[];
  seriesLabel: string;
}) {
  if (points.length === 0) return null;
  const yMax = Math.max(...points.map((p) => p.answered), 1);
  const { x, y } = scales(points, yMax);
  const breakTimes = new Set(events.filter((e) => e.type === "rebaseline").map((e) => e.t));

  // segments: consecutive point pairs, broken at re-baseline boundaries
  const segments: string[] = [];
  for (let i = 1; i < points.length; i++) {
    if (breakTimes.has(points[i].t)) continue;
    segments.push(`M ${x(i - 1)} ${y(points[i - 1].rec)} L ${x(i)} ${y(points[i].rec)}`);
  }
  // noise ribbon: v±1 clamped to [0, yMax]
  const upper = points.map((p, i) => `${x(i)},${y(Math.min(p.rec + 1, yMax))}`);
  const lower = points.map((p, i) => `${x(i)},${y(Math.max(p.rec - 1, 0))}`).reverse();
  const last = points[points.length - 1];
  const takeaway = recTakeaway(points, "Recommended");

  return (
    <figure className="m-0">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={seriesLabel}>
      {points.length > 1 && (
        <polygon points={[...upper, ...lower].join(" ")} className="fill-wire/15" />
      )}
      {segments.map((d, i) => (
        <path key={i} d={d} className="stroke-wire" strokeWidth="1.5" fill="none" />
      ))}
      {points.map((p, i) => {
        const dot = (
          <circle
            cx={x(i)}
            cy={y(p.rec)}
            r={i === points.length - 1 ? 4 : 3}
            className={i === points.length - 1 ? "fill-signal" : "fill-ink"}
          >
            <title>{`${fmtDate(p.t)}: recommended in ${p.rec} of ${p.answered} answers${p.id ? " · open the run" : ""}`}</title>
          </circle>
        );
        // each dot deep-links to its run's dossier (verify runs are redirected
        // to their comparison view by /app/run/[id]). SVG <a> stays keyboard-
        // focusable; rendering of the circle itself is unchanged.
        return p.id ? (
          <a key={p.t} href={`/app/run/${p.id}`} className="cursor-pointer">
            {dot}
          </a>
        ) : (
          <g key={p.t}>{dot}</g>
        );
      })}
      {/* x labels per dot (sparse data: label everything, no axis guesswork) */}
      {points.map((p, i) => (
        <text
          key={`l${p.t}`}
          x={x(i)}
          y={H - PAD.bottom + 14}
          textAnchor="middle"
          className="fill-wire font-mono text-[9px]"
        >
          {fmtDate(p.t)}
        </text>
      ))}
      {/* rim event markers — on the axis rim, never on the data. Multiple events
          can pin to the SAME run index (every shipped fix verifies on one run),
          which stacked triangles on top of each other and hid all but the top
          tooltip. Group by point index → ONE marker per index, all labels joined
          into one <title>, and a tiny mono count when a group holds more than one. */}
      {(() => {
        const byIndex = new Map<number, RunEvent[]>();
        for (const e of events) {
          const i = points.findIndex((p) => p.t === e.t);
          if (i === -1) continue;
          const g = byIndex.get(i);
          if (g) g.push(e);
          else byIndex.set(i, [e]);
        }
        return Array.from(byIndex.entries()).map(([i, group]) => {
          // rebaseline is the comparability-critical color — if a group mixes
          // types, surface it in the rebaseline color rather than masking it.
          const isRebaseline = group.some((e) => e.type === "rebaseline");
          return (
            <g key={`marker-${i}`}>
              <path
                d={`M ${x(i) - 4} ${H - PAD.bottom + 24} l 4 -6 l 4 6 z`}
                className={isRebaseline ? "fill-pill-dismissed" : "fill-wire"}
              >
                <title>{group.map((e) => e.label).join(" · ")}</title>
              </path>
              {group.length > 1 && (
                <text
                  x={x(i) + 6}
                  y={H - PAD.bottom + 22}
                  className="fill-wire font-mono text-[8px]"
                >
                  ×{group.length}
                </text>
              )}
            </g>
          );
        });
      })()}
      {/* direct label at the right end — no legend. The two-line block is
          clamped inside the data area so a last value near 0 (or the top)
          never descends into the x-axis date row (a collision caught in testing). */}
      {(() => {
        const labelY = Math.max(PAD.top + 8, Math.min(y(last.rec), H - PAD.bottom - 20));
        return (
          <>
            <text
              x={x(points.length - 1) + 10}
              y={labelY + 4}
              className="fill-ink font-mono text-[10px]"
            >
              {last.rec} of {last.answered}
            </text>
            <text x={x(points.length - 1) + 10} y={labelY + 16} className="fill-wire text-[9px]">
              {seriesLabel}
            </text>
          </>
        );
      })()}
    </svg>
      <figcaption className="mt-2 text-sm text-wire">{takeaway}</figcaption>
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-xs text-wire">View as table</summary>
        <table className="mt-2 w-full max-w-md text-xs">
          <caption className="mb-1 text-left font-mono text-xs text-wire">
            Recommended answers per run
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-1 text-left font-mono text-xs text-wire">
                Run date
              </th>
              <th scope="col" className="py-1 text-right font-mono text-xs text-wire">
                Recommended
              </th>
              <th scope="col" className="py-1 text-right font-mono text-xs text-wire">
                Answered
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.t} className="border-b border-line hover:bg-paper">
                <th
                  scope="row"
                  className="py-1 text-left font-mono text-xs font-normal text-wire"
                  suppressHydrationWarning
                >
                  {p.id ? (
                    <PendingLink href={`/app/run/${p.id}`} className="hover:text-ink">
                      {fmtDate(p.t)}
                    </PendingLink>
                  ) : (
                    fmtDate(p.t)
                  )}
                </th>
                <td className="py-1 text-right font-mono tabular-nums">{p.rec}</td>
                <td className="py-1 text-right font-mono tabular-nums">{p.answered}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** One small-multiple panel: the focused engine in ink/signal, others ghosted. */
export function EnginePanel({
  engine,
  focus,
  ghosts,
  yMax,
}: {
  engine: string;
  focus: TrendPoint[];
  ghosts: TrendPoint[][];
  yMax: number;
}) {
  const w = 300;
  const h = 110;
  const pad = { top: 10, right: 12, bottom: 18, left: 12 };
  const iw = w - pad.left - pad.right;
  const ih = h - pad.top - pad.bottom;
  const maxLen = Math.max(focus.length, ...ghosts.map((g) => g.length), 2);
  const px = (i: number, len: number) =>
    pad.left + (len === 1 ? iw / 2 : (i / (maxLen - 1)) * iw);
  const py = (v: number) => pad.top + ih - (Math.min(v, yMax) / yMax) * ih;
  const line = (pts: TrendPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${px(i, pts.length)} ${py(p.rec)}`).join(" ");
  const takeaway = recTakeaway(focus, `${engine} recommended you`);

  return (
    <div className="rounded-md border border-line p-3">
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-wire">{engine}</p>
      {focus.length === 0 ? (
        <p className="py-8 text-center font-mono text-[10px] text-wire">no answers from this engine yet</p>
      ) : (
        <figure className="m-0">
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`${engine} recommended answers over runs`}>
            {ghosts.map((g, gi) =>
              g.length > 1 ? (
                <path key={gi} d={line(g)} className="stroke-line" strokeWidth="1" fill="none" />
              ) : null,
            )}
            {focus.length > 1 && (
              <path d={line(focus)} className="stroke-ink" strokeWidth="1.5" fill="none" />
            )}
            {focus.map((p, i) => (
              <circle
                key={p.t}
                cx={px(i, focus.length)}
                cy={py(p.rec)}
                r={i === focus.length - 1 ? 3.5 : 2.5}
                className={i === focus.length - 1 ? "fill-signal" : "fill-ink"}
              >
                <title>{`${fmtDate(p.t)}: ${p.rec} of ${p.answered}`}</title>
              </circle>
            ))}
          </svg>
          <figcaption className="mt-1 text-xs text-wire">{takeaway}</figcaption>
          <details className="mt-1">
            <summary className="cursor-pointer font-mono text-[10px] text-wire">
              View as table
            </summary>
            <table className="mt-1 w-full text-xs">
              <caption className="mb-1 text-left font-mono text-[10px] text-wire">
                {engine} recommended answers per run
              </caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-1 text-left font-mono text-[10px] text-wire">
                    Run date
                  </th>
                  <th scope="col" className="py-1 text-right font-mono text-[10px] text-wire">
                    Recommended
                  </th>
                  <th scope="col" className="py-1 text-right font-mono text-[10px] text-wire">
                    Answered
                  </th>
                </tr>
              </thead>
              <tbody>
                {focus.map((p) => (
                  <tr key={p.t} className="border-b border-line">
                    <th
                      scope="row"
                      className="py-1 text-left font-mono text-[10px] font-normal text-wire"
                      suppressHydrationWarning
                    >
                      {fmtDate(p.t)}
                    </th>
                    <td className="py-1 text-right font-mono tabular-nums">{p.rec}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{p.answered}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>
      )}
    </div>
  );
}

/** SOV over time — emphasis form: the brand in signal, rivals gray, direct
 *  labels at the right ends. Entities = brand + top rivals of the latest run. */
export function SovChart({
  series,
  brandName,
}: {
  series: { name: string; points: { t: string; count: number }[] }[];
  brandName: string;
}) {
  // drop empty series — an underdog brand can be absent from every run's SOV
  // (that absence is already told honestly in the dossier)
  const drawn = series.filter((s) => s.points.length > 0);
  const all = drawn.flatMap((s) => s.points.map((p) => p.count));
  if (all.length === 0) return null;
  const yMax = Math.max(...all, 1);
  const maxLen = Math.max(...drawn.map((s) => s.points.length));
  if (maxLen < 2) return null;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const px = (i: number) => PAD.left + (i / (maxLen - 1)) * iw;
  const py = (v: number) => PAD.top + ih - (v / yMax) * ih;
  const takeaway = sovTakeaway(series, brandName);
  // union of run timestamps across all drawn entities → one aligned table
  // column per run; a blank cell means that entity wasn't mentioned that run.
  const dates = Array.from(new Set(drawn.flatMap((s) => s.points.map((p) => p.t)))).sort();
  const countAt = (s: (typeof drawn)[number], t: string) =>
    s.points.find((p) => p.t === t)?.count;

  return (
    <figure className="m-0">
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="share of voice over runs">
      {(() => {
        // End-labels collide when series finish at the same count (seen live:
        // "GitHub"/"ClickUp" rendered on top of each other). Assign each label a
        // slot: sort by natural y, then push apart to >=11px separation, clamped
        // to the chart. Names truncate at 12 chars — the full name stays in the
        // point <title> tooltips and the table fallback below.
        const LABEL_GAP = 11;
        const naturalY = drawn.map((s) => py(s.points[s.points.length - 1].count) + 3);
        const order = naturalY.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
        const slotY: number[] = [];
        let prev = -Infinity;
        for (const { y, i } of order) {
          const placed = Math.max(y, prev + LABEL_GAP);
          slotY[i] = Math.min(placed, H - 4);
          prev = slotY[i];
        }
        // Reverse pass: the down-pass + H-4 bottom clamp can pile the two lowest
        // labels onto the clamp (both land on H-4). Walk bottom-up, pushing each
        // label at least LABEL_GAP above the one below it, so all stay separated
        // even against the bottom edge.
        let below = H - 4 + LABEL_GAP;
        for (let k = order.length - 1; k >= 0; k--) {
          const i = order[k].i;
          slotY[i] = Math.min(slotY[i], below - LABEL_GAP);
          below = slotY[i];
        }
        const trunc = (n: string) => (n.length > 12 ? `${n.slice(0, 11)}…` : n);
        return drawn.map((s, si) => {
          const isBrand = s.name.toLowerCase() === brandName.toLowerCase();
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${px(i)} ${py(p.count)}`).join(" ");
          const lastP = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              {s.points.length > 1 && (
                <path
                  d={d}
                  className={isBrand ? "stroke-signal" : "stroke-wire/60"}
                  strokeWidth={isBrand ? 2 : 1.25}
                  fill="none"
                />
              )}
              {s.points.map((p, i) => (
                <circle
                  key={p.t}
                  cx={px(i)}
                  cy={py(p.count)}
                  r={2.5}
                  className={isBrand ? "fill-signal" : "fill-wire/70"}
                >
                  <title>{`${s.name} · ${fmtDate(p.t)}: ${p.count} mentions`}</title>
                </circle>
              ))}
              <text
                x={px(s.points.length - 1) + 8}
                y={slotY[si]}
                className={`font-mono text-[9px] ${isBrand ? "fill-signal" : "fill-wire"}`}
              >
                <title>{`${s.name}: ${lastP.count} mentions in the latest run`}</title>
                {trunc(s.name)} {lastP.count}
              </text>
            </g>
          );
        });
      })()}
    </svg>
      <figcaption className="mt-2 text-sm text-wire">{takeaway}</figcaption>
      <details className="mt-2">
        <summary className="cursor-pointer font-mono text-xs text-wire">View as table</summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full text-xs">
            <caption className="mb-1 text-left font-mono text-xs text-wire">
              Mentions per entity across runs (blank = not mentioned that run)
            </caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-1 pr-3 text-left font-mono text-xs text-wire">
                  Entity
                </th>
                {dates.map((t) => (
                  <th
                    key={t}
                    scope="col"
                    className="py-1 px-2 text-right font-mono text-xs text-wire"
                    suppressHydrationWarning
                  >
                    {fmtDate(t)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drawn.map((s) => (
                <tr key={s.name} className="border-b border-line">
                  <th
                    scope="row"
                    className="py-1 pr-3 text-left font-mono text-xs font-normal text-wire"
                  >
                    {s.name}
                  </th>
                  {dates.map((t) => {
                    const c = countAt(s, t);
                    return (
                      <td
                        key={t}
                        className="py-1 px-2 text-right font-mono tabular-nums"
                      >
                        {c ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
