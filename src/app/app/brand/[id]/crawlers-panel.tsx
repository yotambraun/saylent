"use client";
// AI crawlers on the brand page: upload an access log, see which AI crawlers
// actually came, what they fetched, what they were refused, and which pages the
// latest audit's answers cite that no AI crawler fetched. The log streams to
// this deployment's own server, is read once and is not stored; only the
// aggregates are (migration 0046). Sentences come from @saylent/report
// crawlers-view, so the CLI and this panel word the same numbers the same way.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@saylent/report/ui/button";
import { deleteCrawlerReport } from "./crawler-actions";
import type { CrawlerReportView, CrawlerUploadRow } from "@/lib/crawler-view";

export type { CrawlerReportView, CrawlerUploadRow };

const n = (x: number) => x.toLocaleString("en-US");

export function CrawlersPanel({
  brandId,
  latest,
  history,
}: {
  brandId: string;
  latest: CrawlerReportView | null;
  history: CrawlerUploadRow[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [verify, setVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage({ ok: false, text: "Choose a log file first." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      const gz = head[0] === 0x1f && head[1] === 0x8b;
      const q = new URLSearchParams({ name: file.name, ...(gz ? { gz: "1" } : {}), ...(verify ? { verify: "1" } : {}) });
      const res = await fetch(`/api/brands/${brandId}/crawlers?${q}`, { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } });
      const body = (await res.json().catch(() => ({}))) as { error?: string; aiBotHits?: number; parsed?: number };
      if (!res.ok) setMessage({ ok: false, text: body.error ?? `Upload failed (HTTP ${res.status}).` });
      else {
        setMessage({ ok: true, text: `Read ${n(body.parsed ?? 0)} requests; ${n(body.aiBotHits ?? 0)} from AI crawlers.` });
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Upload failed. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" id="crawlers">
      <div>
        <h2 className="font-display text-lg">AI crawlers</h2>
        <p className="text-sm text-wire">
          Which AI crawlers actually visit your site, and how many visitors AI assistants sent, from your own access log. The
          file is read once on this server and not stored: only the counts, the top pages and a few redacted log lines are
          kept (the newest 12 uploads).
        </p>
      </div>

      {latest ? (
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-ink">{latest.lede}</p>
            <span className="font-mono text-xs text-wire">
              {latest.sourceName} · {latest.window}
            </span>
          </div>
          {latest.problems && <p className="text-sm text-pill-dismissed">{latest.problems}</p>}
          {latest.bots.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                    <th className="py-2 pr-3 font-normal">Bot</th>
                    <th className="py-2 pr-3 font-normal">Purpose</th>
                    <th className="py-2 pr-3 text-right font-normal">Requests</th>
                    <th className="py-2 pr-3 text-right font-normal">Pages</th>
                    <th className="py-2 pr-3 text-right font-normal">Blocked</th>
                    <th className="py-2 pr-3 text-right font-normal">5xx</th>
                    <th className="py-2 pr-1 text-right font-normal">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.bots.map((b) => (
                    <tr key={b.label} className="border-b border-line">
                      <td className="py-2 pr-3 text-ink">{b.label}</td>
                      <td className="py-2 pr-3 text-wire">{b.purpose}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{n(b.requests)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{n(b.pages)}</td>
                      <td className={`py-2 pr-3 text-right font-mono text-xs tabular-nums ${b.blocked ? "text-pill-dismissed" : "text-wire"}`}>{b.blocked ? n(b.blocked) : "·"}</td>
                      <td className={`py-2 pr-3 text-right font-mono text-xs tabular-nums ${b.errors ? "text-pill-dismissed" : "text-wire"}`}>{b.errors ? n(b.errors) : "·"}</td>
                      <td className="py-2 pr-1 text-right font-mono text-xs tabular-nums text-wire">{b.verified === null ? "off" : n(b.verified)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {latest.topProblems.length > 0 && (
            <div>
              <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">Problems</h3>
              <ul className="flex flex-col gap-2">
                {latest.topProblems.map((p, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-mono text-xs text-ink">{p.path}</span> <span className="text-wire">· {p.bot} · {p.kind} · {n(p.count)}×</span>
                    {p.receipt && (
                      <code className="mt-0.5 block overflow-x-auto whitespace-pre rounded bg-paper px-2 py-1 font-mono text-[11px] text-wire">{p.receipt}</code>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">Visits from AI assistants</h3>
            <p className="text-sm text-ink">{latest.referrals.line}</p>
            {latest.referrals.rows.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-wider text-wire">
                      <th className="py-2 pr-3 font-normal">Assistant</th>
                      <th className="py-2 pr-3 text-right font-normal">Visits</th>
                      <th className="py-2 pr-3 text-right font-normal">By referrer</th>
                      <th className="py-2 pr-3 text-right font-normal">By utm_source</th>
                      <th className="py-2 pr-1 font-normal">Top landing pages</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.referrals.rows.map((a) => (
                      <tr key={a.label} className="border-b border-line">
                        <td className="py-2 pr-3 text-ink">{a.label}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums">{n(a.visits)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-wire">{n(a.viaReferrer)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-xs tabular-nums text-wire">{n(a.viaUtmSource)}</td>
                        <td className="py-2 pr-1 font-mono text-xs text-wire">{a.pages}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {latest.referrals.rows[0]?.receipt && (
              <code className="mt-2 block overflow-x-auto whitespace-pre rounded bg-paper px-2 py-1 font-mono text-[11px] text-wire">
                {latest.referrals.rows[0].receipt}
              </code>
            )}
            {latest.referrals.note && <p className="mt-1 text-xs text-wire">{latest.referrals.note}</p>}
          </div>
          {latest.join.length > 0 && (
            <div>
              <h3 className="mb-1 font-mono text-xs uppercase tracking-widest text-wire">Against the latest audit&apos;s citations</h3>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
                {latest.join.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-wire">{latest.verification}</p>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line p-4 text-sm text-wire">
          No log uploaded yet. Upload an nginx or Apache access log, a Vercel log drain export or a Cloudflare Logpush file
          (.gz is fine) to see which AI crawlers came and what they could read.
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
        <label htmlFor="crawler-log" className="text-sm font-medium text-ink">
          Upload a log
        </label>
        <input id="crawler-log" ref={fileRef} type="file" className="text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-sm" />
        <label className="flex items-start gap-2 text-xs text-wire">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-signal,currentColor)]" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
          <span>Check bot IPs against the operators&apos; published ranges (the server downloads those public lists; nothing about your log is sent)</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={upload} disabled={busy}>
            {busy ? "Reading the log…" : "Upload and analyze"}
          </Button>
          {message && (
            <p role="status" className={`text-sm ${message.ok ? "text-success" : "text-pill-dismissed"}`}>
              {message.text}
            </p>
          )}
        </div>
        <p className="text-xs text-wire">Large logs: upload a recent slice or gzip it, or run <span className="font-mono">npx saylent crawlers access.log</span> on your machine.</p>
      </div>

      {history.length > 0 && (
        <ul className="flex flex-col gap-1">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 text-sm">
              <span className="font-mono text-xs text-wire" suppressHydrationWarning>
                {new Date(h.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </span>
              <span className="text-ink">{h.sourceName}</span>
              <span className="text-wire">{n(h.aiBotHits)} AI-crawler requests</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => void (await deleteCrawlerReport(brandId, h.id), router.refresh()))}
                className="font-mono text-xs text-wire underline underline-offset-2 hover:text-ink"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
