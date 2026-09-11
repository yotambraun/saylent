"use client";
// Realtime subscription + RUNNING-mode checklist (see METHODOLOGY.md;
// EXACT labels). Per-engine failures render as wire-colored "flagged" notes,
// never an error wall. DONE mode here is a compact preview — the full dossier renders once the run finishes.
import { useEffect, useMemo, useState } from "react";
import { useReportHost } from "../host";
import { STAGES, parseStage, runProgressPct } from "../run-stages";
import { stripMarkdownForPreview } from "../strip-md";
import { deriveTheater, type TheaterAnswer, type TheaterQuestion } from "../theater";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Theater } from "./theater";

export interface RunRow {
  id: string;
  kind: string;
  status: string;
  stage: string;
  profile: string;
  scores: Record<string, unknown> | null;
  est_cost_usd: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  // Data hygiene (migration 0038) — present via the poll/realtime row; optional so a
  // lean `initial` prop (get_dossier omits them) still type-checks.
  hidden_at?: string | null;
  brand_id?: string;
}

// STAGES + progress math now live in @saylent/report/run-stages (shared with the header's
// GlobalRunPill so the two speak one vocabulary; see METHODOLOGY.md).

export function RunView({
  initial,
  brandName,
  brandDomain,
  questionSet,
}: {
  initial: RunRow;
  brandName: string;
  brandDomain: string;
  /** the brand's frozen question set — powers the Audit Theater board.
   * null when unavailable ⇒ the classic stage checklist renders instead. */
  questionSet?: TheaterQuestion[] | null;
}) {
  const [run, setRun] = useState<RunRow>(initial);
  // Audit Theater: answers accumulate here keyed by `qid|engine`. Fed by the
  // same 5s poll that watches the run row (answers are NOT in the realtime
  // publication) — but leanly: only NEW answers (created_at cursor) plus a tiny
  // verdict->brand_present projection for already-seen rows. We never refetch
  // the several-KB raw_text of a row twice.
  const [answers, setAnswers] = useState<Map<string, TheaterAnswer>>(new Map());
  // The live feed itself (Realtime channel + the 5s safety poll + the created_at
  // cursor) is a HOST capability: the app wires it to Supabase, a static report
  // has no server and gets a no-op. This view only shapes what arrives.
  const { refresh, subscribeRunFeed } = useReportHost();

  // the moment the run finishes, reload server-side → the full dossier renders
  useEffect(() => {
    if (run.status === "done") refresh();
  }, [run.status, refresh]);

  useEffect(() => {
    // Theater feed — the host rides the poll (answers aren't realtime) and hands
    // back only NEW rows plus a tiny verdict->brand_present projection for rows
    // already seen; the several-KB raw_text of a row is never refetched.
    return subscribeRunFeed({
      runId: initial.id,
      wantAnswers: !!questionSet?.length,
      onRun: (patch) => setRun((r) => ({ ...r, ...patch }) as RunRow),
      onAnswers: (freshRows, judgedRows) => {
        if (freshRows.length === 0 && judgedRows.length === 0) return;
        setAnswers((prev) => {
          const next = new Map(prev);
          for (const r of freshRows) {
            const key = `${r.qid}|${r.engine}`;
            next.set(key, {
              qid: r.qid,
              engine: r.engine,
              ok: r.ok,
              question: r.question,
              qtype: r.qtype,
              excerpt: stripMarkdownForPreview(r.raw_text ?? "").slice(0, 400),
              citations: r.citations ?? [],
              brand_present: prev.get(key)?.brand_present ?? null,
              created_at: r.created_at,
            });
          }
          for (const r of judgedRows) {
            const key = `${r.qid}|${r.engine}`;
            const ex = next.get(key);
            // bp is null when verdict lacks the key; keep whatever we have
            if (ex && r.bp !== null) next.set(key, { ...ex, brand_present: !!r.bp });
          }
          return next;
        });
      },
    });
  }, [initial.id, questionSet, subscribeRunFeed]);

  const theater = useMemo(
    () =>
      deriveTheater({
        questions: questionSet ?? null,
        answers: [...answers.values()],
        stage: run.stage,
        status: run.status,
        profile: run.profile,
      }),
    [questionSet, answers, run.stage, run.status, run.profile],
  );

  // stage strings may carry live detail: "Asking Gemini · 3/6 answered"
  const { detail: stageDetail, index: currentIdx } = parseStage(run.stage);
  const progressPct = runProgressPct(run.stage, run.status);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <a href="/app" className="mb-4 block text-xs text-wire underline">
        ← Brands &amp; runs
      </a>
      <p className="font-mono text-xs uppercase tracking-wider text-wire">
        SAYLENT · {run.kind === "verify" ? "VERIFY RUN" : "AUDIT RUN"} · {brandName} ·{" "}
        {brandDomain}
        {run.profile === "smoke" && (
          <Badge variant="outline" className="ml-2 border-wire text-wire">
            smoke profile · 6 questions
          </Badge>
        )}
      </p>

      <RunMenu run={run} />

      {run.status === "failed" ? (
        <div className="mt-8 rounded-lg border border-line bg-card p-6">
          <h1 className="font-display text-xl">This run hit a wall. Nothing was re-run.</h1>
          <p className="mt-2 font-mono text-sm text-pill-dismissed">{run.error}</p>
          <RetryButton runId={run.id} />
          <p className="mt-3 text-sm text-wire">
            Retry re-uses this same run. It reuses the stored answers.
          </p>
        </div>
      ) : run.status === "done" ? (
        <DossierOpening />
      ) : (
        <div className="mt-8 rounded-lg border border-line bg-card p-6">
          <div className="flex items-baseline justify-between">
            <h1 className="font-display text-xl">Your audit is running</h1>
            <Elapsed since={run.created_at} />
          </div>
          {/* progress bar */}
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-signal transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* screen-reader announcement of stage changes — polite = never
              interrupts, announces on each transition */}
          <p aria-live="polite" className="sr-only">
            {run.stage ?? ""}
          </p>
          {/* Audit Theater — the board, spotlight, and honest counters. Renders
              only when the frozen question set is available; the stage rail
              below stays as the narrative line. */}
          {theater.active && <Theater state={theater} />}
          <ol className="mt-6 flex flex-col gap-3">
            {STAGES.map((label, i) => {
              const done = currentIdx > i || run.status === "done";
              const active = currentIdx === i;
              return (
                <li key={label} className="flex items-start gap-3 text-sm">
                  <span
                    className={
                      done
                        ? "text-success"
                        : active
                          ? "animate-pulse text-signal"
                          : "text-line"
                    }
                  >
                    {done ? "✓" : active ? "●" : "○"}
                  </span>
                  <span className={done || active ? "" : "text-wire"}>
                    {label}
                    {active && stageDetail && (
                      <span className="mt-0.5 block animate-pulse font-mono text-xs text-signal">
                        {stageDetail}…
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          {currentIdx === -1 && run.stage && (
            <p className="mt-4 animate-pulse font-mono text-xs text-signal">{run.stage}…</p>
          )}
          <p className="mt-6 text-xs text-wire">
            {run.profile === "smoke"
              ? "Smoke runs usually take 1–3 minutes."
              : "Full audits usually take 8–12 minutes."}{" "}
            Engines without a working key show up as flagged: partial coverage, never a
            failed run.
          </p>
          <NotifyMe />
        </div>
      )}
    </div>
  );
}

// Data-hygiene menu (migration 0038) — owner controls that live with the
// run itself: Cancel (only while queued/running), Hide/Unhide (from every list; the run
// stays reachable by URL), plus a badge when the run is hidden. RunView renders only for
// non-done runs, so hiding a DONE run happens from the brand Movement page instead.
function RunMenu({ run }: { run: RunRow }) {
  const { refresh, actions } = useReportHost();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const isActive = run.status === "queued" || run.status === "running";
  const hidden = !!run.hidden_at;

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(key);
    setErr(null);
    const res = await fn();
    if (res.ok) refresh();
    else {
      setErr(res.error ?? "Something went wrong. Try again.");
      setBusy(null);
    }
  };

  return (
    <div className="mt-3">
      {hidden && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-xs text-wire">
          <Badge variant="outline" className="border-wire text-wire">
            hidden
          </Badge>
          <span>This run is hidden from your dashboards and lists. Only reachable by its link.</span>
        </div>
      )}
      {/* the mutating controls exist only where the host can actually mutate
          (the app); a static render drops them rather than showing dead buttons */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {actions.available && isActive && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm("Cancel this run? It will be marked as cancelled and stop appearing as active."))
                void act("cancel", () => actions.cancelRun(run.id));
            }}
            className="text-pill-dismissed underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel run"}
          </button>
        )}
        {actions.available && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void act("hide", () => (hidden ? actions.unhideRun(run.id) : actions.hideRun(run.id)))
            }
            className="text-wire underline underline-offset-2 hover:text-ink disabled:opacity-50"
          >
            {busy === "hide"
              ? hidden
                ? "Unhiding…"
                : "Hiding…"
              : hidden
                ? "Unhide this run"
                : "Hide this run"}
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-pill-dismissed">{err}</p>}
    </div>
  );
}

