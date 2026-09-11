"use client";
// The interactive half of /admin/providers. Every
// privileged write is a server action (each re-running the demo guard AND
// requireAdmin); nothing here ever holds a key beyond the keystroke that types it
// — the field is cleared the moment the action returns.
import { useState } from "react";
import { Badge } from "@saylent/report/ui/badge";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { Label } from "@saylent/report/ui/label";
import type { ModelChoiceRow, MaskedProvider } from "@/lib/provider-settings";
import { clearProviderKey, resetModels, saveModels, saveProviderKey, testOneProvider } from "./actions";

type RowState = "idle" | "saving" | "testing";

/** WHAT EACH ROLE DOES, in one line, keyed by the registry label
 *  (packages/engine/src/models.ts SLOTS). The table used to print
 *  `judge (anthropic)`, `brand model (openai)`, `drafter (openai)` with nothing
 *  anywhere on the page saying what a judge or a drafter is, or when the second
 *  variant of each is used. An operator picking a cheaper judge
 *  has to know what they are trading away. */
const ROLE_HELP: Record<string, string> = {
  "chatgpt (answer)": "Answers your buyer questions as ChatGPT would, with web search on.",
  "claude (answer)": "Answers your buyer questions as Claude would, with web search on.",
  "gemini (answer)": "Answers your buyer questions as Gemini would, with Google search grounding.",
  "perplexity (answer)": "Answers your buyer questions as Perplexity would; every call carries a search fee.",
  "judge (anthropic)":
    "Labels every answer: are you named, recommended, dismissed, absent. Judges the ChatGPT and Gemini answers when both families have a key.",
  "judge (openai)":
    "The same labelling job for the Claude and Perplexity answers — an answer is always judged by the family that did NOT write it.",
  "brand model (anthropic)":
    "Reads your site once per audit and works out your category, buyers, value props and likely rivals.",
  "drafter (anthropic)":
    "Writes the fix artifacts: the hub outline, the source pitch, the schema block.",
  "brand model (openai)":
    "The same site read, used when OpenAI is the only family with a key (single-provider mode).",
  "drafter (openai)":
    "The same fix drafting, used when OpenAI is the only family with a key (single-provider mode).",
};

