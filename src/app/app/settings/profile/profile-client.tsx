"use client";
// Profile section — interactive islands. Behavior preserved verbatim from the old
// /app/account ProfileCard/EmailCard: inline display-name save with "Saved"
// feedback, Secure Email Change (both-inboxes copy + pending banner), sign out.
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { createClient } from "@/lib/supabase/browser";
import { cn } from "@saylent/report/utils";
import { updateDisplayName, updateTimezone } from "../profile-actions";
import { SettingRow } from "../setting-row";

export function DisplayNameField({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    const res = await updateDisplayName(name);
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      return setState("error");
    }
    setState("saved");
  }

  return (
    <SettingRow
      label="Display name"
      description="The name shown across Saylent."
      htmlFor="display-name"
      stack
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="display-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setState("idle");
          }}
          placeholder="Your name"
          className="sm:max-w-xs"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={save}
            disabled={state === "saving" || name.trim() === initialName.trim()}
          >
            {state === "saving" ? "Saving…" : "Save"}
          </Button>
          {state === "saved" && <span className="text-sm text-success">Saved.</span>}
          {error && <span className="text-sm text-pill-dismissed">{error}</span>}
        </div>
      </div>
    </SettingRow>
  );
}

// Time-zone preference. A native <select> of the
// runtime's IANA zones (hundreds of entries; a native control stays light and
// keyboard/screen-reader friendly vs. a custom listbox). "Use detected" pre-fills
// the browser zone (Intl…resolvedOptions().timeZone) as a one-click suggestion;
// the user still confirms with Save. Stored on the profile for the Phase-8 crons.
/* The browser's own time-zone facts, read once and cached so the
 * useSyncExternalStore snapshots are referentially stable (React re-reads them
 * on every render and would loop on a fresh array). Neither exists during SSR. */
const NO_ZONES: string[] = [];
const subscribeNever = () => () => {};
let zonesCache: string[] | null = null;
function browserTimeZones(): string[] {
  if (zonesCache) return zonesCache;
  try {
    zonesCache = Intl.supportedValuesOf("timeZone");
  } catch {
    zonesCache = NO_ZONES;
  }
  return zonesCache;
}
const noTimeZones = () => NO_ZONES;
let detectedCache: string | null = null;
function browserTimeZone(): string {
  if (detectedCache !== null) return detectedCache;
  try {
    detectedCache = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    detectedCache = "";
  }
  return detectedCache;
}
const noTimeZone = () => "";

export function TimezoneField({ initialTimezone }: { initialTimezone: string }) {
  // THE HYDRATION MISMATCH. Both of these are environment
  // readings, and the environment differs between the server and the browser:
  // Node's ICU zone list is not byte-identical to Chrome's, and
  // resolvedOptions().timeZone is the SERVER's zone during SSR and the USER's
  // afterwards — so the option list and the "Use detected: …" button each
  // rendered differently on the client, which is the "a tree hydrated but some
  // attributes … didn't match" warning on /app/settings. useSyncExternalStore
  // is the sanctioned way to say "this fact does not exist on the server": the
  // server snapshot is empty, the client snapshot is the real reading, and React
  // does the swap itself with no effect and no cascading render.
  const zones = useSyncExternalStore(subscribeNever, browserTimeZones, noTimeZones);
  const detected = useSyncExternalStore(subscribeNever, browserTimeZone, noTimeZone);

  const [tz, setTz] = useState(initialTimezone);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setState("saving");
    setError(null);
    const res = await updateTimezone(tz);
    if (!res.ok) {
      setError(res.error ?? "Could not save.");
      return setState("error");
    }
    setState("saved");
  }

  return (
    <SettingRow
      label="Time zone"
      description="Sets the local send-time for your emails and scheduled checks. Defaults to UTC until set."
      htmlFor="timezone"
      stack
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          id="timezone"
          value={tz}
          onChange={(e) => {
            setTz(e.target.value);
            setState("idle");
          }}
          className={cn(
            "h-8 rounded-lg border border-border bg-background px-2.5 text-sm",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            "sm:max-w-xs",
          )}
        >
          <option value="">Not set (UTC)</option>
          {/* Before the zone list is read (SSR and the first client paint) the
              saved value still needs an option to sit in, or the select would
              snap back to "Not set". */}
          {zones.length === 0 && tz && <option value={tz}>{tz}</option>}
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-3">
          {detected && detected !== tz && (
            <Button
              variant="outline"
              onClick={() => {
                setTz(detected);
                setState("idle");
              }}
            >
              Use detected: {detected}
            </Button>
          )}
          <Button onClick={save} disabled={state === "saving" || tz === initialTimezone}>
            {state === "saving" ? "Saving…" : "Save"}
          </Button>
          {state === "saved" && <span className="text-sm text-success">Saved.</span>}
          {error && <span className="text-sm text-pill-dismissed">{error}</span>}
        </div>
      </div>
    </SettingRow>
  );
}

export function EmailField({
  email,
  pendingEmail,
  hasPassword,
}: {
  email: string;
  pendingEmail: string | null;
  /** Whether this deployment accepts password sign-in (NEXT_PUBLIC_AUTH_METHODS).
   *  caught this row hard-coding "No password to manage. You sign in
   *  with a magic link." on the shipped default, which leads with email +
   *  password — same falsehood as the one Settings › Account had. */
  hasPassword: boolean;
}) {
  const [next, setNext] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string>("");

  async function changeEmail() {
    const trimmed = next.trim();
    if (!trimmed || trimmed === email) return;
    setState("saving");
    setError(null);
    // Browser client: Supabase Secure Email Change sends confirmation links to
    // BOTH the current and the new address; the change lands only once both are
    // confirmed. (No password step — this account uses magic links.)
    const { error } = await createClient().auth.updateUser({ email: trimmed });
    if (error) {
      setError(error.message);
      return setState("error");
    }
    setSentTo(trimmed);
    setNext("");
    setState("sent");
  }

  return (
    <SettingRow
      label="Email"
      description={
        <>
          Signed in as <span className="font-mono text-ink">{email}</span>.{" "}
          {hasPassword
            ? "Change your password from Settings › Account."
            : "No password to manage. You sign in with a magic link."}
        </>
      }
      htmlFor="change-email"
      stack
    >
      {pendingEmail && (
        <div className="mb-3 rounded border border-signal/50 bg-signal/10 p-3 text-xs">
          Email change pending: confirm the links sent to{" "}
          <span className="font-mono">{pendingEmail}</span>.
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id="change-email"
          type="email"
          autoComplete="email"
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            setState("idle");
          }}
          placeholder="new@email.com"
          className="sm:max-w-xs"
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={changeEmail}
            disabled={state === "saving" || !next.trim() || next.trim() === email}
          >
            {state === "saving" ? "Sending…" : "Change email"}
          </Button>
          {error && <span className="text-sm text-pill-dismissed">{error}</span>}
        </div>
      </div>
      {state === "sent" && (
        <p className="mt-2 text-xs text-success">
          Check both inboxes ({email} and {sentTo}). The change completes once you confirm
          from both.
        </p>
      )}
    </SettingRow>
  );
}

export function SignOutRow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <SettingRow label="Sign out" description="End this session on this device.">
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await createClient().auth.signOut();
          router.push("/login");
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </Button>
    </SettingRow>
  );
}
