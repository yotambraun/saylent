// PUBLIC read-only dossier — the client-deliverable surface (plan 2026-07-07).
// Outside /app/* so proxy never gates it; data via service role keyed on
// the 128-bit token; noindex (private-by-obscurity links must not be indexed).
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PendingLink } from "@/components/pending-link";
import { Brief } from "@saylent/report/components/brief";
import { Dossier } from "@saylent/report/components/dossier";
import type { RunRow } from "@saylent/report/components/run-view";
import { PublicReportHost } from "@/app/app/run/[id]/public-host";
import { CONTACT_EMAIL, PROJECT_ISSUES_URL } from "@/lib/branding";
import { getSharedRun } from "@/lib/dossier-data";
import { MODELS } from "@saylent/engine/models";
import { createAdminClient } from "@/lib/supabase/admin";

// per-engine model ids for the answer-drawer source chip (model registry)
const ENGINE_MODELS: Record<string, string> = {
  chatgpt: MODELS.chatgptAnswer,
  claude: MODELS.claudeAnswer,
  gemini: MODELS.geminiAnswer,
  perplexity: MODELS.perplexityAnswer,
};

export const metadata: Metadata = {
  title: "Saylent report",
  robots: { index: false, follow: false },
};

export default async function SharedRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  // Next 16: searchParams is a Promise in server components — must be awaited.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const shared = await getSharedRun(createAdminClient(), token);
  if (!shared) notFound();
  const { run, brand, answers, corpus, checks, fixes } = shared;
  if (!brand) notFound();

  // A shared audit opens on the summary (the answer-first lead layer);
  // ?view=full switches to the full report. Server-resolved so the choice is in
  // the URL (shareable, print-stable). demo flag stays true in both views.
  const sp = await searchParams;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const showFull = viewParam === "full";

  const brandProps = {
    name: brand.name,
    domain: brand.domain,
    aliases: (brand.aliases as string[]) ?? [],
    competitors: (brand.competitors as string[]) ?? [],
  };

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-baseline justify-between px-4 py-4">
          <span className="font-display text-lg font-semibold">
            {brand.name} · Saylent report
          </span>
          <span className="font-mono text-xs text-wire">
            Prepared with Saylent · read-only
          </span>
        </div>
      </header>
      {/* VIEW SWITCH — same segmented control as the run page; print-hidden.
          PendingLink (house nav standard) client-transitions instead of reloading
          the whole document, and shows an inline pending spinner on the clicked
          tab. Relative hrefs preserve the /share/<token> URL. */}
      <div className="view-switch-bar mx-auto mt-8 flex w-full max-w-5xl px-4 print:hidden">
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
      <main className="px-4 py-10">
        {/* PublicReportHost gives the package components the app's Link (client
            transitions) and nothing else: a share link is anonymous and read-only,
            so no server actions, no analytics beacon, no Supabase browser client. */}
        <PublicReportHost>
          {showFull ? (
            <Dossier
              run={run as unknown as RunRow}
              brand={{
                ...brandProps,
                authorized_at:
                  (brand as { authorized_at?: string | null }).authorized_at ?? null,
              }}
              answers={answers as never}
              corpus={corpus as never}
              checks={checks as never}
              fixes={fixes as never}
              demo
            />
          ) : (
            <Brief
              run={run as unknown as RunRow}
              brand={brandProps}
              answers={answers as never}
              corpus={corpus as never}
              checks={checks as never}
              fixes={fixes as never}
              engineModels={ENGINE_MODELS}
              demo
            />
          )}
        </PublicReportHost>
      </main>
      {/* Quiet conversion line — editorial, ink-tone, not a banner ad. */}
      <footer className="border-t border-line py-6 text-center font-mono text-xs text-wire">
        <p>
          Prepared with Saylent: see exactly what the AI engines say about your brand.{" "}
          <Link href="/login" className="text-ink underline underline-offset-2 hover:text-signal">
            Run yours
          </Link>
        </p>
        {/* TRUST-SAFETY: takedown intake for the subject brand. Always here —
            it is a form on this deployment, not an email address. */}
        <p className="mt-2">
          Is this about your company?{" "}
          <Link
            href={`/takedown?ref=${token}`}
            className="text-ink underline underline-offset-2 hover:text-signal"
          >
            Request a review →
          </Link>
        </p>
        {/* Who to write to about the CONTENTS of this page. With no address
            published, say so honestly instead of printing a placeholder mailbox — and point software bugs at the project, which is a
            different thing from this deployment. */}
        <p className="mt-2">
          {CONTACT_EMAIL ? (
            <>
              Corrections:{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Report%20an%20inaccuracy`}
                className="text-ink underline underline-offset-2 hover:text-signal"
              >
                {CONTACT_EMAIL}
              </a>
            </>
          ) : (
            <>
              This deployment has published no contact address; corrections go to the operator
              of this deployment through the review form above.
            </>
          )}{" "}
          · A bug in the software itself:{" "}
          <a
            href={PROJECT_ISSUES_URL}
            className="text-ink underline underline-offset-2 hover:text-signal"
          >
            open an issue
          </a>
        </p>
      </footer>
    </div>
  );
}
