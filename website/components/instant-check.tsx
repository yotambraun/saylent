// The free instant check on the docs site:
// type a domain, get the bot-access verdict in a few seconds, $0, no keys, no
// sign-up. It renders the same four rows `saylent gate-check` prints
// and then hands the visitor the command that
// does the rest.
//
// The only network call this component ever makes is to
// NEXT_PUBLIC_INSTANT_CHECK_URL (services/instant-check). When that env var is
// not set — a local `npm run site:dev`, a fork's Pages build, or before the
// service is deployed — the widget degrades to the command on its own rather
// than showing a broken input, so the site is never wrong about what works.
//
// The result types below are a hand-kept copy of the service's public JSON
// contract (services/instant-check/src/types.ts). They are TYPES only, never
// check logic: the website is a separate workspace with a static export and
// cannot import across into a Vercel project's source. If the service's payload
// changes, change this block with it.
"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { CopyCommand } from "./copy-command";

type Verdict = "pass" | "warn" | "fail";

interface BotRow {
  agent: string;
  status: Verdict;
  detail: string;
}

export interface InstantCheckResult {
  domain: string;
  result: Verdict;
  robots: { status: Verdict; readable: boolean; training: BotRow[]; search: BotRow[]; user: BotRow[]; notes: string[] };
  probe: { status: Verdict; agents: { agent: string; http: string; status: Verdict; detail: string }[]; notes: string[] };
  // `checked` is false when NOT ONE page of the site could be read (blocked,
  // unreachable, timed out) — the engine's honesty guard then skips these two
  // sections rather than reporting a false "pass". Render that state plainly;
  // never show `types`/`findings` as if the site were clean.
  jsonld: { status: Verdict; checked: boolean; types: { type: string; present: boolean; status: Verdict; detail: string }[] };
  meta: {
    status: Verdict;
    checked: boolean;
    noindex: boolean;
    nosnippet: boolean;
    findings: { check: string; status: Verdict; detail: string }[];
  };
  notes: string[];
  checked_at: string;
  cached: boolean;
  elapsed_ms: number;
  pages_crawled: number;
}

const SERVICE_URL = process.env.NEXT_PUBLIC_INSTANT_CHECK_URL;

/** What a keyless, fast, one-site check genuinely cannot tell you.
 *  Stated on the page, every time, next to the verdict — never buried. */
export const CANNOT_KNOW =
  "This reads your gates, not your answers. It cannot tell you whether ChatGPT, Claude, Gemini or Perplexity actually recommend you, who they recommend instead, or which sources they cite — that needs the full audit.";

const MARK: Record<Verdict, string> = { pass: "✓", warn: "⚠", fail: "✗" };
const TONE: Record<Verdict, string> = { pass: "text-success", warn: "text-signal", fail: "text-signal" };

export function VerdictTag({ status, children }: { status: Verdict; children?: ReactNode }) {
  return (
    <span className={`font-mono text-xs uppercase tracking-wide ${TONE[status]}`}>
      {MARK[status]} {children ?? status}
    </span>
  );
}

function Row({ label, status, children }: { label: string; status: Verdict; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-wire">{label}</span>
        <VerdictTag status={status} />
      </div>
      <div className="text-sm text-ink">{children}</div>
    </div>
  );
}

function BotList({ title, bots }: { title: string; bots: BotRow[] }) {
  if (bots.length === 0) return null;
  return (
    <p className="text-sm">
      <span className="text-wire">{title}: </span>
      {bots.map((bot, i) => (
        <span key={bot.agent}>
          {i > 0 ? " · " : ""}
          <span className={TONE[bot.status]}>{bot.agent}</span>{" "}
          <span className="text-wire">{bot.status === "pass" ? "allowed" : "blocked"}</span>
        </span>
      ))}
    </p>
  );
}

/** The result, rendered as the four rows the CLI prints. Kept as its own pure
 *  component so it can be rendered from a test with a fixed payload. */
