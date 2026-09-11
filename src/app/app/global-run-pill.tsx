"use client";
// The GlobalRunPill: a calm, editorial signal in the app header
// that follows every one of your runs from any /app page. Dual-channel by design:
// Supabase Realtime for instant stage/status pushes + a 5s safety
// poll that runs ONLY while a run is active (no idle churn). It also drives the
// tab-title/favicon signal and fires the browser notification
// on completion/failure when the tab is hidden.
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PendingLink } from "@/components/pending-link";
import { fireNotificationIfHidden } from "@/lib/browser-notify";
import { derivePillState, type PillRun } from "@/lib/run-pill";
import { createClient } from "@/lib/supabase/browser";
import { useTabSignal } from "./use-tab-signal";

// the lean run shape the poll/realtime speak in
const SELECT = "id,stage,status,brand_id,created_at,brands(name)";

function isActive(status: string): boolean {
  return status === "queued" || status === "running";
}

// Supabase embeds a many-to-one relation as an object; be defensive.
function brandNameOf(row: { brands?: unknown }): string {
  const b = row.brands as { name?: string } | { name?: string }[] | null | undefined;
  if (Array.isArray(b)) return b[0]?.name ?? "";
  return b?.name ?? "";
}

export function GlobalRunPill({ initialRuns, uid }: { initialRuns: PillRun[]; uid: string }) {
  // tracked = active runs (server-seeded) + any that flip to done/failed while
  // we're mounted (they persist as a "ready"/"failed" pill until navigation).
  const [tracked, setTracked] = useState<Record<string, PillRun>>(() =>
    Object.fromEntries(initialRuns.map((r) => [r.id, r])),
  );
  const pathname = usePathname();
  const prevStatus = useRef<Record<string, string>>(
    Object.fromEntries(initialRuns.map((r) => [r.id, r.status])),
  );

  const runs = Object.values(tracked);
  const state = derivePillState(runs);
  const hasActive = runs.some((r) => isActive(r.status));

  // Tab-title + favicon signal.
  useTabSignal(state);

  // On navigation (which includes clicking the pill itself), clear the completed
  // pills — "persists until clicked or navigated". Active runs stay.
  useEffect(() => {
    const dropCompleted = () =>
      setTracked((t) => {
        const next: Record<string, PillRun> = {};
        for (const [id, r] of Object.entries(t)) if (isActive(r.status)) next[id] = r;
        return Object.keys(next).length === Object.keys(t).length ? t : next;
      });
    dropCompleted(); // pathname is the only trigger; setTracked is stable
  }, [pathname]);

  // Fire a browser notification when a tracked run transitions into
  // done/failed (only if the tab is hidden; a visible tab is served by the pill).
  useEffect(() => {
    for (const r of runs) {
      const before = prevStatus.current[r.id];
      if (before && isActive(before) && !isActive(r.status)) {
        const brand = r.brandName || "Your brand";
        fireNotificationIfHidden({
          title: r.status === "failed" ? `${brand} run failed` : `${brand} report ready`,
          body:
            r.status === "failed"
              ? "Open Saylent to retry. You were not charged again."
              : "Your report is ready to read.",
          icon: "/favicon-alert.svg",
          href: `/app/run/${r.id}`,
        });
      }
      prevStatus.current[r.id] = r.status;
    }
  }, [runs]);

  // Realtime: instant pushes for the user's runs. We accept
  // INSERT too so a brand-new active run appears without waiting for a poll.
  useEffect(() => {
    const supabase = createClient();
    const merge = (n: { id: string; stage: string; status: string; created_at?: string }) =>
      setTracked((t) => {
        const existing = t[n.id];
        // only adopt UNKNOWN runs when they're active; always update known ones.
        if (!existing && !isActive(n.status)) return t;
        return {
          ...t,
          [n.id]: {
            id: n.id,
            brandName: existing?.brandName ?? "",
            stage: n.stage,
            status: n.status,
            created_at: n.created_at ?? existing?.created_at ?? null,
          },
        };
      });
    const ch = supabase
      .channel(`run-pill-${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "runs", filter: `user_id=eq.${uid}` },
        (p) => {
          const n = p.new as { id: string; stage: string; status: string; created_at?: string };
          if (n?.id) merge(n);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [uid]);

  // Safety poll — ONLY while a run is active. Refreshes the exact set we track
  // (fills brand names for realtime-discovered runs, catches missed final states)
  // AND discovers new active runs. Stops when idle.
  useEffect(() => {
    if (!hasActive) return;
    const supabase = createClient();
    const ids = Object.keys(tracked);
    const poll = async () => {
      let q = supabase.from("runs").select(SELECT).is("hidden_at", null);
      // union: currently-active runs OR any run we're still tracking
      q = ids.length
        ? q.or(`status.in.(queued,running),id.in.(${ids.join(",")})`)
        : q.in("status", ["queued", "running"]);
      const { data } = await q;
      if (!data) return;
      setTracked((t) => {
        const next = { ...t };
        for (const row of data as Array<Record<string, unknown>>) {
          const id = row.id as string;
          // keep a run only if it's active or something we were already tracking
          if (!isActive(row.status as string) && !t[id]) continue;
          next[id] = {
            id,
            brandName: brandNameOf(row) || t[id]?.brandName || "",
            stage: (row.stage as string) ?? "",
            status: row.status as string,
            created_at: (row.created_at as string) ?? t[id]?.created_at ?? null,
          };
        }
        return next;
      });
    };
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
    // re-arm when the active set changes (new run → restart; idle → cleared above)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive, uid]);

  if (state.kind === "idle") return null;

  const dotClass =
    state.kind === "failed"
      ? "bg-pill-dismissed"
      : state.kind === "done"
        ? "bg-success"
        : "bg-signal animate-pulse motion-reduce:animate-none";
  const textClass = state.kind === "failed" ? "text-pill-dismissed" : "text-ink";

  return (
    <PendingLink
      href={state.href}
      aria-label={state.label}
      className="group flex max-w-[46vw] items-center gap-2 rounded-md border border-line bg-card px-2.5 py-1 font-mono text-xs transition-colors hover:border-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center sm:max-w-xs"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className={`hidden min-w-0 flex-col gap-1 sm:flex ${textClass}`}>
        <span className="truncate">
          {state.label}
          {state.extraCount > 0 && <span className="ml-1 text-wire">+{state.extraCount} more</span>}
        </span>
        {state.kind === "running" && (
          <span className="h-0.5 w-full overflow-hidden rounded-full bg-line" aria-hidden>
            <span
              className="block h-full rounded-full bg-signal transition-all duration-700"
              style={{ width: `${state.progressPct}%` }}
            />
          </span>
        )}
      </span>
    </PendingLink>
  );
}
