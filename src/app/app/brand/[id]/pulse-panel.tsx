// THE PULSE — the Movement page's sentence-diff panel (promoted from the dev
// spike src/app/dev/pulse/page.tsx). Implements the product rule:
// change is only shown set-vs-set across a frozen question set, and only the
// exact SENTENCES that moved — never an invented score. Server component; the
// brand page does all the data work (pickComparablePair → diffRuns → pulseView)
// and hands this the finished view-model.
import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import type { AnswerDiff } from "@saylent/report/answer-diff";
import { parseInline } from "@saylent/report/inline-markdown";
import type { PulseView } from "@saylent/report/pulse";

// Render the engines' verbatim sentence with its light markdown resolved
// (**bold** → bold, links → label) instead of showing raw `**` / `[..](..)` noise.
function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((s, i) =>
        s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>,
      )}
    </>
  );
}

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

export function PulsePanel({
  view,
  questionCount,
  currentRunId,
}: {
  view: PulseView;
  questionCount: number;
  currentRunId: string;
}) {
  const { cards, stableCount } = view;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <p className="font-mono text-xs uppercase tracking-widest text-wire">The pulse</p>
        <h2 className="font-display text-2xl leading-tight text-ink">
          The engines changed their minds.
        </h2>
        <p className="max-w-lg text-sm leading-relaxed text-wire">
          Same {questionCount} question{questionCount === 1 ? "" : "s"}, asked again. The exact
          sentences that moved, not a score.
        </p>
      </div>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-line bg-card p-5 text-sm text-wire">
          Nothing moved between these two runs. We&apos;d have stayed quiet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {cards.map((d) => (
            <DeltaCard key={`${d.engine}:${d.qid}`} d={d} currentRunId={currentRunId} />
          ))}
          <p className="border-t border-line pt-4 text-sm leading-relaxed text-wire">
            Your other <span className="text-ink">{stableCount}</span> answer
            {stableCount === 1 ? "" : "s"} are stable. We stay quiet until something moves.
          </p>
        </div>
      )}
    </section>
  );
}

/* One question's sentence-level movement between the two runs. Green is reserved
 * for the brand's own gains — a sentence entering that doesn't name the brand
 * (a rival gaining ground) reads as a signal-orange warning, not good news. */
function DeltaCard({ d, currentRunId }: { d: AnswerDiff; currentRunId: string }) {
  const entered = d.added.length > 0;
  const left = d.removed.length > 0;
  const goodNews = d.added.some((s) => s.mentionsBrand);
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
      <p className="font-mono text-xs uppercase tracking-wider text-wire">
        {entered && (
          <span className={goodNews ? "text-success" : "text-signal"}>
            {goodNews ? (
              "▲ entered"
            ) : (
              // lucide glyph (not the ⚠ char, which emoji-renders on some platforms)
              <span className="inline-flex items-center gap-1 align-middle">
                <TriangleAlertIcon className="size-3" aria-hidden />
                entered
              </span>
            )}
          </span>
        )}
        {entered && left && " · "}
        {left && <span className="text-signal">▼ left</span>}
        {" · "}
        <span className="text-ink">{ENGINE_LABEL[d.engine] ?? d.engine}</span>
      </p>
      <p className="text-sm leading-snug text-ink">{d.question}</p>

      {d.added.map((s, i) => (
        <blockquote
          key={`a${i}`}
          className={`rounded-md border-l-2 py-2 pr-3 pl-3 text-sm leading-relaxed ${
            s.mentionsBrand
              ? "border-success bg-success/10 font-medium text-ink"
              : "border-line bg-paper text-ink/80"
          }`}
        >
          <InlineText text={s.text} />
        </blockquote>
      ))}

      {d.removed.map((s, i) => (
        <p
          key={`r${i}`}
          className={`pl-3 text-sm leading-relaxed text-wire line-through ${
            s.mentionsBrand ? "decoration-signal" : "decoration-wire"
          }`}
        >
          <InlineText text={s.text} />
        </p>
      ))}

      <Link
        href={`/app/run/${currentRunId}#q-${d.qid}`}
        className="w-fit font-mono text-xs text-wire underline underline-offset-2 hover:text-ink"
      >
        open the receipt →
      </Link>
    </article>
  );
}
