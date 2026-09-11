"use client";
// Shared client primitives for "product in motion" surfaces — currently just the
// tour widget (product-tour.tsx). Kept in one place so future surfaces stay DRY
// and honor the SAME
// reduced-motion contract (reduced-motion must present the final
// state with no movement) and the SAME Audit-Theater visual language (board grid +
// engine columns, mirrored from packages/report/src/components/theater.tsx and
// packages/report/src/theater.ts).
// 60fps-cheap only: transform/opacity transitions, no layout thrash, no packages.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/* ---------- reduced-motion gate ---------- */

const MQ = "(prefers-reduced-motion: reduce)";
function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia(MQ);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** SSR-safe subscription to prefers-reduced-motion (useSyncExternalStore, so no
 *  setState-in-effect and no hydration warning): server snapshot is false, client
 *  reads + live-tracks the real setting. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(MQ).matches,
    () => false,
  );
}

/* ---------- entrance animation (transform/opacity only) ---------- */

const SPRING = "cubic-bezier(0.34,1.4,0.64,1)";

/** Fade + rise a child in after `delay` ms. Under reduced motion it renders the
 *  final composed state instantly — no transition, no transform. */
export function Appear({
  delay,
  children,
  className,
}: {
  delay: number;
  children: React.ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (reduced) return; // static branch below renders the final state
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [delay, reduced]);
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <div
      style={{ transitionTimingFunction: SPRING }}
      className={`transition-all duration-500 ${show ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** Typewriter that respects reduced motion (renders the full string at once, no
 *  caret). Cheap: one interval, cleared on unmount. */
export function Typewriter({
  text,
  delay = 0,
  speed = 40,
  className,
}: {
  text: string;
  delay?: number;
  speed?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) return; // reduced renders the full string (derived below)
    let i = 0;
    let t: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      t = setInterval(() => {
        i++;
        setN(i);
        if (i >= text.length) clearInterval(t);
      }, speed);
    }, delay);
    return () => {
      clearTimeout(start);
      if (t!) clearInterval(t);
    };
  }, [text, delay, speed, reduced]);
  const shown = reduced ? text.length : n;
  return (
    <span className={className}>
      {text.slice(0, shown)}
      {!reduced && shown < text.length && (
        <span className="animate-pulse text-signal motion-reduce:animate-none">|</span>
      )}
    </span>
  );
}

/** Steps a loop index 0..count-1 on an interval; pauses while `paused`, and never
 *  runs under reduced motion (holds on `hold`, a stable composed frame). Returns
 *  the current index. */
export function useLoop(count: number, ms: number, paused: boolean, hold = 0): number {
  const reduced = useReducedMotion();
  const [i, setI] = useState(hold);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (reduced || paused) return;
    ref.current = setInterval(() => setI((n) => (n + 1) % count), ms);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
  }, [count, ms, paused, reduced]);
  return reduced ? hold : i;
}

/* ---------- device frame (craft: layered depth + a quiet sheen) ---------- */

export function MiniFrame({
  url = "app.example.com",
  children,
  className,
}: {
  url?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-line bg-card shadow-[0_1px_2px_rgba(20,33,43,0.05),0_20px_48px_-18px_rgba(20,33,43,0.38)] ${className ?? ""}`}
    >
      {/* soft top sheen — reads as glass in light, a faint key-light in dark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-white/[0.06] via-transparent to-transparent"
      />
      <div className="flex items-center gap-2 border-b border-line bg-paper px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-pill-dismissed/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-signal/60" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
        <span className="ml-3 rounded bg-card px-3 py-0.5 font-mono text-[11px] text-wire">{url}</span>
      </div>
      {children}
    </div>
  );
}

/* ---------- Audit-Theater board (mirrors theater.tsx's grid + slot tones) ---------- */

// Canonical column order + stubs — kept in lockstep with the live board's
// engineStub (src/lib/theater.ts): "GPT/Cla/Gem/Pplx". The 2-char "Ch/Cl" slice
// read as noise; these don't. Full engine name stays in each header's title=.
const BOARD_ENGINES: { label: string; short: string }[] = [
  { label: "ChatGPT", short: "GPT" },
  { label: "Claude", short: "Cla" },
  { label: "Gemini", short: "Gem" },
  { label: "Perplexity", short: "Pplx" },
];

export type SlotState = "empty" | "answered" | "present" | "absent" | "locked";

// Slot tone per state — lifted from theater.tsx's SLOT_CLASS so the landing board
// reads as the SAME evidence surface. "locked" is the hero-only placeholder.
const SLOT_CLASS: Record<Exclude<SlotState, "locked">, string> = {
  empty: "border-line/60 bg-transparent text-transparent",
  answered: "border-signal/40 bg-signal/10 text-signal",
  present: "border-success bg-success/15 text-success",
  absent: "border-line bg-line/30 text-wire",
};
const SLOT_GLYPH: Record<Exclude<SlotState, "locked">, string> = {
  empty: "",
  answered: "●",
  present: "✓",
  absent: "–",
};
const SLOT_TITLE: Record<SlotState, string> = {
  empty: "waiting",
  answered: "answered",
  present: "your brand appears",
  absent: "your brand is absent",
  locked: "your answers appear here",
};

function LockGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" opacity="0.55" />
      <path
        d="M8 11V8a4 4 0 0 1 8 0v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface MiniBoardRow {
  eyebrow?: string;
  question: string;
  slots: SlotState[];
}

const GRID = "grid grid-cols-[minmax(0,1fr)_repeat(4,minmax(1.5rem,2.25rem))] items-center gap-x-1.5 gap-y-1.5";

/** The brand's questions × the four engines. `locked` rows render a lock + a soft
 *  shimmer bar in every answer cell — the honest "your answers appear here" state
 *  that never fabricates an answer. Non-locked states mirror the live theater. */
export function MiniBoard({
  rows,
  caption,
}: {
  rows: MiniBoardRow[];
  caption?: string;
}) {
  return (
    <div>
      <div className={`${GRID} mb-1`}>
        <span />
        {BOARD_ENGINES.map((e) => (
          <span
            key={e.label}
            title={e.label}
            className="text-center font-mono text-[10px] uppercase text-wire"
          >
            {e.short}
          </span>
        ))}
      </div>
      <ol className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <li key={i} className={GRID}>
            <div className="min-w-0">
              {row.eyebrow && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-signal">
                  {row.eyebrow}
                </span>
              )}
              <p className="truncate text-xs text-ink/80" title={row.question}>
                {row.question}
              </p>
            </div>
            {row.slots.map((state, s) =>
              state === "locked" ? (
                <span
                  key={s}
                  title={SLOT_TITLE.locked}
                  className="relative flex h-7 items-center justify-center overflow-hidden rounded border border-line/70 bg-line/15"
                >
                  <span
                    aria-hidden
                    className="absolute inset-x-1 h-1.5 animate-pulse rounded-full bg-wire/25 blur-[1px] motion-reduce:animate-none"
                  />
                  <LockGlyph className="relative h-3 w-3 text-wire/70" />
                </span>
              ) : (
                <span
                  key={s}
                  title={`${BOARD_ENGINES[s]?.label ?? ""}: ${SLOT_TITLE[state]}`}
                  className={`flex h-7 items-center justify-center rounded border font-mono text-[11px] transition-colors duration-500 ${SLOT_CLASS[state]}`}
                >
                  {SLOT_GLYPH[state]}
                </span>
              ),
            )}
          </li>
        ))}
      </ol>
      {caption && (
        /* pb keeps the caption clear of the input bar overlaying the frame
           bottom on mobile (visual pass: caption was half-clipped at 390px) */
        <p className="mt-2.5 flex items-center gap-1.5 pb-10 font-mono text-[11px] text-wire sm:pb-0">
          <LockGlyph className="h-3 w-3 text-wire/70" />
          {caption}
        </p>
      )}
    </div>
  );
}
