"use client";
// Admin support-queue controls. The "Resolve" button
// posts to the audited resolveSupport server action (which re-runs requireAdmin()).
// No service key here; a reason is required. Mirrors the takedown queue's
// ReasonButton pattern.
import { useState } from "react";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { resolveSupport } from "./actions";

export function ResolveSupport({ id }: { id: string }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    if (!reason.trim()) return;
    setState("busy");
    setMsg(null);
    const res = await resolveSupport(id, reason.trim());
    if (res.ok) {
      setReason("");
      setMsg("Resolved.");
      setState("ok");
    } else {
      setMsg(res.error ?? "Failed.");
      setState("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input
        aria-label="Resolution note"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setState("idle");
        }}
        placeholder="Resolution note (required)"
        className="max-w-[240px]"
      />
      <Button variant="outline" disabled={!reason.trim() || state === "busy"} onClick={go}>
        {state === "busy" ? "Resolving…" : "Resolve"}
      </Button>
      {msg && <span className={state === "error" ? "text-pill-dismissed" : "text-success"}>{msg}</span>}
    </div>
  );
}
