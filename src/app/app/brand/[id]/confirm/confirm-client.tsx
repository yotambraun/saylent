"use client";
// "Confirm your audit" — the user sees + tunes the EXACT question set
// before the run is spent. Two modes:
//   • not-yet-frozen (the normal path): edit competitors / category / icp with a
//     LIVE, LLM-free preview (buildPreviewQuestions), then save + start.
//   • already-frozen (rare edge — a first audit that froze then failed): the set is
//     locked, so we show it read-only and just offer to start.
// No LLM on this page; every re-render of the preview is pure string templating.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PendingLink } from "@/components/pending-link";
import { useMemo, useState } from "react";
import { Button } from "@saylent/report/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import type { QType, Question } from "@saylent/engine/types";
import type { GeneratedQuestions } from "@saylent/engine/questions";
import { MAX_COMPETITORS } from "@saylent/report/validation";
import {
  estimateRunCost,
  formatUsdRange,
  ROLE_CENTS,
} from "@/lib/question-options";
import { PROFILES, type ProfileName } from "@saylent/engine/profiles";
import { saveConfirmEdits } from "./actions";
import { buildPreviewQuestions } from "./preview";

// Human labels for the seven template-set-v2 archetypes, in generation order.
const GROUPS: { type: QType; label: string; blurb: string }[] = [
  { type: "category", label: "Category & discovery", blurb: "how buyers search before they know you" },
  { type: "comparison", label: "Head-to-head", blurb: "you vs the rivals you named" },
  { type: "problem", label: "Problem-led", blurb: "the jobs buyers hire you for" },
  { type: "branded", label: "Direct brand questions", blurb: "buyers asking about you by name" },
  { type: "integration", label: "Integration fit", blurb: "does it work with their stack" },
  { type: "migration", label: "Switching from a rival", blurb: "is the move worth it" },
  { type: "trust", label: "Trust & safety", blurb: "can they rely on you" },
];

// A rejection that points the user at their operator is a deployment limit — the
// user needs the operator to raise it, not a retry (same rule as run-cta.tsx;
// createRun reason strings).
const isOperatorLimit = (reason: string) => reason.toLowerCase().includes("ask your operator");

const cents = (n: number) => `$${(n / 100).toFixed(2)}`;

