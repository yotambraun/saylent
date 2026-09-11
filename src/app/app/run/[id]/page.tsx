// /app/run/[id] — RUNNING mode (Realtime checklist) and DONE
// mode (THE DOSSIER — section order is law). RLS-scoped reads.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchDossierViaRpc } from "@/lib/dossier-data";
import { MODELS } from "@saylent/engine/models";
import type { TheaterQuestion } from "@saylent/report/theater";
import { createClient } from "@/lib/supabase/server";
import { PendingLink } from "@/components/pending-link";
import { Brief } from "@saylent/report/components/brief";
import { Dossier } from "@saylent/report/components/dossier";
import { RunView, type RunRow } from "@saylent/report/components/run-view";
import { NextReportHost } from "./host";
import { ReportActionRow } from "./report-actions";
import chrome from "./report-chrome.module.css";

// Per-run tab title: one lightweight RLS-scoped read of the brand name (NOT the
// full get_dossier RPC the page runs) so an owner sees "{Brand} — dossier". An
// unowned / missing / unauthed run falls back to a generic honest title; the page
// itself throws notFound() (rendered by ./not-found.tsx). Next 16: a segment may
// export ONE of `metadata` or `generateMetadata`, never both.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("runs").select("brands(name)").eq("id", id).maybeSingle();
    const b = (data as { brands?: { name?: string } | { name?: string }[] | null } | null)?.brands;
    const name = Array.isArray(b) ? b[0]?.name : b?.name;
    return { title: name ? `${name} · report · Saylent` : "Report · Saylent" };
  } catch {
    return { title: "Report · Saylent" };
  }
}

const MODELS_USED = `${MODELS.chatgptAnswer} · ${MODELS.claudeAnswer} · ${MODELS.geminiAnswer} · ${MODELS.perplexityAnswer}`;
// per-engine model ids for the answer-drawer source chip (from the model registry)
const ENGINE_MODELS: Record<string, string> = {
  chatgpt: MODELS.chatgptAnswer,
  claude: MODELS.claudeAnswer,
  gemini: MODELS.geminiAnswer,
  perplexity: MODELS.perplexityAnswer,
};

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // Next 16: searchParams is a Promise in server components — must be awaited.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  // ONE round trip (get_dossier, migration 0014): 373ms/RTT measured — the
  // report's DB time is now a single batch. RLS applies inside the function.
  const d = await fetchDossierViaRpc(supabase, id);
  if (!d) notFound();
  const run = d.run;
  const brand = d.brand;

  if (run.status !== "done") {
    // get_dossier omits question_set (TRULY lean since migration 0039 — the RPC
    // used to leak it via to_jsonb(r); the audit caught the drift) — fetch it here,
    // only while a run is live, so the Audit Theater can build its board. One
    // small RLS-scoped read; absent set ⇒ RunView falls back to the checklist.
    const brandId = (run as { brand_id?: string }).brand_id;
    let questionSet: TheaterQuestion[] | null = null;
    if (brandId) {
      const { data: qs } = await supabase
        .from("brands")
        .select("question_set")
        .eq("id", brandId)
        .maybeSingle();
      const stored = (qs?.question_set as { questions?: TheaterQuestion[] } | null) ?? null;
      questionSet = stored?.questions?.length ? stored.questions : null;
    }
    return (
      <NextReportHost>
        <RunView
          initial={run as unknown as RunRow}
          brandName={brand?.name ?? ""}
          brandDomain={brand?.domain ?? ""}
          questionSet={questionSet}
        />
      </NextReportHost>
    );
  }

  // finished verify runs render the comparison view, not a dossier
  if (run.kind === "verify") redirect(`/app/run/${id}/verify`);

  const prevScores = d.previous?.scores as { overall?: { rec_rate: number | null } } | null;
  const previous = d.previous
    ? {
        pct: Math.round((prevScores?.overall?.rec_rate ?? 0) * 100),
        date: new Date(d.previous.finished_at ?? d.previous.created_at).toLocaleDateString(
          "en-GB",
          { day: "2-digit", month: "short" },
        ),
      }
    : null;

  // A done audit opens on THE BRIEF (the answer-first lead layer);
  // ?view=full switches to the full dossier. Server-resolved so the choice is in
  // the URL (shareable, print-stable). Verify runs already redirected above.
  const sp = await searchParams;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const showFull = viewParam === "full";

  const brandProps = {
    name: brand?.name ?? "",
    domain: brand?.domain ?? "",
    aliases: brand?.aliases ?? [],
    competitors: brand?.competitors ?? [],
  };

  return (
    // The report components are @saylent/report now; NextReportHost gives them the
    // app's Link, analytics, server actions and live feed.
    <NextReportHost>
      {/* THE ACTION ROW — back · share · export · print, on BOTH layers. It used to live inside <Dossier>, which meant the Brief had none
          of it and the row could not wrap on a phone. `chrome.appChrome` hides the
          dossier's own copy; see report-chrome.module.css. */}
      <ReportActionRow
        runId={run.id}
        brandName={brandProps.name}
        shareToken={run.share_token ?? null}
      />

      {/* VIEW SWITCH — segmented control above either view; print-hidden (the
          printable artifact is the dossier only). PendingLink (house nav standard)
          does a client transition — no full-document reload of the 3,000-line
          dossier — and shows an inline pending spinner on the clicked tab, the
          guaranteed "your click registered" feedback while the new view renders.
          Relative hrefs preserve the run URL (resolveHref bases them on asPath). */}
      <div className="view-switch-bar mx-auto mb-6 flex w-full max-w-5xl print:hidden">
        <div className="inline-flex rounded-lg border border-line p-0.5 font-mono text-xs">
          <PendingLink
            href="?view=brief"
            aria-current={showFull ? undefined : "page"}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              showFull ? "text-wire hover:text-ink" : "bg-ink text-paper"
            }`}
          >
            The summary
          </PendingLink>
          <PendingLink
            href="?view=full"
            aria-current={showFull ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              showFull ? "bg-ink text-paper" : "text-wire hover:text-ink"
            }`}
          >
            Full report
          </PendingLink>
        </div>
      </div>

      <div className={chrome.appChrome}>
        {showFull ? (
          <Dossier
            run={run as unknown as RunRow}
            brand={{
              ...brandProps,
              authorized_at:
                (brand as { authorized_at?: string | null } | null)?.authorized_at ?? null,
            }}
            answers={d.answers as never}
            corpus={d.corpus as never}
            checks={d.checks as never}
            fixes={d.fixes as never}
            modelsUsed={MODELS_USED}
            engineModels={ENGINE_MODELS}
            previous={previous}
            shareToken={run.share_token ?? null}
          />
        ) : (
          <Brief
            run={run as unknown as RunRow}
            brand={brandProps}
            answers={d.answers as never}
            corpus={d.corpus as never}
            checks={d.checks as never}
            fixes={d.fixes as never}
            engineModels={ENGINE_MODELS}
            previous={
              d.previous
                ? {
                    recommended:
                      (d.previous.scores as { overall?: { recommended?: number; answered?: number } } | null)
                        ?.overall?.recommended ?? 0,
                    answered:
                      (d.previous.scores as { overall?: { recommended?: number; answered?: number } } | null)
                        ?.overall?.answered,
                    date: new Date(d.previous.finished_at ?? d.previous.created_at).toLocaleDateString(
                      "en-GB",
                      { day: "2-digit", month: "short" },
                    ),
                  }
                : null
            }
          />
        )}
      </div>
    </NextReportHost>
  );
}
