// @saylent/report/render — the three delivered artifacts of a run, all composed
// from the same rows the app renders: report.html (full parity with the app's
// report), movement.html (the verify view), and report.md.
export { renderReportHtml, type RenderReportHtmlOptions } from "./html";
export { renderMovementHtml, type RenderMovementOptions } from "./movement";
export { renderMarkdown } from "./markdown";
export { buildReportCss, APP_CSS_PATH, OFFLINE_CSS } from "./css";
export { buildHydrationBundle } from "./bundle";
export {
  assetsFromDir,
  resolveReportAssets,
  REPORT_ASSET_FILES,
  type ReportAssets,
  type ReportAssetManifest,
  type ResolveAssetsOptions,
} from "./assets";
export {
  ReportDocument,
  ReportMasthead,
  REPORT_DATA_ID,
  REPORT_ROOT_ID,
  type ReportPayload,
} from "./document";
export { StaticReportHost, staticHostValue, staticHref, type StaticHostOptions } from "./static-host";
export type {
  ReportData,
  ReportBrand,
  ReportMeta,
  ReportPrevious,
  RenderReportOptions,
  AnswerRow,
  CorpusRow,
  CheckRow,
  FixRow,
  RunRow,
} from "./types";
