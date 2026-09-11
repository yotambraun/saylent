"use client";
// Search UX: suggestion chips fill the box (users shouldn't have to invent
// queries), every hit is labeled with brand + run date, empty states teach.
// Highlights come from Postgres ts_headline [[ ]] markers, rendered as <mark>.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@saylent/report/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@saylent/report/ui/tabs";
import { Skeleton } from "@saylent/report/ui/skeleton";
import { type SearchResults, searchAll } from "./actions";

type RunMeta = Record<string, { brand: string; date: string; brandId: string; iso: string }>;
const ENGINES = ["chatgpt", "claude", "gemini", "perplexity"];
const DATE_FACETS = [
  { key: "all", label: "All time" },
  { key: "last", label: "Last run" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
] as const;
type DateFacet = (typeof DATE_FACETS)[number]["key"];

function Highlight({ snip }: { snip: string }) {
  const parts = snip.split(/\[\[|\]\]/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-signal/20 font-medium text-ink">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u.slice(0, 40);
  }
};

function FacetChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-line text-ink/70 hover:border-ink hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function RunTag({ meta }: { meta?: { brand: string; date: string } }) {
  if (!meta) return null;
  return (
    <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 font-mono text-[10px] text-wire">
      {meta.brand} · {meta.date}
    </span>
  );
}

export function SearchClient({
  runMeta,
  suggestions,
  brands,
}: {
  runMeta: RunMeta;
  suggestions: string[];
  brands: { id: string; name: string }[];
}) {
  const [q, setQ] = useState("");
  const [typeTab, setTypeTab] = useState("all");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // facets — all client-side over the returned rows (each row carries run_id ⇒
  // brand + date via runMeta; answers additionally carry engine).
  const [brandFacet, setBrandFacet] = useState<string | null>(null);
  const [engineFacet, setEngineFacet] = useState<string | null>(null);
  const [dateFacet, setDateFacet] = useState<DateFacet>("all");
  // page-load timestamp captured once (lazy init keeps render pure) — the
  // reference point for the relative 7d/30d date windows.
  const [nowMs] = useState(() => Date.now());

  // the single most-recent run id (for the "Last run" facet)
  const lastRunId = useMemo(() => {
    let best: string | null = null;
    let bestIso = "";
    for (const [rid, m] of Object.entries(runMeta)) {
      if (m.iso > bestIso) {
        bestIso = m.iso;
        best = rid;
      }
    }
    return best;
  }, [runMeta]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const query = q.trim();
    if (query.length < 2) return; // display derives emptiness from q, no state write
    timer.current = setTimeout(async () => {
      setSearching(true);
      const r = await searchAll(query);
      setResults(r);
      setSearching(false);
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const active = q.trim().length >= 2;
  const raw = active ? results : null;

  // apply the facets to the raw rows. brand + date key off run_id (all three
  // row types have it); engine is answer-only, so a specific engine narrows to
  // answers and hides fixes/pages (they aren't engine-scoped).
  const shown = useMemo<SearchResults | null>(() => {
    if (!raw || raw.failed) return raw;
    const now = nowMs;
    const passRun = (runId: string) => {
      const m = runMeta[runId];
      if (brandFacet && m?.brandId !== brandFacet) return false;
      if (dateFacet === "last") return runId === lastRunId;
      if (dateFacet === "7d" || dateFacet === "30d") {
        if (!m?.iso) return false;
        const days = (now - new Date(m.iso).getTime()) / 86_400_000;
        return days <= (dateFacet === "7d" ? 7 : 30);
      }
      return true;
    };
    return {
      ...raw,
      answers: raw.answers.filter(
        (a) => passRun(a.run_id) && (!engineFacet || a.engine === engineFacet),
      ),
      fixes: engineFacet ? [] : raw.fixes.filter((f) => passRun(f.run_id)),
      sources: engineFacet ? [] : raw.sources.filter((s) => passRun(s.run_id)),
    };
  }, [raw, runMeta, brandFacet, engineFacet, dateFacet, lastRunId, nowMs]);

  const total = shown
    ? shown.answers.length + shown.fixes.length + shown.sources.length
    : 0;
  const rawTotal = raw && !raw.failed
    ? raw.answers.length + raw.fixes.length + raw.sources.length
    : 0;
  const facetsActive = brandFacet !== null || engineFacet !== null || dateFacet !== "all";
  const clearFacets = () => {
    setBrandFacet(null);
    setEngineFacet(null);
    setDateFacet("all");
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="font-display text-2xl">Find anything in your reports</h1>
      <p className="mt-1 text-sm text-wire">
        Every AI answer, fix, and cited page across all your audits.
      </p>
      <Input
        autoFocus
        className="mt-4 h-11 text-base"
        placeholder="Try a competitor name or a topic…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {/* suggestion chips — always visible so the box is never a blank stare */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-wire">Try:</span>
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setQ(s)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              q === s
                ? "border-ink bg-ink text-paper"
                : "border-line text-ink/70 hover:border-ink hover:text-ink"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {!active && (
        <div className="mt-10 grid gap-4 text-sm text-wire sm:grid-cols-3">
          <div>
            <p className="font-medium text-ink">Track a competitor</p>
            <p className="mt-1">See every answer and page where a rival shows up.</p>
          </div>
          <div>
            <p className="font-medium text-ink">Check a topic</p>
            <p className="mt-1">&quot;pricing&quot;, &quot;security&quot;, &quot;support&quot;: what AI says about it.</p>
          </div>
          <div>
            <p className="font-medium text-ink">Re-find a fix</p>
            <p className="mt-1">Search any words from a fix title or its drafted artifact.</p>
          </div>
        </div>
      )}

      {active && searching && (
        <div className="mt-6 flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      )}

      {active && !searching && shown && shown.failed && (
        <div className="mt-8 rounded-lg border border-line bg-card p-4 text-sm text-wire">
          <p className="text-ink">Search is having trouble. Try again.</p>
          <p className="mt-1">
            This is on our side, not your query. Edit the box or search the same words again.
          </p>
        </div>
      )}

      {/* FACETS — visible whenever the raw query returned anything, so filtering
          to zero still leaves the controls to undo it. Same chip pattern as the
          suggestion chips above. */}
      {active && !searching && raw && !raw.failed && rawTotal > 0 && (
        <div className="mt-6 flex flex-col gap-2 rounded-lg border border-line bg-card p-3">
          {brands.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-wire">
                Brand
              </span>
              <FacetChip active={brandFacet === null} onClick={() => setBrandFacet(null)}>
                All
              </FacetChip>
              {brands.map((b) => (
                <FacetChip
                  key={b.id}
                  active={brandFacet === b.id}
                  onClick={() => setBrandFacet(brandFacet === b.id ? null : b.id)}
                >
                  {b.name}
                </FacetChip>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-wire">
              Engine
            </span>
            <FacetChip active={engineFacet === null} onClick={() => setEngineFacet(null)}>
              All
            </FacetChip>
            {ENGINES.map((e) => (
              <FacetChip
                key={e}
                active={engineFacet === e}
                onClick={() => setEngineFacet(engineFacet === e ? null : e)}
              >
                {e}
              </FacetChip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-wire">
              When
            </span>
            {DATE_FACETS.map((d) => (
              <FacetChip
                key={d.key}
                active={dateFacet === d.key}
                onClick={() => setDateFacet(d.key)}
              >
                {d.label}
              </FacetChip>
            ))}
          </div>
        </div>
      )}

      {active && !searching && shown && !shown.failed && total === 0 && (
        <div className="mt-8 text-sm text-wire">
          {facetsActive && rawTotal > 0 ? (
            <>
              <p>
                No matches inside these filters.{" "}
                <span className="text-ink">{rawTotal}</span> result{rawTotal === 1 ? "" : "s"} without
                them.
              </p>
              <button onClick={clearFacets} className="mt-1 text-ink underline">
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p>
                No matches for &quot;<span className="text-ink">{q}</span>&quot;.
              </p>
              <p className="mt-1">Try a competitor name, a topic like pricing, or fewer words.</p>
            </>
          )}
        </div>
      )}

      {active && !searching && shown && !shown.failed && total > 0 && (
        <div className="mt-6 flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-wire">
              <span className="font-medium text-ink">{total}</span> result{total === 1 ? "" : "s"} for
              {" "}&quot;<span className="text-ink">{q}</span>&quot;
            </p>
            <Tabs value={typeTab} onValueChange={setTypeTab}>
              <TabsList>
                <TabsTrigger value="all">All {total}</TabsTrigger>
                <TabsTrigger value="answers">Answers {shown.answers.length}</TabsTrigger>
                <TabsTrigger value="fixes">Fixes {shown.fixes.length}</TabsTrigger>
                <TabsTrigger value="pages">Pages {shown.sources.length}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {(typeTab === "all" || typeTab === "answers") && shown.answers.length > 0 && (
            <section>
              <h2 className="mb-2 font-mono text-xs uppercase tracking-widest text-wire">
                In AI answers ({shown.answers.length})
              </h2>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
                {shown.answers.map((a, i) => (
                  <li key={i}>
                    <Link
                      href={`/app/run/${a.run_id}#q-${a.qid}`}
                      className="block px-4 py-3 hover:bg-paper"
                    >
                      <div className="flex min-w-0 items-center gap-2 text-xs text-wire">
                        <span className="rounded bg-ink px-1.5 py-0.5 font-mono text-[10px] text-paper">
                          {a.engine}
                        </span>
                        <RunTag meta={runMeta[a.run_id]} />
                        <span className="min-w-0 truncate">{a.question}</span>
                      </div>
                      <p className="mt-1 text-sm text-ink/80">
                        …<Highlight snip={a.snip} />…
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(typeTab === "all" || typeTab === "fixes") && shown.fixes.length > 0 && (
            <section>
              <h2 className="mb-2 font-mono text-xs uppercase tracking-widest text-wire">
                In your fix plans ({shown.fixes.length})
              </h2>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
                {shown.fixes.map((f) => (
                  <li key={f.fix_id}>
                    <Link
                      href={`/app/run/${f.run_id}#fix-plan`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-paper"
                    >
                      <span>{f.title}</span>
                      <RunTag meta={runMeta[f.run_id]} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(typeTab === "all" || typeTab === "pages") && shown.sources.length > 0 && (
            <section>
              <h2 className="mb-2 font-mono text-xs uppercase tracking-widest text-wire">
                In cited pages ({shown.sources.length})
              </h2>
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-card">
                {shown.sources.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/app/run/${s.run_id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-paper"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{s.title || hostOf(s.final_url ?? s.url)}</span>
                        <span className="ml-2 font-mono text-xs text-wire">
                          {hostOf(s.final_url ?? s.url)}
                        </span>
                      </span>
                      <RunTag meta={runMeta[s.run_id]} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
