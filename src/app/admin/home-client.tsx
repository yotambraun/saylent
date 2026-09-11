"use client";
// Interactive bits of the admin home: the kill switch +
// daily-cap form (cost control, operable from the UI) and the searchable user
// list. All privileged writes happen in server actions (pauseRuns, setDailyCap),
// each re-running requireAdmin(); the service key is never touched here.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@saylent/report/ui/badge";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@saylent/report/ui/table";
import type { ProviderStatus } from "@/lib/provider-check";
import { pauseRuns, setDailyCap, testProviders } from "./actions";

export function KillSwitchPanel({
  initialPaused,
  initialCap,
}: {
  initialPaused: boolean;
  initialCap: number;
}) {
  const [paused, setPaused] = useState(initialPaused);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await pauseRuns(!paused);
    if (res.ok) setPaused(!paused);
    else setError(res.error ?? "Could not update.");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button
          variant={paused ? "default" : "outline"}
          className={
            paused
              ? "bg-pill-dismissed text-paper hover:bg-pill-dismissed/90"
              : "border-pill-dismissed text-pill-dismissed hover:bg-pill-dismissed hover:text-paper"
          }
          disabled={busy}
          onClick={toggle}
        >
          {busy ? "Working…" : paused ? "Resume all runs" : "Pause all runs (kill switch)"}
        </Button>
        <Badge variant={paused ? "destructive" : "secondary"}>
          {paused ? "runs paused" : "runs live"}
        </Badge>
      </div>
      {error && <p className="text-sm text-pill-dismissed">{error}</p>}
      <CapForm initialCap={initialCap} />
    </div>
  );
}

function CapForm({ initialCap }: { initialCap: number }) {
  const [cap, setCap] = useState(String(initialCap));
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const parsed = cap.trim() === "" ? null : Number(cap);
  const valid =
    reason.trim().length > 0 && (parsed === null || (Number.isFinite(parsed) && parsed >= 0));

  async function submit() {
    if (!valid) return;
    setState("saving");
    setMsg(null);
    const res = await setDailyCap(parsed, reason.trim());
    if (!res.ok) {
      setMsg(res.error ?? "Could not update the cap.");
      return setState("error");
    }
    setReason("");
    setMsg("Daily cap updated.");
    setState("saved");
  }

  return (
    <div className="grid gap-2 border-t border-line pt-3 text-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="daily-spend-cap">Daily spend cap ($, blank = clear)</Label>
        <Input
          id="daily-spend-cap"
          type="number"
          value={cap}
          onChange={(e) => {
            setCap(e.target.value);
            setState("idle");
          }}
          placeholder="e.g. 50"
          className="font-mono tabular-nums"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="daily-spend-cap-reason">Reason (required)</Label>
        <Input
          id="daily-spend-cap-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setState("idle");
          }}
          placeholder="Why?"
        />
      </div>
      <Button onClick={submit} disabled={!valid || state === "saving"} variant="outline">
        {state === "saving" ? "Saving…" : "Set cap"}
      </Button>
      {msg && (
        <p
          className={`sm:col-span-3 ${state === "error" ? "text-pill-dismissed" : "text-success"}`}
        >
          {msg}
        </p>
      )}
    </div>
  );
}

// ── Providers card (Budget & limits) — which of
// OPENAI/ANTHROPIC/GEMINI/PERPLEXITY keys this deployment has, masked to
// present/absent, with an on-demand free live check (same call as `saylent keys
// test`). Never receives or renders a key value.
type ProviderTestRow = { provider: string; label: string; ok: boolean | null; detail: string };

export function ProvidersCard({ initial }: { initial: ProviderStatus[] }) {
  const [results, setResults] = useState<ProviderTestRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runTest() {
    setBusy(true);
    setError(null);
    try {
      const res = await testProviders();
      if (res.ok) setResults(res.results);
      else setError("Could not test providers.");
    } catch {
      setError("Could not test providers.");
    } finally {
      setBusy(false);
    }
  }

  // Resting state (no live check yet): presence + WHERE the key comes from (env or
  // the console), server-rendered — never the key itself. After "Test
  // providers": the free live-check result per provider.
  const rows: ProviderTestRow[] =
    results ??
    initial.map((p) => ({
      provider: p.provider,
      label: p.label,
      ok: p.configured ? null : false,
      detail: p.configured ? `configured (${p.source})` : "not configured",
    }));

  return (
    <div className="flex flex-col gap-3 text-sm">
      <ul className="flex flex-col gap-2">
        {rows.map((p) => (
          <li key={p.provider} className="flex items-center justify-between gap-3">
            <span className="text-ink">{p.label}</span>
            <Badge variant={p.ok ? "secondary" : p.ok === null ? "outline" : "destructive"}>
              {p.detail}
            </Badge>
          </li>
        ))}
      </ul>
      {error && <p className="text-pill-dismissed">{error}</p>}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={runTest} className="w-fit">
          {busy ? "Testing…" : "Test providers"}
        </Button>
        {/* Keys and per-role models are editable with no redeploy. */}
        <Link href="/admin/providers" className="text-xs text-wire underline hover:text-ink">
          Providers &amp; models →
        </Link>
      </div>
    </div>
  );
}

export type UserRow = {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  spendUsd: number;
  createdAt: string;
  lastActivity: string | null;
};

export function SearchableUsers({ rows }: { rows: UserRow[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.email.toLowerCase().includes(term) || (r.displayName ?? "").toLowerCase().includes(term),
    );
  }, [q, rows]);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          aria-label="Search users by email or name"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email or name…"
          className="max-w-sm"
        />
        <span className="font-mono text-xs text-wire tabular-nums">
          {filtered.length} / {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <Table className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-wire">
                  No matching users.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/admin/users/${p.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {p.email}
                    </Link>
                    {p.role === "admin" && (
                      <Badge variant="default" className="ml-2">
                        admin
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    ${p.spendUsd.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-wire tabular-nums" suppressHydrationWarning>
                    {new Date(p.createdAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-wire tabular-nums" suppressHydrationWarning>
                    {p.lastActivity
                      ? new Date(p.lastActivity).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
