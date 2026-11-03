"use client";
// T3 — the editor. Everything on this page is local state plus pure arithmetic:
// no LLM call, no network, no cost until "Run audit". The estimate at the top
// recomputes on every keystroke, which is the whole point of keeping
// src/lib/question-options.ts free of Next and Supabase imports.
//
// Layout: the answer comes first. What this run will ask, what it will cost, and
// the button, before any control. The controls that change that number sit
// directly under it, and the question set itself, the longest thing on the page,
// comes last. Every number carries the arithmetic that produced it.
//
// Native <select> rather than the app's Radix listbox: this page can hold fifty
// rows with two selects each, and a hundred portalled listboxes is a real cost
// for a dense editor. The two run-level controls use the same styling so the
// page reads as one thing.
import { useMemo, useState } from "react";
import { QuestionImport } from "./question-import";
import { useRouter } from "next/navigation";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { PendingLink } from "@/components/pending-link";
import { SurfacePicker } from "@/components/engine-picker";
import {
  type DraftQuestion,
  estimateRunCost,
  formatUsdRange,
  isBandCounted,
  MAX_QUESTIONS,
  QUESTION_TYPES,
  type QuestionType,
  questionsChanged,
  MAX_SOURCE_OVERRIDES,
  ROLE_CENTS,
  type RunSkipOptions,
  SOURCE_TYPE_OPTIONS,
} from "@/lib/question-options";
import { MAX_SAMPLES, MIN_SAMPLES, PROFILES, type ProfileName } from "@saylent/engine/profiles";
import { ENGINE_FLOOR, SELECTABLE_ENGINES } from "@saylent/engine/engines";
import { SERP_REQUEST_CENTS } from "@saylent/engine/rates";
import { SERP_PROVIDERS, SURFACES, engineLabel, isSurfaceId } from "@saylent/engine/surfaces";
import { resetRunOptions, saveRunOptions, startRunWithOptions } from "./actions";

type SurfaceLocaleForm = { country: string; language: string; location: string };
type OverrideRow = { host: string; type: string };
const EMPTY_LOCALE: SurfaceLocaleForm = { country: "", language: "", location: "" };
const SERP_LABEL = SERP_PROVIDERS.serpapi.label;

const TYPE_LABELS: Record<QuestionType, string> = {
  category: "Category",
  comparison: "Head to head",
  problem: "Problem led",
  branded: "Branded",
  integration: "Integration",
  migration: "Switching",
  trust: "Trust",
  custom: "Your own",
};

const selectClass =
  "rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-signal/40 disabled:opacity-50";

const cents = (n: number) => `$${(n / 100).toFixed(2)}`;

