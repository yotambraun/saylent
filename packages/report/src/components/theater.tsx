// Audit Theater — the running-state reveal: watch four AIs answer your brand's
// frozen questions live. Purely presentational; all derivation is in
// @saylent/report/theater (deriveTheater), memoised by the run view. Calm editorial tone
// — serif headings, mono detail, house tokens. Motion is a single 0.4s fade as
// each new answer takes the spotlight (globals.css .theater-fade), disabled
// under prefers-reduced-motion. Nothing here fabricates: every slot, chip, and
// counter reflects a row that actually landed.
import {
  type BoardRow,
  type Counters,
  engineLabel,
  engineStub,
  qtypeLabel,
  type SlotState,
  type Spotlight,
  THEATER_ENGINES,
  type TheaterState,
} from "../theater";

// Slot tone per state. Kept deliberately quiet — "present" is the only warm
// note (the brand showed up); everything else stays wire/line neutral so the
// board reads as evidence, not a scoreboard.
const SLOT_CLASS: Record<SlotState, string> = {
  empty: "border-line/60 bg-transparent",
  answered: "border-signal/40 bg-signal/10",
  present: "border-success bg-success/15 text-success",
  absent: "border-line bg-line/30 text-wire",
  flagged: "border-pill-dismissed/50 bg-pill-dismissed/10 text-pill-dismissed",
};
const SLOT_GLYPH: Record<SlotState, string> = {
  empty: "",
  answered: "●",
  present: "✓",
  absent: "–",
  flagged: "!",
};
const SLOT_TITLE: Record<SlotState, string> = {
  empty: "waiting",
  answered: "answered",
  present: "your brand appears",
  absent: "your brand is absent",
  flagged: "engine flagged: no answer",
};

export function Theater({ state }: { state: TheaterState }) {
  return (
    <div className="mt-6 flex flex-col gap-6">
      <CountersLine counters={state.counters} phase={state.phase} />
      {state.spotlight && <SpotlightCard spotlight={state.spotlight} />}
      <Board rows={state.board} phase={state.phase} />
    </div>
  );
}

// Counter moment — one honest line computed from rows actually present. During
// observe: "14 of 24 answers in". Once judging begins, it gains the presence
// tally. Never shows a mention count before a single verdict exists.
function CountersLine({ counters, phase }: { counters: Counters; phase: TheaterState["phase"] }) {
  const { answersIn, expectedTotal, mentions } = counters;
  if (answersIn === 0 && expectedTotal === 0) {
    return (
      <p className="font-mono text-xs text-wire">The engines are about to be asked…</p>
    );
  }
  const total = expectedTotal > 0 ? expectedTotal : answersIn;
  return (
    <p className="font-mono text-xs text-wire" aria-live="polite">
      <span className="text-ink">{answersIn}</span> of {total} answers in
      {mentions !== null && (
        <>
          {" · your brand appears in "}
          <span className={mentions > 0 ? "text-success" : "text-pill-dismissed"}>{mentions}</span>
          {" so far"}
        </>
      )}
      {phase === "prep" && answersIn === 0 && " · warming up the engines"}
    </p>
  );
}

// The spotlight — the newest answer as a card. Keyed on qid+engine so a new
// arrival remounts and replays the fade (never a typewriter). Shows the engine,
// the question, the first stretch of the real answer, and its citation hosts.
function SpotlightCard({ spotlight }: { spotlight: Spotlight }) {
  const excerpt = spotlight.excerpt.slice(0, 240).trim();
  return (
    <div
      key={`${spotlight.qid}-${spotlight.engine}`}
      className="theater-fade rounded-lg border border-line bg-card p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs uppercase tracking-wider text-signal">
          {spotlight.engineLabel}
        </span>
        {spotlight.qtype && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-wire">
            {qtypeLabel(spotlight.qtype)}
          </span>
        )}
      </div>
      <p className="mt-2 font-display text-base leading-snug">{spotlight.question}</p>
      <p className="mt-3 text-sm leading-relaxed text-ink/85">
        {excerpt}
        {spotlight.excerpt.length > 240 && <span className="text-wire">…</span>}
      </p>
      {spotlight.hosts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {spotlight.hosts.map((h) => (
            <span
              key={h}
              className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-wire"
            >
              {h}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// The board — the brand's frozen questions × the four engines. Slots fill as
// answers land; during judging each filled slot takes on its presence tone.
function Board({ rows, phase }: { rows: BoardRow[]; phase: TheaterState["phase"] }) {
  if (rows.length === 0) {
    return (
      <p className="font-mono text-xs text-wire">
        The board fills as the first engine starts answering…
      </p>
    );
  }
  const cols = "grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(1.75rem,2.5rem))] items-center gap-x-2 gap-y-1.5";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-mono text-xs uppercase tracking-wider text-wire">
          The board · your questions × four engines
        </h2>
        {phase === "judge" && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-signal">
            reading the answers
          </span>
        )}
      </div>
      <div className={cols}>
        <span />
        {THEATER_ENGINES.map((e) => (
          <span key={e} className="text-center font-mono text-[10px] uppercase text-wire" title={engineLabel(e)}>
            {engineStub(e)}
          </span>
        ))}
      </div>
      <ol className="mt-1 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.qid} className={cols}>
            <span className="truncate text-xs text-ink/80" title={row.question}>
              {row.question}
            </span>
            {row.slots.map((slot) => (
              <span
                key={slot.engine}
                title={`${engineLabel(slot.engine)}: ${SLOT_TITLE[slot.state]}`}
                className={`flex h-6 items-center justify-center rounded border font-mono text-[11px] transition-colors duration-500 ${SLOT_CLASS[slot.state]}`}
              >
                {SLOT_GLYPH[slot.state]}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
