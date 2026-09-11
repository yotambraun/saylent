"use client";
// THE DOSSIER — mirrors METHODOLOGY.md exactly: eyebrow → verdict strip →
// 01 battlefield → 02 question verdicts → 03 share of voice → 04 domain gates →
// 05 fix plan → 06 methodology footer. Every number opens its stored receipt.
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { ArrowDown, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useReportHost } from "../host";
import { Favicon } from "./favicon";
import { ReportDisclaimer } from "./report-disclaimer";
import { CountUp, Reveal } from "./reveal";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { groupFixes, pickTopMoves, type FixGroup } from "../fix-groups";
import { gatesLede, gateTally, robotsVsLiveNote, type GateCheck } from "../gates-lede";
import { pagePresence } from "../page-presence";
import { decodeEntities } from "../entities";
import { runTotals, totalsLine, failuresLine } from "../totals";
import { parseArtifact, artifactPlainText, type ArtifactBlock } from "../artifact";
import { parseInline } from "../inline-markdown";
import { ReportOutro } from "./report-outro";
import {
  bandDescriptor,
  battlefieldRows,
  buriedBehind,
  consensusSources,
  degradedEngines,
  entityConfusion,
  lossMap,
  mergedPricingClaims,
  opportunityPages,
  ownSiteCoverage,
  perceptionClaims,
  pricingFigures,
  rankRiskClaims,
  sendElsewhere,
  shareOfVoiceRows,
  sourceMix,
  toneCounts,
  CONSENSUS_PHRASE,
  type AnswerRef,
  type BandDescriptor,
  type BandLike,
  type EntityConfusionAgg,
  type MergedPricingClaim,
  type OwnSiteCoverage,
  type RivalOwnerFn,
  type SendElsewhere,
} from "../report-intel";
import { makeRivalOwner } from "@saylent/engine/rival-owner";
import { stripMarkdownForPreview } from "../strip-md";
import { rivalGaps, type RivalGaps } from "../rival-gaps";
import { buildSourceMap } from "../source-map";
import { sovEntries, topRivalPick, topRivalSentence } from "../sov";
import {
  AnswerDrawer,
  ENGINE_LABEL,
  hostOf,
  PageDrawer,
  type AnswerRow,
  type CorpusRow,
} from "./drawers";
import type { RunRow } from "./run-view";
import { formatDayUtc } from "../utils";

/* ---------- row types (DB snake_case, RLS-fetched) ---------- */
export interface CheckRow {
  id: string;
  check_name: string;
  status: string;
  detail: string;
  factor: string | null;
}
export interface FixRow {
  id: string;
  fix_key: string;
  title: string;
  factor: string;
  weight: number;
  effort: string;
  time_to_impact: string;
  engines: string[];
  evidence: string[];
  artifact: string | null;
  published_at: string | null;
}

const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"] as const;

// E3b — short stage nouns for the sharpest-gap lede (qtype = buyer-journey stage).
const STAGE_NOUN: Record<string, string> = {
  category: "what-to-buy",
  comparison: "head-to-head",
  problem: "problem-stage",
  branded: "branded",
};

const PILL: Record<string, string> = {
  recommended: "bg-success text-paper",
  listed: "bg-pill-listed text-paper",
  compared: "bg-pill-listed text-paper",
  neutral: "bg-wire text-paper",
  dismissed: "bg-pill-dismissed text-paper",
  absent: "bg-pill-absent text-ink",
};

