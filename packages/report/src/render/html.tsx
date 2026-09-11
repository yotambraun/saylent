// renderReportHtml — the delivered file. One self-contained report.html:
// the app's own Brief and dossier components, server-rendered, hydrated by one
// inlined script, styled by the app's own compiled stylesheet. No CDN, no
// network request of any kind, opens from file://, prints to the dossier alone.
import { renderToString } from "react-dom/server";
import { resolveReportAssets, type ReportAssets } from "./assets";
import { ReportDocument, REPORT_DATA_ID, REPORT_ROOT_ID, type ReportPayload } from "./document";
import type { ReportData, RenderReportOptions } from "./types";

/** Runs before paint so a stored theme choice never flashes the other palette.
 *  With no stored choice it does nothing and the CSS media query decides. */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem('saylent-report-theme');if(t==='dark'||t==='light')document.documentElement.classList.add(t);}catch(e){}})();`;

/** `</script>` inside JSON would close the block early; `<!--` would open a
 *  comment. Both are escaped with \\u sequences that JSON.parse reads back
 *  identically, so the payload the browser hydrates from is byte-equal. */
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

export interface RenderReportHtmlOptions extends RenderReportOptions {
  /** PREBUILT stylesheet + hydration bundle (content or paths), as shipped in
   *  packages/cli/dist/assets. Given these, the render needs no repo checkout
   *  and no postcss/esbuild — the published-package path. */
  assets?: ReportAssets;
  /** build-at-render fallback (dev inside a checkout): directory holding
   *  src/app/globals.css and packages/ (defaults to cwd). Ignored when
   *  `assets` is given. */
  repoRoot?: string;
  /** one line when the render had to compile its own assets */
  onNotice?: (message: string) => void;
}

export async function renderReportHtml(
  data: ReportData,
  opts: RenderReportHtmlOptions,
): Promise<string> {
  const payload: ReportPayload = { data, options: stripRenderOnly(opts) };
  const { css, clientJs: bundle } = await resolveReportAssets(opts);
  const body = renderToString(<ReportDocument data={payload.data} options={payload.options} />);

  // theme "light"/"dark" pins the file to one palette (a report mailed to a
  // client who wants it on paper); "auto" is the default and follows the reader.
  const rootClass = opts.theme === "dark" ? "dark" : opts.theme === "light" ? "light" : "";

  return `<!doctype html>
<html lang="en"${rootClass ? ` class="${rootClass}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(opts.title)}</title>
<style>${css}</style>
<script>${THEME_BOOT}</script>
</head>
<body>
<div id="${REPORT_ROOT_ID}">${body}</div>
<script type="application/json" id="${REPORT_DATA_ID}">${safeJson(payload)}</script>
<script>${bundle}</script>
</body>
</html>
`;
}

/** Render-only options must never travel inside the file: `repoRoot` is a
 *  build-time path (it would leak the builder's filesystem), `assets` is the
 *  whole stylesheet + bundle a second time, and `onNotice` is a function. */
function stripRenderOnly(opts: RenderReportHtmlOptions): RenderReportOptions {
  const { repoRoot: _repoRoot, assets: _assets, onNotice: _onNotice, ...rest } = opts;
  void _repoRoot;
  void _assets;
  void _onNotice;
  return rest;
}
