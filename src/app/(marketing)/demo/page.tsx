// /demo — the sample report. Default: a CLEARLY-LABELED written-by-us report for
// the fictional "Acme Cloud" (no real brand is ever named on a public page, and no
// engine produced any answer here). The data is written rather than captured: the
// run fixture the repo ships (fixtures/run.json) is a real smoke run and carries no
// site-crawl snapshot, no brand model and no confidence band, so several panels
// would self-hide and the sample would stop being a tour of the report. If
// DEMO_RUN_ID points at a consented FULL run, that real report renders instead and
// every "written by us" label disappears with it. Reachable from the sidebar Help
// area and the top nav.
import Link from "next/link";
import { PendingLink } from "@/components/pending-link";
import { Button } from "@saylent/report/ui/button";
import { MODELS } from "@saylent/engine/models";
import { Brief } from "@saylent/report/components/brief";
import { Dossier } from "@saylent/report/components/dossier";
import type { RunRow } from "@saylent/report/components/run-view";
import { PublicReportHost } from "@/app/app/run/[id]/public-host";
import { DemoCloser } from "./demo-closer";
import { getDemoRun } from "./getDemoRun";
import {
  SAMPLE_ANSWERS,
  SAMPLE_BRAND,
  SAMPLE_CHECKS,
  SAMPLE_CORPUS,
  SAMPLE_FIXES,
  SAMPLE_RUN,
  SAMPLE_VERIFY,
} from "./sample-data";

export const revalidate = 3600;
export const metadata = { title: "Sample report · Saylent" };

// per-engine model ids for the answer-drawer source chip (model registry)
const ENGINE_MODELS: Record<string, string> = {
  chatgpt: MODELS.chatgptAnswer,
  claude: MODELS.claudeAnswer,
  gemini: MODELS.geminiAnswer,
  perplexity: MODELS.perplexityAnswer,
};

function Cta() {
  return (
    <Button asChild>
      <Link href="/login">Sign in to run your own</Link>
    </Button>
  );
}

