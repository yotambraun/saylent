// website/app/page.tsx - the landing page tells the same six-section story as
// the docs sidebar, the docs start page and the README, in the same order and
// under the same names: run it once, keep score as a team, operate it for
// others, automate, understand, project.
import type { Metadata } from "next";
import Link from "next/link";
import { CopyCommand } from "@/components/copy-command";
import { InstantCheck } from "@/components/instant-check";
import { SampleEmbed } from "@/components/sample-embed";
import { LICENSE_URL, REPO_URL, SiteHeader } from "@/components/site-header";
import { SiteImage, ThemedImage } from "@/components/site-image";

// GitHub Pages serves this repo at a sub-path (next.config.ts) - a raw string
// src/data attribute isn't rewritten by Next the way next/link and next/image
// are, so the prefix is applied by hand here, the same way next.config.ts
// computes it.
const BASE_PATH = process.env.SITE_BASE_PATH === "1" ? "/saylent" : "";
const SAMPLE_REPORT_SRC = `${BASE_PATH}/samples/kestrel/report.html`;
const DEMO_URL = "https://saylent-demo.vercel.app/app";

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
    body: "Which AI bots your site lets in, tested live, not guessed from robots.txt.",
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

// The six sections, in the order the docs sidebar, the docs start page and the
// README use them. `image` is the one screen that proves the section; a block
// without one spans the full row instead of leaving a gap.
const SECTIONS: {
  title: string;
  body: string;
  href: string;
  cta: string;
  external?: boolean;
  image?: { light: string; dark: string; alt: string } | { src: string; alt: string };
  /** For the one section whose proof is a file, not a screen: the panel is the
   *  file itself, framed like its neighbours' screenshots. */
  snippet?: { file: string; code: string };
}[] = [
  {
    title: "Run it once",
    body: "One command, your own keys, and a report you can open from disk, email, or drop in a ticket. It prints what it is about to spend before it spends anything, and a dry run costs $0.",
    href: "/docs/quickstart",
    cta: "Keys, the command, the report",
    image: {
      src: "/media/cli.gif",
      alt: "A terminal running npx saylent audit: the engines, judge and profile lines, then all nine numbered stages, then the verdict, the band and the report path",
    },
  },
  {
    title: "Keep score as a team",
    body: "Two people, five brands and a year of runs do not fit in a folder. Deploy the same engine with a memory: history, a fix tracker that knows what you shipped, scheduled verifies and share links. One deployment, as many user accounts as you like, each isolated from the others, on infrastructure you own.",
    href: "/docs/tour",
    cta: "Every screen of the app",
    image: {
      light: "/media/app-dashboard-light.png",
      dark: "/media/app-dashboard-dark.png",
      alt: "The Saylent dashboard: a next-move strip, a brand card with its recommended score and buttons to open the latest report or run a verify, and a recent-runs table",
    },
  },
  {
    title: "Operate it for others",
    body: "Somebody owns the keys, the bill and the blast radius. The operator console is the daily spend cap, the kill switch that stops every run at once, a model per role with no redeploy, and an append-only log of who changed what.",
    href: "/docs/self-host/admin",
    cta: "The operator console",
    image: {
      light: "/media/app-admin-budget-light.png",
      dark: "/media/app-admin-budget-dark.png",
      alt: "The budget and limits screen: a seven-day spend table against the daily cap, a Pause all runs kill switch, and a daily spend cap field with a required reason",
    },
  },
  {
    title: "Automate",
    body: "The same checks on every push, inside your agent, or inside your own program. The CI gate costs $0 and needs no keys; the MCP server and the library spend only your own credits, under the same ceiling the command respects.",
    href: "/docs/integrations",
    cta: "The Action, the MCP server, the library",
    snippet: {
      file: ".github/workflows/ai-access.yml",
      code: `on: [push]
jobs:
  ai-access:
    runs-on: ubuntu-latest
    steps:
      - uses: yotambraun/saylent@v0
        with:
          domain: example.com`,
    },
  },
  {
    title: "Understand",
    body: "Nine stages, each one narrating itself and each one saying where you can change it. Presence is a deterministic alias match, everything else is judged by a model from the other provider family, and the report states a band instead of a number the draws cannot support.",
    href: "/docs/how-it-works",
    cta: "How it works, stage by stage",
    image: {
      light: "/brand/pipeline-light.svg",
      dark: "/brand/pipeline-dark.svg",
      alt: "The nine audit stages in order: crawl, brand model, questions, engines, judge, cited pages, site gates, fix plan, score",
    },
  },
  {
    title: "Project",
    body: "Apache-2.0, solo-maintained, and the test suite runs at $0 with no keys and no database. Adding an answer engine is one file implementing one interface; adding a site check is one registry entry and one test.",
    href: "/docs/contributing",
    cta: "Contribute, or read the changelog",
  },
];