export function InstantCheckResultView({ result }: { result: InstantCheckResult }) {
  return (
    <div className="mt-6 rounded-lg border border-line bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3">
        <p className="font-display text-xl text-ink">
          {result.domain} <VerdictTag status={result.result} />
        </p>
        <p className="font-mono text-xs text-wire">
          {result.pages_crawled} pages · {(result.elapsed_ms / 1000).toFixed(1)}s · $0
          {result.cached ? " · cached" : ""}
        </p>
      </div>

      <Row label="robots.txt" status={result.robots.status}>
        {result.robots.readable ? (
          <>
            <BotList title="training" bots={result.robots.training} />
            <BotList title="search" bots={result.robots.search} />
            <BotList title="user" bots={result.robots.user} />
          </>
        ) : (
          <p>No readable robots.txt — engines assume allow, but you have no control surface.</p>
        )}
        {result.robots.notes.map((note) => (
          <p key={note} className="mt-1 text-xs text-wire">
            {note}
          </p>
        ))}
      </Row>

      <Row label="live probe" status={result.probe.status}>
        {result.probe.agents.length === 0 ? (
          <p>No page was reachable to probe.</p>
        ) : (
          <p>
            {result.probe.agents.map((a, i) => (
              <span key={a.agent}>
                {i > 0 ? " · " : ""}
                <span className={TONE[a.status]}>{a.agent}</span> <span className="text-wire">{a.http}</span>
                {a.status === "fail" ? <span className="text-signal"> (robots allows, the CDN does not)</span> : null}
              </span>
            ))}
          </p>
        )}
      </Row>

      <Row label="JSON-LD" status={result.jsonld.status}>
        {result.jsonld.checked ? (
          <p>
            {result.jsonld.types.map((t, i) => (
              <span key={t.type}>
                {i > 0 ? " · " : ""}
                <span className={TONE[t.status]}>{t.type}</span>{" "}
                <span className="text-wire">{t.present ? "present" : "missing"}</span>
              </span>
            ))}
          </p>
        ) : (
          <p className={TONE.warn}>Not checked (site unreachable) — no page on the site could be read.</p>
        )}
      </Row>

      <Row label="meta" status={result.meta.status}>
        {result.meta.checked ? (
          <p>
            <span className={TONE[result.meta.noindex ? "fail" : "pass"]}>noindex</span>{" "}
            <span className="text-wire">{result.meta.noindex ? "present" : "absent"}</span> ·{" "}
            <span className={TONE[result.meta.nosnippet ? "warn" : "pass"]}>nosnippet</span>{" "}
            <span className="text-wire">{result.meta.nosnippet ? "present" : "absent"}</span>
          </p>
        ) : (
          <p className={TONE.warn}>Not checked (site unreachable) — no page on the site could be read.</p>
        )}
        {result.meta.checked
          ? result.meta.findings.map((f) => (
              <p key={f.check + f.detail} className="mt-1 text-xs text-wire">
                {f.detail}
              </p>
            ))
          : null}
      </Row>

      {result.notes.length > 0 ? (
        <div className="border-t border-line py-3">
          {result.notes.map((note) => (
            <p key={note} className="text-xs text-wire">
              {note}
            </p>
          ))}
        </div>
      ) : null}

      <div className="border-t border-line pt-4">
        <p className="mb-2 text-sm text-ink">Run the full audit — what they actually say about you:</p>
        <CopyCommand command={`npx saylent audit ${result.domain}`} />
      </div>
    </div>
  );
}

/** The command every visitor gets, whether or not the hosted check is wired up
 *  — the check is a convenience, the CLI is the product. */
function CommandFallback({ note }: { note: string }) {
  return (
    <div className="mt-4">
      <CopyCommand command="npx saylent gate-check acme.com" />
      <p className="mt-2 text-xs text-wire">{note}</p>
    </div>
  );
}

export function InstantCheck({ serviceUrl = SERVICE_URL }: { serviceUrl?: string }) {
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [result, setResult] = useState<InstantCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No hosted service configured: the site says so plainly and hands over the
  // command, rather than rendering an input that cannot work.
  if (!serviceUrl) {
    return (
      <section className="rounded-xl border border-line bg-card p-6">
        <h2 className="font-display text-xl text-ink">Check your site&apos;s AI gates</h2>
        <p className="mt-2 text-sm text-wire">
          Run it on your own machine — no keys, no sign-up, nothing sent anywhere but your own site.
        </p>
        <CommandFallback note="Replace acme.com with your domain. The check is free and makes no LLM calls." />
      </section>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = domain.trim();
    if (!value || state === "loading") return;
    setState("loading");
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`${serviceUrl}?domain=${encodeURIComponent(value)}`, {
        headers: { accept: "application/json" },
      });
      const body = (await res.json()) as InstantCheckResult | { error: { message: string; retry_after?: number } };
      if (!res.ok || "error" in body) {
        const message = "error" in body ? body.error.message : `The check failed (HTTP ${res.status}).`;
        setError(message);
      } else {
        setResult(body);
      }
    } catch {
      setError("Could not reach the check. Run it locally instead: npx saylent gate-check <domain>");
    } finally {
      setState("idle");
    }
  }

  return (
    <section className="rounded-xl border border-line bg-card p-6">
      <h2 className="font-display text-xl text-ink">Check your site&apos;s AI gates</h2>
      <p className="mt-2 text-sm text-wire">
        Type a domain. In a few seconds you see which AI crawlers your site lets in — robots.txt, a live per-crawler
        fetch, your schema and your meta directives. No keys, no sign-up, no LLM calls, nothing stored.
      </p>

      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="instant-check-domain" className="sr-only">
          Domain to check
        </label>
        <input
          id="instant-check-domain"
          name="domain"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="acme.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          maxLength={253}
          className="flex-1 rounded-lg border border-line bg-background px-4 py-3 font-mono text-sm text-ink outline-none placeholder:text-wire focus:border-signal"
        />
        <button
          type="submit"
          disabled={state === "loading" || domain.trim().length === 0}
          className="rounded-lg border border-line bg-ink px-5 py-3 text-sm text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {state === "loading" ? "Checking…" : "Check"}
        </button>
      </form>

      <p className="mt-3 text-xs text-wire">{CANNOT_KNOW}</p>

      {state === "loading" ? (
        <p className="mt-4 text-sm text-wire" role="status">
          Reading robots.txt, probing as each crawler, scanning your schema…
        </p>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-signal/40 bg-background p-4" role="alert">
          <p className="text-sm text-ink">{error}</p>
          <CommandFallback note="The local run has no rate limit and reads more of your site." />
        </div>
      ) : null}

      {result ? <InstantCheckResultView result={result} /> : null}
    </section>
  );
}
