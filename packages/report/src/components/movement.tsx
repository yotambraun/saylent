"use client";
// THE MOVEMENT VIEW — the verify page's report body, rendered from the pure
// buildMovement model (../movement.ts). Same house language as the app's
// /app/run/[id]/verify: before → after hero, the noise note verbatim when the
// swing is inside normal variation, the per-engine table with the sentence
// receipts, and the "since you shipped" notes with the single celebration.
import { PerEngineTable } from "./per-engine-table";
import type { Movement } from "../movement";
import { formatDayUtc } from "../utils";

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return formatDayUtc(d);
}

export function MovementView({ model }: { model: Movement }) {
  const {
    brand,
    before,
    after,
    questionCount: n,
    withinNoise,
    watchNotes,
    rows,
    engines,
    baselineRunId,
    comparable,
    celebration,
    finishedAt,
  } = model;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10" id="movement">
      <p className="font-mono text-xs uppercase tracking-wider text-wire">
        SAYLENT · VERIFY RE-RUN · {brand.name} · {brand.domain} · {day(finishedAt)}
      </p>

      {!comparable && (
        <div className="rounded-lg border border-signal bg-signal/5 p-5 text-sm">
          <p className="font-medium text-ink">The question set changed between these runs.</p>
          <p className="mt-1 text-wire">
            Movement is only measured set against set on the same frozen questions. The counts
            below are each run&apos;s own; treat the difference as unmeasured.
          </p>
        </div>
      )}

      {watchNotes.length > 0 && (
        <div className="-mb-4 flex flex-col gap-1.5">
          <p className="font-mono text-xs uppercase tracking-widest text-wire">The verify</p>
          <h2 className="font-display text-3xl leading-tight text-ink">
            You shipped. Here&apos;s what moved.
          </h2>
        </div>
      )}

      {/* HERO */}
      <section className="rounded-lg border border-line bg-card p-8 text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-wire">
          Recommended, before → after
        </p>
        <div className="mt-4 flex items-baseline justify-center gap-4 font-display">
          <span className="text-4xl text-wire">
            {before}/{n}
          </span>
          <span className="text-3xl text-signal">→</span>
          <span className={`text-6xl ${after > before ? "text-success" : ""}`}>
            {after}/{n}
          </span>
        </div>
        {withinNoise && (
          <>
            <p className="mx-auto mt-4 max-w-md text-sm text-wire">
              A one-answer swing on a {n}-question set is within normal variation. Sustained
              movement across runs is the signal.
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-wire">
              No measurable movement yet. That&apos;s normal inside the stated time-to-impact.{" "}
              {watchNotes.length} of your shipped fixes are being watched; re-verify after the
              window.
            </p>
          </>
        )}
      </section>

      {/* PER-ENGINE */}
      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-wire">Per engine</h2>
        <PerEngineTable engines={engines} rows={rows} baselineRunId={baselineRunId} />
      </section>

      {/* SINCE YOU SHIPPED */}
      <section>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-wire">
          Since you shipped
        </h2>
        {watchNotes.length === 0 ? (
          <p className="text-sm text-wire">
            No fixes were marked as shipped before this verify. Mark fixes as shipped in your
            report and the next verify will watch them individually.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {watchNotes.map((w) => (
              <li key={w.fixKey} className="rounded-lg border border-line bg-card p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{w.title}</p>
                  {w.shippedAt && (
                    <span className="font-mono text-xs text-wire">
                      ✓ shipped {day(w.shippedAt)}
                    </span>
                  )}
                </div>
                <p className={`mt-1 ${w.moved ? "text-success" : "text-wire"}`}>{w.note}</p>
                {celebration && w.fixKey === celebration.fixKey && (
                  <div className="mt-3 border-t-2 border-signal pt-3">
                    <p className="font-display text-lg leading-snug text-ink">
                      {celebration.line}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