const FRAME = "overflow-hidden rounded-lg border border-line bg-card";
const CAPTION = "mt-3 text-sm text-wire";
const CARD = "rounded-lg border border-line bg-card p-5 transition-colors hover:border-wire";

// The four receipts. They live INSIDE "Run it once" (see the section map
// below): they are what that one command hands you, not a seventh part
// arriving after the story has closed.
function Receipts() {
  return (
    <div className="flex flex-col gap-6">
      <h3 className="font-display text-xl text-ink">
        What the command hands you: four receipts, one screenshot each
      </h3>
      <div className="flex flex-col gap-10">
        {RECEIPTS.map((r) => (
          <div
            key={r.title}
            className="grid items-start gap-6 lg:grid-cols-[minmax(0,720px)_minmax(220px,1fr)]"
          >
            <a href={`${SAMPLE_REPORT_SRC}#${r.anchor}`} className={`block ${FRAME} hover:border-wire`}>
              <ThemedImage
                light={`/media/receipt-${r.slug}-light.png`}
                dark={`/media/receipt-${r.slug}-dark.png`}
                alt={r.alt}
                className="w-full"
              />
            </a>
            <div className="lg:pt-2">
              <h4 className="font-mono text-xs uppercase tracking-wide text-signal">{r.title}</h4>
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
      <p className="text-xs text-wire">
        Every screenshot is generated from the sample run, never hand-edited.
      </p>
    </div>
  );
}

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
        {/* Fold: the headline, the one command, and the two things you can open
            right now - the report it writes, and the app it writes into. */}
        <section className="flex flex-col gap-10">
          <div className="flex flex-col gap-6 text-center">
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
                One OpenAI or Anthropic key runs the audit with that engine. Two keys turn on the
                cross-family judge; Gemini and Perplexity keys add those engines.
              </p>
              <p className="mt-1 text-center text-xs text-wire">
                All four: about $0.60 to $1.20 a run, of your own credits. Our two recorded runs
                cost $0.93 and $1.11.
              </p>
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-2">
            <figure className="m-0">
              <div className={`relative ${FRAME}`}>
                <SampleEmbed src={SAMPLE_REPORT_SRC} className="h-80 w-full lg:h-[26rem]" />
                {/* The frame is a deliberate peek, so the crop fades out instead of
                    ending mid-sentence like a rendering bug. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-card"
                />
              </div>
              <figcaption className={CAPTION}>
                <a href={SAMPLE_REPORT_SRC} className="text-signal underline">
                  Open the full sample report
                </a>
                : a real run against Kestrel Uptime, a fictional company we audit.
              </figcaption>
            </figure>

            <figure className="m-0">
              <a href={DEMO_URL} className={`block ${FRAME} hover:border-wire`}>
                <ThemedImage
                  light="/media/app.gif"
                  dark="/media/app-dark.gif"
                  alt="Eight screens of the Saylent app in sequence: your brands, the question editor with its live price, the summary, the full report, the fix tracker, the rival comparison, the operator's keys and models, and the operator's budget and kill switch"
                  className="h-80 w-full object-cover object-top lg:h-[26rem]"
                />
              </a>
              <figcaption className={CAPTION}>
                <a href={DEMO_URL} className="text-signal underline">
                  Open the live demo
                </a>
                : the same run inside the app, with history, a fix tracker and share links. Nothing
                saves, no account.
              </figcaption>
            </figure>
          </div>

          <div className="mx-auto w-full max-w-xl text-left">
            <InstantCheck />
          </div>
        </section>

        {/* The six sections, same names and same order as the docs sidebar. The
            receipts hang under the first one, because the receipts are what
            that one command hands you - not a seventh part after the story. */}
        <section className="flex flex-col gap-14">
          {SECTIONS.map((s) => (
            <div key={s.title} className="flex flex-col gap-10">
            <div
              className="grid items-start gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]"
            >
              <div className={s.image || s.snippet ? "" : "lg:col-span-2 lg:max-w-3xl"}>
                <h2 className="font-display text-2xl text-ink">{s.title}</h2>
                <p className="mt-3 text-sm text-wire">{s.body}</p>
                <p className="mt-4 text-sm">
                  <Link href={s.href} className="text-signal underline">
                    {s.cta}
                  </Link>
                </p>
              </div>
              {s.snippet ? (
                <div className={FRAME}>
                  <p className="border-b border-line px-4 py-2 font-mono text-xs text-wire">
                    {s.snippet.file}
                  </p>
                  <pre className="m-0! overflow-x-auto p-4 font-mono text-xs leading-relaxed text-ink">
                    {s.snippet.code}
                  </pre>
                </div>
              ) : null}
              {s.image ? (
                <Link href={s.href} className={`block ${FRAME} hover:border-wire`}>
                  {"src" in s.image ? (
                    // The terminal replay is 1280x770; at full column width it
                    // becomes a 600px-tall mostly-empty black panel before the
                    // recording gets going. Crop to the top, where the command
                    // and the stage lines are.
                    <SiteImage
                      src={s.image.src}
                      alt={s.image.alt}
                      className="w-full"
                    />
                  ) : (
                    <ThemedImage
                      light={s.image.light}
                      dark={s.image.dark}
                      alt={s.image.alt}
                      className="w-full"
                    />
                  )}
                </Link>
              ) : null}
            </div>
            {s.title === "Run it once" ? <Receipts /> : null}
            </div>
          ))}
        </section>

        {/* Closing cards: the three questions asked before anyone runs it. */}
        <section className="grid gap-4 border-t border-line pt-10 sm:grid-cols-3">
          <Link href="/docs/costs" className={CARD}>
            <h3 className="font-display text-base text-ink">What it costs</h3>
            <p className="mt-2 text-sm text-wire">
              Real numbers by profile, from recorded runs, before you run anything. Your keys, your
              dollars.
            </p>
          </Link>
          <Link href="/docs/data-sent" className={CARD}>
            <h3 className="font-display text-base text-ink">What gets sent to providers</h3>
            <p className="mt-2 text-sm text-wire">
              Exactly what leaves your machine, to whom, and what never does. No telemetry,
              anywhere.
            </p>
          </Link>
          <Link href="/docs/compare" className={CARD}>
            <h3 className="font-display text-base text-ink">Compared with hosted tools</h3>
            <p className="mt-2 text-sm text-wire">
              Sourced prices, dated, and the five things the hosted tools still do that this does
              not.
            </p>
          </Link>
        </section>

        {/* The reader who went the whole way gets the three things they can do
            next, in one band. */}
        <section className="flex flex-col items-center gap-4 border-t border-line pt-10 text-center">
          <h2 className="font-display text-2xl text-ink">Run it on your own domain</h2>
          <div className="w-full max-w-xl text-left">
            <CopyCommand command="npx saylent audit example.com" />
          </div>
          <p className="text-sm text-wire">
            <a href={DEMO_URL} className="text-signal underline">
              Open the live demo
            </a>
            {" · "}
            <a href={REPO_URL} className="text-signal underline">
              Star on GitHub
            </a>
          </p>
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
