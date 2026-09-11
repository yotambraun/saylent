// /app/compare — THE compare destination (sidebar entry; project rule: compare is a
// real page, not a bounce). Brand chips (when several brands qualify) + the
// full rival head-to-head inline: ?brand= picks the brand (defaults to the
// newest audited one), ?rival= picks the rival. /app/brand/[id]/vs redirects
// here so older links keep working. Same single-RPC read as the run page;
// all composition is $0 in src/lib/compare.ts.
import type { Metadata } from "next";
import Link from "next/link";
import { PendingLink } from "@/components/pending-link";
import { Button } from "@saylent/report/ui/button";
import { buildRivalCompare, rivalOptions, type CompareInput } from "@saylent/report/compare";
import { fetchDossierViaRpc } from "@/lib/dossier-data";
import { MODELS } from "@saylent/engine/models";
import { createClient } from "@/lib/supabase/server";
import { VsClient } from "../brand/[id]/vs/vs-client";

export const metadata: Metadata = { title: "Compare · Saylent" };

const ENGINE_MODELS: Record<string, string> = {
  chatgpt: MODELS.chatgptAnswer,
  claude: MODELS.claudeAnswer,
  gemini: MODELS.geminiAnswer,
  perplexity: MODELS.perplexityAnswer,
};

function Shell({ children, picker }: { children: React.ReactNode; picker?: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {picker}
      {children}
    </div>
  );
}

/** honest empty state — a note + a next step, never a blank page */
function EmptyCompare({ headline, body }: { headline: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-card py-16 text-center">
      <p className="max-w-md font-display text-xl">{headline}</p>
      <p className="max-w-md text-sm text-wire">{body}</p>
      <Button asChild>
        <Link href="/app/onboarding">Run an audit</Link>
      </Button>
    </div>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string | string[]; rival?: string | string[] }>;
}) {
  const sp = await searchParams;
  const brandParam = Array.isArray(sp.brand) ? sp.brand[0] : sp.brand;
  const rivalParam = Array.isArray(sp.rival) ? sp.rival[0] : sp.rival;
  const supabase = await createClient();

  // independent reads → ONE parallel round-trip (perf audit #8; the dashboard
  // does the same for runs+profile)
  const [brandsRes, doneAuditsRes] = await Promise.all([
    supabase
      .from("brands")
      .select("id,name,domain,aliases,competitors,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    // brands that actually have a finished audit (the head-to-head's raw material)
    supabase
      .from("runs")
      .select("brand_id")
      .eq("kind", "audit")
      .eq("status", "done")
      .is("hidden_at", null),
  ]);
  const { data: brandsData, error: brandsError } = brandsRes;
  if (brandsError) throw brandsError;
  const brands = brandsData ?? [];
  const { data: doneAudits, error: runsError } = doneAuditsRes;
  if (runsError) throw runsError;
  const auditedIds = new Set((doneAudits ?? []).map((r) => r.brand_id));
  const eligible = brands.filter((b) => auditedIds.has(b.id));

  if (eligible.length === 0) {
    return (
      <Shell>
        <h1 className="font-display text-2xl">Compare with a rival</h1>
        <EmptyCompare
          headline="The head-to-head needs a finished audit first."
          body="It reads the rivals the engines actually named in your answers. Run an audit, then come back to compare."
        />
      </Shell>
    );
  }

  const brand = eligible.find((b) => b.id === brandParam) ?? eligible[0];

  // brand chips — only when there is a real choice to make
  const picker =
    eligible.length > 1 ? (
      <nav aria-label="Compare which brand" className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-wire">Brand</span>
        {eligible.map((b) => {
          const active = b.id === brand.id;
          return (
            <PendingLink
              key={b.id}
              href={`/app/compare?brand=${b.id}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1.5 font-mono text-xs transition-colors pointer-coarse:min-h-11 ${
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-wire hover:border-ink/40 hover:text-ink"
              }`}
            >
              {b.name}
            </PendingLink>
          );
        })}
      </nav>
    ) : undefined;

  // latest done audit, full profile preferred over smoke (richer head-to-head)
  const { data: runsForBrand, error: brandRunsError } = await supabase
    .from("runs")
    .select("id,profile,created_at,finished_at")
    .eq("brand_id", brand.id)
    .eq("status", "done")
    .eq("kind", "audit")
    .is("hidden_at", null)
    .order("created_at", { ascending: false });
  if (brandRunsError) throw brandRunsError;
  const chosen = (runsForBrand ?? []).find((r) => r.profile !== "smoke") ?? (runsForBrand ?? [])[0];
  if (!chosen) {
    return (
      <Shell picker={picker}>
        <EmptyCompare
          headline={`No completed audit for ${brand.name} yet.`}
          body="A rival head-to-head reads from a finished audit's stored answers. Run one, then come back to compare."
        />
      </Shell>
    );
  }

  const d = await fetchDossierViaRpc(supabase, chosen.id);
  if (!d) {
    return (
      <Shell picker={picker}>
        <EmptyCompare
          headline={`We couldn't open ${brand.name}'s latest audit.`}
          body="The run is untouched. Try again in a moment, or open it from the brand's movement page."
        />
      </Shell>
    );
  }

  const input: CompareInput = {
    brand: {
      name: brand.name,
      domain: brand.domain,
      aliases: (brand.aliases as string[] | null) ?? [],
      competitors: (brand.competitors as string[] | null) ?? [],
    },
    scores: (d.run.scores as CompareInput["scores"]) ?? null,
    answers: d.answers as CompareInput["answers"],
    corpus: d.corpus as CompareInput["corpus"],
  };

  const options = rivalOptions(input);
  if (options.length === 0) {
    return (
      <Shell picker={picker}>
        <EmptyCompare
          headline="This run didn't name a single rival to compare against."
          body="The engines mentioned no competitor by name in the scored answers, so there's no head-to-head to draw yet."
        />
      </Shell>
    );
  }

  const rival =
    options.find((o) => o.name.toLowerCase() === (rivalParam ?? "").toLowerCase())?.name ??
    options[0].name;
  const compare = buildRivalCompare(input, rival);
  const runDate = new Date(d.run.finished_at ?? d.run.created_at).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <Shell picker={picker}>
      <VsClient
        brandId={brand.id}
        brand={{
          name: brand.name,
          domain: brand.domain,
          aliases: (brand.aliases as string[] | null) ?? [],
          competitors: (brand.competitors as string[] | null) ?? [],
        }}
        options={options}
        compare={compare}
        answers={d.answers as never}
        corpus={d.corpus as never}
        engineModels={ENGINE_MODELS}
        runId={chosen.id}
        runDate={runDate}
        rivalHrefBase={`/app/compare?brand=${brand.id}&rival=`}
      />
    </Shell>
  );
}