// A quiet inline offer to get a browser notification when the dossier
// is ready. Shown ONLY when the API exists and permission is still "default"
// (and the user hasn't been denied before). We NEVER ask on load — only on this
// click. Feature-detected inside an effect → SSR-safe, zero errors unsupported.
function NotifyMe() {
  const { notify } = useReportHost();
  // "offer" | "granted" | "hidden"
  const [phase, setPhase] = useState<"hidden" | "offer" | "granted">("hidden");
  useEffect(() => {
    // read the browser-only permission on mount (SSR renders "hidden")
    const offerIfAllowed = () => {
      if (notify.canOffer()) setPhase("offer");
    };
    offerIfAllowed();
  }, [notify]);

  if (phase === "hidden") return null;
  if (phase === "granted")
    return <p className="mt-3 text-xs text-success">✓ We&apos;ll notify you when it&apos;s ready.</p>;
  return (
    <button
      type="button"
      onClick={async () => {
        const result = await notify.request();
        setPhase(result === "granted" ? "granted" : "hidden");
      }}
      className="mt-3 text-xs text-signal underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Notify me when it&apos;s ready
    </button>
  );
}

// The moment status flips to "done", the useEffect above fires the host refresh()
// and the server re-renders the real dossier in its place. This is the brief
// bridge frame — a calm "opening" state, never the old scaffold copy.
function DossierOpening() {
  return (
    <div className="mt-8 flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <div className="rounded-lg border border-line bg-card p-6">
        <h1 className="font-display text-xl">Opening your report…</h1>
        <p className="mt-2 text-sm text-wire">
          Your snapshot is captured. Laying out the battlefield map, receipts, and fix plan.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3 motion-reduce:animate-none" />
          <Skeleton className="h-24 w-full motion-reduce:animate-none" />
          <Skeleton className="h-24 w-full motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

function RetryButton({ runId }: { runId: string }) {
  const { refresh } = useReportHost();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mt-4">
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const res = await fetch("/api/runs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ retryRunId: runId }),
          });
          if (res.ok) refresh();
          else {
            const d = await res.json().catch(() => ({}));
            setErr(d.reason ?? "Retry failed. Try again in a minute.");
            setBusy(false);
          }
        }}
      >
        {busy ? "Retrying…" : "Retry this run"}
      </Button>
      {err && <p className="mt-2 text-sm text-pill-dismissed">{err}</p>}
    </div>
  );
}

function Elapsed({ since }: { since: string }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [since]);
  if (seconds === null) return null; // client-only → no hydration mismatch
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <span className="font-mono text-xs text-wire">
      {m > 0 ? `${m}m ` : ""}
      {s}s
    </span>
  );
}
