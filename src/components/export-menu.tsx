// The Export menu: every saylent.export/v1 table as CSV, everything as JSON,
// and (for one run) the lossless run bundle. Plain same-origin links into the
// read-only API (/api/v1/...), so the browser's session cookie authenticates
// the download, RLS scopes it to the viewer's own runs, and a script with an
// API token gets the very same bytes. A native <details> disclosure: no client
// JavaScript, keyboard-operable, and it closes like any disclosure.
//
// The table list is written out here, not imported from
// @saylent/report/data-export, so a client component that renders this menu
// does not pull the export builder (and the engine modules it reads) into
// the browser bundle. export-menu.test.ts pins it to EXPORT_TABLES.
import { cn } from "@saylent/report/utils";

export const MENU_TABLES = ["runs", "answers", "citations", "sources", "opportunities", "share_of_voice", "fixes", "crawlers", "search_queries", "ai_referrals"] as const;
type ExportTable = (typeof MENU_TABLES)[number];

const TABLE_LABEL: Record<ExportTable, string> = {
  runs: "Runs",
  answers: "Answers",
  citations: "Citations",
  sources: "Sources",
  opportunities: "Opportunities",
  share_of_voice: "Share of voice",
  fixes: "Fixes",
  crawlers: "AI crawlers",
  search_queries: "Engine searches",
  ai_referrals: "AI referral visits",
};

export function ExportMenu({
  base,
  label = "Export",
  bundle = false,
  tables = MENU_TABLES,
  align = "right",
  className,
}: {
  /** e.g. /api/v1/runs/<id> or /api/v1/brands/<id>/export */
  base: string;
  label?: string;
  /** offer the lossless run.json (one run only) */
  bundle?: boolean;
  tables?: readonly ExportTable[];
  align?: "left" | "right";
  className?: string;
}) {
  const item = "block whitespace-nowrap px-3 py-1.5 font-mono text-xs text-wire hover:bg-card hover:text-ink focus-visible:bg-card focus-visible:text-ink focus-visible:outline-none";
  return (
    <details className={cn("group relative inline-block", className)}>
      <summary className="cursor-pointer list-none font-mono text-xs text-wire underline underline-offset-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        {label} <span aria-hidden="true">▾</span>
      </summary>
      <div
        className={cn(
          "absolute z-20 mt-2 min-w-48 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-paper py-1 shadow-lg",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        <a href={`${base}?format=json&download=1`} className={item}>
          Everything (JSON)
        </a>
        {bundle && (
          <a href={`${base}?format=bundle&download=1`} className={item}>
            Run bundle (run.json)
          </a>
        )}
        <div className="my-1 border-t border-line" role="presentation" />
        {tables.map((t) => (
          <a key={t} href={`${base}?format=csv&table=${t}&download=1`} className={item}>
            {TABLE_LABEL[t]} (CSV)
          </a>
        ))}
        <div className="my-1 border-t border-line" role="presentation" />
        <a href="https://yotambraun.github.io/saylent/docs/export" className={item} target="_blank" rel="noreferrer">
          What the columns mean ↗
        </a>
      </div>
    </details>
  );
}
