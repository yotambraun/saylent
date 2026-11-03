"use client";
// Create a token (shown once, with a copy button) and revoke tokens.
import { useState, useTransition } from "react";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import { SettingRow } from "../setting-row";
import { createApiToken, revokeApiToken } from "./actions";

export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export function TokensClient({ tokens }: { tokens: TokenRow[] }) {
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      setError(null);
      setCopied(false);
      const r = await createApiToken(name);
      if (!r.ok) return setError(r.error);
      setFresh(r.token);
      setName("");
    });
  const revoke = (id: string) =>
    start(async () => {
      setError(null);
      const r = await revokeApiToken(id);
      if (!r.ok) setError(r.error);
    });

  const active = tokens.filter((t) => !t.revoked_at);
  const revoked = tokens.filter((t) => t.revoked_at);

  return (
    <>
      <SettingRow label="New token" description="Give it a name you will recognize, such as the script or dashboard that uses it." stack>
        <div className="grid gap-2">
          <Label htmlFor="token-name" className="text-sm text-wire">
            Name
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="token-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Weekly dashboard" className="sm:max-w-xs" />
            <Button variant="outline" className="w-fit" disabled={pending || name.trim().length === 0} onClick={create}>
              {pending ? "Working…" : "Create token"}
            </Button>
          </div>
          {fresh && (
            <div className="grid min-w-0 gap-2 rounded-md border border-line bg-card p-3" role="status">
              <p className="text-sm text-ink">Copy it now. It is shown once; Saylent keeps only its hash.</p>
              <code className="block min-w-0 overflow-x-auto font-mono text-xs break-all text-ink">{fresh}</code>
              <Button
                variant="outline"
                className="w-fit"
                onClick={() => {
                  void navigator.clipboard?.writeText(fresh).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-pill-dismissed">{error}</p>}
        </div>
      </SettingRow>
      <SettingRow label="Your tokens" description={active.length ? undefined : "No active tokens."} stack>
        {active.length > 0 && (
          <ul className="grid gap-2">
            {active.map((t) => (
              <li key={t.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                <span className="min-w-0">
                  <span className="text-sm text-ink">{t.name}</span>{" "}
                  <span className="font-mono text-xs text-wire">{t.prefix}…</span>
                  <span className="block font-mono text-[11px] text-wire">
                    created {day(t.created_at)} · {t.last_used_at ? `last used ${day(t.last_used_at)}` : "never used"}
                  </span>
                </span>
                <Button variant="outline" className="w-fit" disabled={pending} onClick={() => revoke(t.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
        {revoked.length > 0 && (
          <p className="font-mono text-[11px] text-wire">
            {revoked.length} revoked: {revoked.map((t) => `${t.name} (${t.prefix}…)`).join(", ")}
          </p>
        )}
      </SettingRow>
    </>
  );
}
