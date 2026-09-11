"use client";
// THE STATIC REPORT DOCUMENT — the exact tree that is server-rendered into
// report.html and then hydrated in the browser from the same props. One tree,
// so hydration can never disagree with the HTML on disk.
//
// Design note (the masthead): this is a colophon, not a hero. A delivered file
// has to state its own provenance — when it was run, on which profile, against
// which engines and models, and what it cost — and then get out of the way of
// the report it introduces. So: the brand name in the document's own serif, a
// definition list of the run's facts in mono, hairline rules for structure, and
// no accent colour at all (the signal tone belongs to the evidence below).
// The controls are the only non-printing part.
import { type ReactNode } from "react";
import { Brief, SINGLE_FAMILY_JUDGE_NOTE } from "../components/brief";
import { Dossier } from "../components/dossier";
import { StaticReportHost } from "./static-host";
import type { ReportData, ReportMeta, RenderReportOptions } from "./types";
import { formatDayUtc } from "../utils";

export const REPORT_ROOT_ID = "saylent-report-root";
export const REPORT_DATA_ID = "saylent-report-data";

/** The progressive-enhancement switch for the scroll-reveal (globals.css).
 *  `.reveal` is VISIBLE in the stylesheet; only `.js .reveal` is hidden. This
 *  one line is the first node in the document body, so it runs before any
 *  `.reveal` section has been parsed (no flash), and if scripting is off — or
 *  the hydration bundle throws — the class is never set and every section
 *  stays readable instead of sitting at opacity 0. */
const JS_CLASS_BOOT = `document.documentElement.classList.add("js");`;

/** Everything the browser needs to rebuild this exact tree. Serialised into a
 *  <script type="application/json"> block and read back by the hydration entry. */
export interface ReportPayload {
  data: ReportData;
  options: RenderReportOptions;
}

function formatCost(cost: number | null): string {
  if (cost === null || Number.isNaN(cost)) return "not recorded";
  return `$${cost.toFixed(2)}`;
}

const SKIP_LABEL: Record<"drafts" | "corpus" | "gates", string> = {
  drafts: "drafted artifacts",
  corpus: "cited-page fetches",
  gates: "site gate checks",
};

/** Stages the user skipped by request. Absent on reports rendered before this
 *  option existed, or when nothing was skipped. */
function skippedStages(meta: ReportMeta): ("drafts" | "corpus" | "gates")[] {
  const skip = meta.skip;
  if (!skip) return [];
  return (["drafts", "corpus", "gates"] as const).filter((k) => skip[k]);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // UTC on purpose: the static file is rendered once and read everywhere, so the
  // date must not depend on the clock of the machine that rendered it
  return formatDayUtc(d);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-l border-line pl-3">
      <dt className="font-mono text-[10px] tracking-wide text-wire">{label}</dt>
      <dd className="font-mono text-xs text-ink">{children}</dd>
    </div>
  );
}

/** The provenance band. Prints with the document — a delivered PDF must carry
 *  its own date, models and cost or the numbers have no receipt. */
