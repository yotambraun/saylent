"use client";
// Client shell for the Fix Tracker table: status tabs
// (All/Open/Shipped/Watched, same chip pattern as the brand filter) + in-row
// disclosure (evidence lines + the verify watch-note outcome) with no page jump.
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { PendingLink } from "@/components/pending-link";
import { Badge } from "@saylent/report/ui/badge";
import { groupFixes } from "@saylent/report/fix-groups";
import type { TrackedFix } from "@saylent/report/fix-tracker";
import { MarkShippedButton } from "./mark-shipped-button";

/* De-templating the tracker: fold a brand's same-shape source pitches
 * into ONE cluster (anchored at its first row, so the status→weight order is
 * otherwise preserved), leaving every other fix as a normal row. A lone source
 * stays ungrouped; brand boundaries are respected so two brands' pitches never
 * merge under one header. View-only — the underlying rows are untouched. */
type DisplayItem =
  | { kind: "single"; fix: TrackedFix }
  | { kind: "cluster"; key: string; title: string; fixes: TrackedFix[] };

function groupForDisplay(shown: TrackedFix[]): DisplayItem[] {
  const out: DisplayItem[] = [];
  const clusters = new Map<string, TrackedFix[]>();
  for (const f of shown) {
    if (f.fix_key.startsWith("source-")) {
      let arr = clusters.get(f.brand_id);
      if (!arr) {
        arr = [];
        clusters.set(f.brand_id, arr);
        out.push({ kind: "cluster", key: `cluster-${f.brand_id}`, title: "", fixes: arr });
      }
      arr.push(f);
    } else {
      out.push({ kind: "single", fix: f });
    }
  }
  // a cluster of one is just a row; give real clusters the dossier's headline.
  return out.flatMap((item) => {
    if (item.kind === "single") return [item];
    if (item.fixes.length < 2)
      return item.fixes.map((fix) => ({ kind: "single", fix }) as DisplayItem);
    return [
      {
        ...item,
        title: groupFixes(item.fixes)[0]?.title ?? "Get onto the sources the engines trust",
      },
    ];
  });
}

const hostFromKey = (fixKey: string) => fixKey.replace(/^source-/, "");

const STATUS_LABEL = {
  open: { text: "open", cls: "border-signal text-signal" },
  shipped: { text: "shipped", cls: "border-wire text-wire" },
  watched: { text: "watched", cls: "border-success text-success" },
} as const;