function QuestionGroups({ questions }: { questions: Question[] }) {
  const byType = new Map<QType, Question[]>();
  for (const q of questions) {
    const list = byType.get(q.qtype) ?? [];
    list.push(q);
    byType.set(q.qtype, list);
  }
  return (
    <div className="flex flex-col gap-5">
      {GROUPS.filter((g) => (byType.get(g.type)?.length ?? 0) > 0).map((g) => (
        <div key={g.type} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-display text-sm text-ink">{g.label}</h3>
            <span className="font-mono text-[10px] uppercase tracking-wider text-wire">{g.blurb}</span>
          </div>
          <ol className="flex flex-col gap-1.5">
            {(byType.get(g.type) ?? []).map((q) => (
              <li key={q.qid} className="flex gap-2 text-sm text-ink">
                <span className="shrink-0 font-mono text-xs text-wire">{q.qid}</span>
                <span>{q.text}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

export function ConfirmClient({
  brandId,
  brandName,
  domain,
  initialCategory,
  initialCompetitors,
  initialIcp,
  problems,
  year,
  frozenQuestions,
  profile,
  samples,
  engines,
  allEngineCount,
  capUsd,
  capRemainingUsd,
}: {
  brandId: string;
  brandName: string;
  domain: string;
  initialCategory: string;
  initialCompetitors: string[];
  initialIcp: string;
  problems: string[];
  year: number;
  frozenQuestions: Question[] | null;
  /** the profile this deployment's audits run at (sets samples + fix drafts) */
  profile: ProfileName;
  /** default samples per scored question at that profile */
  samples: number;
  /** the engines this brand asks */
  engines: string[];
  allEngineCount: number;
  /** the deployment-wide daily spend cap, 0 when the operator set none */
  capUsd: number;
  /** what is left of it today, null when there is no cap */
  capRemainingUsd: number | null;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(initialCategory);
  const [icp, setIcp] = useState(initialIcp);
  const [competitors, setCompetitors] = useState<string[]>(initialCompetitors);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<"idle" | "saving" | "starting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  const locked = !!frozenQuestions;
  const busy = phase !== "idle";

  // LIVE preview — pure, deterministic, no LLM. Recomputes only on a real field
  // change (fixed `year` keeps server + client renders identical → no hydration drift).
  // NEVER PREVIEW A PLACEHOLDER QUESTION. With category or buyer
  // blank, the engine's templates fall back to "product" / "teams evaluating
  // options" and this page used to offer 23 of those with "Start my audit" fully
  // enabled. Both are required at brand creation now; an older brand that has
  // one blank gets the fields, not the fake questions, and the start button is
  // refused here and again in createRun (src/lib/placeholder-guard.ts).
  const missingSlots: string[] = [];
  if (!locked && !category.trim()) missingSlots.push("your category");
  if (!locked && !icp.trim()) missingSlots.push("who buys you");
  const aimed = missingSlots.length === 0;

  const preview = useMemo<GeneratedQuestions>(
    () =>
      locked
        ? frozenQuestions!
        : aimed
          ? buildPreviewQuestions({ brand: brandName, category, icp, competitors, problems }, year)
          : [],
    [locked, aimed, frozenQuestions, brandName, category, icp, competitors, problems, year],
  );

  // The same arithmetic the questions tab and the CLI preflight use. Pure, no
  // network, recomputed as the fields change the question count.
  const estimate = useMemo(
    () =>
      estimateRunCost({
        questions: preview.map((q) => ({ type: q.qtype })),
        engines,
        samples,
        profile,
      }),
    [preview, engines, samples, profile],
  );
  const draftTop = PROFILES[profile].draftTop;
  const overCap =
    capRemainingUsd !== null && preview.length > 0 && estimate.lowUsd > capRemainingUsd;

  function addCompetitor() {
    const value = draft.trim();
    if (!value) return;
    if (competitors.length >= MAX_COMPETITORS) return;
    if (competitors.some((c) => c.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    setCompetitors([...competitors, value]);
    setDraft("");
  }

  async function start() {
    setError(null);
    setReason(null);
    if (!aimed) {
      setError(
        `Fill in ${missingSlots.join(" and ")} above first — without them every question asks about “product” for “teams evaluating options”.`,
      );
      return;
    }
    try {
      if (!locked) {
        setPhase("saving");
        const saved = await saveConfirmEdits({
          brandId,
          category,
          competitorsCsv: competitors.join(", "),
          icp,
        });
        if (!saved.ok) {
          setError(saved.error);
          setPhase("idle");
          return;
        }
      }
      setPhase("starting");
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId, kind: "audit" }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/app/run/${data.runId}`);
        return; // navigating away — keep the button busy until the route swaps
      }
      setReason(data.reason ?? "Could not start the audit.");
      setPhase("idle");
    } catch {
      setError("Something went wrong. Try again.");
      setPhase("idle");
    }
  }

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-wider text-signal">Confirm your audit</p>
        <h1 className="font-display text-2xl text-ink">
          {brandName} <span className="font-mono text-sm text-wire">{domain}</span>
        </h1>
        <p className="text-sm text-wire">
          One audit, one shot. These are the exact questions we&apos;ll put to every answer
          engine. Check them before we spend it.
        </p>
      </header>

      {!locked && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Aim the audit</CardTitle>
            <CardDescription>
              Fix a typo or vague field here: it changes the questions live, below. Category and
              who-buys-you are required — they are the two things every question is built from.
              Competitors we can detect from your site.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <div className="grid gap-1.5">
              <Label htmlFor="category">What are you? (category) *</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. uptime monitoring"
                aria-invalid={!category.trim() ? true : undefined}
              />
              <p className="text-xs text-wire">
                The words a buyer would search: “uptime monitoring”, “payroll software for
                restaurants”. A vague category makes vague questions.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="icp">Who buys you? (your buyer) *</Label>
              <Input
                id="icp"
                value={icp}
                onChange={(e) => setIcp(e.target.value)}
                placeholder="e.g. SRE teams at high-traffic SaaS"
                aria-invalid={!icp.trim() ? true : undefined}
              />
              <p className="text-xs text-wire">
                {icp.trim()
                  ? "We’ll ask the engines about exactly these buyers."
                  : "Required: every question is asked on their behalf, so blank means the engines get asked about “teams evaluating options”."}
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="competitor">Who are you against? (competitors)</Label>
              {competitors.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {competitors.map((c) => (
                    <li
                      key={c}
                      className="flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-sm text-ink"
                    >
                      <span>{c}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${c}`}
                        className="text-wire hover:text-pill-dismissed"
                        onClick={() => setCompetitors(competitors.filter((x) => x !== c))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  id="competitor"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCompetitor();
                    }
                  }}
                  placeholder="e.g. ZoomInfo"
                  disabled={competitors.length >= MAX_COMPETITORS}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addCompetitor}
                  disabled={!draft.trim() || competitors.length >= MAX_COMPETITORS}
                >
                  Add
                </Button>
              </div>
              <p className="text-xs text-wire">
                {competitors.length >= MAX_COMPETITORS
                  ? `That's the max (${MAX_COMPETITORS}). Remove one to add another.`
                  : "These drive your comparison questions. Leave empty and we'll detect them from your site."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg text-ink">
              {locked ? "Your frozen questions" : "The questions we'll ask"}
            </h2>
            <span className="font-mono text-xs text-wire">{preview.length} questions</span>
          </div>
          <p className="text-sm text-wire">
            {locked
              ? "This set is already frozen from an earlier attempt. It can't be re-aimed. Starting an audit re-asks exactly these."
              : "These freeze the moment you start. Every future verify re-asks exactly these, so your trend stays honest. They're generated from the fields above, no AI guesswork."}
          </p>
          {!locked && preview.skipped?.reason === "no-competitor" && (
            <p className="text-sm text-wire">
              Head-to-head questions are added once you name a rival above or we detect one on
              your site — we don&apos;t ask engines to compare you against a placeholder.
            </p>
          )}
        </div>
        {preview.length > 0 ? (
          <QuestionGroups questions={preview} />
        ) : (
          <p className="rounded-lg border border-signal/40 bg-signal/10 p-3 text-sm text-ink">
            No questions yet. Fill in {missingSlots.join(" and ")} above and they appear here,
            rewritten live. We will not show you stand-in questions and we will not run them.
          </p>
        )}
      </section>

      {/* THE PRICE, AT THE BUTTON. Same numbers, same arithmetic
          as /app/brand/[id]/questions — that page is where you change them. */}
      <section className="flex flex-col gap-4 rounded-xl border border-line bg-card p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="font-display text-4xl tabular-nums text-ink">
              {preview.length > 0 ? formatUsdRange(estimate) : "—"}
            </p>
            <p className="text-sm text-wire">
              estimated cost of this run, on your own provider credits
            </p>
          </div>
          <PendingLink
            href={`/app/brand/${brandId}/questions`}
            className="font-mono text-xs text-signal underline underline-offset-2 hover:text-ink"
          >
            Change questions, samples or models →
          </PendingLink>
        </div>

        <dl className="grid gap-x-8 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Profile</dt>
            <dd className="text-ink">
              {profile === "smoke" ? "smoke (a short test run)" : "full audit"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Questions asked</dt>
            <dd className="tabular-nums text-ink">
              {estimate.asked === estimate.total
                ? `${estimate.total}, of which ${estimate.scored} count toward the recommended band`
                : `${estimate.asked} of ${estimate.total} (the ${profile} profile asks ${estimate.asked}), of which ${estimate.scored} count toward the recommended band`}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Answer engines</dt>
            <dd className="text-ink">
              {engines.length} of {allEngineCount}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Samples per scored question</dt>
            <dd className="tabular-nums text-ink">{samples}, per engine</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Answers collected</dt>
            <dd className="tabular-nums text-ink">
              {estimate.drawsLow === estimate.drawsHigh
                ? estimate.drawsLow
                : `${estimate.drawsLow} to ${estimate.drawsHigh}`}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Also billed</dt>
            <dd className="tabular-nums text-ink">
              one brand model call ({cents(ROLE_CENTS.brand)}), judging at{" "}
              {cents(ROLE_CENTS.judge)} an answer, {draftTop} fix drafts
            </dd>
          </div>
          <div className="flex justify-between gap-4 sm:col-span-2">
            <dt className="text-wire">Spend cap left today</dt>
            <dd className="tabular-nums text-ink">
              {capRemainingUsd === null
                ? "no cap set on this deployment"
                : `$${capRemainingUsd.toFixed(2)} of $${capUsd.toFixed(2)}, deployment-wide`}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-wire">
          The range is the adaptive tiebreak: a question asked twice gets a third draw only
          when the first two disagree. The low number assumes none of them do.
        </p>
        {overCap && (
          <p className="rounded-lg border border-signal/40 bg-signal/10 p-3 text-sm text-ink">
            This run’s low estimate is above what is left of today’s deployment-wide spend cap.
            It may be refused, or it may trip the cap partway. Ask your operator to raise the
            cap, or come back tomorrow.
          </p>
        )}
      </section>

      {error && <p className="text-sm text-pill-dismissed">{error}</p>}
      {reason && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-signal/40 bg-signal/10 p-3">
          <p className="text-sm text-ink">{reason}</p>
          {isOperatorLimit(reason) && (
            <Button asChild size="sm">
              <Link href="/app/settings/limits">Check your limits</Link>
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={start} disabled={busy || !aimed}>
          {phase === "saving"
            ? "Saving your edits…"
            : phase === "starting"
              ? "Starting your audit…"
              : "Start my audit"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/app")} disabled={busy}>
          Not yet
        </Button>
        <span className="text-xs text-wire">
          {aimed
            ? "“Not yet” keeps your brand saved. Nothing is spent until you start."
            : `Fill in ${missingSlots.join(" and ")} above to start.`}
        </span>
      </div>
    </>
  );
}
