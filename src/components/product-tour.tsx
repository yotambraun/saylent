"use client";
// Tour v2 — the below-the-fold "product in motion" strip: the REAL
// product, miniaturized, one scene at a time. Rebuilt from the shipped surfaces:
// the confirm step (aim your questions) → the Audit Theater board filling → the
// verdict with an HONEST confidence BAND (we print the range, never a fake single
// number) → a receipt with source chips → who the engines send buyers to instead →
// a drafted fix (submit-via-mailto, depth-matched) → verified movement with the
// honesty band. Fictional brand + .example sources, CLEARLY LABELLED illustrative
// (project legal rule: never depict a real company here). Motion honors
// prefers-reduced-motion via tour-kit.
import { useEffect, useState } from "react";
import { Appear, MiniBoard, type MiniBoardRow, MiniFrame, Typewriter, useReducedMotion } from "@/components/tour-kit";

// Fictional world — never a real company (project rule); sources on the
// IETF-reserved .example TLD, same convention as /demo's "Acme Cloud".
const BRAND = "Larkfield";

const SCENES = [
  { key: "aim", label: "Aim your questions" },
  { key: "board", label: "Watch the engines answer" },
  { key: "verdict", label: "Read the verdict" },
  { key: "receipt", label: "Open any receipt" },
  { key: "steer", label: "Who they send buyers to" },
  { key: "fix", label: "Copy the fix, written" },
  { key: "verify", label: "Watch the movement" },
] as const;

const SCENE_MS = 4600;

export function ProductTour() {
  const [scene, setScene] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || paused) return;
    const t = setInterval(() => setScene((s) => (s + 1) % SCENES.length), SCENE_MS);
    return () => clearInterval(t);
  }, [reduced, paused]);

  return (
    <div
      className="w-full select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-wire">
          Illustrative example · fictional brand
        </span>
      </div>
      <MiniFrame url={`app.example.com/${BRAND.toLowerCase()}`}>
        <div className="relative h-[24rem] overflow-hidden p-6">
          <div key={scene} className="theater-fade h-full">
            {scene === 0 && <SceneAim />}
            {scene === 1 && <SceneBoard />}
            {scene === 2 && <SceneVerdict />}
            {scene === 3 && <SceneReceipt />}
            {scene === 4 && <SceneSteer />}
            {scene === 5 && <SceneFix />}
            {scene === 6 && <SceneVerify />}
          </div>
        </div>
      </MiniFrame>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        {SCENES.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setScene(i)}
            className={`flex min-h-11 items-center gap-1.5 text-xs transition-colors ${
              i === scene ? "text-ink" : "text-wire hover:text-ink"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${i === scene ? "bg-signal" : "bg-line"}`} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- source chip (gradient letter-tile fallback) ----------
 * TODO(favicon): swap the letter tile for the shared Favicon component's gradient
 * fallback once a sibling extracts + exports it. Fictional .example hosts have no
 * real favicon, so a plain gradient letter chip is the correct fallback here. */
function SourceChip({ host }: { host: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[10px] text-wire">
      <span
        aria-hidden
        className="flex h-4 w-4 items-center justify-center rounded-sm bg-gradient-to-br from-signal/70 to-signal/25 text-[9px] font-semibold uppercase text-paper"
      >
        {host.charAt(0)}
      </span>
      {host}
    </span>
  );
}

/* ---------- 1 · Aim your questions (the confirm step) ---------- */

function SceneAim() {
  const questions = [
    "What is the best help desk software for support teams?",
    `${BRAND} vs Nimbus: which is better for support teams?`,
    `We're using Nimbus: is switching to ${BRAND} worth it?`,
  ];
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">
        Confirm your audit · aim the questions
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-ink">
          help desk software
        </span>
        <span className="text-wire">vs</span>
        {["Nimbus", "Halyard"].map((c) => (
          <span key={c} className="rounded-full border border-line bg-paper px-2 py-0.5 text-ink">
            {c}
          </span>
        ))}
      </div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-signal">
        The exact questions we&apos;ll ask · generated live
      </p>
      <ol className="mt-2 flex flex-col gap-1.5">
        {questions.map((q, i) => (
          <Appear key={q} delay={300 + i * 500}>
            <li className="flex gap-2 text-[13px] text-ink">
              <span className="shrink-0 font-mono text-xs text-wire">q{String(i + 1).padStart(2, "0")}</span>
              <span>{q}</span>
            </li>
          </Appear>
        ))}
      </ol>
      <Appear delay={2100}>
        <p className="mt-3 text-xs text-wire">…23 in all, frozen so every re-run asks the same set.</p>
      </Appear>
    </div>
  );
}