export function ReportMasthead({
  title,
  generatedAt,
  meta,
  sampleNotice,
}: {
  title: string;
  generatedAt: string;
  meta: ReportMeta;
  /** banner for a report rendered from a published sample bundle */
  sampleNotice?: string;
}) {
  const models = meta.engines
    .map((e) => meta.models[e])
    .filter((m): m is string => typeof m === "string" && m.length > 0);
  const skipped = skippedStages(meta);
  return (
    <header data-report-header className="mx-auto w-full max-w-5xl border-b border-line pb-6">
      {sampleNotice ? (
        <p
          data-report-sample-notice
          className="mb-5 rounded-lg border border-line bg-card px-4 py-2 font-mono text-[11px] leading-relaxed text-ink"
        >
          {sampleNotice}
        </p>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-2xl leading-tight text-ink">{title}</h1>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 whitespace-nowrap font-mono text-xs text-wire print:hidden">
          <a href="#brief" className="underline underline-offset-4 hover:text-ink">
            The summary
          </a>
          <a href="#dossier" className="underline underline-offset-4 hover:text-ink">
            The full report
          </a>
          <span className="flex items-center gap-4 whitespace-nowrap border-l border-line pl-4">
            <button
              type="button"
              data-report-theme-toggle
              className="min-h-11 underline underline-offset-4 transition-colors duration-200 hover:text-ink sm:min-h-0"
            >
              Switch theme
            </button>
            <button
              type="button"
              data-report-print
              className="min-h-11 underline underline-offset-4 transition-colors duration-200 hover:text-ink sm:min-h-0"
            >
              Print both
            </button>
          </span>
        </nav>
      </div>
      <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-4">
        <Fact label="Run date">{formatDate(generatedAt)}</Fact>
        <Fact label="Profile">{meta.profile}</Fact>
        <Fact label="Engines">
          {meta.engines.length > 0 ? meta.engines.join(", ") : "none recorded"}
        </Fact>
        <Fact label="Models">{models.length > 0 ? models.join(", ") : "none recorded"}</Fact>
        <Fact label="Cost">{formatCost(meta.cost)}</Fact>
        {meta.judgeMode ? <Fact label="Judge">{meta.judgeMode}</Fact> : null}
      </dl>
      {meta.judgeMode === "single-family" ? (
        <p className="mt-4 max-w-[70ch] font-mono text-[11px] leading-relaxed text-wire">
          {SINGLE_FAMILY_JUDGE_NOTE}
        </p>
      ) : null}
      {skipped.length > 0 ? (
        <p className="mt-4 max-w-[70ch] font-mono text-[11px] leading-relaxed text-wire">
          Skipped by request: {skipped.map((k) => SKIP_LABEL[k]).join(", ")}. See the notices below each
          affected section — nothing skipped is reported as a pass or an absence.
        </p>
      ) : null}
    </header>
  );
}

/** Brief on top, the untouched dossier below it, both fed the same rows the app
 *  feeds them. `demo` is the public variant: it removes every write surface
 *  structurally (no Mark-as-shipped, no share controls) — correct for a file
 *  that has no server behind it. */
export function ReportDocument({ data, options }: ReportPayload) {
  const brandProps = {
    name: data.brand.name,
    domain: data.brand.domain,
    aliases: data.brand.aliases,
    competitors: data.brand.competitors,
  };
  return (
    <StaticReportHost
      contactEmail={options.contactEmail}
      methodologyUrl={options.methodologyUrl ?? null}
    >
      <script dangerouslySetInnerHTML={{ __html: JS_CLASS_BOOT }} />
      <div className="flex flex-col gap-12 px-4 py-10 sm:px-8">
        <ReportMasthead
          title={options.title}
          generatedAt={options.generatedAt}
          meta={options.meta}
          sampleNotice={options.sampleNotice}
        />
        <Brief
          run={data.run}
          brand={brandProps}
          answers={data.answers}
          corpus={data.corpus}
          checks={data.checks as never}
          fixes={data.fixes as never}
          engineModels={options.meta.models}
          judgeMode={options.meta.judgeMode}
          demo
        />
        {/* The two layers are stacked in ONE document here: a file has no view
            switch, and the delivered artifact must carry both. Printing this
            file prints both, in this order: the summary, then the full report
            starting on a fresh page (the print rules key off #brief/#dossier). */}
        <Dossier
          run={data.run}
          brand={{ ...brandProps, authorized_at: data.brand.authorized_at ?? null }}
          answers={data.answers}
          corpus={data.corpus}
          checks={data.checks}
          fixes={data.fixes}
          modelsUsed={options.meta.engines
            .map((e) => options.meta.models[e])
            .filter(Boolean)
            .join(" · ")}
          engineModels={options.meta.models}
          demo
        />
      </div>
    </StaticReportHost>
  );
}