export default async function DemoPage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise in server components — must be awaited.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const real = await getDemoRun();

  const data = real ?? {
    run: SAMPLE_RUN,
    brand: SAMPLE_BRAND,
    answers: SAMPLE_ANSWERS,
    corpus: SAMPLE_CORPUS,
    checks: SAMPLE_CHECKS,
    fixes: SAMPLE_FIXES,
  };

  // The demo opens on the summary; ?view=full switches to the full report. Both
  // data paths (real run / scripted sample) switch identically; all demo chrome
  // stays put, only the report body swaps.
  const sp = await searchParams;
  const viewParam = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const showFull = viewParam === "full";

  const brandProps = {
    name: data.brand.name,
    domain: data.brand.domain,
    aliases: [...(data.brand.aliases as string[])],
    competitors: [...(data.brand.competitors as string[])],
  };

  return (
    <div className="relative px-4 py-10">
      {/* THE STAMP. Absolutely positioned from `sm` up, where there is margin
          for it to sit in; on a phone it was printed straight over the middle
          line of the disclaimer paragraph below, so below `sm`
          it is a normal block that flows above the banner. */}
      {!real && (
        <div className="pointer-events-none mx-auto mb-3 w-fit rounded border-2 border-signal bg-paper px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-widest text-signal shadow-md print:hidden sm:absolute sm:right-4 sm:top-20 sm:z-50 sm:mx-0 sm:mb-0 sm:rotate-2">
          Written by us · not engine output
        </div>
      )}
      {/* BANNER — honesty first: labeled as written-by-us unless a consented real run exists */}
      <div className="mx-auto mb-10 flex w-full max-w-5xl flex-col items-start justify-between gap-4 rounded-lg border-2 border-signal bg-card p-5 sm:flex-row sm:items-center">
        <p className="max-w-xl text-sm">
          {real ? (
            <>
              This is a real, unedited Saylent audit of{" "}
              <strong>{(data.brand as { name: string }).name}</strong>. Every number below opens
              its receipt. Run it for your brand →
            </>
          ) : (
            <>
              <strong>Acme Cloud is a fictional company.</strong> Every answer on this page is
              written by us to show the report&apos;s panels; no engine produced them. The engine
              names and model labels are illustrative too: they mark where a real engine&apos;s
              answer would sit, not anything an engine said. Your report runs on your live data
              across all 23 questions on ChatGPT, Claude, Gemini and Perplexity, every answer
              stored, every number opening its receipt. Run it for your brand →
            </>
          )}
        </p>
        <Cta />
      </div>

      {/* VIEW SWITCH — same segmented control as the run page; print-hidden.
          PendingLink (house nav standard) client-transitions instead of reloading
          the whole document, and shows an inline pending spinner on the clicked
          tab. Links preserve the /demo URL so the choice is shareable. */}
      <div className="view-switch-bar mx-auto mb-6 flex w-full max-w-5xl print:hidden">
        <div className="inline-flex rounded-lg border border-line p-0.5 font-mono text-xs">
          <PendingLink
            href="/demo?view=brief"
            aria-current={showFull ? undefined : "page"}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              showFull ? "text-wire hover:text-ink" : "bg-ink text-paper"
            }`}
          >
            The summary
          </PendingLink>
          <PendingLink
            href="/demo?view=full"
            aria-current={showFull ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              showFull ? "bg-ink text-paper" : "text-wire hover:text-ink"
            }`}
          >
            Full report
          </PendingLink>
        </div>
      </div>

      {/* the report as a crafted document: elevated paper frame, not a webpage.
          The body swaps Brief ⇄ Dossier; the frame + all demo chrome stay put. */}
      <div className="mx-auto w-full max-w-6xl rounded-xl border border-line bg-paper px-4 py-10 shadow-[0_2px_8px_rgba(20,33,43,0.06),0_16px_48px_rgba(20,33,43,0.10)] sm:px-10">
        {/* PublicReportHost gives the package components the app's Link (client
            transitions) and nothing else: no server actions, no analytics beacon,
            no Supabase in the marketing bundle. */}
        <PublicReportHost>
          {showFull ? (
            <Dossier
              run={data.run as RunRow}
              brand={brandProps}
              answers={structuredClone(data.answers) as never}
              corpus={structuredClone(data.corpus) as never}
              checks={structuredClone(data.checks) as never}
              fixes={structuredClone(data.fixes) as never}
              demo
            />
          ) : (
            <Brief
              run={data.run as RunRow}
              brand={brandProps}
              answers={structuredClone(data.answers) as never}
              corpus={structuredClone(data.corpus) as never}
              checks={structuredClone(data.checks) as never}
              fixes={structuredClone(data.fixes) as never}
              engineModels={ENGINE_MODELS}
              demo
            />
          )}
        </PublicReportHost>
      </div>

      {/* THE RETENTION STORY — what happens after you ship. Written by us like the
          rest of the sample, and labelled as such right where the numbers are. */}
      {!real && (
        <section className="mx-auto mt-16 w-full max-w-5xl rounded-lg border border-line bg-card p-8">
          <p className="font-mono text-xs uppercase tracking-widest text-wire">
            Two weeks later: the verify re-run
          </p>
          <p className="mt-2 text-sm text-wire">
            Written by us, like the rest of this sample. A real verify re-run reports whatever
            the engines say, including no movement.
          </p>
          <p className="mt-4 font-display text-3xl">
            Recommended {SAMPLE_VERIFY.before} <span className="text-signal">→</span>{" "}
            {SAMPLE_VERIFY.after} of category answers
          </p>
          <ul className="mt-6 flex flex-col gap-2 text-sm">
            {SAMPLE_VERIFY.notes.map((n) => (
              <li key={n.fix} className="flex gap-2">
                <span className="text-success">•</span>
                <span>
                  <strong>{n.fix}:</strong> {n.note}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-wire">
            Every audit includes one verify re-run on the same frozen questions: honest
            movement, and &quot;no movement yet&quot; when that&apos;s the truth. How often you can
            re-measure after that is set by whoever operates this deployment.
          </p>
        </section>
      )}

      {/* CLOSING CTA */}
      <div
        id="demo-cta"
        className="mx-auto mt-16 flex w-full max-w-5xl scroll-mt-8 flex-col items-center gap-4 rounded-lg border-2 border-ink p-8 text-center"
      >
        <h2 className="font-display text-2xl">Every number in your report will be yours.</h2>
        <p className="max-w-lg text-sm text-ink/80">
          Real answers from the four engines, the real pages they cite, your real gaps, and
          the fixes drafted, ready to ship.
        </p>
        <Cta />
      </div>

      {/* ONE-ACTION CLOSER — a thin sticky bar after ~25% scroll (sample view only,
          dismissible, print-hidden), sign-in CTA. */}
      {!real && <DemoCloser />}
    </div>
  );
}