/* ---------- 2 · The Audit Theater board, filling ---------- */

function SceneBoard() {
  const rows: MiniBoardRow[] = [
    { question: "Best help desk software for support teams?", slots: ["present", "answered", "absent", "present"] },
    { question: `${BRAND} vs Nimbus for support teams?`, slots: ["answered", "present", "present", "absent"] },
    { question: "How do I cut first-response time?", slots: ["absent", "answered", "present", "answered"] },
    { question: `Is ${BRAND} safe to rely on?`, slots: ["present", "absent", "answered", "present"] },
  ];
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">
        The board · your questions × four engines
      </p>
      <p className="mt-1 font-mono text-xs text-wire" aria-live="polite">
        <span className="text-ink">38</span> of 48 answers in · reading the answers now
      </p>
      <div className="mt-3">
        <MiniBoard rows={rows} />
      </div>
      <p className="mt-3 text-xs text-wire">
        Every dot opens the raw answer. Green means the engine actually named you.
      </p>
    </div>
  );
}

/* ---------- 3 · The verdict + the honest confidence BAND ---------- */

function ConfidenceBand({ min, max, total }: { min: number; max: number; total: number }) {
  const left = (min / total) * 100;
  const width = Math.max(((max - min) / total) * 100, 2.5);
  return (
    <div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="absolute inset-y-0 rounded-full bg-signal/70"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
      <p className="mt-2 font-mono text-[13px] text-ink">
        recommended in{" "}
        <strong className="text-signal">
          {min}–{max} of {total}
        </strong>{" "}
        (we print the range)
      </p>
    </div>
  );
}

function SceneVerdict() {
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">The verdict</p>
      <Appear delay={200}>
        <p className="mt-2 max-w-md font-display text-lg leading-snug text-ink">
          {BRAND} gets recommended in most answers. The count moves between runs, so we never
          hand you a fake single number.
        </p>
      </Appear>
      <Appear delay={1000} className="mt-4">
        <ConfidenceBand min={44} max={46} total={48} />
      </Appear>
      <Appear delay={1700}>
        <p className="mt-3 text-xs text-wire">
          AI answers wobble. We show the honest minimum and maximum, and every count opens its
          receipts.
        </p>
      </Appear>
    </div>
  );
}

/* ---------- 4 · A receipt, opened, with source chips ---------- */

function SceneReceipt() {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">
        Perplexity · q07: the raw answer, behind the pill
      </p>
      <Appear delay={200}>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          {["seen", "mention: listed", "prominence: early", "sentiment: positive"].map((c) => (
            <span key={c} className="rounded border border-line px-2 py-0.5 font-mono text-wire">
              {c}
            </span>
          ))}
        </div>
      </Appear>
      <Appear delay={700}>
        <p className="mt-3 border-l-2 border-line pl-3 text-[13px] italic text-ink/80">
          &ldquo;…
          <mark className="rounded bg-signal/20 px-0.5 font-medium text-ink">{BRAND}</mark> is a
          strong pick for smaller teams thanks to its guided setup…&rdquo;
        </p>
      </Appear>
      <Appear delay={1300}>
        <div className="mt-3">
          <p className="font-mono text-[9px] uppercase text-wire">Sources this answer was built from</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <SourceChip host="buyersguide.example" />
            <SourceChip host="toolstack.example" />
            <SourceChip host="devforum.example" />
          </div>
        </div>
      </Appear>
      <Appear delay={1900}>
        <p className="mt-3 text-[12px] text-wire">
          Every chip is a real page the engine cited. Click through to the source.
        </p>
      </Appear>
    </div>
  );
}

