"use client";
// Recent-runs table with lightweight client-side filters
// (brand · kind/profile · status). Extracted from app/page.tsx, which is an
// async server component and therefore can't hold "use client" state itself —
// same split precedent as run-cta.tsx. No data re-fetch: it filters the same
// 60-row server payload in the browser; pagination is unchanged.
import { useMemo, useState } from "react";
import { PendingLink } from "@/components/pending-link";
import { ScrollX } from "@/components/scroll-x";
import { Badge } from "@saylent/report/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@saylent/report/ui/select";

export interface RecentRun {
  id: string;
  brand_id: string;
  brandName: string;
  kind: string;
  status: string;
  stage: string;
  profile: string;
  created_at: string;
  /** precomputed on the server (mirrors dashboard scoredN) */
  score: { rec: number; answered: number; pct: number } | null;
}

const KINDS = [
  { value: "all", label: "All kinds" },
  { value: "audit", label: "Audits" },
  { value: "verify", label: "Verifies" },
  { value: "smoke-profile", label: "Smoke runs" },
] as const;

export function RecentRuns({
  runs,
  brands,
}: {
  runs: RecentRun[];
  brands: { id: string; name: string }[];
}) {
  const [brand, setBrand] = useState("all");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");

  // status options come from the data so we never offer an empty filter
  const statuses = useMemo(
    () => Array.from(new Set(runs.map((r) => r.status))).sort(),
    [runs],
  );

  const filtered = runs.filter((r) => {
    if (brand !== "all" && r.brand_id !== brand) return false;
    if (kind === "smoke-profile" ? r.profile !== "smoke" : kind !== "all" && r.kind !== kind)
      return false;
    if (status !== "all" && r.status !== status) return false;
    return true;
  });

  return (
    <div className="rounded-lg border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-3">
        <span className="font-mono text-xs uppercase tracking-wider text-wire">Recent runs</span>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={brand} onValueChange={setBrand}>
            <SelectTrigger aria-label="Filter by brand">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All brands</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger aria-label="Filter by kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="px-6 py-8 text-sm text-wire">
          {runs.length === 0 ? "No runs yet." : "No runs match these filters."}
        </p>
      ) : (
        <ScrollX hint="Scroll sideways for kind, score and status">
          <table className="w-full min-w-[640px] text-sm">
            <tbody>
              {filtered.map((run) => (
                <tr key={run.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className="px-6 py-3">
                    <PendingLink href={`/app/run/${run.id}`} className="block font-medium">
                      {run.brandName}
                    </PendingLink>
                  </td>
                  <td className="py-3 text-wire" suppressHydrationWarning>
                    {new Date(run.created_at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-3">
                    <Badge variant={run.kind === "verify" ? "outline" : "default"}>
                      {run.kind}
                    </Badge>
                    {run.profile === "smoke" && (
                      <Badge variant="outline" className="ml-1 border-wire text-wire">
                        smoke
                      </Badge>
                    )}
                  </td>
                  <td className="py-3 text-wire">
                    {run.status === "done"
                      ? run.score
                        ? `Recommended ${run.score.rec}/${run.score.answered} answers (${run.score.pct}%)`
                        : "no engine answers, flagged run"
                      : ""}
                  </td>
                  <td className="py-3 pr-6 text-right">
                    <span
                      className={
                        run.status === "done"
                          ? "text-success"
                          : run.status === "failed"
                            ? "text-pill-dismissed"
                            : "animate-pulse text-signal"
                      }
                    >
                      {run.status === "running" ? run.stage || "running" : run.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
    </div>
  );
}
