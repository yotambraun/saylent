"use client";
// Interactive admin controls on the user-detail page. Inputs only:
// the actual privileged writes happen in server actions (setAccountDisabled,
// etc.), each of which re-runs requireAdmin(). The service key is never touched
// here.
import { useState } from "react";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import {
  adminMarkRunFailed,
  adminRecoveryLink,
  adminReRun,
  adminRetryRun,
  setAccountDisabled,
} from "../../actions";

export function DisableAccountButton({
  userId,
  disabled: initialDisabled,
}: {
  userId: string;
  disabled: boolean;
}) {
  const [disabled, setDisabled] = useState(initialDisabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const res = await setAccountDisabled(userId, !disabled);
    if (res.ok) setDisabled(!disabled);
    else setError(res.error ?? "Could not update account.");
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <Button
        variant="outline"
        className={
          disabled
            ? ""
            : "border-pill-dismissed text-pill-dismissed hover:bg-pill-dismissed hover:text-paper"
        }
        disabled={busy}
        onClick={toggle}
      >
        {busy ? "Working…" : disabled ? "Enable account" : "Disable account"}
      </Button>
      <span className="text-wire">
        {disabled ? "This account is currently disabled." : "Account is active."}
      </span>
      {error && <span className="text-pill-dismissed">{error}</span>}
    </div>
  );
}

// ── Reusable reason + action button (every privileged action needs a reason) ──
function ReasonAction({
  label,
  busyLabel,
  run,
  variant = "outline",
  className,
  placeholder = "Reason (required)",
  successText = "Done.",
}: {
  label: string;
  busyLabel: string;
  run: (reason: string) => Promise<{ ok: boolean; error?: string }>;
  variant?: "default" | "outline";
  className?: string;
  placeholder?: string;
  successText?: string;
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
      setMsg(successText);
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
        placeholder={placeholder}
        className="max-w-[220px]"
      />
      <Button variant={variant} className={className} disabled={!reason.trim() || state === "busy"} onClick={go}>
        {state === "busy" ? busyLabel : label}
      </Button>
      {msg && <span className={state === "error" ? "text-pill-dismissed" : "text-success"}>{msg}</span>}
    </div>
  );
}

// ── Run controls: re-run a brand's audit; retry/mark-failed a specific run ────
export function ReRunBrandButton({ userId, brandId }: { userId: string; brandId: string }) {
  return (
    <ReasonAction
      label="Re-run audit"
      busyLabel="Starting…"
      successText="Audit started."
      run={(reason) => adminReRun(userId, brandId, reason)}
    />
  );
}

export function RunRowControls({
  userId,
  runId,
  status,
}: {
  userId: string;
  runId: string;
  status: string;
}) {
  const canRetry = status === "failed";
  const canMarkFailed = status === "queued" || status === "running";
  if (!canRetry && !canMarkFailed) return <span className="text-xs text-wire">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {canRetry && (
        <ReasonAction
          label="Retry"
          busyLabel="Retrying…"
          successText="Retried."
          run={(reason) => adminRetryRun(userId, runId, reason)}
        />
      )}
      {canMarkFailed && (
        <ReasonAction
          label="Mark failed"
          busyLabel="Working…"
          successText="Marked failed."
          variant="outline"
          className="border-pill-dismissed text-pill-dismissed hover:bg-pill-dismissed hover:text-paper"
          run={(reason) => adminMarkRunFailed(userId, runId, reason)}
        />
      )}
    </div>
  );
}

// ── Account recovery: generate a fresh magic link (out-of-band delivery) ──────
export function RecoveryLink({ userId }: { userId: string }) {
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function go() {
    if (!reason.trim()) return;
    setState("busy");
    setMsg(null);
    setLink(null);
    const res = await adminRecoveryLink(userId, reason.trim());
    if (res.ok && res.link) {
      setLink(res.link);
      setReason("");
      setState("ok");
    } else {
      setMsg(res.error ?? "Failed.");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-wire">
        Generates a single-use magic link. Verify the requester&apos;s identity, then send it over
        a trusted channel: never post it publicly.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Reason for generating a recovery link"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setState("idle");
          }}
          placeholder="Reason (required)"
          className="max-w-[220px]"
        />
        <Button variant="outline" disabled={!reason.trim() || state === "busy"} onClick={go}>
          {state === "busy" ? "Generating…" : "Generate recovery link"}
        </Button>
        {msg && <span className="text-pill-dismissed">{msg}</span>}
      </div>
      {link && (
        <div className="rounded border border-line bg-card p-2 font-mono text-xs break-all text-ink">
          {link}
        </div>
      )}
    </div>
  );
}