/** Next free q-number, so an added row never collides with an existing id. */
function nextQid(rows: readonly DraftQuestion[]): string {
  const taken = new Set(rows.map((r) => r.id));
  let n = rows.length;
  let id = "";
  do {
    n += 1;
    id = `q${String(n).padStart(2, "0")}`;
  } while (taken.has(id));
  return id;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function QuestionsClient(props: {
  brandId: string;
  brandName: string;
  domain: string;
  profile: ProfileName;
  defaultSamples: number;
  baseline: DraftQuestion[];
  savedQuestions: DraftQuestion[] | null;
  savedSamples: number | null;
  savedEngines: string[] | null;
  savedLocale: string;
  savedSkip: RunSkipOptions;
  savedSurfaceLocale: SurfaceLocaleForm;
  savedSourceOverrides: OverrideRow[];
  /** the deployment has a SerpApi key (presence only, resolved server-side) */
  serpAvailable: boolean;
  brandEngines: string[];
  allEngines: string[];
  hasFrozenSet: boolean;
  questionSetVersion: number;
  templateSetVersion: number;
  activeRunId: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DraftQuestion[]>(props.savedQuestions ?? props.baseline);
  const [samples, setSamples] = useState(props.savedSamples ?? props.defaultSamples);
  const [engines, setEngines] = useState<string[]>(
    props.savedEngines?.length ? props.savedEngines : props.brandEngines,
  );
  const [locale, setLocale] = useState(props.savedLocale);
  const [skip, setSkip] = useState<RunSkipOptions>(props.savedSkip);
  const [surfaceLocale, setSurfaceLocale] = useState<SurfaceLocaleForm>(props.savedSurfaceLocale);
  const [overrides, setOverrides] = useState<OverrideRow[]>(props.savedSourceOverrides);
  const [phase, setPhase] = useState<"idle" | "saving" | "starting" | "resetting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const busy = phase !== "idle";
  const caps = PROFILES[props.profile];

  const estimate = useMemo(
    () => estimateRunCost({ questions: rows, engines, samples, skip, profile: props.profile }),
    [rows, engines, samples, skip, props.profile],
  );

  const questionsEdited = questionsChanged(props.baseline, rows);
  const enginesEdited = !sameSet(engines, props.brandEngines);
  const optionsEdited =
    questionsEdited ||
    enginesEdited ||
    samples !== props.defaultSamples ||
    locale !== props.savedLocale ||
    surfaceLocale.country !== props.savedSurfaceLocale.country ||
    surfaceLocale.language !== props.savedSurfaceLocale.language ||
    surfaceLocale.location !== props.savedSurfaceLocale.location ||
    !!(skip.drafts || skip.corpus || skip.gates);
  const surfacesPicked = engines.filter((e) => isSurfaceId(e));
  // a selected surface with no key: the server refuses the run, so say it here
  const surfacesWithoutKey = surfacesPicked.length > 0 && !props.serpAvailable;
  // The methodology warning, stated before the click: a verify re-asks the frozen
  // set, so changing what gets asked starts a new trend line.
  const willRebaseline = props.hasFrozenSet && (questionsEdited || enginesEdited);
  const belowFloor = engines.length > 0 && engines.length < ENGINE_FLOOR;
  const emptyRow = rows.some((r) => !r.text.trim());
  const canRun =
    !busy && !belowFloor && !emptyRow && rows.length > 0 && !props.activeRunId && !surfacesWithoutKey;
  // WHY THE BUTTON IS DEAD, NEXT TO THE BUTTON. The explanations
  // existed, but 3,000px down the page: you clicked Run, nothing happened, and
  // the reason was off-screen. Same sentences, said where the click was.
  const blockedReason = props.activeRunId
    ? "This brand already has a run in progress. Watch it and come back when it finishes."
    : rows.length === 0
      ? "There are no questions. Add at least one below."
      : emptyRow
        ? "One row has no text. Fill it in or remove it below before running."
        : belowFloor
          ? `Only ${engines.length} engine selected. Pick at least ${ENGINE_FLOOR} — one engine cannot cross-check another.`
          : surfacesWithoutKey
            ? `Answer surfaces need a ${SERP_LABEL} key and this deployment has none. Untick them below, or ask your operator to add ${SERP_PROVIDERS.serpapi.envVar}.`
            : null;

  function patchRow(index: number, patch: Partial<DraftQuestion>) {
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch, source: "user" } : r)));
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
  }

  /** Append imported questions (question-import.tsx), each tagged as the
   *  owner's own; a questions.json locale fills an empty surface locale. */
  function importRows(texts: string[], loc: { language?: string; country?: string } | null) {
    const next = [...rows];
    for (const text of texts) {
      if (next.length >= MAX_QUESTIONS) break;
      if (next.some((r) => r.text.trim().toLowerCase() === text.trim().toLowerCase())) continue;
      next.push({ id: nextQid(next), type: "custom", text, source: "user" });
    }
    setRows(next);
    if (loc && (loc.country || loc.language)) {
      setSurfaceLocale({
        ...surfaceLocale,
        country: surfaceLocale.country || loc.country || "",
        language: surfaceLocale.language || loc.language || "",
      });
    }
  }

  function addRow() {
    if (rows.length >= MAX_QUESTIONS) return;
    setRows([...rows, { id: nextQid(rows), type: "custom", text: "", source: "user" }]);
  }

  function toggleEngine(engine: string) {
    // canonical order (model APIs, then surfaces), so the set compares cleanly
    const next = engines.includes(engine) ? engines.filter((e) => e !== engine) : [...engines, engine];
    setEngines(SELECTABLE_ENGINES.filter((e) => next.includes(e)));
  }

  function patchOverride(index: number, patch: Partial<OverrideRow>) {
    setOverrides(overrides.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const form = () => ({
    brandId: props.brandId,
    questions: rows,
    samples,
    engines,
    locale,
    skip,
    surfaceLocale,
    sourceOverrides: overrides.filter((r) => r.host.trim() || r.type),
  });

  async function save() {
    setError(null);
    setNote(null);
    setPhase("saving");
    const res = await saveRunOptions(form());
    setPhase("idle");
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNote(
      res.rebaselined
        ? "Saved. Your frozen set was cleared, so the next audit starts a new baseline."
        : "Saved. Nothing has been spent.",
    );
  }

  async function run() {
    setError(null);
    setNote(null);
    setPhase("starting");
    const res = await startRunWithOptions(form());
    if (res.ok) {
      router.push(`/app/run/${res.runId}`);
      return; // navigating away: keep the button busy until the route swaps
    }
    setError(res.error);
    setPhase("idle");
  }

  async function reset() {
    setError(null);
    setNote(null);
    setPhase("resetting");
    const res = await resetRunOptions(props.brandId);
    setPhase("idle");
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows(props.baseline);
    setSamples(props.defaultSamples);
    setEngines(props.brandEngines);
    setLocale("");
    setSkip({});
    setSurfaceLocale(EMPTY_LOCALE);
    // the source-type overrides are kept by the server: they are not run options
    setNote("Back to the generated set and the defaults.");
  }

  const draftCost = skip.drafts ? 0 : ROLE_CENTS.drafter * caps.draftTop;

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl text-ink">
          {props.brandName} <span className="font-mono text-sm text-wire">{props.domain}</span>
        </h1>
        <p className="max-w-[65ch] text-sm text-wire">
          These are the questions we will put to the answer engines, and the settings the run
          will use. Change anything you like here. Nothing costs a cent until you press Run
          audit.
        </p>
      </header>

      {/* The answer, first: what it asks, what it costs, and the button. Sticky
          from lg up so the estimate and Run stay with you down a 3,800px page. */}
      <section className="flex flex-col gap-5 rounded-xl border border-line bg-card p-6 lg:sticky lg:top-4 lg:z-20 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-1">
            <p className="font-display text-4xl tabular-nums text-ink">{formatUsdRange(estimate)}</p>
            <p className="text-sm text-wire">
              estimated cost of this run, on your own provider credits
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={run} disabled={!canRun}>
              {phase === "starting" ? "Starting your audit…" : "Run audit"}
            </Button>
            <Button variant="outline" onClick={save} disabled={busy}>
              {phase === "saving" ? "Saving…" : "Save for later"}
            </Button>
            {optionsEdited && (
              <Button variant="ghost" onClick={reset} disabled={busy}>
                {phase === "resetting" ? "Resetting…" : "Reset to generated"}
              </Button>
            )}
          </div>
          {blockedReason && (
            <p
              role="status"
              className="w-full text-sm text-pill-dismissed sm:basis-full sm:text-right"
            >
              {blockedReason}
            </p>
          )}
        </div>

        {/* The receipt for the number above. */}
        <dl className="grid gap-x-8 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Questions asked</dt>
            <dd className="tabular-nums text-ink">
              {estimate.asked === estimate.total
                ? `${estimate.total}, of which ${estimate.scored} count toward the recommended band`
                : `${estimate.asked} of ${estimate.total} (the ${props.profile} profile asks ${estimate.asked}), of which ${estimate.scored} count toward the recommended band`}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Answers collected</dt>
            <dd className="tabular-nums text-ink">
              {estimate.drawsLow === estimate.drawsHigh
                ? estimate.drawsLow
                : `${estimate.drawsLow} to ${estimate.drawsHigh}`}{" "}
              across {estimate.engines} engines
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Fix drafts</dt>
            <dd className="tabular-nums text-ink">
              {skip.drafts ? "none, you skipped them" : `${caps.draftTop}, about ${cents(draftCost)}`}
            </dd>
          </div>
          {surfacesPicked.length > 0 && !belowFloor && (
            <div className="flex justify-between gap-4">
              <dt className="text-wire">Answer surfaces</dt>
              <dd className="tabular-nums text-ink">
                {surfacesPicked.map((s) => SURFACES[s as keyof typeof SURFACES].label).join(", ")}, on
                your {SERP_LABEL} plan at about {cents(SERP_REQUEST_CENTS.serpapi)} a search
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-wire">Also billed</dt>
            <dd className="tabular-nums text-ink">
              one brand model call ({cents(ROLE_CENTS.brand)}) and judging at {cents(ROLE_CENTS.judge)} an
              answer
            </dd>
          </div>
        </dl>
        <p className="text-xs text-wire">
          The range is the adaptive tiebreak: a question asked twice gets a third draw only when
          the first two disagree. The low number assumes none of them do.
        </p>

        {props.activeRunId && (
          <p className="text-sm text-ink">
            This brand already has a run in progress.{" "}
            <PendingLink href={`/app/run/${props.activeRunId}`} className="text-signal underline">
              Watch it
            </PendingLink>{" "}
            and come back when it finishes.
          </p>
        )}
        {willRebaseline && (
          <p className="rounded-lg border border-signal/40 bg-signal/10 p-3 text-sm text-ink">
            You changed what gets asked. Verify compares a run against the frozen set it was
            baselined on, so this run starts a new baseline and the movement chart begins again
            from here. Your existing reports stay exactly as they are.
          </p>
        )}
        {error && <p className="text-sm text-pill-dismissed">{error}</p>}
        {note && <p className="text-sm text-wire">{note}</p>}
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg text-ink">How the run is asked</h2>
          <p className="max-w-[65ch] text-sm text-wire">
            The same four controls the command line takes as flags:{" "}
            <code className="font-mono text-xs">--samples</code>,{" "}
            <code className="font-mono text-xs">--engines</code>,{" "}
            <code className="font-mono text-xs">--locale</code> and the skips.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="samples">Samples per scored question</Label>
            <select
              id="samples"
              className={selectClass}
              value={samples}
              onChange={(e) => setSamples(Number(e.target.value))}
            >
              {Array.from({ length: MAX_SAMPLES - MIN_SAMPLES + 1 }, (_, i) => MIN_SAMPLES + i).map(
                (n) => (
                  <option key={n} value={n}>
                    {n === props.defaultSamples ? `${n} (default)` : n}
                  </option>
                ),
              )}
            </select>
            <p className="text-xs text-wire">
              How many times each scored question is asked, per engine. Engines are not
              deterministic, so more draws make the verdict steadier and the bill larger. A row
              can override this for itself below.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="locale">Language</Label>
            <Input
              id="locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              placeholder="Leave blank for English, or de, pt-BR"
            />
            <p className="text-xs text-wire">
              {questionsEdited
                ? "No effect while you have edited rows: your wording is asked exactly as written."
                : "One drafter call translates the whole set once, before it freezes, so every future verify asks the same wording."}
            </p>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Answer engines</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {props.allEngines.map((engine) => (
              <label key={engine} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-signal,currentColor)]"
                  checked={engines.includes(engine)}
                  onChange={() => toggleEngine(engine)}
                />
                {engineLabel(engine)}
              </label>
            ))}
          </div>
          <SurfacePicker
            selected={engines}
            onToggle={(id) => toggleEngine(id)}
            serpAvailable={props.serpAvailable}
            idPrefix="run"
          />
          <p className="text-xs text-wire">
            {belowFloor
              ? `Pick at least ${ENGINE_FLOOR}. One engine cannot cross-check another, so a single-engine verdict is a coin flip.`
              : `Every engine you drop removes its answers from the score. Changing the set starts a new baseline, because a verify may not compare ${engines.length} engines against a different number.`}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-ink">
            Where the answer surfaces read from
          </legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="surface-country">Country</Label>
              <Input
                id="surface-country"
                value={surfaceLocale.country}
                maxLength={2}
                onChange={(e) => setSurfaceLocale({ ...surfaceLocale, country: e.target.value })}
                placeholder="us, gb, de"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="surface-language">Language</Label>
              <Input
                id="surface-language"
                value={surfaceLocale.language}
                onChange={(e) => setSurfaceLocale({ ...surfaceLocale, language: e.target.value })}
                placeholder={locale.trim() ? `${locale.trim()} (the run language)` : "en, pt-BR"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="surface-location">Location</Label>
              <Input
                id="surface-location"
                value={surfaceLocale.location}
                maxLength={120}
                onChange={(e) => setSurfaceLocale({ ...surfaceLocale, location: e.target.value })}
                placeholder="Austin, Texas, United States"
              />
            </div>
          </div>
          <p className="max-w-[65ch] text-xs text-wire">
            Applies to the answer surfaces only; the four model APIs ignore it. A blank language
            uses the run language above. {SURFACES.copilot.label} has no documented country or
            language setting, so it answers from the provider&apos;s default location. A verify
            always reads the surfaces from where its baseline did.
            {surfacesPicked.length === 0 && " No surface is selected, so this has no effect yet."}
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-ink">Source types</legend>
          <p className="max-w-[65ch] text-xs text-wire">
            Correct how a cited domain is classified in the report&apos;s Sources &amp;
            opportunities section, for example a review site we filed as a blog. This changes how
            every report for this brand reads its stored answers, never what a run asks, so it
            never starts a new baseline. Subdomains follow their domain.
          </p>
          {overrides.length > 0 && (
            <ul className="flex flex-col gap-2">
              {overrides.map((r, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`Domain ${index + 1}`}
                    className="w-56 font-mono text-xs"
                    value={r.host}
                    onChange={(e) => patchOverride(index, { host: e.target.value })}
                    placeholder="g2.com"
                  />
                  <select
                    aria-label={`Source type for domain ${index + 1}`}
                    className={selectClass}
                    value={r.type}
                    onChange={(e) => patchOverride(index, { type: e.target.value })}
                  >
                    <option value="">Pick a type</option>
                    {SOURCE_TYPE_OPTIONS.map(([type, label]) => (
                      <option key={type} value={type}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setOverrides(overrides.filter((_, i) => i !== index))}
                    className="text-xs text-wire underline underline-offset-2 hover:text-pill-dismissed"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setOverrides([...overrides, { host: "", type: "" }])}
              disabled={overrides.length >= MAX_SOURCE_OVERRIDES}
            >
              Add a source type
            </Button>
            <span className="text-xs text-wire">
              {overrides.length >= MAX_SOURCE_OVERRIDES
                ? `That is the most a brand can keep (${MAX_SOURCE_OVERRIDES}).`
                : "Saved with Save for later or Run audit."}
            </span>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-ink">Stages to skip</legend>
          <SkipToggle
            id="skip-drafts"
            label="Skip the fix drafts"
            checked={!!skip.drafts}
            onChange={(v) => setSkip({ ...skip, drafts: v })}
            note={`Saves about ${cents(ROLE_CENTS.drafter * caps.draftTop)}. You still get the diagnosis and the priority order, without the ready to paste copy.`}
          />
          <SkipToggle
            id="skip-corpus"
            label="Skip the page by page corpus"
            checked={!!skip.corpus}
            onChange={(v) => setSkip({ ...skip, corpus: v })}
            note="Costs nothing either way, it is your own site being read. Skipping it means the fixes cannot point at which page to change."
          />
          <SkipToggle
            id="skip-gates"
            label="Skip the crawler gate checks"
            checked={!!skip.gates}
            onChange={(v) => setSkip({ ...skip, gates: v })}
            note="Costs nothing either way. Skipping it means you will not learn whether the AI crawlers are being blocked before they ever read you."
          />
        </fieldset>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg text-ink">The questions</h2>
          <p className="font-mono text-xs text-wire">
            template set v{props.templateSetVersion} · question set v{props.questionSetVersion}
          </p>
        </div>
        <p className="max-w-[65ch] text-sm text-wire">
          Only category and problem questions count toward the recommended band. Everything else,
          including anything you write yourself, is asked, judged and reported, and deliberately
          left out of the score, so your own questions can never inflate your own number.{" "}
          {props.hasFrozenSet
            ? "This set is frozen from your last audit. Editing it starts a new baseline."
            : "This set freezes the first time you run an audit, and every verify re-asks it."}
        </p>

        <ol className="flex flex-col divide-y divide-line border-y border-line">
          {rows.map((row, index) => (
            <li key={row.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-start gap-3">
                <span className="w-8 shrink-0 pt-2 font-mono text-xs text-wire">{row.id}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Input
                    aria-label={`Question ${row.id}`}
                    value={row.text}
                    onChange={(e) => patchRow(index, { text: e.target.value })}
                    placeholder="What would a buyer type into an answer engine?"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-wire">
                      Type
                      <select
                        className={selectClass}
                        aria-label={`Type of question ${row.id}`}
                        value={row.type}
                        onChange={(e) => patchRow(index, { type: e.target.value as QuestionType })}
                      >
                        {QUESTION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-wire">
                      Samples
                      <select
                        className={selectClass}
                        aria-label={`Samples for question ${row.id}`}
                        value={row.samples ?? ""}
                        onChange={(e) =>
                          patchRow(index, {
                            samples: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                      >
                        <option value="">
                          run default ({isBandCounted(row.type) ? samples : 1})
                        </option>
                        {Array.from(
                          { length: MAX_SAMPLES - MIN_SAMPLES + 1 },
                          (_, i) => MIN_SAMPLES + i,
                        ).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-wire">
                      {isBandCounted(row.type) ? "counts toward the band" : "asked, not scored"}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="ml-auto text-xs text-wire underline underline-offset-2 hover:text-pill-dismissed"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={addRow} disabled={rows.length >= MAX_QUESTIONS}>
            Add a question
          </Button>
          <QuestionImport capacity={MAX_QUESTIONS - rows.length} onImport={importRows} />
          <span className="text-xs text-wire">
            {rows.length >= MAX_QUESTIONS
              ? `That is the most one run can ask (${MAX_QUESTIONS}). Remove one to add another.`
              : "A question you write is tagged as your own and left out of the band by default. Tag it category or problem to have it counted."}
          </span>
        </div>
        {emptyRow && (
          <p className="text-sm text-pill-dismissed">
            One row has no text. Fill it in or remove it before running.
          </p>
        )}
        <p className="text-sm text-wire">
          The questions come from your brand model: category, ideal customer, problems and rivals.
          To change them at the source rather than one row at a time, edit the brand in{" "}
          <PendingLink href="/app/settings/brands" className="text-signal underline">
            settings
          </PendingLink>
          .
        </p>
      </section>
    </div>
  );
}

function SkipToggle(props: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="flex items-center gap-2 text-sm text-ink">
        <input
          id={props.id}
          type="checkbox"
          className="size-4 accent-[var(--color-signal,currentColor)]"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        {props.label}
      </label>
      <p className="max-w-[65ch] pl-6 text-xs text-wire">{props.note}</p>
    </div>
  );
}
