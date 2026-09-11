// renderMovementHtml — movement.html, the verify view as a self-contained file.
// Same pipeline as report.html: the app's own components, server-rendered, one
// inlined hydration bundle, the app's compiled stylesheet, no network.
//
// SCOPE NOTE: the app's verify page
// (src/app/app/run/[id]/verify/page.tsx) interleaves five Supabase reads with its
// markup, so it could not be lifted wholesale. What WAS separable is now shared:
// `per-engine-table.tsx` moved into this package and the app renders the package
// copy, and the rest of the view is reproduced by `MovementView` over the pure
// `buildMovement` composer, which derives before/after, the per-engine rows, the
// sentence-level diffs (answer-diff) and the watch notes from the two runs'
// stored rows. Folding the app's verify page onto MovementView is the follow-up.
import { renderToString } from "react-dom/server";
import { MovementView } from "../components/movement";
import { buildMovement, type MovementSide } from "../movement";
import { resolveReportAssets, type ReportAssets } from "./assets";
import { StaticReportHost } from "./static-host";
import type { ReportData } from "./types";

export interface RenderMovementOptions {
  title?: string;
  /** PREBUILT stylesheet + hydration bundle (content or paths), as shipped in
   *  packages/cli/dist/assets — see html.tsx. */
  assets?: ReportAssets;
  /** build-at-render fallback: directory holding src/app/globals.css and
   *  packages/ (defaults to cwd). Ignored when `assets` is given. */
  repoRoot?: string;
  /** one line when the render had to compile its own assets */
  onNotice?: (message: string) => void;
  theme?: "auto" | "light" | "dark";
  contactEmail?: string;
  methodologyUrl?: string | null;
}

const THEME_BOOT = `(function(){try{var t=localStorage.getItem('saylent-report-theme');if(t==='dark'||t==='light')document.documentElement.classList.add(t);}catch(e){}})();`;

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A ReportData is everything a movement side needs: the run's scores, its
 *  answers, and (for the baseline) which fixes were marked shipped. */
function toSide(data: ReportData): MovementSide {
  const run = data.run as unknown as {
    id: string;
    finished_at?: string | null;
    scores?: unknown;
  };
  return {
    runId: run.id,
    finishedAt: run.finished_at ?? null,
    scores: (run.scores ?? null) as MovementSide["scores"],
    answers: data.answers.map((a) => ({
      qid: a.qid,
      engine: a.engine,
      question: a.question,
      raw_text: a.raw_text ?? "",
      verdict: a.verdict as MovementSide["answers"][number]["verdict"],
    })),
    fixes: data.fixes.map((f) => ({ fix_key: f.fix_key, published_at: f.published_at })),
  };
}

export async function renderMovementHtml(
  baseline: ReportData,
  current: ReportData,
  opts: RenderMovementOptions = {},
): Promise<string> {
  const model = buildMovement({
    brand: {
      name: current.brand.name,
      domain: current.brand.domain,
      aliases: current.brand.aliases,
    },
    baseline: toSide(baseline),
    current: toSide(current),
  });

  const { css, clientJs: bundle } = await resolveReportAssets(opts);
  const host = { contactEmail: opts.contactEmail, methodologyUrl: opts.methodologyUrl ?? null };
  const body = renderToString(
    <StaticReportHost contactEmail={host.contactEmail} methodologyUrl={host.methodologyUrl}>
      <div className="px-4 py-10 sm:px-8">
        <MovementView model={model} />
      </div>
    </StaticReportHost>,
  );

  const title = opts.title ?? `${current.brand.name} · movement`;
  const rootClass = opts.theme === "dark" ? "dark" : opts.theme === "light" ? "light" : "";

  // The per-engine rows are the only interactive part, and they are disclosure
  // state the reader can also reach with the browser's own find-in-page; the
  // static page therefore ships the same bundle so the rows expand offline.
  return `<!doctype html>
<html lang="en"${rootClass ? ` class="${rootClass}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
<script>${THEME_BOOT}</script>
</head>
<body>
<div class="mx-auto flex w-full max-w-3xl justify-end gap-4 px-4 pt-6 font-mono text-xs text-wire print:hidden sm:px-8">
<button type="button" data-report-theme-toggle class="min-h-11 underline underline-offset-4 hover:text-ink sm:min-h-0">Switch theme</button>
<button type="button" data-report-print class="min-h-11 underline underline-offset-4 hover:text-ink sm:min-h-0">Print</button>
</div>
<div id="saylent-movement-root">${body}</div>
<script type="application/json" id="saylent-movement-data">${safeJson({ model, host })}</script>
<script>${bundle}</script>
</body>
</html>
`;
}
