// /methodology — TRUST page, concept-level only (project rule:
// standards are public, the recipe is not; implementation detail lives in the
// private docs). Sells WHY the numbers can be trusted, never HOW they're computed.
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";

export const metadata = { title: "Why you can trust the numbers · Saylent" };

const PRINCIPLES = [
  {
    title: "We ask what your buyers ask",
    body: "Your report is built from the 23 real questions that decide purchases in your category, asked through ChatGPT, Claude, Gemini and Perplexity the way a buyer would ask them. The same set is used for every re-measurement, so when a number moves, the world moved, not the questions.",
  },
  {
    title: "Official interfaces only",
    body: "We measure through the engines' official APIs with live web search on, never by scraping apps against their terms. Where the API surface differs from the consumer apps, your report says so plainly.",
  },
  {
    title: "Every number opens its receipt",
    body: "Click any figure in a Saylent report and you'll see the stored raw answer, or the actual page, behind it. Nothing asks to be trusted; everything can be checked. Where we couldn't verify something, the report says \"unverified\". It never guesses.",
  },
  {
    title: "We read the pages the answers come from",
    body: "AI answers are written from a small set of real web pages, and the engines reveal which ones by citing them. We fetch every one and check who's on it: you, or your competitors. \"The page used 13 times to write these answers lists all your rivals and not you\" is not a theory. It's checkable, and it's fixable.",
  },
  {
    title: "We map where each engine sources its answers",
    body: "The four engines don't draw from the same web. One leans on best-of listicles, another on community threads, another on review directories. Your report builds a Source Map (the hosts each engine cites most, and a plain-English read of the sources it trusts) so you know which pages to win for which engine, and which of them your rivals already own.",
  },
  {
    title: "We test your gates the way the bots do",
    body: "AI crawlers can be silently blocked by security layers you never configured, invisible in your own files. We don't just read your settings; we knock on your door the way each engine's crawler does and report who actually gets in.",
  },
  {
    title: "We show where in the buyer journey you win or lose",
    body: "Being known and being chosen are different problems. Your report separates the moments that matter (when buyers ask what to buy, when they compare options, when they describe their problem, when they check you out by name) so you can see exactly where they lose you, and read the answers from that moment.",
  },
  {
    title: "Mentioned isn't endorsed: we show how you're framed",
    body: "A mention that describes you as \"limited\" or \"for smaller teams\" can cost more than absence. Your report shows the tone around every mention, where you land in each answer, and the exact claims the engines made about you, split into what they praise and the doubts a buyer hears, with the rivals each answer named and the reason it gave for each. Every answer is assessed the same way, independent of which engine produced it. We show what was said, quoted and attributed; we never guess what's true.",
  },
  {
    title: "We print the error bars every dashboard hides",
    body: "AI answers vary run to run. Everyone in the field knows it, and most tools bury it under a smooth trend line. We do the opposite: every scored question is asked at least twice (and a third time whenever the answers disagree) so you see the range, single runs are labeled SNAPSHOT, small samples are reported as honest counts instead of dressed-up percentages, and movement is only ever measured by re-asking the identical question set and comparing whole sets. When we say you moved, you moved. When nothing moved yet, your report says so instead of selling you noise.",
  },
];