type StatusTab = "all" | "open" | "shipped" | "watched";
const TABS: { key: StatusTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "shipped", label: "Shipped" },
  { key: "watched", label: "Watched" },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export function FixesTable({
  fixes,
  brandName,
}: {
  fixes: TrackedFix[];
  brandName: Record<string, string>;
}) {
  const [tab, setTab] = useState<StatusTab>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openCluster, setOpenCluster] = useState<Record<string, boolean>>({});

  const counts = {
    all: fixes.length,
    open: fixes.filter((f) => f.status === "open").length,
    shipped: fixes.filter((f) => f.status === "shipped").length,
    watched: fixes.filter((f) => f.status === "watched").length,
  };
  const shown = tab === "all" ? fixes : fixes.filter((f) => f.status === tab);
  const items = groupForDisplay(shown);

  // one row, shared per-row disclosure state; reused by singletons and children
  const renderRow = (f: TrackedFix, indent: boolean) => {
    const key = `${f.brand_id}-${f.fix_key}`;
    const isOpen = open[key] ?? false;
    const canExpand = f.evidence.length > 0 || f.status === "watched";
    return (
      <FixRows
        key={key}
        f={f}
        rowKey={key}
        isOpen={isOpen}
        canExpand={canExpand}
        indent={indent}
        brandName={brandName}
        onToggle={() => setOpen((s) => ({ ...s, [key]: !(s[key] ?? false) }))}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* status tabs — same chip pattern as the brand filter above */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1 text-xs ${
              tab === t.key
                ? "border-ink bg-ink text-paper"
                : "border-line text-wire hover:border-ink"
            }`}
          >
            {t.label} {counts[t.key]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-line bg-card py-12 text-center text-sm text-wire">
          No {tab} fixes.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full min-w-[800px] text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                <th className="px-6 py-2 font-normal" />
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal">Fix</th>
                <th className="py-2 font-normal">Factor</th>
                <th className="py-2 text-right font-normal">Weight</th>
                <th className="py-2 pl-4 font-normal">Effort</th>
                <th className="py-2 pl-4 font-normal">Found</th>
                <th className="py-2 pl-4 font-normal">Brand</th>
                <th className="py-2 pr-6 text-right font-normal">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                if (item.kind === "single") return renderRow(item.fix, false);
                const clusterIsOpen = openCluster[item.key] ?? true;
                return (
                  <Fragment key={item.key}>
                    <tr className="border-b border-line bg-paper/60 align-top">
                      <td className="px-6 py-3">
                        <button
                          type="button"
                          aria-expanded={clusterIsOpen}
                          onClick={() =>
                            setOpenCluster((s) => ({
                              ...s,
                              [item.key]: !(s[item.key] ?? true),
                            }))
                          }
                          className="font-mono text-xs text-wire hover:text-ink"
                        >
                          {clusterIsOpen ? "▾" : "▸"}
                        </button>
                      </td>
                      <td className="py-3">
                        <Badge variant="outline" className="border-line text-wire">
                          {item.fixes.length} pitches
                        </Badge>
                      </td>
                      <td colSpan={7} className="py-3 pr-6">
                        <span className="font-medium">{item.title}</span>
                        {!clusterIsOpen && (
                          <span className="ml-2 font-mono text-xs text-wire">
                            {item.fixes.map((f) => hostFromKey(f.fix_key)).join(" · ")}
                          </span>
                        )}
                      </td>
                    </tr>
                    {clusterIsOpen && item.fixes.map((f) => renderRow(f, true))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The key for the two columns that were unreadable to a first-time user. Weight is the fix family's spec weight from
          packages/engine/src/fixes.ts FIX_WEIGHTS — access 9.5 down to
          freshness 4.0 — re-derived from this brand's own citation mix for the
          hub and source-pitch families. Effort is the S/M/L size the diagnosis
          assigns each fix. */}
      {shown.length > 0 && (
        <p className="text-xs text-wire">
          <strong className="font-medium text-ink">Weight</strong> = how much this kind of fix
          is expected to move your answers, 0 to 10. Crawl access scores highest (9.5), stale
          content lowest (4.0); hub and source fixes are re-weighted from where the engines
          actually cite you.{" "}
          <strong className="font-medium text-ink">Effort</strong> = the rough size of the job:
          S a single page edit, M a page to write or a person to email, L a new hub to build.
        </p>
      )}
    </div>
  );
}

function FixRows({
  f,
  rowKey,
  isOpen,
  canExpand,
  indent,
  brandName,
  onToggle,
}: {
  f: TrackedFix;
  rowKey: string;
  isOpen: boolean;
  canExpand: boolean;
  indent?: boolean;
  brandName: Record<string, string>;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-line align-top last:border-0 hover:bg-paper">
        <td className={`py-3 ${indent ? "pl-12 pr-3" : "px-6"}`}>
          {canExpand ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-controls={`fix-detail-${rowKey}`}
              aria-label={isOpen ? "Collapse detail" : "Expand detail"}
              className="inline-flex items-center justify-center rounded text-wire hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:p-2"
            >
              {isOpen ? (
                <ChevronDown className="size-3" aria-hidden />
              ) : (
                <ChevronRight className="size-3" aria-hidden />
              )}
            </button>
          ) : (
            <span className="font-mono text-xs text-line">·</span>
          )}
        </td>
        <td className="py-3">
          <Badge variant="outline" className={STATUS_LABEL[f.status].cls}>
            {STATUS_LABEL[f.status].text}
          </Badge>
        </td>
        <td className="max-w-md py-3 pr-4">
          <PendingLink href={`/app/run/${f.run_id}#fixes`} className="font-medium hover:underline">
            {f.title}
          </PendingLink>
          {f.status === "watched" && (
            <p className={`mt-1 font-mono text-xs ${f.moved ? "text-success" : "text-wire"}`}>
              {f.watch_note ?? "verified after shipping, no note for this fix yet"}
            </p>
          )}
          {f.has_artifact && f.status === "open" && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-success">
              drafted artifact ready
            </p>
          )}
          {/* First surface of fixes.engines (stored since 0006). */}
          {f.engines.length > 0 && (
            <p className="mt-1 font-mono text-[10px] text-wire">affects: {f.engines.join(" · ")}</p>
          )}
        </td>
        <td className="py-3">
          <Badge variant="outline" className="border-line text-wire">
            {f.factor}
          </Badge>
        </td>
        <td className="py-3 text-right font-mono tabular-nums">{f.weight}</td>
        <td className="py-3 pl-4 font-mono">{f.effort}</td>
        {/* Consolidated occurrence provenance: how many audits raised this fix, and
            the LATEST run's date (the row's run_id links to that same dossier).
            first_seen is the "since" tooltip. */}
        <td className="whitespace-nowrap py-3 pl-4 text-wire" suppressHydrationWarning>
          <span title={`first seen ${fmtDate(f.first_seen)}`}>
            {f.occurrences > 1 ? `seen in ${f.occurrences} audits` : "seen once"}
          </span>
          <br />
          <span className="font-mono text-[10px]">latest {fmtDate(f.last_seen)}</span>
        </td>
        <td className="py-3 pl-4 text-wire">{brandName[f.brand_id] ?? "—"}</td>
        <td className="py-3 pr-6 text-right">
          {f.status === "open" ? (
            <MarkShippedButton fixId={f.id} runId={f.run_id} />
          ) : (
            <span className="font-mono text-xs text-wire" suppressHydrationWarning>
              {f.published_at ? `shipped ${fmtDate(f.published_at)}` : ""}
            </span>
          )}
        </td>
      </tr>
      {isOpen && canExpand && (
        <tr id={`fix-detail-${rowKey}`} className="border-b border-line bg-paper last:border-0">
          <td />
          <td colSpan={8} className="px-0 py-3 pr-6 text-sm">
            {f.evidence.length > 0 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-wire">
                  Evidence
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {f.evidence.map((line, i) => (
                    <li key={i} className="text-ink/80">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {f.status === "watched" && (
              <div className={f.evidence.length > 0 ? "mt-3" : ""}>
                <p className="font-mono text-[10px] uppercase tracking-wider text-wire">
                  Verify outcome
                </p>
                <p className={`mt-1 ${f.moved ? "text-success" : "text-wire"}`}>
                  {f.watch_note ??
                    "A verify ran after you shipped, but recorded no note for this fix."}
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