/* ---------- 5 · Who the engines send buyers to instead ---------- */

function SceneSteer() {
  const rivals = [
    { name: "Nimbus", why: "called the most complete platform" },
    { name: "Halyard", why: "praised for an easier migration path" },
  ];
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">
        Who the engines send buyers to instead
      </p>
      <p className="mt-1 text-xs text-wire">
        When you&apos;re not the pick, the report names who is, and the reason the engine gave.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {rivals.map((r, i) => (
          <Appear key={r.name} delay={300 + i * 500}>
            <div className="flex items-baseline justify-between gap-3 rounded-lg border border-line bg-paper p-3">
              <span className="font-display text-base text-ink">{r.name}</span>
              <span className="text-right text-[13px] text-wire">&ldquo;{r.why}&rdquo;</span>
            </div>
          </Appear>
        ))}
      </div>
      <Appear delay={1500}>
        <p className="mt-3 border-l-2 border-signal pl-3 text-[13px] text-ink">
          The reasons are the engines&apos; own words. That&apos;s what your fix has to answer.
        </p>
      </Appear>
    </div>
  );
}

/* ---------- 6 · A drafted fix (submit-via-mailto, depth-matched) ---------- */

function SceneFix() {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">
        <span className="text-signal">Fix 01</span> · drafted for you
      </p>
      <Appear delay={100}>
        <div className="mt-2 rounded-lg border border-line bg-paper p-3">
          <p className="font-display text-[15px] leading-snug text-ink">
            Get {BRAND} onto the buyer&apos;s guide the engines cite most
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-signal">
            Submit via mailto:editors@buyersguide.example · match its depth: ~4,000 words / 41 sections
          </p>
        </div>
      </Appear>
      <Appear delay={800}>
        <div className="mt-2 rounded border border-dashed border-line bg-paper p-3 font-mono text-[11px] leading-relaxed text-ink/80">
          <Typewriter
            text={`Subject: A data point for your help-desk guide\n\nHi. Your guide is one of the pages AI leans on when buyers ask what to use. One gap worth closing: ${BRAND} belongs on the list because…`}
            delay={1000}
            speed={16}
          />
        </div>
      </Appear>
      <Appear delay={3400}>
        <div className="mt-2 w-fit rounded border border-line bg-card px-3 py-1 text-xs text-ink">
          Copied ✓
        </div>
      </Appear>
    </div>
  );
}

/* ---------- 7 · Verified movement + the honesty band ---------- */

function SceneVerify() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">
        Two weeks later: the verify re-run
      </p>
      <p className="mt-3 text-sm text-wire">Migration questions, same frozen set:</p>
      <div className="mt-2 flex items-baseline gap-3 font-display">
        <Appear delay={300}>
          <span className="text-4xl text-wire">1/4</span>
        </Appear>
        <Appear delay={900}>
          <span className="text-3xl text-signal">→</span>
        </Appear>
        <Appear delay={1400}>
          <span className="text-5xl text-success">3/4</span>
        </Appear>
      </div>
      <Appear delay={2000}>
        <p className="mt-3 text-sm text-ink">now recommend {BRAND} over the rival you switched from</p>
      </Appear>
      <Appear delay={2600}>
        <p className="mt-3 max-w-sm border-t border-line pt-3 text-xs text-wire">
          Measured on the same frozen questions, receipts included. When nothing moved yet, the
          report says exactly that.
        </p>
      </Appear>
    </div>
  );
}
