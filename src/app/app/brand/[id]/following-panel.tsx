// "WHAT'S FOLLOWING YOU" — the Living-Asset panel on the Movement page. Renders
// the longitudinal composition computed in @saylent/report/following: the rivals and the
// objections that PERSIST across a brand's comparable audits, in honest, rate-
// based sentences (never raw counts). Server component; the brand page does all
// the data work (comparableCohort → computeFollowing) and hands this the finished
// view. No timestamps here — the panel is an aggregate over the cohort, so there
// is nothing date-shaped to render (hydration-safe by construction). Styling
// mirrors the sibling PulsePanel (mono eyebrow, display headline, bordered cards).
import type { FollowingView } from "@saylent/report/following";

export function FollowingPanel({ view }: { view: FollowingView }) {
  const { cohortRunIds, rivals, objections } = view;
  const n = cohortRunIds.length;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-xs uppercase tracking-widest text-wire">What&apos;s following you</p>
        <h2 className="font-display text-2xl leading-tight text-ink">
          The patterns that keep showing up.
        </h2>
        <p className="max-w-lg text-sm leading-relaxed text-wire">
          Across your last {n} comparable audits, these rivals and objections recur, composed as
          shares, not raw counts, so a bigger run never fakes a bigger threat.
        </p>
      </div>

      {rivals.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
          <p className="font-mono text-xs uppercase tracking-wider text-wire">Rivals that follow you</p>
          <ul className="flex flex-col gap-2.5">
            {rivals.map((r) => (
              <li key={r.name} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                <span aria-hidden className="mt-0.5 text-signal">
                  ›
                </span>
                <span>{r.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {objections.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
          <p className="font-mono text-xs uppercase tracking-wider text-wire">
            Objections that follow you
          </p>
          <ul className="flex flex-col gap-2.5">
            {objections.map((o) => (
              <li key={o.claim} className="flex gap-2.5 text-sm leading-relaxed text-ink">
                <span aria-hidden className="mt-0.5 text-signal">
                  ›
                </span>
                <span>{o.sentence}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