// ── keys ────────────────────────────────────────────────────────────────────
export function KeysPanel({ providers }: { providers: MaskedProvider[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {providers.map((p) => (
        <KeyRow key={p.provider} provider={p} />
      ))}
    </ul>
  );
}

function KeyRow({ provider }: { provider: MaskedProvider }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<RowState>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optimistic local echo of the saved state, so the row is honest before the
  // server component re-renders.
  const [source, setSource] = useState(provider.source);

  const busy = state !== "idle";
  const display =
    source === "env" ? "present (env)" : source === "console" ? "present (console)" : "absent";

  async function save() {
    if (!value.trim()) return;
    if (!confirm(`Save a new ${provider.label} key? It replaces any key stored here.`)) return;
    setState("saving");
    setError(null);
    setNote(null);
    const res = await saveProviderKey(provider.provider, value);
    setValue(""); // the plaintext never lingers in the page
    if (res.ok) {
      setSource("console");
      setNote("Saved. The key is encrypted and cannot be shown again.");
    } else {
      setError(res.error ?? "Could not save the key.");
    }
    setState("idle");
  }

  async function remove() {
    if (!confirm(`Remove the stored ${provider.label} key? Runs that need it will stop.`)) return;
    setState("saving");
    setError(null);
    setNote(null);
    const res = await clearProviderKey(provider.provider);
    if (res.ok) {
      setSource("absent");
      setNote("Removed.");
    } else {
      setError(res.error ?? "Could not remove the key.");
    }
    setState("idle");
  }

  async function test() {
    setState("testing");
    setError(null);
    setNote(null);
    const res = await testOneProvider(provider.provider);
    if (res.ok && res.result) setNote(`${res.result.ok ? "OK" : "Failed"}: ${res.result.detail}`);
    else setError(res.error ?? "Could not test this provider.");
    setState("idle");
  }

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-24 text-sm text-ink">{provider.label}</span>
        <Badge variant={source === "absent" ? "outline" : "secondary"}>{display}</Badge>
        <code className="font-mono text-xs text-wire">{provider.envVar}</code>
        <div className="ml-auto flex items-center gap-2">
          {/* The cost of the check, on the button. Every branch
              of testProviderKey (packages/cli/src/key-test.ts) is a metadata
              request — GET /v1/models on OpenAI and Anthropic, GET
              /v1beta/models on Gemini — which bills nothing; Perplexity has no
              free endpoint at all, so that one only validates the key's shape
              and makes no request. Nothing here can spend a cent. */}
          <Button variant="outline" size="sm" disabled={busy} onClick={test}>
            {state === "testing" ? "Testing…" : "Test key (free)"}
          </Button>
          {source === "console" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={remove}>
              Remove
            </Button>
          )}
        </div>
      </div>

      {provider.editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`key-${provider.provider}`} className="text-xs text-wire">
              {source === "console" ? "Replace key" : "Set key"}
            </Label>
            <Input
              id={`key-${provider.provider}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="paste the API key"
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
              className="w-80 font-mono text-xs"
            />
          </div>
          <Button size="sm" disabled={busy || !value.trim()} onClick={save}>
            {state === "saving" ? "Saving…" : "Save"}
          </Button>
        </div>
      ) : source === "env" ? (
        <p className="text-xs text-wire">
          {`Set in the environment (${provider.envVar}): the environment wins, so this key is read-only here.`}
        </p>
      ) : (
        <AppSecretNotice />
      )}

      {note && <p className="text-xs text-wire">{note}</p>}
      {error && <p className="text-xs text-pill-dismissed">{error}</p>}
    </li>
  );
}

/** The one thing standing between an operator and editable keys, styled as such
 *. It used to be a grey bordered line that read like a disabled
 *  input, with no way to generate the value and no link to the docs. */
function AppSecretNotice() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-signal/40 bg-signal/10 p-3 text-sm">
      <p className="font-medium text-ink">
        Set <code className="font-mono text-xs">APP_SECRET</code> to manage keys from this page.
      </p>
      <p className="text-wire">
        It is the encryption key for provider keys stored in the database. Without it there is
        nowhere safe to put one, so this deployment can only read keys from its environment.
        Generate one, put it in <code className="font-mono text-xs">.env.local</code> (or your
        host&apos;s env), and restart:
      </p>
      <code className="block w-fit rounded bg-card px-2 py-1 font-mono text-xs text-ink">
        openssl rand -hex 32
      </code>
      <p className="text-wire">
        <a
          href="https://yotambraun.github.io/saylent/docs/self-host/environment"
          className="underline underline-offset-2 hover:text-ink"
        >
          Environment variables →
        </a>
      </p>
    </div>
  );
}

// ── models ──────────────────────────────────────────────────────────────────
export function ModelsPanel({
  rows,
  options,
}: {
  rows: ModelChoiceRow[];
  options: string[];
}) {
  // One draft map for the whole form: the console stores the WHOLE override map,
  // so it is saved as one confirmed, audited change rather than per-row writes.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const r of rows) if (r.source === "console") out[r.role] = r.model;
    return out;
  });
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = state === "saving";
  const listId = "saylent-model-options";

  async function submit(next: Record<string, string> | null) {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    if (!confirm(next === null ? "Reset every role to the shipped default?" : "Apply these models to the next run?")) {
      return;
    }
    setState("saving");
    setError(null);
    const res = next === null ? await resetModels(reason) : await saveModels(next, reason);
    if (res.ok) {
      if (next === null) setDraft({});
      setState("saved");
      setReason("");
    } else {
      setError(res.error ?? "Could not save.");
      setState("idle");
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="max-w-3xl text-wire">
        Leave a field empty to use the shipped default. A role whose MODEL_* variable is set
        in the environment shows source <span className="font-mono">env</span> and ignores
        whatever is typed here. Suggestions are the registry defaults; any model id the
        provider accepts is allowed.
      </p>
      <p className="max-w-3xl text-wire">
        <strong className="font-medium text-ink">Cross-family judging:</strong> when this
        deployment has both an Anthropic and an OpenAI key, an answer is always labelled by the
        family that did <em>not</em> write it — that is what the two judge rows are for, and it
        is how self-preference bias is kept out of your score. With only one family keyed, every
        role runs on it and the <span className="font-mono">(openai)</span> brand and drafter
        rows are the ones in force.
      </p>

      {/* free text + registry suggestions in one control (a datalist, not a closed
          select: a new provider model must be usable the day it ships) */}
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left">
          <thead>
            <tr className="border-b border-line font-mono text-xs text-wire">
              <th className="py-2 pr-4 font-normal">role</th>
              <th className="py-2 pr-4 font-normal">in force</th>
              <th className="py-2 pr-4 font-normal">source</th>
              <th className="py-2 pr-4 font-normal">override</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const envWins = r.source === "env";
              return (
                <tr key={r.role} className="border-b border-line/60 align-middle">
                  <td className="py-2 pr-4 align-top text-ink">
                    <span className="block">{r.label}</span>
                    {ROLE_HELP[r.label] && (
                      <span className="mt-0.5 block max-w-xs text-xs font-normal text-wire">
                        {ROLE_HELP[r.label]}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink">{r.model}</td>
                  <td className="py-2 pr-4">
                    <Badge variant={r.source === "default" ? "outline" : "secondary"}>
                      {r.source}
                    </Badge>
                  </td>
                  <td className="py-2 pr-4">
                    <Input
                      aria-label={`${r.label} model override`}
                      list={listId}
                      value={draft[r.role] ?? ""}
                      disabled={busy || envWins}
                      placeholder={envWins ? r.envVar : `default: ${r.fallback}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        setState("idle");
                        setDraft((d) => {
                          const next = { ...d };
                          if (v.trim()) next[r.role] = v;
                          else delete next[r.role];
                          return next;
                        });
                      }}
                      className="w-64 font-mono text-xs"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="models-reason" className="text-xs text-wire">
            Reason (audit log)
          </Label>
          <Input
            id="models-reason"
            value={reason}
            disabled={busy}
            placeholder="why this change"
            onChange={(e) => setReason(e.target.value)}
            className="w-80"
          />
        </div>
        <Button size="sm" disabled={busy} onClick={() => submit(draft)}>
          {busy ? "Saving…" : "Save models"}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => submit(null)}>
          Reset to defaults
        </Button>
      </div>

      {state === "saved" && <p className="text-xs text-wire">Saved. The next run uses these.</p>}
      {error && <p className="text-xs text-pill-dismissed">{error}</p>}
    </div>
  );
}