// Field facts that justify the choices above — attributed and linkable, so a
// skeptic can check the reasoning, not just take our word. Stats stay ranges
// with attribution; none of this reveals HOW the pipeline works. A source with no
// url is cited by name only, on purpose.
const RESEARCH: { point: string; body: string; source: { name: string; url?: string } }[] = [
  {
    point: "The engines don't share one index, so we read them one at a time",
    body: "As reported by Profound, Claude's web search draws on Brave's independent index rather than Google's or Bing's, and the same measurement put the overlap between Claude's citations and Brave's top organic results at roughly 86.7%. We don't treat that as settled fact about every engine; we treat it as the reason a Source Map is built per-engine instead of as one blended list.",
    source: { name: "Profound, 2026", url: "https://www.tryprofound.com/blog/what-is-claude-web-search-explained" },
  },
  {
    point: "The cited set is tiny: being in it is winner-take-most",
    body: "AI answers are written from a strikingly small pool of pages. Across six LLM search systems, fewer than 10 distinct URLs appeared in about 80% of answers, far tighter concentration than a page of search results. That's the whole reason an audit that moves you into the cited set is worth more than a rankings report: a handful of pages decide the answer.",
    source: { name: "arXiv source-coverage study, 2025", url: "https://arxiv.org/html/2512.09483v1" },
  },
  {
    point: "A citation isn't proof, so we open the page and check",
    body: "The engines cite pages, but a citation doesn't mean the page actually backs the claim. Studies of LLM answers find that roughly 50–90% of responses are not fully supported by their own cited sources, and some are contradicted by them. So we don't count citations and trust them. We fetch the cited page and check who and what is really on it. Reading the pages, rather than tallying links, is the only honest way to measure.",
    source: { name: "Nature Communications, via Daily Geo Insights", url: "https://www.dailygeoinsights.com/llm-citation-source-selection-research/" },
  },
  {
    point: "Why we won't sell you an llms.txt file",
    body: "It's a fashionable fix with the numbers against it: of 137,210 domains that added an llms.txt, about 97% received zero AI-bot requests to the file in May 2026, and no engine we audit reads it. We test what engines actually fetch, not what a vendor wishes they would.",
    source: { name: "PPC Land, 2026", url: "https://ppc.land/llms-txt-adoption-rises-8-8x-but-97-of-files-get-zero-ai-requests/" },
  },
  {
    point: "Our gate test is honestly scoped",
    body: "We knock on your door as each engine's declared crawler (the identity it publishes) and report who actually gets in. That's the access we can verify. It's also scoped, and we say so: the result reflects the declared agent, and some engines have been documented fetching through undeclared crawlers or real-browser agents that no robots rule governs. We tell you what we tested, never more than we know.",
    source: { name: "Cloudflare crawler research, 2025" },
  },
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-display text-4xl leading-tight">
        Numbers you can defend in front of anyone
      </h1>
      <p className="mt-4 text-lg text-ink/80">
        Most &quot;AI visibility&quot; tools hand you an opaque score. Saylent is built the
        opposite way: nine principles, each one checkable in your own report.
      </p>

      <div className="mt-12 flex flex-col gap-10">
        {PRINCIPLES.map((p, i) => (
          <section key={p.title}>
            <h2 className="font-display text-2xl">
              <span className="mr-2 text-signal">{String(i + 1).padStart(2, "0")}</span>
              {p.title}
            </h2>
            <p className="mt-2 leading-relaxed text-ink/80">{p.body}</p>
          </section>
        ))}

        {/* The evidence behind the method — sourced field facts, each checkable.
            Recipe stays private; these justify WHY the principles are shaped as
            they are, with attributed ranges and links a skeptic can follow. */}
        <section className="border-t border-line pt-10">
          <h2 className="font-display text-2xl">Why the method is built this way</h2>
          <p className="mt-2 leading-relaxed text-ink/80">
            The choices above aren&apos;t taste. They track how answer engines actually behave,
            and you can check the evidence yourself.
          </p>
          <div className="mt-8 flex flex-col gap-8">
            {RESEARCH.map((r) => (
              <div key={r.point}>
                <h3 className="font-medium">{r.point}</h3>
                <p className="mt-1 leading-relaxed text-ink/80">{r.body}</p>
                {r.source.url ? (
                  <a
                    href={r.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-sm text-signal underline underline-offset-2"
                  >
                    Source: {r.source.name} →
                  </a>
                ) : (
                  <p className="mt-1 text-sm text-wire">Source: {r.source.name}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* the honesty box — verbatim, at home here as positioning */}
        <section className="rounded-lg border-2 border-ink p-6">
          <h2 className="font-mono text-xs uppercase tracking-widest text-wire">
            What we won&apos;t do
          </h2>
          <p className="mt-3 leading-relaxed">
            Scrape AI apps against their terms, invent &quot;AI search volume&quot;, sell you
            an llms.txt file, or show a delta between two coin-flips. One run is a snapshot.
            We label it. Movement is measured set-vs-set, and if nothing moved yet, we say so.
          </p>
        </section>
      </div>

      <div className="mt-14 flex flex-col items-start gap-4">
        <h2 className="font-display text-2xl">See these principles in a real report</h2>
        <div className="flex flex-col gap-4 sm:flex-row">
          <Button asChild variant="outline">
            <Link href="/demo">Explore the sample report →</Link>
          </Button>
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