export function Dossier({
  run,
  brand,
  answers,
  corpus,
  checks,
  fixes,
  demo = false,
  modelsUsed,
  engineModels,
  previous = null,
  shareToken = null,
}: {
  run: RunRow;
  brand: {
    name: string;
    domain: string;
    aliases: string[];
    competitors: string[];
    /** TRUST-SAFETY: when the owner attested authorization — drives the quiet
     *  "Prepared with the requester's authorization" line in the methodology & honesty section (owner + share). */
    authorized_at?: string | null;
  };
  answers: AnswerRow[];
  corpus: CorpusRow[];
  checks: CheckRow[];
  fixes: FixRow[];
  /** public /demo rendering: no user chrome, no Mark-as-shipped */
  demo?: boolean;
  /** eyebrow: "models used, mono, small" — passed from the server */
  modelsUsed?: string;
  /** per-engine model id (registry, see METHODOLOGY.md) for the answer-drawer source chip */
  engineModels?: Record<string, string>;
  /** previous done audit of this brand — the progress story (plan 2026-07-07) */
  previous?: { pct: number; date: string } | null;
  /** current share token when the owner has sharing on (null = off) */
  shareToken?: string | null;
}) {
  // Analytics is a host capability (a beacon in the app, a no-op in a static
  // report.html) — the view never imports the app's client.
  const { track, methodologyUrl } = useReportHost();
  const [answerOpen, setAnswerOpen] = useState<AnswerRow | null>(null);
  const [pageOpen, setPageOpen] = useState<CorpusRow | null>(null);

  // receipt_opened is THE activation "aha": the
  // first time a buyer opens a stored answer receipt. Fire-and-forget, once per
  // drawer-open, never blocking the open. Gated off the public /demo render so
  // anonymous marketing visitors never inflate the activation funnel.
  const openAnswer = (a: AnswerRow) => {
    if (!demo) track("receipt_opened", { run_id: run.id, qid: a.qid, engine: a.engine });
    setAnswerOpen(a);
  };

  const scores = run.scores as {
    overall?: {
      answered?: number;
      recommended?: number;
      mentioned?: number;
      rec_rate: number | null;
      mention_rate: number | null;
    };
    per_engine?: Record<
      string,
      {
        answered: number;
        recommended: number;
        mentioned: number;
        rec_rate: number | null;
        mention_rate?: number | null;
      }
    >;
    share_of_voice?: Record<string, number>;
    // Adaptive-sampling confidence band, absent on old/smoke runs.
    recommended_band?: { overall?: BandLike; per_engine?: Record<string, BandLike> };
  } | null;
  const recPct = Math.round((scores?.overall?.rec_rate ?? 0) * 100);
  const menPct = Math.round((scores?.overall?.mention_rate ?? 0) * 100);
  // WEAK-FIRST-AUDIT SAFETY NET a done audit whose
  // headline is rough — recommended in <10% of scored answers (the very number the
  // verdict strip shows). Reuses recPct + the stored overall tally; invents nothing.
  const recCount = scores?.overall?.recommended ?? 0;
  const answeredScored = scores?.overall?.answered ?? 0;
  const weakAudit = run.kind === "audit" && answeredScored > 0 && recPct < 10;
  // Rival-ownership guard (see @saylent/engine's rival-owner.ts) — the ONE shared
  // definition the engine and this UI agree on. A page on a competitor's OWN site
  // is never an "opportunity you're absent from". Built from
  // the brand's competitor list + the run's own corpus redirect evidence.
  const rivalOwner = useMemo<RivalOwnerFn>(
    () => makeRivalOwner(brand.competitors, corpus),
    [brand.competitors, corpus],
  );
  // ONE opportunity-page definition (report-intel), so the verdict-strip tile
  // and the consensus card below it can never show two numbers for one idea.
  const opportunities = useMemo(
    () => opportunityPages(corpus, rivalOwner),
    [corpus, rivalOwner],
  );
  // the rivals that keep winning the answers you're absent from, and
  // the engines' stated reason why. Null when no absent answer names a rival.
  const rivalGapData = useMemo(
    () => rivalGaps(answers, corpus, brand.name, brand.aliases),
    [answers, corpus, brand.name, brand.aliases],
  );
  // jsonb mangles key order — sovEntries re-sorts by count desc
  const sov = sovEntries(scores?.share_of_voice);
  // A share-of-voice TIE is broken on the ordering the rival section uses
  // (appearances in the answers that skip you), never alphabetically, so the
  // headline and "Where rivals beat you" name the same rival.
  const rivalOrder = useMemo(
    () => (rivalGapData?.rivals ?? []).map((r) => r.name),
    [rivalGapData],
  );
  const topRivalPickValue = useMemo(
    () => topRivalPick(sov, brand.name, rivalOrder),
    [sov, brand.name, rivalOrder],
  );
  const topRivalEntry: [string, number] | undefined = topRivalPickValue
    ? [topRivalPickValue.name, topRivalPickValue.count]
    : undefined;
  const topRivalName = topRivalEntry?.[0];
  // the brand's own tally for the "Who gets mentioned most" rows + no-rivals note: its share-of-voice
  // count if the judges listed it, else computed from its own verdicts (never invented)
  const sovOwnCount =
    sov.find(([n]) => n.toLowerCase() === brand.name.toLowerCase())?.[1] ??
    answers.filter((a) =>
      ["recommended", "listed", "compared"].includes(a.verdict?.mention_type ?? ""),
    ).length;
  // The "Who gets mentioned most" rows (G1) — pure logic in report-intel: the
  // brand row is merged into the sorted list at its TRUE position, and the bar
  // scale max is computed over EVERYTHING so the brand bar can never overflow 100%.
  const sovRows = useMemo(
    () => shareOfVoiceRows(sov, brand.name, sovOwnCount),
    [sov, brand.name, sovOwnCount],
  );
  const crawlIssue = checks.find((c) => c.check_name === "site crawl" && c.status === "warn");
  // Disclaimer props — dated-methodology framing, computed from data in scope only.
  const totals = useMemo(
    () => runTotals(answers, scores?.overall?.answered),
    [answers, scores],
  );
  const disclaimerEngines = useMemo(() => {
    const seen = new Set(answers.map((a) => a.engine));
    // keep canonical order, then any unexpected engines, labelled via the map
    const ordered = [...ENGINES.filter((e) => seen.has(e)), ...[...seen].filter((e) => !ENGINES.includes(e as (typeof ENGINES)[number]))];
    return ordered.map((e) => ENGINE_LABEL[e] ?? e.charAt(0).toUpperCase() + e.slice(1));
  }, [answers]);
  // The engines ACTUALLY asked on this run (a run can be narrowed to fewer
  // engines), in canonical order — so the eyebrow/methodology never overclaims "four".
  const enginesAsked = useMemo(() => {
    const seen = new Set(answers.map((a) => a.engine));
    return ENGINES.filter((e) => seen.has(e));
  }, [answers]);
  // Model list honest to the engines asked: map the present engines to their registry
  // model ids; fall back to the passed all-four string only if the map is absent.
  const modelsShown = useMemo(() => {
    if (!engineModels) return modelsUsed;
    const ids = enginesAsked.map((e) => engineModels[e]).filter(Boolean);
    return ids.length > 0 ? ids.join(" · ") : modelsUsed;
  }, [enginesAsked, engineModels, modelsUsed]);
  const engineCountLabel = `${enginesAsked.length} AI engine${enginesAsked.length === 1 ? "" : "s"}`;
  // explicit locale: bare toLocaleDateString() differs server vs browser
  // (7/10/2026 vs 10/07/2026) and hydration-mismatches the disclaimer
  const disclaimerDate = formatDayUtc(run.finished_at ?? run.created_at);
  // qtype tab state lives here so funnel cells can drive it
  const [qtype, setQtype] = useState("all");

  // FUNNEL — qtype IS the buyer-journey stage; counts, never
  // percentages: 3–6 answers per stage would make percentages fake precision.
  const funnel = useMemo(() => {
    const STAGES = [
      { key: "category", label: "Buyers ask what to buy" },
      { key: "comparison", label: "Buyers compare options" },
      { key: "problem", label: "Buyers describe their problem" },
      { key: "branded", label: "Buyers check you out" },
    ];
    return STAGES.map((s) => {
      const rows = answers.filter((a) => a.qtype === s.key && a.ok);
      return {
        ...s,
        answered: rows.length,
        seen: rows.filter((a) => a.verdict?.brand_present).length,
        rec: rows.filter((a) => a.verdict?.mention_type === "recommended").length,
      };
    }).filter((s) => s.answered > 0);
  }, [answers]);
  const weakestStage = useMemo(() => {
    const contested = funnel.filter((s) => s.key !== "branded");
    if (contested.length === 0) return null;
    return [...contested].sort(
      (a, b) => a.rec / a.answered - b.rec / b.answered || a.seen / a.answered - b.seen / b.answered,
    )[0];
  }, [funnel]);

  // THE LEDE — deterministic editorial synthesis; sentences self-omit when
  // their data is missing; the whole block hides below 2 sentences.
  const lede = useMemo(() => {
    const out: ReactNode[] = [];
    // E3b — ALWAYS lead with the sharpest per-run stage gap (counts, no jargon,
    // correlational). Rate = rec/answered per funnel stage; the headline is the
    // weakest stage (with a real n) contrasted against the strongest.
    const rate = (s: { rec: number; answered: number }) => s.rec / s.answered;
    if (funnel.length > 0) {
      const weakest = [...funnel].sort((a, b) => rate(a) - rate(b) || b.answered - a.answered)[0];
      const strongest = [...funnel].sort((a, b) => rate(b) - rate(a) || b.answered - a.answered)[0];
      const wNoun = STAGE_NOUN[weakest.key] ?? weakest.key;
      const sNoun = STAGE_NOUN[strongest.key] ?? strongest.key;
      if (weakest.answered >= 2) {
        if (weakest.rec === 0) {
          out.push(
            strongest.key !== weakest.key && rate(strongest) >= 0.5 ? (
              <>
                You lose every {wNoun} answer: <strong>0 of {weakest.answered}</strong> recommend{" "}
                {brand.name}, yet the engines back you in {strongest.rec} of {strongest.answered}{" "}
                {sNoun} questions.
              </>
            ) : (
              <>
                You lose every {wNoun} answer: <strong>0 of {weakest.answered}</strong> recommend{" "}
                {brand.name}.
              </>
            ),
          );
        } else if (weakest.key !== strongest.key && rate(weakest) < rate(strongest)) {
          out.push(
            <>
              {brand.name} is recommended in only{" "}
              <strong>
                {weakest.rec} of {weakest.answered}
              </strong>{" "}
              {wNoun} answers, your weakest stage, against {strongest.rec} of {strongest.answered}{" "}
              {sNoun}.
            </>,
          );
        }
      }
    }
    const per = Object.entries(scores?.per_engine ?? {}).filter(([, v]) => (v?.answered ?? 0) > 0);
    if (per.length >= 2) {
      const byRec = [...per].sort(([, a], [, b]) => (b.rec_rate ?? 0) - (a.rec_rate ?? 0));
      const [bestName, best] = byRec[0];
      const [worstName, worst] = byRec[byRec.length - 1];
      if ((best.rec_rate ?? 0) > 0 && (worst.rec_rate ?? 0) === 0) {
        out.push(
          <>
            <strong>{ENGINE_LABEL[bestName] ?? bestName}</strong> recommends {brand.name} in{" "}
            {best.recommended} of {best.answered} buyer questions;{" "}
            <strong>{ENGINE_LABEL[worstName] ?? worstName}</strong> never does.
          </>,
        );
      } else if ((scores?.overall?.recommended ?? 0) === 0 && (scores?.overall?.mentioned ?? 0) > 0) {
        out.push(
          <>
            The engines know {brand.name} but never volunteer it: mentioned in{" "}
            {scores?.overall?.mentioned} answers, recommended in none.
          </>,
        );
      } else if ((scores?.overall?.recommended ?? 0) > 0) {
        out.push(
          <>
            The engines recommend {brand.name} in {scores?.overall?.recommended} of{" "}
            {scores?.overall?.answered} scored answers.
          </>,
        );
      }
    }
    if (topRivalPickValue) {
      const own =
        sov.find(([n]) => n.toLowerCase() === brand.name.toLowerCase())?.[1] ??
        answers.filter((a) =>
          ["recommended", "listed", "compared"].includes(a.verdict?.mention_type ?? ""),
        ).length;
      const { name: rivalName, count: rivalCount, tiedWith } = topRivalPickValue;
      out.push(
        rivalCount > own ? (
          tiedWith.length > 0 ? (
            // a TIE is said out loud: two rivals on 9 mentions each is not a
            // ranking, and the alphabetical winner used to contradict the
            // rival section two screens down.
            <>
              <strong>{topRivalSentence(topRivalPickValue)}</strong>, to your {own}.
            </>
          ) : (
            <>
              <strong>{rivalName}</strong> owns the share of voice: {rivalCount} mentions to your{" "}
              {own}.
            </>
          )
        ) : (
          <>
            You lead the share of voice: {own} mentions to {rivalName}&apos;s {rivalCount}.
          </>
        ),
      );
    }
    const gateFail = checks.find((c) => c.status === "fail" && c.factor === "access_blocked");
    if (gateFail) {
      out.push(
        <>
          One gate is costing you: <em>{gateFail.check_name}</em>,{" "}
          {gateFail.detail.split("—")[0].trim().toLowerCase()}
        </>,
      );
    }
    return out;
  }, [scores, funnel, topRivalPickValue, sov, checks, answers, brand.name]);

  // E3c — Source Map: per-engine source trust, aggregated from the corpus rows
  // already on the page. Pure computation (src/lib/source-map.ts, unit-tested).
  const sourceMap = useMemo(() => {
    const rates: Record<string, number | null> = {};
    for (const e of ENGINES) rates[e] = scores?.per_engine?.[e]?.mention_rate ?? null;
    return buildSourceMap(corpus, rates, ENGINES);
  }, [corpus, scores]);

  // de-templated fix plan: same-shape source pitches fold into one
  // cluster, every other fix passes through unchanged. groupFixes is memoized
  // once and shared by the top-moves cards (one per shape) and the fix plan.
  const fixGroups = useMemo(() => groupFixes(fixes), [fixes]);
  const topMoves = useMemo(() => pickTopMoves(fixGroups), [fixGroups]);

  // absent-answer count, computed the same way rivalGaps counts them, so the
  // honest positive line only shows when there are genuinely zero absences.
  const absentAnswerCount = useMemo(
    () =>
      answers.filter(
        (a) =>
          a.verdict &&
          (a.verdict.brand_present === false || a.verdict.mention_type === "absent"),
      ).length,
    [answers],
  );
  // the crawl-access story above the gates table. CheckRow.status
  // widens to string in the DB row; narrow it to the lede's union at the boundary.
  const gateChecks = useMemo(
    () =>
      checks.map((c) => ({
        check_name: c.check_name,
        status: c.status as GateCheck["status"],
        detail: c.detail,
      })),
    [checks],
  );
  const gatesStory = useMemo(
    // "just now" is false the moment the file is written and these reports are
    // read for years — the sentence carries the run date instead.
    () => gatesLede(gateChecks, brand.domain, disclaimerDate),
    [gateChecks, brand.domain, disclaimerDate],
  );
  const gateCounts = useMemo(() => gateTally(gateChecks), [gateChecks]);
  const gateNote = useMemo(() => robotsVsLiveNote(gateChecks), [gateChecks]);

  // ---- Extra reads: run-level snapshots ride along in get_dossier's
  // to_jsonb(r) (no RPC / dossier-data change). All optional — old runs read
  // null and every panel below self-hides. ----
  const health = (run as { health?: { answers?: Record<string, { got?: number; expected?: number }> | null } | null }).health ?? null;
  const brandModel = (run as { brand_model?: { value_props?: unknown; confidence?: unknown } | null }).brand_model ?? null;
  const sitePages = (run as { site_pages?: { url: string; title: string; date?: string }[] | null }).site_pages ?? null;
  // same extra-field convention as health/
  // brand_model above: `skip` is not on RunRow (out of this task's file
  // scope), so it rides along the same way and self-hides (undefined ⇒ no
  // stage was skipped) on every run that predates this feature.
  const skip = (run as { skip?: { drafts?: boolean; corpus?: boolean; gates?: boolean } | null }).skip ?? null;

  const degraded = useMemo(() => degradedEngines(health), [health]);
  const degradedSet = useMemo(() => new Set(degraded.map((d) => d.engine)), [degraded]);
  const valueProps = useMemo(() => {
    const vp = brandModel?.value_props;
    return Array.isArray(vp) ? vp.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  }, [brandModel]);
  const brandModelLow = brandModel?.confidence === "low";
  const overallBand = useMemo(
    () => bandDescriptor(scores?.recommended_band?.overall ?? null),
    [scores],
  );

  // fast qid|engine → AnswerRow lookup so mined receipts open via the existing drawer
  const answerByRef = useMemo(() => {
    const m = new Map<string, AnswerRow>();
    for (const a of answers) m.set(`${a.qid}|${a.engine}`, a);
    return m;
  }, [answers]);
  const resolveRef = (r: AnswerRef) => answerByRef.get(`${r.qid}|${r.engine}`);

  const steers = useMemo(
    () => sendElsewhere(answers, brand.name, brand.aliases),
    [answers, brand.name, brand.aliases],
  );
  const pricing = useMemo(() => mergedPricingClaims(answers), [answers]);
  const confusion = useMemo(() => entityConfusion(answers), [answers]);
  const coverage = useMemo(
    () => ownSiteCoverage(sitePages, corpus, answers, brand.domain),
    [sitePages, corpus, answers, brand.domain],
  );

  return (
    // overflow-x-clip: no card, table or tab strip inside the report may widen
    // the document. A 474px tab strip used to drag the whole page sideways on
    // a 390px phone (body scrollWidth 490); the individual scroll containers
    // are the fix, this is the guarantee.
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-12 overflow-x-clip pb-24 print:gap-6"
      id="dossier"
    >
      {/* The section index and the print control belong to every READER: a
          shared /share/<token> report used to ship with no way to jump between
          sections and no way to save a PDF. Only the owner controls (back to
          the app, sharing, the CSV/JSON exports) stay owner-only. */}
      <DossierNav />
      <div className="-mb-8 flex items-center justify-between gap-3 print:hidden">
        {!demo ? (
          <a href="/app" className="text-xs text-wire underline">
            ← Brands &amp; runs
          </a>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {!demo && (
            <>
              <ShareControls runId={run.id} initialToken={shareToken} />
              <a
                href={`/api/runs/${run.id}/export?format=csv`}
                className="font-mono text-xs text-wire underline hover:text-ink"
              >
                CSV
              </a>
              <a
                href={`/api/runs/${run.id}/export?format=json`}
                className="font-mono text-xs text-wire underline hover:text-ink"
              >
                JSON
              </a>
            </>
          )}
          <PrintButton />
        </div>
      </div>
      {/* print-only running footer — styled by globals.css .saylent-print-footer */}
      <div className="saylent-print-footer hidden" suppressHydrationWarning>
        {brand.name} ·{" "}
        {formatDayUtc(run.finished_at ?? run.created_at)}{" "}
        · every number opens its receipt in the live report
      </div>
      {/* EYEBROW — the page's real <h1> (semantic heading; visual treatment unchanged) */}
      <h1 className="font-mono text-xs uppercase tracking-wider text-wire" suppressHydrationWarning>
        SAYLENT · REPORT ·{" "}
        {formatDayUtc(run.finished_at ?? run.created_at)} · SNAPSHOT (single
        run)
        {previous && (
          <span className="normal-case">
            {" "}
            · previous audit {previous.date}: {previous.pct}% recommended
          </span>
        )}
        {run.profile === "smoke" && (
          <Badge variant="outline" className="ml-2 border-wire text-wire">
            smoke profile · 6 questions
          </Badge>
        )}
        {modelsShown && (
          <span className="mt-1 block normal-case tracking-normal">models: {modelsShown}</span>
        )}
      </h1>

      {/* DISCLAIMER — dated-methodology framing (rigor, not apology). Public =
          bordered box for /demo + /share; owner = one muted mono line. Not print-hidden. */}
      <ReportDisclaimer
        variant={demo ? "public" : "owner"}
        engines={disclaimerEngines}
        models={modelsShown}
        dateRange={disclaimerDate}
        totals={totals}
      />

      {/* Top-of-report honesty: how engines could describe you
          (value_props from runs.brand_model) + degraded-engine caveat (runs.health).
          Both self-hide when their data is absent (old runs). */}
      {(valueProps.length > 0 || degraded.length > 0) && (
        <div className="-mb-4 flex flex-col gap-2">
          {valueProps.length > 0 && (
            <p className="font-mono text-xs text-wire">
              How engines could describe you:{" "}
              <span className="normal-case text-ink/70">
                {valueProps.slice(0, 5).map((v) => stripMarkdownForPreview(v)).join(" · ")}
                {valueProps.length > 5 && ` · +${valueProps.length - 5} more`}
              </span>
            </p>
          )}
          {degraded.map((d) => (
            <p
              key={d.engine}
              className="rounded border border-signal/40 bg-signal/5 px-4 py-2 text-sm text-ink/80"
            >
              <span className="font-medium">{ENGINE_LABEL[d.engine] ?? d.engine}</span> answered{" "}
              {d.got} of {d.expected} this run. Treat its column as low-confidence.
            </p>
          ))}
        </div>
      )}

      {/* THE LEDE — editorial synthesis; a CEO should be able to read only this */}
      {lede.length >= 2 && (
        <p className="-mb-4 max-w-4xl font-display text-xl leading-relaxed">
          {lede.map((s, i) => (
            <span key={i}>{s} </span>
          ))}
        </p>
      )}

      {/* VERDICT STRIP */}
      <section className="grid grid-cols-2 gap-6 rounded-lg border border-line bg-card p-6 sm:grid-cols-4">
        <Stat
          value={`${recPct}%`}
          label="Recommended"
          sub="when buyers ask WITHOUT naming you (category & problem questions)"
        />
        <Stat
          value={`${menPct}%`}
          label="Mentioned"
          sub="the gap between these two is your opportunity"
        />
        {/* The tile is dropped at zero rather than sitting dead in the best
            real estate on the page; the one-line note below says why. */}
        {opportunities.length > 0 && (
          <Stat
            value={String(opportunities.length)}
            label="Opportunity pages"
            sub={`pages 2+ engines cite that you're absent from (listed in 01)`}
          />
        )}
        <Stat
          value={topRivalName ?? "none yet"}
          label="Top rival"
          sub={
            topRivalName
              ? topRivalPickValue && topRivalPickValue.tiedWith.length > 0
                ? `tied with ${topRivalPickValue.tiedWith.join(", ")} on ${topRivalPickValue.count} mentions`
                : `named ${topRivalPickValue?.count} times in these answers`
              : "no rival dominates these answers yet"
          }
          small
        />
      </section>
      {opportunities.length === 0 && corpus.length > 0 && (
        <p className="-mt-6 text-xs text-wire">
          No opportunity pages: on every cited page we could verify, you are either already
          present or the page is a rival&apos;s own site, which is not a listing you can win.
        </p>
      )}

      {/* Confidence band (adaptive-sampling variance) + brand-model honesty,
          right under the headline number. Each self-hides when its data is absent. */}
      {(overallBand.kind !== "none" || (!demo && brandModelLow)) && (
        <div className="-mt-6 flex flex-col gap-3">
          {overallBand.kind !== "none" && (
            <ConfidenceBand
              overall={overallBand}
              perEngine={scores?.recommended_band?.per_engine}
              answeredScored={answeredScored}
              perEngineAnswered={Object.fromEntries(
                enginesAsked.map((e) => [e, scores?.per_engine?.[e]?.answered ?? 0]),
              )}
              engines={enginesAsked}
              degraded={degradedSet}
            />
          )}
          {!demo && brandModelLow && (
            <p className="rounded border border-signal/40 bg-signal/5 px-4 py-2 text-sm text-ink/80">
              We modeled your brand from a thin crawl:{" "}
              <a href="/app/settings" className="underline hover:text-signal">
                refine your ICP in Settings
              </a>{" "}
              to sharpen future audits.
            </p>
          )}
        </div>
      )}

      {/* FUNNEL STRIP — WHERE in the buyer journey you win or lose (qtype = stage) */}
      {funnel.length >= 2 && (
        <div className="-mt-6 rounded-lg border border-line bg-card p-6">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {funnel.map((s) => (
              <button
                key={s.key}
                onClick={() => {
                  setQtype(s.key);
                  document.getElementById("verdicts")?.scrollIntoView({ behavior: "smooth" });
                }}
                className={`cursor-pointer rounded p-2 text-left transition-colors hover:bg-paper ${
                  weakestStage?.key === s.key ? "border-l-2 border-signal pl-3" : ""
                }`}
              >
                <div className="text-xs text-wire">{s.label}</div>
                <div className="mt-1 font-mono text-sm tabular-nums">
                  <span className={s.rec > 0 ? "text-success" : "text-wire"}>recommended {s.rec}</span>
                  {" · "}
                  appears in {s.seen} of {s.answered}
                </div>
              </button>
            ))}
          </div>
          {weakestStage && weakestStage.rec === 0 && (
            <p className="mt-3 text-xs text-wire">
              Your gap is <span className="text-signal">{weakestStage.label.toLowerCase()}</span>
              . The engines {weakestStage.seen > 0 ? "know you but don't volunteer you" : "don't surface you at all"} there.
              Click a stage to read those answers.
            </p>
          )}
        </div>
      )}

      {/* CRAWL HONESTY — surface a blocked crawl at the top, not just in the gates table */}
      {crawlIssue && (
        <p className="-mt-6 rounded border border-signal/40 bg-signal/5 px-4 py-2 text-sm text-ink/80">
          <span className="font-medium">Heads up:</span> {crawlIssue.detail}
        </p>
      )}

      {/* WEAK-FIRST-AUDIT SAFETY NET — empathetic, honest framing when the result
          is rough. No false comfort, no invented stats: the numbers are the same
          stored tally the verdict strip shows, and it points at the top-weighted
          fix. Owner view only (the /demo showcase keeps its own framing). */}
      {!demo && weakAudit && (
        <div className="rounded-lg border border-signal/40 bg-signal/5 p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-signal">
            A rough first read, that&apos;s the point
          </p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink/90">
            The engines recommend {brand.name} in{" "}
            <strong>
              {recCount} of {answeredScored}
            </strong>{" "}
            scored answers today. That&apos;s your baseline, not your verdict. Most first
            audits start here. Everything below is the plan to move it
            {topMoves.length > 0 ? (
              <>
                , starting with{" "}
                <a className="underline hover:text-signal" href={`#fix-${topMoves[0].fixes[0].fix_key}`}>
                  {topMoves[0].title}
                </a>
              </>
            ) : null}
            . When you&apos;ve shipped, a verify run re-asks these exact questions and
            measures what actually moved.
          </p>
        </div>
      )}

      {/* YOUR 3 MOVES — the top fixes by evidence weight, as compact cards that
          jump to the full plan (E3b, replaces the single "Start here" card) */}
      {topMoves.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-signal">
            What we found · your {topMoves.length === 1 ? "first move" : `${topMoves.length} moves`}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {topMoves.map((g, i) => (
              <a
                key={g.shape}
                href={`#fix-${g.fixes[0].fix_key}`}
                className="flex flex-col gap-2 rounded-lg border border-line bg-card p-4 transition-colors hover:border-signal hover:bg-signal/5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-wire">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Badge variant="outline" className="border-line font-mono tabular-nums">
                    #{i + 1} by evidence
                  </Badge>
                </div>
                <span className="font-display text-base leading-snug">{g.title}</span>
                <span className="mt-auto inline-flex items-center gap-1 text-xs text-signal underline">
                  See the fix <ArrowDown aria-hidden className="size-3" />
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* SOURCE MAP — where each engine sources its answers (E3c, intro block,
          not a numbered section — sits between the moves and 01 Battlefield) */}
      <Reveal>
        <SourceMapPanel map={sourceMap} />
      </Reveal>

      {/* 01 BATTLEFIELD MAP */}
      <Reveal>
        <Battlefield
          corpus={corpus}
          onOpen={setPageOpen}
          openPageId={pageOpen?.id ?? null}
          brandName={brand.name}
          brandAliases={brand.aliases}
          rivalOwner={rivalOwner}
          corpusSkipped={!!skip?.corpus}
        />
      </Reveal>

      {/* LOSS MAP — the single page beating you on each question you never win
          (intel block, between the battlefield and the verdicts) */}
      <Reveal>
        <LossMap answers={answers} corpus={corpus} rivalOwner={rivalOwner} onOpenPage={setPageOpen} />
      </Reveal>

      {/* ENTITY CLARITY leads the verdicts when it applies: the praise and the
          pricing below are partly quotes about a DIFFERENT company sharing the
          name, and a reader has to know that BEFORE reading them, not two
          screens later. */}
      {/* Entity confusion callout (pairs with entity_unclear fix) */}
      {confusion.length > 0 && (
        <Reveal>
          <EntityConfusionCallout
            data={confusion}
            brandName={brand.name}
            resolve={resolveRef}
            onOpen={openAnswer}
            openAnswerId={answerOpen?.id ?? null}
          />
        </Reveal>
      )}

      {/* 02 QUESTION VERDICTS (+ perception panel — how they frame you) */}
      <Reveal>
      <QuestionVerdicts
        answers={answers}
        onOpen={openAnswer}
        openAnswerId={answerOpen?.id ?? null}
        qtype={qtype}
        setQtype={setQtype}
        brandName={brand.name}
        brandAliases={brand.aliases}
        confusedCount={confusion.reduce((n, c) => n + c.count, 0)}
      />
      </Reveal>

      {/* "What the engines say you cost" (self-hides when none) */}
      {pricing.length > 0 && (
        <Reveal>
          <PricingStrip
            claims={pricing}
            resolve={resolveRef}
            onOpen={openAnswer}
            openAnswerId={answerOpen?.id ?? null}
            brandName={brand.name}
          />
        </Reveal>
      )}

      {/* 03 SHARE OF VOICE */}
      <Reveal>
      <section id="voice">
        <SectionTitle n="03" title="Who gets mentioned most" />
        <p className="mb-3 text-sm text-wire">
          Counted over every answer this run collected, scored or not: an answer counts when it lists,
          compares or recommends the name. The summary&apos;s &ldquo;of {scores?.overall?.answered ?? "9"}&rdquo; counts scored answers only.
        </p>
        {topRivalEntry ? (
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
          <thead className="sr-only">
            <tr>
              <th scope="col">Brand or competitor</th>
              <th scope="col">Share of mentions</th>
              <th scope="col">Mentions</th>
            </tr>
          </thead>
          <tbody>
            {sovRows.rows.map(({ name, count, isBrand }) => (
              <tr
                key={name}
                className={`border-b border-line ${isBrand ? "bg-signal/10 font-medium" : ""}`}
              >
                <td className="w-48 py-2 pr-3">
                  {name}
                  {isBrand && count === 0 && (
                    <span className="font-normal text-wire">
                      {" "}
                      (the engines never listed you among the options)
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <div
                    className={`h-1.5 rounded-full ${isBrand ? "bg-signal" : "bg-wire"}`}
                    style={{
                      width: `${Math.min(100, Math.max(3, Math.round((count / sovRows.scaleMax) * 100)))}%`,
                    }}
                  />
                </td>
                <td className="w-14 py-2 text-right font-mono tabular-nums">{count}</td>
              </tr>
            ))}
            {sovRows.singles > 0 && (
              <tr className="border-b border-line text-wire">
                <td className="py-2" colSpan={2}>+{sovRows.singles} more mentioned once each</td>
                <td className="py-2 text-right font-mono tabular-nums">1×</td>
              </tr>
            )}
          </tbody>
        </table></div>
        ) : (
          // no rival was named in these answers — nothing to compare yet. Honest
          // designed note (not a lonely brand bar); keep the brand's own count
          // only when it carries information.
          <p className="text-sm text-wire">
            The engines didn&apos;t name any rival in these answers. There&apos;s nothing
            to compare yet.{" "}
            {sovOwnCount > 0
              ? `They listed ${brand.name} ${sovOwnCount} time${sovOwnCount > 1 ? "s" : ""}, but against no one.`
              : `They didn't list ${brand.name} among the options either. That absence is the finding.`}
          </p>
        )}
        {/* in the answers that skip you, which rivals win, and why.
            Renders only with data; the positive line only when zero absences. */}
        {rivalGapData ? (
          <RivalGapsPanel
            data={rivalGapData}
            answers={answers}
            onAnswerOpen={openAnswer}
            onPageOpen={setPageOpen}
            openAnswerId={answerOpen?.id ?? null}
            openPageId={pageOpen?.id ?? null}
          />
        ) : absentAnswerCount === 0 ? (
          <p className="mt-6 text-sm text-wire">
            You appear in every scored answer. No rival owns your absences.
          </p>
        ) : null}
      </section>

      </Reveal>

      {/* "Who the engines send elsewhere — and why". Absent
          entirely on old runs (no segments field); honest empty state otherwise. */}
      {steers && (
        <Reveal>
          <SendElsewherePanel
            data={steers}
            resolve={resolveRef}
            onOpen={openAnswer}
            openAnswerId={answerOpen?.id ?? null}
          />
        </Reveal>
      )}

      {/* 04 DOMAIN GATES */}
      <Reveal>
      <section id="gates">
        <SectionTitle n="04" title="Can the AI crawlers read your site?" />
        {/* the crawl→citation story leads the gates table. It composes
            around the stored check detail verbatim; null when there are no checks. */}
        {gatesStory && (
          <div className="mb-4">
            <h3 className="font-display text-lg font-semibold">{gatesStory.headline}</h3>
            <p className="mt-1 text-sm text-wire">{gatesStory.story}</p>
          </div>
        )}
        {checks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-wire">
            {skip?.gates
              ? "Gate checks were skipped by request. Nothing here is a pass or a fail; it simply wasn't run."
              : "No domain gates were checked on this run, usually because the site crawl couldn't run. Nothing here is a pass or a fail; it simply wasn't tested."}
          </p>
        ) : (
          <>
            {/* 23 rows of equal weight hid the three that matter. The tally
                leads, the passes fold away (open in print), and the one pair a
                reader WILL notice as a contradiction gets its sentence. */}
            <p className="mb-3 font-mono text-sm tabular-nums">
              <span className={gateCounts.fail > 0 ? "text-pill-dismissed" : "text-success"}>
                {gateCounts.line}
              </span>{" "}
              <span className="text-wire">of {gateCounts.total} checks</span>
            </p>
            {gateNote && <p className="mb-3 max-w-3xl text-sm text-ink/80">{gateNote}</p>}
            <GateTable rows={checks.filter((c) => c.status !== "pass")} />
            {gateCounts.pass > 0 && (
              <details className="mt-2" open={gateCounts.fail + gateCounts.warn + gateCounts.info === 0}>
                <summary className="cursor-pointer text-sm text-wire underline">
                  {gateCounts.pass} checks passed
                </summary>
                <div className="mt-2">
                  <GateTable rows={checks.filter((c) => c.status === "pass")} />
                </div>
              </details>
            )}
          </>
        )}
      </section>

      </Reveal>

      {/* "Your site vs the buyer questions". Anchored on
          runs.site_pages; absent on old runs (no snapshot). */}
      {coverage && (
        <Reveal>
          <OwnSiteCoveragePanel data={coverage} />
        </Reveal>
      )}

      {/* 05 FIX PLAN */}
      <Reveal>
        <FixPlan
          fixes={fixes}
          groups={fixGroups}
          runId={run.id}
          demo={demo}
          crawlBlocked={!!crawlIssue}
          draftsSkipped={!!skip?.drafts}
          domain={brand.domain}
        />
      </Reveal>

      {/* 06 METHODOLOGY & HONESTY */}
      <Reveal>
      <section id="method" className="rounded-lg border border-line bg-card p-6 text-sm">
        <SectionTitle n="06" title="Methodology & honesty" />
        <p className="mt-2">
          <strong>What this is:</strong> the answers {engineCountLabel} gave to your buyers&apos;
          questions, the pages those answers were built from, and what we found on each. This
          run: <span className="tabular-nums">{totalsLine(totals)}</span>. Every number above
          opens its stored receipt.
        </p>
        {failuresLine(totals) && <p className="mt-2 text-wire">{failuresLine(totals)}</p>}
        <p className="mt-2 text-wire">
          <strong className="text-ink">The two labels in the header:</strong> the{" "}
          <em>profile</em> is the question set (smoke is the short sample set, full is the
          complete one), and the <em>judge</em> is who scored the
          answers (cross-family means every answer was judged by a model from a different
          provider family, which lowers self-preference bias; single-family means one provider
          served every role).
        </p>
        <p className="mt-2">
          <strong>What this is not:</strong> a guarantee, a ranking factor list, or a delta.
          One run is a snapshot. We label it. Movement is measured set-vs-set on the same
          frozen questions, and if nothing moved yet, we say so.
        </p>
        <p className="mt-2 text-wire">
          What we won&apos;t do: scrape AI apps against their terms, invent &quot;AI search
          volume&quot;, sell you an llms.txt file, or show a before/after gap that&apos;s really just luck.{" "}
          {methodologyUrl && (
            <a href={methodologyUrl} className="underline">
              Full methodology →
            </a>
          )}
        </p>
        {brand.authorized_at && (
          <p className="mt-3 font-mono text-[11px] text-wire">
            Prepared with the requester&apos;s authorization.
          </p>
        )}
      </section>
      </Reveal>

      {/* THE CLOSING BLOCK — the document used to end mid-sentence on what we
          won't do, with no link to the project and no way to run it. */}
      {demo && <ReportOutro />}

      {/* NEXT MOVE — close the loop (one next move) */}
      {!demo && fixes.length > 0 && (
        <section className="rounded-lg border border-line bg-card p-6 text-sm">
          <p className="font-mono text-xs uppercase tracking-widest text-wire">Your next move</p>
          <p className="mt-2">
            Ship fix <strong>01</strong>, press <em>Mark as shipped</em> on it, and run a verify
            when it unlocks. That&apos;s how movement gets measured, honestly, on the same
            questions.
          </p>
        </section>
      )}

      {/* drawers */}
      <AnswerDrawer
        answer={answerOpen}
        engineModels={engineModels}
        brand={brand}
        onClose={() => setAnswerOpen(null)}
      />
      <PageDrawer page={pageOpen} brand={brand} rivalOwner={rivalOwner} onClose={() => setPageOpen(null)} />
    </div>
  );
}

/* ---------- pieces ---------- */

/* Share controls — the client-deliverable feature: enable copies the public
 * read-only link; revoke kills it. Owner view only (hidden in demo + print). */
function ShareControls({ runId, initialToken }: { runId: string; initialToken: string | null }) {
  const [token, setToken] = useState(initialToken);
  const [state, setState] = useState<"idle" | "busy" | "copied">("idle");
  const shareUrl = (t: string) => `${window.location.origin}/share/${t}`;

  async function call(action: "enable" | "revoke") {
    setState("busy");
    const res = await fetch(`/api/runs/${runId}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const d = (await res.json().catch(() => ({}))) as { shareToken?: string | null };
    if (!res.ok) return setState("idle");
    setToken(d.shareToken ?? null);
    if (action === "enable" && d.shareToken) {
      await navigator.clipboard.writeText(shareUrl(d.shareToken)).catch(() => {});
      setState("copied");
      setTimeout(() => setState("idle"), 2500);
    } else {
      setState("idle");
    }
  }

  return token ? (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={state === "busy"}
        onClick={async () => {
          await navigator.clipboard.writeText(shareUrl(token)).catch(() => {});
          setState("copied");
          setTimeout(() => setState("idle"), 2500);
        }}
      >
        {state === "copied" ? "Link copied ✓" : "Copy share link"}
      </Button>
      <button
        className="cursor-pointer text-xs text-wire underline"
        disabled={state === "busy"}
        onClick={() => call("revoke")}
      >
        revoke
      </button>
    </span>
  ) : (
    <Button variant="outline" size="sm" disabled={state === "busy"} onClick={() => call("enable")}>
      {state === "busy" ? "Creating…" : "Share report"}
    </Button>
  );
}

function Stat({
  value,
  label,
  sub,
  small,
}: {
  value: string;
  label: string;
  sub?: string;
  small?: boolean;
}) {
  return (
    <div>
      <div className={`font-display tabular-nums ${small ? "text-2xl leading-[2.75rem]" : "text-4xl"}`}>
        <CountUp value={value} />
      </div>
      <div className="text-xs uppercase tracking-wide text-wire">{label}</div>
      {sub && <div className="mt-1 text-[11px] text-wire">{sub}</div>}
    </div>
  );
}

/* Sticky mini-TOC with scroll-spy (owner view only, 2xl+) — the device every
 * exemplar digital report shares; hidden in print and below 2xl. The left origin
 * is offset by half the app-shell sidebar (w-52) so it sits in the gutter of the
 * content column, never over the sidebar nav. */
const TOC = [
  ["battlefield", "01 Battlefield"],
  ["verdicts", "02 Verdicts"],
  ["voice", "03 Voice"],
  ["gates", "04 Gates"],
  ["fix-plan", "05 Fixes"],
  ["method", "06 Method"],
] as const;

function DossierNav() {
  const [active, setActive] = useState<string>("battlefield");
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const [id] of TOC) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return (
    <nav className="fixed left-[max(1rem,calc(50%-41rem))] top-32 hidden print:hidden 2xl:block">
      <ul className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-wider">
        {TOC.map(([id, label]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className={`transition-colors ${active === id ? "text-signal" : "text-wire hover:text-ink"}`}
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function subscribePrintControl() {
  // the masthead's own print control (if any) is static after mount — nothing
  // to subscribe to, the snapshot read below is what matters.
  return () => {};
}
function hasExternalPrintControl(): boolean {
  return !!document.querySelector("[data-report-print]");
}

/** Print / save as PDF. Hidden only where the document already carries its own
 *  print control (the delivered report.html masthead). SSR-safe external-store
 *  read, mirrors brief.tsx's useIsDesktop: server snapshot is false (every
 *  reader gets the button by default), the client reads the real DOM after
 *  commit. No setState-in-effect, no hydration mismatch. */
function PrintButton() {
  const duplicate = useSyncExternalStore(subscribePrintControl, hasExternalPrintControl, () => false);
  if (duplicate) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      Print / save as PDF
    </Button>
  );
}

function SectionTitle({ n, title }: { n: string; title: string }) {
  return (
    <h2 className="mb-3 font-mono text-xs uppercase tracking-widest text-wire">
      <span className="text-signal">{n}</span> · {title}
    </h2>
  );
}

/* Source Map (E3c) — where each engine sources its answers. Editorial panel:
 * one row per engine (name · top hosts · plain-English trust profile) + one
 * computed divergence line. All numbers are citation counts from this run. */
function SourceMapPanel({ map }: { map: ReturnType<typeof buildSourceMap> }) {
  return (
    <section id="source-map" className="rounded-lg border border-line bg-card p-6">
      {/* h2: top-level panel before the battlefield map — keeps the h1→h2→h3 hierarchy legal (visual unchanged) */}
      <h2 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">
        Where each engine gets its answers
      </h2>
      <p className="mb-4 max-w-2xl text-xs text-wire">
        Each engine builds its answers from a different corner of the web. The counts are
        citations on this run. The sources you have to win are the ones the engines already
        trust.
      </p>
      {map.engines.length === 0 ? (
        <p className="text-sm text-wire">No cited pages captured on this run.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line">
          {map.engines.map((e) => (
            <div key={e.engine} className="grid gap-2 py-3 sm:grid-cols-[7rem_1fr] sm:gap-6">
              <div>
                <div className="font-display text-lg">{ENGINE_LABEL[e.engine] ?? e.engine}</div>
                <div className="font-mono text-[10px] text-wire tabular-nums">
                  {e.citations} citation{e.citations === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {e.topHosts.length === 0 ? (
                    <span className="text-sm text-wire">—</span>
                  ) : (
                    e.topHosts.map((h) => (
                      <span key={h.host} className="flex items-center gap-1.5 text-sm">
                        <Favicon host={h.host} />
                        <span>{h.host}</span>
                        <span className="font-mono text-[10px] text-wire tabular-nums">×{h.count}</span>
                      </span>
                    ))
                  )}
                </div>
                <p className="text-sm text-wire">{e.trustLine}.</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {map.channelMix && (
        // one sentence, composed and classified in buildSourceMap (tested there);
        // the "present but not named" finding gets the ink weight to draw the eye
        <p
          className={`mt-4 text-sm ${
            map.channelMix.appearance === "present_not_named" ? "text-ink" : "text-wire"
          }`}
        >
          {map.channelMix.sentence}
        </p>
      )}
      {map.synthesis && (
        <p className="mt-4 border-l-2 border-signal pl-3 text-sm">
          <span className="font-medium text-signal">The divergence that matters: </span>
          {map.synthesis}
        </p>
      )}
    </section>
  );
}

/* "Where rivals beat you": over the answers the brand is absent
 * from, the rivals the engines named instead, the reasons they gave, and the
 * cited pages those rivals sit on. Every rival is one tap from its receipt
 * (AnswerDrawer via refs[0]); every page chip opens the PageDrawer. Editorial:
 * serif rival names, mono counts, quiet quoted whys — no gauges, no percentages.
 * Renders inside the "Who gets mentioned most" section; the caller gates rendering on non-null data. */
function RivalGapsPanel({
  data,
  answers,
  onAnswerOpen,
  onPageOpen,
  openAnswerId,
  openPageId,
}: {
  data: RivalGaps<CorpusRow>;
  answers: AnswerRow[];
  onAnswerOpen: (a: AnswerRow) => void;
  onPageOpen: (p: CorpusRow) => void;
  openAnswerId?: string | null;
  openPageId?: string | null;
}) {
  return (
    <div className="mt-6">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">
        Where rivals beat you
      </h3>
      <p className="mb-4 max-w-2xl text-sm text-wire">
        In the {data.totalAbsentAnswers}{" "}
        answers that skip you, these rivals keep appearing
        {data.rivals.some((r) => r.whys.length > 0)
          ? ", and here's the engines' stated reason why."
          : "."}
      </p>
      <div className="flex flex-col divide-y divide-line">
        {data.rivals.map((r) => {
          const ref = r.refs[0];
          const answer = ref
            ? answers.find((a) => a.qid === ref.qid && a.engine === ref.engine)
            : undefined;
          return (
            <div key={r.name} className="py-3">
              <button
                type="button"
                onClick={() => answer && onAnswerOpen(answer)}
                disabled={!answer}
                aria-haspopup="dialog"
                aria-expanded={!!answer && openAnswerId === answer.id}
                aria-label={answer ? `Read the answer where ${r.name} appears instead of you` : undefined}
                className="flex min-h-[40px] w-full items-baseline justify-between gap-3 text-left enabled:cursor-pointer enabled:hover:text-signal disabled:cursor-default pointer-coarse:min-h-11"
              >
                <span className="font-display text-lg">{r.name}</span>
                <span className="shrink-0 font-mono text-xs text-wire tabular-nums">
                  in {r.count} of those answers
                </span>
              </button>
              {r.whys.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {r.whys.map((w, i) => (
                    <li key={i} className="text-sm italic text-ink/70">
                      &ldquo;{stripMarkdownForPreview(w.text)}&rdquo;{" "}
                      <span className="font-mono text-[10px] not-italic text-wire tabular-nums">×{w.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              {r.pages.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.pages.map(({ page, citations }) => {
                    const host = hostOf(page.final_url ?? page.url);
                    return (
                      <button
                        key={page.url}
                        type="button"
                        onClick={() => onPageOpen(page)}
                        aria-haspopup="dialog"
                        aria-expanded={openPageId === page.id}
                        aria-label={`Open page details for ${host}`}
                        className="flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded border border-line px-2 py-1 text-xs transition-colors hover:border-signal pointer-coarse:min-h-11"
                      >
                        <Favicon host={host} />
                        <span>{host}</span>
                        <span className="font-mono text-[10px] text-wire tabular-nums">×{citations}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* The adaptive-sampling confidence band, under the headline. A
 * real range (min≠max) shows the variance we measured; a stable point shows the
 * number didn't move. Per-engine chips flag any degraded engine (Item 4). */
function ConfidenceBand({
  overall,
  perEngine,
  answeredScored,
  perEngineAnswered,
  engines,
  degraded,
}: {
  overall: BandDescriptor;
  perEngine?: Record<string, BandLike>;
  answeredScored: number;
  perEngineAnswered: Record<string, number>;
  engines: readonly string[];
  degraded: Set<string>;
}) {
  if (overall.kind === "none") return null;
  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <p className="text-sm">
        {overall.kind === "range" ? (
          <>
            <span className="font-medium tabular-nums">
              Recommended in {overall.min}–{overall.max} of {answeredScored}
            </span>{" "}
            scored answers.{" "}
            <span className="text-wire">
              We ask every scored question at least twice (and a third time whenever the answers
              disagree); the range is how much the answers moved between draws.
            </span>
          </>
        ) : (
          <>
            <span className="font-medium tabular-nums">
              Recommended in {overall.min} of {answeredScored}
            </span>{" "}
            scored answers.{" "}
            <span className="text-wire">Stable across samples. The number didn&apos;t move when we re-asked.</span>
          </>
        )}
      </p>
      {engines.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {engines.map((e) => {
            const b = bandDescriptor(perEngine?.[e] ?? null);
            if (b.kind === "none") return null;
            const isDeg = degraded.has(e);
            return (
              <span
                key={e}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] ${
                  isDeg ? "border-signal/50 text-signal" : "border-line text-wire"
                }`}
              >
                <span className="text-ink">{ENGINE_LABEL[e] ?? e}</span>
                <span className="tabular-nums">
                  {b.kind === "range" ? `${b.min}–${b.max}` : `${b.min}`} / {perEngineAnswered[e] ?? 0}
                </span>
                {isDeg && <span className="uppercase tracking-wide">low-confidence</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* "Who the engines send elsewhere — and why": conditional
 * steers aggregated from verdict.segments, grouped by the rival winner, each with
 * the stated reason and a receipt. The audited brand's own winning segments get
 * one honest lead line. */
function SendElsewherePanel({
  data,
  resolve,
  onOpen,
  openAnswerId,
}: {
  data: SendElsewhere;
  resolve: (r: AnswerRef) => AnswerRow | undefined;
  onOpen: (a: AnswerRow) => void;
  openAnswerId?: string | null;
}) {
  return (
    <section>
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">
        Who the engines send elsewhere, and why
      </h3>
      {data.ownSegments.length > 0 && (
        <p className="mb-3 text-sm">
          <span className="font-medium text-ink">Engines make you the default for: </span>
          {data.ownSegments.slice(0, 6).map((s, i) => (
            <span key={s.phrase}>
              {i > 0 ? ", " : ""}
              {s.phrase}
              {s.count > 1 && (
                <span className="font-mono text-[10px] text-wire tabular-nums"> ×{s.count}</span>
              )}
            </span>
          ))}
          {data.ownSegments.length > 6 && (
            <span className="text-wire"> +{data.ownSegments.length - 6} more</span>
          )}
          .
        </p>
      )}
      {data.steers.length === 0 && data.singleSteerRivals === 0 ? (
        <p className="text-sm text-wire">
          No conditional steers recorded this run. The engines didn&apos;t route any buyer segment
          to a specific rival.
        </p>
      ) : (
        <>
          {data.steers.length > 0 && (
          <>
          <p className="mb-4 max-w-2xl text-sm text-wire">
            When a buyer fits a specific profile, the engines steer them to a rival. Here&apos;s the
            segment, the rival, and the engines&apos; stated reason.
          </p>
          <div className="flex flex-col divide-y divide-line">
            {data.steers.map((s) => (
              <div key={s.winner} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-display text-lg">{s.winner}</span>
                  <span className="shrink-0 font-mono text-xs text-wire tabular-nums">
                    steered {s.count} segment{s.count === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="mt-1 flex flex-col gap-1">
                  {s.items.slice(0, 6).map((it, i) => {
                    const a = resolve({ qid: it.qid, engine: it.engine });
                    return (
                      <li key={i} className="text-sm">
                        <span className="text-ink">{stripMarkdownForPreview(it.segment)}</span>
                        {it.reason && (
                          <span className="text-wire">: &ldquo;{stripMarkdownForPreview(it.reason)}&rdquo;</span>
                        )}{" "}
                        {a && (
                          <button
                            onClick={() => onOpen(a)}
                            aria-haspopup="dialog"
                            aria-expanded={openAnswerId === a.id}
                            aria-label={`Read the answer steering ${it.segment} to ${s.winner}`}
                            className="cursor-pointer font-mono text-[10px] text-signal underline"
                          >
                            [{it.qid}·{ENGINE_LABEL[it.engine] ?? it.engine}]
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {s.items.length > 6 && (
                    <li className="text-xs text-wire">
                      +{s.items.length - 6} more segment{s.items.length - 6 === 1 ? "" : "s"}: see the stored answers.
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
          </>
          )}
          {/* Every rival steered just ONE segment collapses here, so a
              DOMINANT run's ~25 one-off winner blocks don't drown the real steers. */}
          {data.singleSteerRivals > 0 && (
            <p className="mt-3 text-sm text-wire">
              +{data.singleSteerRivals} more rival{data.singleSteerRivals === 1 ? " was" : "s were"} steered a
              single segment each: see the stored answers.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* "What the engines say you cost": deduped pricing claims with
 * engine chips + a receipt on the claim text. Header invites verification. */
/** The inline "this is about someone else" mark. A claim whose every source
 *  answer was flagged entity-confused is a quote about a DIFFERENT company that
 *  shares the name; it used to sit unmarked under "What they praise" and "What
 *  the engines say you cost". */
function ConfusedBadge({ brandName }: { brandName: string }) {
  return (
    <span
      className="ml-2 inline-block rounded bg-signal/15 px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase leading-tight text-signal"
      title="The judge flagged this answer as being about a different company that shares your name."
    >
      different {brandName}
    </span>
  );
}

function PricingStrip({
  claims,
  resolve,
  onOpen,
  openAnswerId,
  brandName,
}: {
  claims: MergedPricingClaim[];
  resolve: (r: AnswerRef) => AnswerRow | undefined;
  onOpen: (a: AnswerRow) => void;
  openAnswerId?: string | null;
  brandName: string;
}) {
  if (claims.length === 0) return null;
  // The claims are already the DISTINCT merged list (report-intel); a
  // DOMINANT run mines 100+ raw claims, so cap the panel at the top 6 by engine
  // consensus and carry the honest "+N more" remainder (no silent truncation).
  const PRICE_CAP = 6;
  const shown = claims.slice(0, PRICE_CAP);
  const more = claims.length - shown.length;
  // Headline the DISTINCT fee FIGURES (the different numbers put on you),
  // not the meaningless raw claim count. Same extraction the Brief uses, so both
  // surfaces show the same N. Zero numbers ⇒ honest qualitative fallback.
  const FIG_CAP = 6;
  const figures = pricingFigures(claims);
  const figShown = figures.slice(0, FIG_CAP);
  const figMore = figures.length - figShown.length;
  return (
    <section className="rounded-lg border border-line bg-card p-6">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">
        What the engines say you cost
      </h3>
      <p className="mb-1 max-w-2xl text-sm text-ink">
        {figures.length > 0
          ? `The engines quote ${figures.length} different fee figure${figures.length === 1 ? "" : "s"} about you.`
          : `The engines describe your fees ${claims.length} different way${claims.length === 1 ? "" : "s"}.`}
      </p>
      {figures.length > 0 && (
        <p className="mb-3 font-mono text-xs text-wire tabular-nums">
          The figures: {figShown.join(" · ")}
          {figMore > 0 && ` · +${figMore} more`}
        </p>
      )}
      <p className="mb-4 max-w-2xl text-sm text-wire">
        Check these against your real pricing. Engines repeating wrong prices is a fix-worthy
        finding.
        {claims.filter((c) => c.confused).length > 0 &&
          ` ${claims.filter((c) => c.confused).length} of the ${claims.length} come from answers about a different ${brandName} sharing the name, marked below.`}
      </p>
      <ul className="flex flex-col divide-y divide-line">
        {shown.map((c) => {
          const a = resolve(c.refs[0]);
          return (
            <li key={c.text} className="flex items-start justify-between gap-3 py-2 text-sm">
              {a ? (
                <button
                  onClick={() => onOpen(a)}
                  aria-haspopup="dialog"
                  aria-expanded={openAnswerId === a.id}
                  aria-label={`Read the answer that says "${stripMarkdownForPreview(c.text)}"`}
                  className="cursor-pointer text-left hover:text-signal"
                >
                  &ldquo;{stripMarkdownForPreview(c.text)}&rdquo;
                  {c.confused && <ConfusedBadge brandName={brandName} />}
                </button>
              ) : (
                <span>
                  &ldquo;{stripMarkdownForPreview(c.text)}&rdquo;
                  {c.confused && <ConfusedBadge brandName={brandName} />}
                </span>
              )}
              <span className="flex shrink-0 flex-wrap justify-end gap-1">
                {c.engines.map((e) => (
                  <span
                    key={e}
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] text-wire outline outline-1 outline-line"
                  >
                    {ENGINE_LABEL[e] ?? e}
                  </span>
                ))}
              </span>
            </li>
          );
        })}
        {more > 0 && (
          <li className="py-2 text-xs text-wire">
            +{more} more fee claim{more === 1 ? "" : "s"} in the stored answers above.
          </li>
        )}
      </ul>
    </section>
  );
}

/* Entity confusion callout: the engine mostly discussed a
 * different brand sharing your name. Pairs with the entity_unclear fix. */
function EntityConfusionCallout({
  data,
  brandName,
  resolve,
  onOpen,
  openAnswerId,
}: {
  data: EntityConfusionAgg[];
  brandName: string;
  resolve: (r: AnswerRef) => AnswerRow | undefined;
  onOpen: (a: AnswerRow) => void;
  openAnswerId?: string | null;
}) {
  if (data.length === 0) return null;
  return (
    <section className="rounded-lg border border-signal/40 bg-signal/5 p-5">
      <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Entity clarity</p>
      <div className="mt-2 flex flex-col gap-2">
        {data.map((d) => {
          const a = resolve(d.refs[0]);
          return (
            <p key={d.engine} className="text-sm text-ink/90">
              <span className="font-medium">{ENGINE_LABEL[d.engine] ?? d.engine}</span> confused you
              with a different &lsquo;{brandName}&rsquo; in {d.count} answer{d.count === 1 ? "" : "s"}{" "}
              (an entity-clarity problem).{" "}
              {a && (
                <button
                  onClick={() => onOpen(a)}
                  aria-haspopup="dialog"
                  aria-expanded={openAnswerId === a.id}
                  className="cursor-pointer font-mono text-[10px] text-signal underline"
                >
                  read the answer
                </button>
              )}
            </p>
          );
        })}
      </div>
    </section>
  );
}

/* "Your site vs the buyer questions": the crawled own-site
 * pages (meta + freshness) and the buyer questions the engines cited no page of
 * yours for. "Covered" = the engines actually cited your page (honest by
 * construction), not merely that a matching page exists. */
function OwnSiteCoveragePanel({ data }: { data: OwnSiteCoverage }) {
  const fmtDate = (d?: string) => {
    if (!d) return null;
    try {
      return formatDayUtc(d);
    } catch {
      return null;
    }
  };
  return (
    <section className="rounded-lg border border-line bg-card p-6">
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">
        Your site vs the buyer questions
      </h3>
      <p className="mb-4 max-w-2xl text-sm text-wire">
        The pages we crawled on your site, and the buyer questions the engines cited no page of yours
        for. <span className="text-ink tabular-nums">{data.coveredCount} of {data.totalQuestions}</span> questions
        have one of your pages in their sources.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-wire tabular-nums">
            Pages we crawled ({data.pages.length})
          </h4>
          {data.pages.length === 0 ? (
            <p className="text-sm text-wire">No own-site pages captured this run.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {data.pages.slice(0, 12).map((p) => {
                const host = hostOf(p.url);
                const date = fmtDate(p.date);
                return (
                  <li key={p.url} className="flex min-w-0 items-center gap-2">
                    <Favicon host={host} />
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate underline"
                      title={p.url}
                    >
                      {decodeEntities(p.title || "") || host}
                    </a>
                    {date && <span className="shrink-0 font-mono text-[10px] text-wire tabular-nums">{date}</span>}
                  </li>
                );
              })}
              {data.pages.length > 12 && (
                <li className="font-mono text-[10px] text-wire tabular-nums">+{data.pages.length - 12} more crawled</li>
              )}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-wire tabular-nums">
            Questions with no page of yours ({data.gaps.length})
          </h4>
          {data.gaps.length === 0 ? (
            <p className="text-sm text-wire">
              The engines cited a page of yours for every buyer question. Full own-site coverage.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {data.gaps.slice(0, 12).map((g) => (
                <li key={g.qid} className="flex items-start gap-2">
                  <a href={`#q-${g.qid}`} className="mt-0.5 shrink-0 font-mono text-[10px] text-signal underline">
                    [{g.qid}]
                  </a>
                  <span className="line-clamp-2">{g.question || g.qtype}</span>
                </li>
              ))}
              {data.gaps.length > 12 && (
                <li className="font-mono text-[10px] text-wire tabular-nums">+{data.gaps.length - 12} more</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** One gate table body — the same rows, most damning first. Split out so the
 *  passes can fold behind a <details> without duplicating the markup. */
function GateTable({ rows }: { rows: CheckRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Check</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort(
              (a, b) =>
                ["fail", "warn", "info", "pass"].indexOf(a.status) -
                ["fail", "warn", "info", "pass"].indexOf(b.status),
            )
            .map((c) => (
              <tr key={c.id} className="border-b border-line align-top">
                <td
                  className={`w-16 py-2 font-mono text-xs uppercase ${
                    c.status === "fail"
                      ? "text-pill-dismissed"
                      : c.status === "warn"
                        ? "text-signal"
                        : c.status === "pass"
                          ? "text-success"
                          : "text-wire"
                  }`}
                >
                  {c.status}
                </td>
                <td className="w-56 py-2 pr-4">{c.check_name}</td>
                <td className="py-2 text-wire">{c.detail}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/* The "You" status cell — PRESENT / ABSENT / unverified, OR the honest
 * "RIVAL'S OWN SITE" pill when the page is a competitor's own domain (you can't
 * be added there, so it is never scored as an absent-opportunity). */
function PageStatus({ brandPresent, owner }: { brandPresent: boolean | null; owner: string | null }) {
  if (owner) {
    return (
      <span
        className="inline-block rounded bg-wire/15 px-1.5 py-0.5 font-mono text-[10px] uppercase leading-tight text-wire"
        title={`${owner}'s own site, not an opportunity you can be added to`}
      >
        Rival&apos;s own site ({owner})
      </span>
    );
  }
  if (brandPresent === null) return <span className="text-wire">unverified</span>;
  return brandPresent ? (
    <span className="text-success">PRESENT</span>
  ) : (
    <span className="text-signal">ABSENT</span>
  );
}

function Battlefield({
  corpus,
  onOpen,
  openPageId,
  brandName,
  brandAliases,
  rivalOwner,
  corpusSkipped,
}: {
  corpus: CorpusRow[];
  onOpen: (p: CorpusRow) => void;
  openPageId?: string | null;
  brandName: string;
  brandAliases: string[];
  rivalOwner: RivalOwnerFn;
  /** this run's corpus stage was skipped by
   *  request: `corpus` is empty because no cited-page fetch ran, not because
   *  none were found. Changes only the empty-state wording below. */
  corpusSkipped?: boolean;
}) {
  const [oppFirst, setOppFirst] = useState(false);
  // page presence vs the top rival across the pages we could verify.
  const presence = useMemo(
    () => pagePresence(corpus, brandName, brandAliases),
    [corpus, brandName, brandAliases],
  );
  // E-report-intel Task 2: rank by CONSENSUS (distinct engines), not raw depth,
  // and never give a rival-owned page opportunity priority. Rows carry owner +
  // engineCount so the view renders only.
  const rows = useMemo(
    () => battlefieldRows(corpus, rivalOwner, oppFirst),
    [corpus, rivalOwner, oppFirst],
  );
  // source-mix (Task 1): rival-owned pages excluded from the "missing from N" count
  const mix = useMemo(() => sourceMix(corpus, rivalOwner), [corpus, rivalOwner]);
  // Consensus sources (Task 2): pages 2+ engines trust, brand absent, not
  // rival-owned — one listing here moves multiple engines at once.
  const consensus = useMemo(() => consensusSources(corpus, rivalOwner), [corpus, rivalOwner]);
  // A column that is "—" on every row carries no information and costs the
  // table a quarter of its width. It renders only when some row fills it.
  const anyCompetitors = useMemo(
    () => corpus.some((p) => p.competitors_present.length > 0),
    [corpus],
  );

  return (
    <section id="battlefield">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle n="01" title="Battlefield map: the pages the answers are built from" />
        <button
          aria-pressed={oppFirst}
          className={`relative cursor-pointer text-xs underline before:absolute before:-inset-x-2 before:-inset-y-[14px] before:content-[''] ${oppFirst ? "text-signal" : "text-wire"}`}
          onClick={() => setOppFirst((v) => !v)}
        >
          opportunities first
        </button>
      </div>
      {mix && <p className="-mt-1 mb-3 font-mono text-xs text-wire">{mix}</p>}
      {presence && (
        <p className="-mt-1 mb-3 text-sm">
          <span className="font-medium text-ink">{presence.sentence}</span>
        </p>
      )}
      {consensus.length >= 2 && (
        <div className="mb-4 rounded-lg border border-signal/40 bg-signal/5 p-4">
          <p className="mb-2 text-sm">
            <span className="font-medium text-ink">
              {consensus.length} pages {CONSENSUS_PHRASE}: you&apos;re absent from all{" "}
              {consensus.length}.
            </span>{" "}
            <span className="text-wire">
              Two or more of the {ENGINES.length} engines cite each one. A listing here moves
              several engines at once.
            </span>
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {consensus.map((c) => (
              <li key={c.page.id}>
                <button
                  onClick={() => onOpen(c.page)}
                  aria-haspopup="dialog"
                  aria-expanded={openPageId === c.page.id}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 py-2 text-left text-sm hover:text-ink min-h-11 sm:min-h-0"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Favicon host={hostOf(c.page.final_url ?? c.page.url)} />
                    <span className="truncate">{decodeEntities(c.page.title || "") || hostOf(c.page.final_url ?? c.page.url)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-signal tabular-nums">
                    {c.engineCount} engines · cited×{c.total}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* mobile: cards (no horizontal body scroll); md+: the full table */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map(({ page: p, total, owner, isOpportunity }) => {
          const cites = Object.entries(p.cited_by);
          return (
            <button
              key={p.id}
              onClick={() => onOpen(p)}
              aria-haspopup="dialog"
              aria-expanded={openPageId === p.id}
              aria-label={`Open page details for ${decodeEntities(p.title || "") || hostOf(p.final_url ?? p.url)}`}
              className={`flex cursor-pointer flex-col gap-2 rounded-lg border border-line bg-card p-4 text-left ${
                isOpportunity ? "border-l-4 border-l-signal" : ""
              }`}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <Favicon host={hostOf(p.final_url ?? p.url)} />
                  <span className="line-clamp-2 break-words">{decodeEntities(p.title || "") || hostOf(p.final_url ?? p.url)}</span>
                </div>
                <span className="shrink-0 font-mono text-xs">
                  <PageStatus brandPresent={p.brand_present} owner={owner} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-wire">
                <Badge variant="outline" className="border-line">
                  {p.page_type}
                </Badge>
                <span className="font-mono tabular-nums">cited×{total}</span>
                {cites.map(([e, n]) => (
                  <span key={e} className="font-mono tabular-nums">
                    {e}×{n}
                  </span>
                ))}
                <span>{hostOf(p.final_url ?? p.url)}</span>
              </div>
              {p.competitors_present.length > 0 && (
                <div className="text-xs text-wire">
                  Competitors on page: {p.competitors_present.slice(0, 4).join(", ")}
                  {p.competitors_present.length > 4 && (
                    <span className="font-mono"> +{p.competitors_present.length - 4} more</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left font-mono text-xs uppercase text-wire">
            <th scope="col" className="w-16 py-2" aria-sort={oppFirst ? "none" : "descending"}>Cited×</th>
            <th scope="col" className="py-2">Source</th>
            <th scope="col" className="w-28 py-2" aria-sort={oppFirst ? "descending" : "none"}>You</th>
            {anyCompetitors && <th scope="col" className="py-2">Competitors on page</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ page: p, total, owner, isOpportunity }) => {
            return (
              <tr
                key={p.id}
                onClick={() => onOpen(p)}
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                aria-expanded={openPageId === p.id}
                aria-label={`Open page details for ${decodeEntities(p.title || "") || hostOf(p.final_url ?? p.url)}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(p);
                  }
                }}
                className={`cursor-pointer border-b border-line hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal ${
                  isOpportunity ? "border-l-4 border-l-signal" : ""
                }`}
              >
                <td className="py-3 pl-2 font-display text-lg tabular-nums">{total}</td>
                <td className="py-3 pr-4">
                  <div className="flex min-w-0 items-center gap-2 font-medium">
                    <Favicon host={hostOf(p.final_url ?? p.url)} />
                    <span className="min-w-0 truncate" title={decodeEntities(p.title || "") || hostOf(p.final_url ?? p.url)}>
                      {decodeEntities(p.title || "") || hostOf(p.final_url ?? p.url)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-wire">
                    <Badge variant="outline" className="border-line">
                      {p.page_type}
                    </Badge>
                    {Object.entries(p.cited_by).map(([e, n]) => (
                      <span key={e} className="font-mono tabular-nums">
                        {e}×{n}
                      </span>
                    ))}
                    <span>{hostOf(p.final_url ?? p.url)}</span>
                  </div>
                </td>
                <td className="py-3 font-mono text-xs">
                  <PageStatus brandPresent={p.brand_present} owner={owner} />
                </td>
                {anyCompetitors && (
                  <td className="py-3 text-wire">
                    {p.competitors_present.length === 0 ? (
                      "—"
                    ) : (
                      <>
                        {p.competitors_present.slice(0, 4).join(", ")}
                        {p.competitors_present.length > 4 && (
                          <span className="font-mono text-wire"> +{p.competitors_present.length - 4} more</span>
                        )}
                      </>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {rows.length === 0 && (
        <p className="py-6 text-sm text-wire">
          {corpusSkipped
            ? "Citation presence unverified (skipped by request): cited-page fetches did not run this run."
            : "No cited pages captured on this run."}
        </p>
      )}
    </section>
  );
}

/* LOSS MAP (report-intel Task 5) — for every scored question the brand never
 * wins, the single page the engines cite instead. Consensus pages preferred;
 * rival-owned pages are excluded (they carry the honest "rival's own site" note
 * in the battlefield). Each row opens that page's drawer. */
function LossMap({
  answers,
  corpus,
  rivalOwner,
  onOpenPage,
}: {
  answers: AnswerRow[];
  corpus: CorpusRow[];
  rivalOwner: RivalOwnerFn;
  onOpenPage: (p: CorpusRow) => void;
}) {
  const { rows, more, totalQuestions, mappedQuestions } = useMemo(
    () => lossMap(answers, corpus, rivalOwner),
    [answers, corpus, rivalOwner],
  );
  const anyRivals = rows.some((r) => r.competitors.length > 0);
  return (
    <section>
      <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">
        The page beating you, per question
      </h3>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-wire">
          No losing question maps to a single cited page on this run. Nothing to point at yet.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-wire">
            <span className="text-ink tabular-nums">
              {mappedQuestions} of the {totalQuestions} questions
            </span>{" "}
            have a single page that beats you: the one page the engines read instead, where a
            listing moves the answer.
            {totalQuestions > mappedQuestions &&
              ` The other ${totalQuestions - mappedQuestions} either name you already or spread across too many sources to point at one.`}
          </p>
          {/* mobile cards */}
          <div className="flex flex-col gap-3 md:hidden">
            {rows.map((r) => (
              <button
                key={r.qid}
                onClick={() => onOpenPage(r.page)}
                aria-haspopup="dialog"
                aria-label={`Open the page beating you on question ${r.qid}`}
                className="flex cursor-pointer flex-col gap-2 rounded-lg border border-line bg-card p-4 text-left"
              >
                <div className="flex items-start gap-2">
                  <span className="font-mono text-xs text-wire">{r.qid}</span>
                  <span className="line-clamp-2 text-sm">{r.question}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <Favicon host={hostOf(r.page.final_url ?? r.page.url)} />
                  <span className="truncate">{decodeEntities(r.page.title || "") || hostOf(r.page.final_url ?? r.page.url)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-wire">
                  <span className="font-mono text-signal tabular-nums">{r.engineCount} engines</span>
                  {r.competitors.length > 0 && <span>on page: {r.competitors.join(", ")}</span>}
                </div>
              </button>
            ))}
          </div>
          {/* md+ table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-xs uppercase text-wire">
                  <th scope="col" className="w-10 py-2">Q</th>
                  <th scope="col" className="py-2">Question</th>
                  <th scope="col" className="py-2">The page beating you</th>
                  <th scope="col" className="w-20 py-2">Engines</th>
                  {anyRivals && <th scope="col" className="py-2">Rivals on page</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.qid}
                    onClick={() => onOpenPage(r.page)}
                    role="button"
                    tabIndex={0}
                    aria-haspopup="dialog"
                    aria-label={`Open the page beating you on question ${r.qid}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenPage(r.page);
                      }
                    }}
                    className="cursor-pointer border-b border-line align-top hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal"
                  >
                    <td className="py-3 font-mono text-xs text-wire">{r.qid}</td>
                    <td className="py-3 pr-4">
                      <div className="line-clamp-2 max-w-xs">{r.question}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2 font-medium">
                        <Favicon host={hostOf(r.page.final_url ?? r.page.url)} />
                        <span className="truncate">{decodeEntities(r.page.title || "") || hostOf(r.page.final_url ?? r.page.url)}</span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-wire">
                        {hostOf(r.page.final_url ?? r.page.url)}
                      </div>
                    </td>
                    <td className="py-3 font-mono text-signal tabular-nums">{r.engineCount}</td>
                    {anyRivals && <td className="py-3 text-wire">{r.competitors.join(", ")}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {more > 0 && (
            <p className="mt-2 font-mono text-xs text-wire">and {more} more losing question{more > 1 ? "s" : ""}.</p>
          )}
        </>
      )}
    </section>
  );
}

/** What each verdict tag means, in the buyer's words. The tags used to ship
 *  with no key anywhere, and "flagged" (a failed call) read as "the engine
 *  flagged something about you", the opposite of the truth. */
const VERDICT_GLOSS: Record<string, string> = {
  absent: "not in the answer at all",
  mentioned: "named, not recommended",
  listed: "named in a list, not recommended",
  compared: "named in a comparison, not recommended",
  neutral: "named without a steer",
  recommended: "the engine tells the buyer to pick you",
  dismissed: "named and ruled out",
};
const GLOSS_ORDER = ["absent", "mentioned", "listed", "compared", "neutral", "recommended", "dismissed"];

function QuestionVerdicts({
  answers,
  onOpen,
  openAnswerId,
  qtype,
  setQtype,
  brandName,
  brandAliases,
  confusedCount = 0,
}: {
  answers: AnswerRow[];
  onOpen: (a: AnswerRow) => void;
  openAnswerId?: string | null;
  qtype: string;
  setQtype: (t: string) => void;
  brandName: string;
  brandAliases: string[];
  /** answers the judge flagged as being about a different brand of the same name */
  confusedCount?: number;
}) {
  const [engineFilter, setEngineFilter] = useState<string | null>(null);
  const byQid = useMemo(() => {
    const m = new Map<string, AnswerRow[]>();
    for (const a of answers) {
      m.set(a.qid, [...(m.get(a.qid) ?? []), a]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [answers]);
  const shown = byQid.filter(([, rows]) => qtype === "all" || rows[0]?.qtype === qtype);

  return (
    <section id="verdicts">
      <SectionTitle n="02" title="Question verdicts: click any tag to read the raw answer" />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {/* The strip is ~474px wide and `w-fit`: on a 390px phone it dragged the
            whole document sideways (body scrollWidth 490). It gets its own
            horizontal scroll container so it can never widen the page. */}
        <div className="w-full min-w-0 max-w-full overflow-x-auto py-1 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] sm:w-auto sm:[mask-image:none]">
        <Tabs value={qtype} onValueChange={setQtype}>
          <TabsList>
            {[
              ["all", "All"],
              ["category", "What-to-buy"],
              ["comparison", "Head-to-head"],
              ["problem", "Problem-led"],
              ["branded", "Brand questions"],
            ].map(([value, label]) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        </div>
        <div className="flex flex-wrap gap-1 pointer-coarse:gap-2">
          {ENGINES.map((e) => (
            <button
              key={e}
              onClick={() => setEngineFilter(engineFilter === e ? null : e)}
              className={`cursor-pointer rounded px-2 py-1 font-mono text-[10px] transition-colors pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center ${
                engineFilter === e
                  ? "bg-ink text-paper"
                  : "text-wire outline outline-1 outline-line hover:text-ink"
              }`}
            >
              {ENGINE_LABEL[e]}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-sm text-wire">
          {byQid.length === 0
            ? "No answers were recorded for this run."
            : `No ${qtype} questions in this run. Pick another stage above.`}
        </p>
      ) : (
      <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Question ID</th>
            <th scope="col">Question</th>
            <th scope="col">Verdict by engine</th>
          </tr>
        </thead>
        <tbody>
          {shown
            .map(([qid, rows]) => {
              const excerpt = rows.find((r) => r.verdict?.excerpt)?.verdict?.excerpt;
              return (
                <tr key={qid} className="border-b border-line align-top" id={`q-${qid}`}>
                  <td className="w-10 py-3 font-mono text-xs text-wire">{qid}</td>
                  <td className="py-3 pr-4">
                    <div>{rows[0]?.question}</div>
                    {excerpt && (
                      <div className="mt-1 line-clamp-2 text-xs text-wire">“{stripMarkdownForPreview(excerpt)}”</div>
                    )}
                  </td>
                  <td className="py-3 pointer-coarse:py-4">
                    <div className="flex flex-wrap gap-1 pointer-coarse:gap-2">
                      {ENGINES.filter((e) => !engineFilter || e === engineFilter).map((e) => {
                        const a = rows.find((r) => r.engine === e);
                        if (!a || !a.ok) {
                          return (
                            <span
                              key={e}
                              title={a?.error ?? "no answer"}
                              className="rounded px-1.5 py-0.5 font-mono text-[10px] text-wire outline outline-1 outline-line pointer-coarse:py-1.5"
                            >
                              {ENGINE_LABEL[e]} · no answer
                            </span>
                          );
                        }
                        const mt = a.verdict?.mention_type ?? "neutral";
                        return (
                          <button
                            key={e}
                            onClick={() => onOpen(a)}
                            aria-haspopup="dialog"
                            aria-expanded={openAnswerId === a.id}
                            aria-label={`Read ${ENGINE_LABEL[e]}'s answer for question ${a.qid}: ${mt}`}
                            className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[10px] pointer-coarse:py-1.5 ${PILL[mt] ?? "bg-wire text-paper"}`}
                          >
                            {ENGINE_LABEL[e]} · {mt}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table></div>
      )}
      <VerdictLegend answers={answers} confusedCount={confusedCount} />
      <PerceptionPanel
        answers={answers}
        brandName={brandName}
        brandAliases={brandAliases}
        onOpen={onOpen}
        openAnswerId={openAnswerId}
      />
    </section>
  );
}

/* The key under the verdict table: what every tag means, and how many calls
 * returned nothing. Both were missing entirely, in both published formats. */
function VerdictLegend({ answers, confusedCount }: { answers: AnswerRow[]; confusedCount: number }) {
  const present = new Set(
    answers.filter((a) => a.ok).map((a) => a.verdict?.mention_type ?? "neutral"),
  );
  const items = GLOSS_ORDER.filter((k) => present.has(k)).map((k) => [k, VERDICT_GLOSS[k]] as const);
  const t = runTotals(answers);
  const failed = failuresLine(t);
  if (items.length === 0 && !failed) return null;
  return (
    <div className="mt-3 flex flex-col gap-1 text-[13px] leading-relaxed text-wire">
      <p>
        {items.map(([k, gloss], i) => (
          <span key={k}>
            {i > 0 ? " · " : ""}
            <span className="text-ink">{k}</span>: {gloss}
          </span>
        ))}
        {failed && (
          <span>
            {items.length > 0 ? " · " : ""}
            <span className="text-ink">no answer</span>: the call returned nothing
          </span>
        )}
      </p>
      {failed && <p>{failed}</p>}
      {confusedCount > 0 && (
        <p>
          {confusedCount} answer{confusedCount === 1 ? " is" : "s are"} about a different company
          that shares your name. Everything mined from {confusedCount === 1 ? "it" : "them"}
          {" "}carries a badge below, and Entity clarity above explains {confusedCount === 1 ? "it" : "them"}.
        </p>
      )}
    </div>
  );
}

/* Perception panel — HOW the engines frame the brand when it IS mentioned,
 * plus the claims they made (we show what was said; we never guess truth). */
function PerceptionPanel({
  answers,
  brandName,
  brandAliases,
  onOpen,
  openAnswerId,
}: {
  answers: AnswerRow[];
  brandName: string;
  brandAliases: string[];
  onOpen: (a: AnswerRow) => void;
  openAnswerId?: string | null;
}) {
  const mentioned = answers.filter((a) => a.ok && a.verdict?.brand_present);
  const tally = (get: (a: AnswerRow) => string | undefined, keys: [string, string][]) =>
    keys
      .map(([k, gloss]) => ({ gloss, n: mentioned.filter((a) => get(a) === k).length }))
      .filter((t) => t.n > 0);
  // THE ONE TONE TALLY (report-intel): the dossier counted mentions and the
  // Markdown counted every answer, so the two published formats disagreed 3x on
  // one metric. One function, and the denominator travels in the label.
  const tone = useMemo(() => toneCounts(answers, brandName), [answers, brandName]);
  const prominence = tally((a) => a.verdict?.prominence, [
    ["first", "named first"],
    ["early", "named early"],
    ["buried", "buried in the list"],
  ]);
  const weak = mentioned.filter(
    (a) =>
      ["listed", "compared"].includes(a.verdict?.mention_type ?? "") &&
      a.verdict?.sentiment !== "positive",
  ).length;
  // The engines this run actually asked — the denominator of the risk lede
  // below. A run narrowed to two engines must never read "2 of 4".
  const enginesAsked = useMemo(() => {
    const seen = new Set(answers.map((a) => a.engine));
    return ENGINES.filter((e) => seen.has(e));
  }, [answers]);
  // claims carry distinct-engine count + repetition; risk claims are ranked by
  // consensus so the widest-agreed doubt can lead.
  const claims = useMemo(() => perceptionClaims(answers), [answers]);
  const riskRanked = useMemo(() => rankRiskClaims(claims), [claims]);
  const riskLead = riskRanked[0] ?? null;
  // The rivals named AHEAD of a present-but-buried brand,
  // per answer, with a receipt to open. Empty ⇒ today's plain "buried ×N".
  const buried = useMemo(
    () => buriedBehind(answers, brandName, brandAliases),
    [answers, brandName, brandAliases],
  );
  const [buriedOpen, setBuriedOpen] = useState(false);
  const CLAIM_CAP = 8;

  return (
    <div className="mt-6">
      <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-wire">
        How they frame you when you ARE mentioned
      </h3>
      {mentioned.length === 0 ? (
        <p className="text-sm text-wire">
          Never mentioned. Nothing to frame. That absence is the finding.
        </p>
      ) : (
        <div className="flex flex-col gap-1 text-sm">
          {tone.rows.length > 0 && (
            <p>
              <span className="text-wire">{tone.label}: </span>
              {tone.rows.map((t) => `${t.gloss} ×${t.n}`).join(" · ")}
              {tone.confusionNote && (
                <span className="text-wire"> ({tone.confusionNote})</span>
              )}
            </p>
          )}
          {prominence.length > 0 && (
            <p>
              <span className="text-wire">Where you land in the answer: </span>
              {prominence.map((t) => `${t.gloss} ×${t.n}`).join(" · ")}
              {buried.length > 0 && (
                <button
                  onClick={() => setBuriedOpen((v) => !v)}
                  aria-expanded={buriedOpen}
                  className="ml-2 cursor-pointer text-xs text-signal underline"
                >
                  {buriedOpen ? "hide" : `buried behind whom? (${buried.length})`}
                </button>
              )}
            </p>
          )}
          {buried.length > 0 && buriedOpen && (
            <ul className="mt-1 flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
              {buried.map((b) => (
                <li key={`${b.qid}-${b.engine}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm">
                  <span className="font-mono text-xs text-wire">{b.qid}</span>
                  <span className="text-wire">named ahead of you:</span>
                  <span className="font-medium">{b.rivals.join(", ")}</span>
                  <button
                    onClick={() => onOpen(b.answer)}
                    aria-haspopup="dialog"
                    aria-expanded={openAnswerId === b.answer.id}
                    className="cursor-pointer font-mono text-[10px] text-signal underline"
                  >
                    read {ENGINE_LABEL[b.engine] ?? b.engine}&apos;s answer
                  </button>
                </li>
              ))}
            </ul>
          )}
          {weak > 0 && (
            <p>
              <span className="text-wire">Mentioned but framed weakly: </span>
              {weak} answer{weak > 1 ? "s" : ""}{" "}
              <span className="text-wire">(a mention that doesn&apos;t sell you is rented ground).</span>
            </p>
          )}
        </div>
      )}
      {/* mentioned, but the engines made no specific claim — read the tallies as
          intentional, not an empty panel */}
      {mentioned.length > 0 && claims.length === 0 && (
        <p className="mt-3 text-sm text-wire">
          The engines named {brandName} but attached no specific claim to it. Presence
          without a story is a mention you don&apos;t yet control.
        </p>
      )}
      {claims.length > 0 && (
        <div className="mt-4">
          <p className="mb-3 text-sm">
            <span className="font-medium">What the engines say about {brandName}</span>
            <span className="text-wire">
              , grouped by how it lands with a buyer. We show what was said; we don&apos;t guess
              what&apos;s true. A false claim is a fix-worthy finding.
            </span>
          </p>
          <div className="flex flex-col gap-4">
            {PERCEPTION_GROUPS.map(({ key, label, empty, accent }) => {
              // risk uses the consensus ranking so the widest-agreed doubt leads
              const items = key === "risk" ? riskRanked : claims.filter((c) => c.kind === key);
              return (
                <div key={key}>
                  <h4 className="mb-1 font-mono text-[10px] uppercase tracking-widest text-wire">
                    {label}
                  </h4>
                  {key === "risk" && riskLead && riskLead.engines.length >= 2 && (
                    <p className="mb-2 rounded-lg border border-signal/40 bg-signal/5 px-4 py-2 text-sm">
                      <span className="font-medium text-signal">
                        {riskLead.engines.length} of {enginesAsked.length} engines
                      </span>{" "}
                      <span className="text-ink">
                        tell buyers: &ldquo;{stripMarkdownForPreview(riskLead.text)}&rdquo;
                      </span>
                    </p>
                  )}
                  {items.length === 0 ? (
                    <p className="text-sm text-wire">{empty}</p>
                  ) : (
                    <ul
                      className={`flex flex-col divide-y divide-line rounded-lg border bg-card ${
                        accent ? "border-signal/40" : "border-line"
                      }`}
                    >
                      {items.slice(0, CLAIM_CAP).map((c) => (
                        <li
                          key={c.text}
                          className="flex items-start justify-between gap-3 px-4 py-2 text-sm"
                        >
                          <span>
                            {stripMarkdownForPreview(c.text)}
                            {c.confused && <ConfusedBadge brandName={brandName} />}
                          </span>
                          <span className="flex shrink-0 gap-1">
                            {c.engines.map((e) => (
                              <span
                                key={e}
                                className="rounded px-1.5 py-0.5 font-mono text-[10px] text-wire outline outline-1 outline-line"
                              >
                                {ENGINE_LABEL[e] ?? e}
                              </span>
                            ))}
                          </span>
                        </li>
                      ))}
                      {items.length > CLAIM_CAP && (
                        <li className="px-4 py-2 text-xs text-wire">
                          +{items.length - CLAIM_CAP} more in the stored answers above.
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* E3e — perception grouped by claim polarity. risk gets the accent border and
 * an honest empty line; risk is NEVER hidden. */
const PERCEPTION_GROUPS = [
  { key: "praise", label: "What they praise", empty: "No praise captured on this run.", accent: false },
  {
    key: "risk",
    label: "What buyers hear as doubts",
    empty: "No objections captured on this run. Clean.",
    accent: true,
  },
  { key: "neutral_fact", label: "Facts they repeat", empty: "No plain facts repeated on this run.", accent: false },
] as const;

const fixNum = (i: number) => String(i + 1).padStart(2, "0");

/** What "evidence weight" is made of, said truthfully (packages/engine/src/
 *  fixes.ts): a static per-family base, re-derived for two families from this
 *  run's own citation mix, plus a bump for the engines and cited pages behind
 *  the specific finding. The reader is asked to act on this ranking, so the
 *  basis is on the card, not invisible. */
const EVIDENCE_WEIGHT_TITLE =
  "Evidence weight: each fix family starts from a fixed base (crawler access 9.5, a coverage hub 9.0, a source pitch 8.5, wrong claims and entity confusion 7.0, missing schema 5.5, stale titles 4.0). The two source families are re-scored from where this run's citations actually come from, and a pitch gains 0.1 for every citation the target page has, up to half a point. Higher means more of this run's evidence points at it.";

/** One clipboard button with its own copied state. */
function CopyButton({
  text,
  label = "Copy",
  onCopy,
}: {
  text: string;
  label?: string;
  onCopy?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-h-11 shrink-0 sm:min-h-0"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        onCopy?.();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? "Copied ✓" : label}
    </Button>
  );
}

/** Inline markdown inside a drafted artifact: `code`, **bold**, [label](url).
 *  Text nodes only — React escapes everything, so no drafted string can inject
 *  markup into the report. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, i) =>
        part.length > 1 && part.startsWith("`") && part.endsWith("`") ? (
          <code key={i} className="rounded bg-wire/15 px-1 font-mono text-[0.9em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          parseInline(part).map((seg, j) =>
            seg.bold ? <strong key={`${i}-${j}`}>{seg.text}</strong> : <span key={`${i}-${j}`}>{seg.text}</span>,
          )
        ),
      )}
    </>
  );
}

/** A shell command is not "a file to paste": label each code block for what it
 *  actually is, so a reader knows whether to paste it or run it. */
const COMMAND_LANGS = new Set(["bash", "sh", "shell", "zsh", "console", "shellsession"]);
const COMMAND_START = /^\s*(?:#[^\n]*\n)*\s*(curl|grep|awk|npx|npm|node|git|docker|sudo|echo|cat|dig|wget|pnpm|yarn)\b/;
function codeBlockLabel(b: Extract<ArtifactBlock, { kind: "code" }>): string {
  if (COMMAND_LANGS.has(b.lang.toLowerCase()) || COMMAND_START.test(b.text)) return "Run this";
  return "The file to paste";
}

/** THE COPY-READY DRAFT. Code blocks are files to paste, each with its own
 *  Copy; everything else is the "how to verify" prose, formatted. */
function ArtifactView({
  artifact,
  domain,
  onCopy,
}: {
  artifact: string;
  domain: string;
  onCopy?: () => void;
}) {
  const blocks = useMemo(() => parseArtifact(artifact, { domain }), [artifact, domain]);
  const plain = useMemo(() => artifactPlainText(artifact, domain), [artifact, domain]);
  return (
    <div className="mt-2 flex flex-col gap-3 rounded border border-dashed border-line p-4">
      {blocks.map((b, i) => {
        if (b.kind === "code") {
          const label = codeBlockLabel(b);
          return (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-wire">
                  {label}
                </span>
                <CopyButton text={b.text} onCopy={onCopy} />
              </div>
              <pre className="overflow-x-auto whitespace-pre rounded bg-paper p-3 font-mono text-xs leading-relaxed">
                {b.text}
              </pre>
            </div>
          );
        }
        return <ArtifactProse key={i} block={b} />;
      })}
      <div className="flex justify-end border-t border-line pt-3">
        <CopyButton text={plain} label="Copy the whole draft" onCopy={onCopy} />
      </div>
    </div>
  );
}

/** Everything in a draft that is not a file: how to verify, in formatted prose. */
function ArtifactProse({ block }: { block: ArtifactBlock }) {
  switch (block.kind) {
    case "heading":
      return (
        <p className={`font-display ${block.level <= 2 ? "text-base" : "text-sm"} leading-snug`}>
          <Inline text={block.text} />
        </p>
      );
    case "paragraph":
      return (
        <p className="text-sm leading-relaxed text-ink/90">
          <Inline text={block.text} />
        </p>
      );
    case "bullets":
      return block.ordered ? (
        <ol className="list-decimal pl-5 text-sm leading-relaxed text-ink/90">
          {block.items.map((t, i) => (
            <li key={i}>
              <Inline text={t} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="list-disc pl-5 text-sm leading-relaxed text-ink/90">
          {block.items.map((t, i) => (
            <li key={i}>
              <Inline text={t} />
            </li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <p className="border-l-2 border-signal pl-3 text-sm leading-relaxed text-ink/90">
          <Inline text={block.text} />
        </p>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-xs uppercase text-wire">
                {block.headers.map((h, i) => (
                  <th key={i} scope="col" className="py-2 pr-4">
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i} className="border-b border-line align-top">
                  {r.map((c, j) => (
                    <td key={j} className="py-2 pr-4 text-ink/90">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="border-line" />;
    default:
      return null;
  }
}

/* The full body of one fix — honest time-to-impact, linkified evidence, the
 * drafted artifact with Copy, and the owner-only Mark-as-shipped. Shared by the
 * singleton cards and the cluster children so a clustered pitch keeps EVERY
 * per-fix control (each child's own useTransition ⇒ independent pending state). */
function FixDetailBody({
  fix,
  runId,
  demo,
  draftsSkipped,
  domain,
}: {
  fix: FixRow;
  runId: string;
  demo?: boolean;
  /** the audited domain, so a drafted artifact never ships "yourdomain.com" */
  domain: string;
  /** this run's drafts stage was skipped by
   *  request: a fix with no artifact is "not drafted", not "the drafter
   *  produced nothing". */
  draftsSkipped?: boolean;
}) {
  const { track, actions } = useReportHost();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <p className="mt-1 text-sm text-signal">Honest time-to-impact: {fix.time_to_impact}</p>
      <ul className="mt-3 list-disc pl-5 text-sm text-wire">
        {/* panel-context preview: fold **bold** markers but KEEP [q01] refs —
            linkifyEvidence turns those into receipt links */}
        {fix.evidence.map((e, j) => (
          <li key={j}>{linkifyEvidence(e.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1"))}</li>
        ))}
      </ul>
      {!fix.artifact && draftsSkipped && (
        <p className="mt-3 text-sm text-wire">Not drafted (skipped by request).</p>
      )}
      {fix.artifact && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm underline">
            Copy-ready draft
          </summary>
          {/* The draft used to be one <pre> of raw markdown behind one Copy
              button: a literal ```markdown line, then #, ** and pipe tables, a
              robots.txt snippet, a curl command and a prose checklist all in one
              blob. Parsed into blocks, each FILE gets its own Copy and the
              prose around it reads as prose. */}
          <ArtifactView
            artifact={fix.artifact}
            domain={domain}
            onCopy={() => {
              // artifact_copied: the buyer took the
              // drafted fix to go ship it. Fire-and-forget, never blocks the copy.
              // Gated off /demo so anonymous visitors don't pollute activation.
              if (!demo) track("artifact_copied", { run_id: runId, fix_key: fix.fix_key });
            }}
          />
        </details>
      )}
      {/* owner-only action: must NOT render (not just hide) on demo/share —
          a public reader saw "Mark as shipped" in the HTML (caught 2026-07-07) */}
      {!demo && actions.available && (
        <div className="mt-4 border-t border-line pt-3">
          {fix.published_at ? (
            <span className="inline-flex items-baseline gap-1 text-sm text-success" suppressHydrationWarning>
              <Check aria-hidden className="size-3 shrink-0 self-center" />
              <span>
              Shipped{" "}
              {formatDayUtc(fix.published_at)}{" "}
              · watching: your next verify measures it
              </span>
            </span>
          ) : (
            <Button
              size="sm"
              className="min-h-11 sm:min-h-0"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await actions.markFixShipped(fix.id, runId);
                })
              }
            >
              Mark as shipped
            </Button>
          )}
        </div>
      )}
    </>
  );
}

/* A single (unclustered) fix — renders exactly as before, now carrying an
 * id anchor so the top-moves cards can jump straight to it. */
function SingleFixCard({
  fix,
  index,
  runId,
  demo,
  draftsSkipped,
  domain,
}: {
  fix: FixRow;
  index: number;
  runId: string;
  demo?: boolean;
  draftsSkipped?: boolean;
  domain: string;
}) {
  return (
    <div id={`fix-${fix.fix_key}`} className="scroll-mt-24 rounded-lg border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-display text-lg">
          <span className="mr-2 font-mono text-sm text-wire">{fixNum(index)}</span>
          {fix.title}
        </h3>
        <div className="flex shrink-0 gap-1">
          <Badge variant="outline">effort {fix.effort}</Badge>
          <Badge variant="outline" className="tabular-nums" title={EVIDENCE_WEIGHT_TITLE}>
            evidence weight {fix.weight}
          </Badge>
        </div>
      </div>
      <FixDetailBody fix={fix} runId={runId} demo={demo} draftsSkipped={draftsSkipped} domain={domain} />
    </div>
  );
}

/* a source-pitch cluster: ONE numbered card (cluster title + max-child
 * weight + the target hosts as chips), with each child pitch nested as a compact
 * expandable sub-block that keeps its FULL body and per-child Mark-as-shipped.
 * Children use native <details> so the print stylesheet expands them (globals.css
 * `details > *:not(summary)`), and each carries its own #fix-{key} anchor. */
function ClusterCard({
  group,
  index,
  runId,
  demo,
  draftsSkipped,
  domain,
}: {
  group: FixGroup<FixRow>;
  index: number;
  runId: string;
  demo?: boolean;
  draftsSkipped?: boolean;
  domain: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-display text-lg">
          <span className="mr-2 font-mono text-sm text-wire">{fixNum(index)}</span>
          {group.title}
        </h3>
        <Badge variant="outline" className="shrink-0 tabular-nums" title={EVIDENCE_WEIGHT_TITLE}>
          evidence weight {Math.max(...group.fixes.map((f) => f.weight))}
        </Badge>
      </div>
      {group.hosts.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-wire">targets</span>
          {group.hosts.map((h) => (
            <span
              key={h}
              className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs"
            >
              <Favicon host={h} />
              {h}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-col divide-y divide-line border-t border-line">
        {group.fixes.map((child) => (
          <details
            key={child.id}
            id={`fix-${child.fix_key}`}
            className="group scroll-mt-24 py-3 first:pt-3 last:pb-0"
          >
            <summary className="flex cursor-pointer list-none items-start justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <ChevronRight aria-hidden className="size-3 shrink-0 text-wire group-open:hidden" />
                <ChevronDown aria-hidden className="hidden size-3 shrink-0 text-wire group-open:block" />
                <span className="font-medium">{child.title}</span>
              </span>
            </summary>
            <div className="mt-2 pl-4">
              <FixDetailBody fix={child} runId={runId} demo={demo} draftsSkipped={draftsSkipped} domain={domain} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function FixPlan({
  fixes,
  groups,
  runId,
  demo,
  crawlBlocked,
  draftsSkipped,
  domain,
}: {
  fixes: FixRow[];
  groups: FixGroup<FixRow>[];
  runId: string;
  demo?: boolean;
  crawlBlocked?: boolean;
  domain: string;
  /** this run's drafts stage was skipped by
   *  request; passed down to every fix card so a missing artifact reads as
   *  "not drafted (skipped by request)" instead of a silent absence. */
  draftsSkipped?: boolean;
}) {
  return (
    <section>
      <span id="fix-plan" />
      <SectionTitle n="05" title="Fix plan: ranked by evidence weight, drafted for you" />
      {/* The ranking's basis, on the page. The weights were never shown and
          never explained, in a document whose whole pitch is receipts. */}
      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-wire">
        <span className="text-ink">Evidence weight</span> is the number on each card. Each fix
        family starts from a fixed base (crawler access 9.5, a coverage hub 9.0, a source pitch
        8.5, wrong claims and entity confusion 7.0, missing schema 5.5, stale titles 4.0). The
        two source families are re-scored from where this run&apos;s citations actually come
        from, and a pitch gains 0.1 for every citation the target page already has, up to half a
        point. Higher means more of this run&apos;s evidence points at it.
      </p>
      {draftsSkipped && (
        <p className="mb-4 rounded-lg border border-dashed border-line px-4 py-3 text-sm text-wire">
          Drafting was skipped by request: the fixes below are the deterministic diagnosis only,
          each without a copy-ready artifact.
        </p>
      )}
      {fixes.length > 0 && fixes.length < 3 && (
        <p className="mb-4 max-w-3xl font-display text-base italic leading-relaxed text-ink/80">
          Only {fixes.length === 1 ? "one fix" : "two fixes"}. That is unusual, and good: the
          engines already see you on most of the pages they read (the battlefield map above). Your battle is
          preference, not presence, and the moves that shift preference are below. Ship them,
          then verify: movement is measured on the same frozen questions.
          {crawlBlocked &&
            " One caveat: page-level factors couldn't be tested this run (your site blocked our crawler), so this plan may understate. Unblock the crawler and re-audit."}
        </p>
      )}
      <div className="flex flex-col gap-4">
        {groups.map((g, i) =>
          g.kind === "cluster" ? (
            <ClusterCard key={g.shape} group={g} index={i} runId={runId} demo={demo} draftsSkipped={draftsSkipped} domain={domain} />
          ) : (
            <SingleFixCard
              key={g.fixes[0].id}
              fix={g.fixes[0]}
              index={i}
              runId={runId}
              demo={demo}
              draftsSkipped={draftsSkipped}
              domain={domain}
            />
          ),
        )}
        {fixes.length === 0 && <p className="text-sm text-wire">No fixes were generated.</p>}
      </div>
    </section>
  );
}

function linkifyEvidence(e: string) {
  // [qid] → anchor into the question verdicts section; bare URLs → external links
  const parts = e.split(/(\[q\d{2}\]|https?:\/\/\S+)/g);
  return parts.map((part, i) => {
    const qid = /^\[(q\d{2})\]$/.exec(part);
    if (qid) {
      return (
        <a key={i} href={`#q-${qid[1]}`} className="text-signal underline">
          {part}
        </a>
      );
    }
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="underline">
          {hostOf(part)}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
