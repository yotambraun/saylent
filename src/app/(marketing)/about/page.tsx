// /about - TRUST/identity page (value-audit fix: strangers won't pay for an
// anonymous site). Marketing design system, same as /methodology. States WHY
// this product exists and HOW it's built. NO fabricated
// facts, NO testimonials (legal: never invent).
import Link from "next/link";
import { Button } from "@saylent/report/ui/button";
import { APP_NAME } from "@/lib/branding";

export const metadata = { title: `About ${APP_NAME}: the AI-visibility audit` };

// The rules, compressed - the full nine live on /methodology; we point there
// rather than duplicate them (single source of truth).
const RULES = [
  {
    title: "We print the error bars, not a smooth line",
    body: "AI answers vary run to run. Everyone knows it, nobody shows it. No single answer decides your score: scored questions are re-asked until a majority settles them, and you see the range, every single run is marked SNAPSHOT, and movement is only ever shown by re-asking the identical question set and comparing whole sets. When we say you moved, you moved. When nothing moved yet, your report says so instead of selling you noise.",
  },
  {
    title: "Every number opens its receipt",
    body: "Click any figure in a report and you see the stored raw answer, or the actual page, behind it. Nothing asks to be trusted; everything can be checked. Where we couldn't verify something, the report says \"unverified\". It never guesses.",
  },
  {
    title: "We never invent a number",
    body: "No made-up \"AI search volume\", no opaque one-to-a-hundred score, no llms.txt file sold as a fix. We measure what the engines actually do through their official APIs, and we tell you the limits of what we tested.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-display text-4xl leading-tight">
        Built to be checked, not trusted.
      </h1>
      <p className="mt-4 text-lg text-ink/80">
        {APP_NAME} is an independent product with one job: show you exactly how AI engines answer
        your buyers, and hand you the receipts, not a dashboard.
      </p>

      <div className="mt-12 flex flex-col gap-10">
        {/* WHY it exists */}
        <section>
          <h2 className="font-display text-2xl">Why {APP_NAME} exists</h2>
          <p className="mt-2 leading-relaxed text-ink/80">
            Buyers stopped Googling. They ask ChatGPT, Claude, Gemini and Perplexity what to buy,
            and the engines answer with a short list of names. If yours isn&apos;t on it, nobody
            tells you. You just win fewer deals, with no idea why.
          </p>
          <p className="mt-4 leading-relaxed text-ink/80">
            Most &quot;AI visibility&quot; tools sell you a subscription to watch a score move up and
            down. {APP_NAME} does the opposite: it gives you the actual answers your buyers get, the
            real web pages those answers were written from, where in the buying journey you lose
            them, and a specific list of fixes anchored to that evidence, plus one re-run to measure
            whether the fixes worked. One brand, about ten minutes, and every finding is yours to
            keep. No meter, no lock-in.
          </p>
        </section>

        {/* HOW it's built - the rules, then a pointer to /methodology */}
        <section>
          <h2 className="font-display text-2xl">How it&apos;s built</h2>
          <p className="mt-2 leading-relaxed text-ink/80">
            The product is shaped by a few rules we won&apos;t bend, because a report you can&apos;t
            check is just another opinion.
          </p>
          <div className="mt-6 flex flex-col gap-6">
            {RULES.map((r) => (
              <div key={r.title}>
                <h3 className="font-medium">{r.title}</h3>
                <p className="mt-1 leading-relaxed text-ink/80">{r.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 leading-relaxed text-ink/80">
            The full method (nine principles, each one checkable in your own report) is written up
            on the{" "}
            <Link href="/methodology" className="text-signal underline underline-offset-2">
              methodology page
            </Link>
            .
          </p>
        </section>
      </div>

      {/* THE PROJECT. A stranger who lands on somebody else's
          self-hosted instance had no path back to the software. The identity
          block above is unchanged — this is one line and two links. */}
      <p className="mt-12 border-t border-line pt-6 leading-relaxed text-ink/80">
        {APP_NAME} is open source (Apache-2.0). Run your own:{" "}
        <a
          href="https://github.com/yotambraun/saylent"
          className="text-signal underline underline-offset-2"
        >
          github.com/yotambraun/saylent
        </a>{" "}
        ·{" "}
        <a
          href="https://yotambraun.github.io/saylent/docs"
          className="text-signal underline underline-offset-2"
        >
          docs
        </a>
      </p>

      <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row">
        <Button asChild variant="outline">
          <Link href="/demo">Explore the sample report →</Link>
        </Button>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </div>
  );
}
