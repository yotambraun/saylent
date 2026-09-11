"use client";
// Admin takedown-queue controls. Every button
// posts to an audited server action (adminUnpublishShare / adminDisableBrand /
// adminBlockDomain / adminResolveTakedown), each re-running requireAdmin(). No
// service key here; a reason is required on every action.
import { useState } from "react";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import {
  adminBlockDomain,
  adminDisableBrand,
  adminResolveTakedown,
  adminUnpublishShare,
} from "../actions";

function ReasonButton({
  label,
  busyLabel,
  run,
  variant = "outline",
  className,
}: {
  label: string;
  busyLabel: string;
  run: (reason: string) => Promise<{ ok: boolean; error?: string }>;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    if (!reason.trim()) return;
    setState("busy");
    setMsg(null);
    const res = await run(reason.trim());
    if (res.ok) {
      setReason("");
      setMsg("Done.");
      setState("ok");
    } else {
      setMsg(res.error ?? "Failed.");
      setState("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input
        aria-label={`Reason for "${label}"`}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setState("idle");
        }}
        placeholder="Reason (required)"
        className="max-w-[200px]"
      />
      <Button variant={variant} className={className} disabled={!reason.trim() || state === "busy"} onClick={go}>
        {state === "busy" ? busyLabel : label}
      </Button>
      {msg && <span className={state === "error" ? "text-pill-dismissed" : "text-success"}>{msg}</span>}
    </div>
  );
}

export function TakedownActions({
  id,
  runId,
  brandId,
}: {
  id: string;
  runId: string | null;
  brandId: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      {runId && (
        <ReasonButton
          label="Unpublish share"
          busyLabel="Working…"
          run={(reason) => adminUnpublishShare(runId, reason)}
        />
      )}
      {brandId && (
        <ReasonButton
          label="Disable brand"
          busyLabel="Working…"
          variant="outline"
          className="border-pill-dismissed text-pill-dismissed hover:bg-pill-dismissed hover:text-paper"
          run={(reason) => adminDisableBrand(brandId, reason)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <ReasonButton
          label="Resolve"
          busyLabel="…"
          run={(reason) => adminResolveTakedown(id, "resolved", reason)}
        />
        <ReasonButton
          label="Dismiss"
          busyLabel="…"
          run={(reason) => adminResolveTakedown(id, "dismissed", reason)}
        />
      </div>
    </div>
  );
}

export function BlockDomainForm() {
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const valid = domain.trim().length > 0 && reason.trim().length > 0;

  async function go() {
    if (!valid) return;
    setState("busy");
    setMsg(null);
    const res = await adminBlockDomain(domain.trim(), reason.trim());
    if (res.ok) {
      setDomain("");
      setReason("");
      setMsg("Domain blocked.");
      setState("ok");
    } else {
      setMsg(res.error ?? "Failed.");
      setState("error");
    }
  }

  return (
    <div className="grid gap-2 text-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor="block-domain">Domain</Label>
        <Input
          id="block-domain"
          value={domain}
          onChange={(e) => {
            setDomain(e.target.value);
            setState("idle");
          }}
          placeholder="acme.com"
          className="font-mono"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="block-domain-reason">Reason (required)</Label>
        <Input
          id="block-domain-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setState("idle");
          }}
          placeholder="Why?"
        />
      </div>
      <Button variant="outline" disabled={!valid || state === "busy"} onClick={go}>
        {state === "busy" ? "Blocking…" : "Block domain"}
      </Button>
      {msg && (
        <p className={`sm:col-span-3 ${state === "error" ? "text-pill-dismissed" : "text-success"}`}>
          {msg}
        </p>
      )}
    </div>
  );
}
