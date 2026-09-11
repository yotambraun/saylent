// The "smart home" above-the-fold block: the Right-now strip (live runs) + the
// "Your next move" cards (≤3, computed by src/lib/next-moves.ts). Editorial and
// calm — one warm sentence + an arrow link per card, never a stat-tile wall
// (ARCHITECTURE.md). Server component; the entrance
// motion comes from the client <Reveal> kit, honest under prefers-reduced-motion.
import { PendingLink } from "@/components/pending-link";
import { Reveal } from "@/components/reveal";
import type { NextMove } from "@saylent/report/next-moves";

export interface ActiveRunLite {
  id: string;
  brandName: string;
  stage: string;
}

export function NextMoves({
  activeRuns,
  moves,
}: {
  activeRuns: ActiveRunLite[];
  moves: NextMove[];
}) {
  // Nothing live and nothing to nudge → render nothing (absence is honest; the
  // brand cards below are the content).
  if (activeRuns.length === 0 && moves.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {activeRuns.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Runs in progress">
          <p className="font-mono text-xs uppercase tracking-wider text-wire">Right now</p>
          {activeRuns.map((run) => (
            <PendingLink
              key={run.id}
              href={`/app/run/${run.id}`}
              className="flex items-center gap-3 rounded-lg border border-line bg-card px-4 py-3 text-sm transition-colors hover:border-ink"
            >
              <span
                className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-signal"
                aria-hidden
              />
              <span className="text-ink">{run.brandName}</span>
              <span className="text-wire">{run.stage || "running"}…</span>
            </PendingLink>
          ))}
        </section>
      )}

      {moves.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Your next move">
          <p className="font-mono text-xs uppercase tracking-wider text-wire">Your next move</p>
          <div className="flex flex-col gap-2">
            {moves.map((move, i) => (
              <Reveal key={move.key} delay={i * 60}>
                <PendingLink
                  href={move.href}
                  className="flex items-center justify-between gap-4 rounded-lg border border-line bg-card px-4 py-3 transition-colors hover:border-ink"
                >
                  <span className="text-sm text-ink">{move.text}</span>
                  <span className="shrink-0 font-mono text-xs text-signal">{move.cta} →</span>
                </PendingLink>
              </Reveal>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
