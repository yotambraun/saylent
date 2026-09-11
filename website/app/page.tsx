// website/app/page.tsx - landing page, final copy: one screen, then
// proof, then the two doors, using the canonical line/names.
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { InstantCheck } from "@/components/instant-check";
import { SampleEmbed } from "@/components/sample-embed";
import { LICENSE_URL, REPO_URL, SiteHeader } from "@/components/site-header";
import { ThemedImage } from "@/components/site-image";

// GitHub Pages serves this repo at a sub-path (next.config.ts) - a raw string
// src/data attribute isn't rewritten by Next the way next/link and next/image
// are, so the prefix is applied by hand here, the same way next.config.ts
// computes it.
const BASE_PATH = process.env.SITE_BASE_PATH === "1" ? "/saylent" : "";
const SAMPLE_REPORT_SRC = `${BASE_PATH}/samples/kestrel/report.html`;

// The home page is the one route that must not inherit the bare "Saylent"
// title from the layout template - it is what a search result and a Slack
// unfurl show above the description. Every other page keeps
// layout.tsx's "%s · Saylent".
export const metadata: Metadata = {
  title: "Saylent: the open-source audit of what AI assistants say about your brand",
};

// Each receipt links into the section of the published sample report it was
// screenshotted from - the anchors are the report's own ids (examples/kestrel/
// report.html: #brief, #source-map, #gates, #fix-plan).
const RECEIPTS = [
  {
    title: "Verdict",
    slug: "verdict",
    anchor: "brief",
    body: '"Kestrel Uptime is in none of the 11 scored answers. Upcheck is named most, 17 times, and upcheck.example is the page they cite most."',
    alt: "The verdict block of a report: the headline finding, recommended and mentioned counts, and the top rival",
  },
  {
    title: "Receipt",
    slug: "answer",
    anchor: "source-map",
    body: "The exact answer, the engine, the date, and the page it was built from.",
    alt: "Per engine, the pages its answers cited and how often",
  },
  {
    title: "Gate",
    slug: "gate",
    anchor: "gates",
    body: "Which AI bots your site lets in, tested live - not just robots.txt.",
    alt: "The site access checks: one row per AI bot, with the status and what it means",
  },
  {
    title: "Fix",
    slug: "fix",
    anchor: "fix-plan",
    body: "Drafted, evidence-anchored, ready to ship: JSON-LD, a comparison page, entity copy.",
    alt: "A drafted fix, with the quoted answers that justify it",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      {/* w-full is load-bearing: fumadocs' reset makes <body> a column flex
          container, and `mx-auto` on a flex item turns OFF cross-axis stretch -
          so without an explicit width this <main> sized itself to its
          min-content (438px) and the whole page scrolled sideways on a 390px
          phone. */}
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-24 px-6 py-16 sm:py-20">
        {/* Hero + report embed */}
        <section className="flex flex-col gap-8 text-center">
          <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">
            The open-source audit of what AI assistants say about your brand
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-wire">
            With the receipts: every verdict traced to the answer, the cited page, and the fix.
            Run it on your own domain, with your own keys.
          </p>

          <div className="mx-auto w-full max-w-xl text-left">
            <CopyCommand command="npx saylent audit example.com" />
            <p className="mt-2 text-center text-xs text-wire">
              Needs one OpenAI or Anthropic key (both for cross-family judging) · about $0.40 to $1.20 with four engines, of your own credits
            </p>
            <p className="mt-5 text-center">
              <Link
                href="/docs/self-host"
                className="inline-block rounded-lg border border-line bg-card px-4 py-2 text-sm text-ink transition-colors hover:border-wire"
              >
                Deploy the full app
              </Link>
            </p>
          </div>

          <div className="mx-auto w-full max-w-4xl">
            <div className="relative overflow-hidden rounded-xl border border-line bg-card">
              <SampleEmbed src={SAMPLE_REPORT_SRC} className="h-80 w-full sm:h-[32rem]" />
              {/* The frame is a deliberate peek, so the crop fades out instead of
                  ending mid-sentence like a rendering bug. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-card"
              />
            </div>
            <p className="mt-3 text-sm text-wire">
              <a href={SAMPLE_REPORT_SRC} className="text-signal underline">
                Open the full sample report
              </a>{" "}
              - a real run against Kestrel Uptime, a fictional company we audit.
            </p>
          </div>

          <div className="mx-auto mt-6 w-full max-w-xl text-left">
            <InstantCheck />
          </div>
        </section>

        {/* Two doors */}
        <section className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/docs/quickstart"
            className="rounded-lg border border-line bg-card p-6 transition-colors hover:border-wire"
          >
            <h2 className="font-display text-xl text-ink">Run it now</h2>
            <p className="mt-2 text-sm text-wire">
              One command, five minutes: keys, <code>npx saylent audit</code>, open the report.
            </p>
          </Link>
          <Link
            href="/docs/self-host"
            className="rounded-lg border border-line bg-card p-6 transition-colors hover:border-wire"
          >
            <h2 className="font-display text-xl text-ink">Deploy the full app</h2>
            <p className="mt-2 text-sm text-wire">
              History, scheduled verifies, multiple users on one deployment, and share links - on
              infrastructure you own.
            </p>
          </Link>
        </section>

        {/* Four receipts - one per row, big enough to actually read. */}
        <section className="flex flex-col gap-6">
          <h2 className="text-center font-display text-2xl text-ink">
            What you get - four receipts, one screenshot each
          </h2>
          <div className="flex flex-col gap-10">
            {RECEIPTS.map((r) => (
              <div
                key={r.title}
                className="grid items-start gap-6 lg:grid-cols-[minmax(0,720px)_minmax(220px,1fr)]"
              >
                <a
                  href={`${SAMPLE_REPORT_SRC}#${r.anchor}`}
                  className="block overflow-hidden rounded-lg border border-line bg-card transition-colors hover:border-wire"
                >
                  <ThemedImage
                    light={`/media/receipt-${r.slug}-light.png`}
                    dark={`/media/receipt-${r.slug}-dark.png`}
                    alt={r.alt}
                    className="w-full"
                  />
                </a>
                <div className="lg:pt-2">
                  <h3 className="font-mono text-xs uppercase tracking-wide text-signal">
                    {r.title}
                  </h3>
                  <p className="mt-2 text-sm text-ink">{r.body}</p>
                  <p className="mt-3 text-sm">
                    <a href={`${SAMPLE_REPORT_SRC}#${r.anchor}`} className="text-signal underline">
                      See it in the sample report
                    </a>
                  </p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-wire">
            Every screenshot is generated from the sample run, never hand-edited.
          </p>
        </section>

        {/* The pipeline, in one picture */}
        <section className="flex flex-col gap-5 border-t border-line pt-10 text-center">
          <h2 className="font-display text-2xl text-ink">Nine stages, every one inspectable</h2>
          <p className="mx-auto max-w-2xl text-sm text-wire">
            Crawl, brand model, questions, engines, judge, cited pages, site gates, fix plan,
            score. Each stage narrates itself as it runs, and each one says exactly where you can
            change it.
          </p>
          <ThemedImage
            light="/brand/pipeline-light.svg"
            dark="/brand/pipeline-dark.svg"
            alt="The nine audit stages in order: crawl, brand model, questions, engines, judge, cited pages, site gates, fix plan, score"
            className="mx-auto w-full max-w-4xl"
          />
          <p>
            <Link href="/docs/how-it-works" className="text-sm text-signal underline">
              How it works, stage by stage
            </Link>
          </p>
        </section>

        {/* Methodology strip */}
        <section className="flex flex-col gap-3 border-t border-line pt-10 text-center">
          <h2 className="font-display text-xl text-ink">Methodology, in five sentences</h2>
          <p className="mx-auto max-w-2xl text-sm text-wire">
            We ask real buyer questions to real AI engines through their official APIs, twice each,
            and record every answer verbatim. Presence is decided by a deterministic alias match; a
            judge model from the other provider family decides the rest, quoting its reasoning
            first. We fetch the pages an answer cites and check them for the same presence - word
            match, not entailment. We report a confidence band, never a single fake-precise number.
            We do not claim traffic, revenue, or ranking effects - only what the assistants answered
            and what it traces back to.
          </p>
          <Link href="/docs/methodology" className="text-sm text-signal underline">
            Full methodology, limits, and the golden set
          </Link>
        </section>

        {/* Two more entrances */}
        <section className="grid gap-4 border-t border-line pt-10 sm:grid-cols-3">
          <Link href="/docs/integrations" className="rounded-lg border border-line bg-card p-5">
            <h3 className="font-display text-base text-ink">Use it as a library</h3>
            <p className="mt-2 text-sm text-wire">
              <code>@saylent/engine</code> and <code>@saylent/report</code> - audit and render from
              your own code.
            </p>
          </Link>
          <Link href="/docs/costs" className="rounded-lg border border-line bg-card p-5">
            <h3 className="font-display text-base text-ink">What it costs</h3>
            <p className="mt-2 text-sm text-wire">
              Real numbers by profile, before you run anything. Your keys, your dollars.
            </p>
          </Link>
          <Link href="/docs/data-sent" className="rounded-lg border border-line bg-card p-5">
            <h3 className="font-display text-base text-ink">What gets sent to providers</h3>
            <p className="mt-2 text-sm text-wire">
              Exactly what leaves your machine. No telemetry, anywhere.
            </p>
          </Link>
        </section>

        <footer className="flex flex-col items-center gap-3 border-t border-line pt-8 text-xs text-wire">
          <nav className="flex flex-wrap justify-center gap-4">
            <Link href="/docs">Docs</Link>
            <a href={REPO_URL}>GitHub</a>
            <a href={LICENSE_URL}>Apache-2.0</a>
            <Link href="/docs/contributing">Contributing</Link>
            <Link href="/policy/sample-data">Sample data policy</Link>
            <Link href="/changelog">Changelog</Link>
          </nav>
          <p>Sample subject: Kestrel Uptime, a fictional company we audit.</p>
        </footer>
      </main>
    </>
  );
}
