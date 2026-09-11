// The self-service help/FAQ page: the honest questions a buyer actually asks, in
// the marketing editorial voice. Deflects tickets before they're filed; the last
// card routes anything unanswered to the tracked support form. Static content —
// no data reads.
import Link from "next/link";

export const metadata = { title: "Help & FAQ · Saylent" };

// Grouped into the buyer's four questions-about-questions. Every answer describes
// how this deployment actually behaves — including that the limits are the
// operator's, not a price list.
const FAQ_GROUPS: { category: string; items: { q: string; a: string }[] }[] = [
  {
    category: "Getting started",
    items: [
      {
        q: "What is a Saylent audit?",
        a: "It measures how the AI engines your buyers actually use (ChatGPT, Claude, Gemini and Perplexity) answer the real questions that decide purchases in your category. You get a full report: every answer with the receipt behind it, a map of where each engine sources its answers, where in the buyer journey you win or lose, how the engines frame you, the web pages those answers are written from, and fixes drafted and anchored to that evidence.",
      },
      {
        q: "What do I need to get started?",
        a: "Your brand name and your website. That's the whole setup. We derive the buyer questions for your category from there. There's no tag to install, no tracking script, and we never need access to your analytics or your servers.",
      },
      {
        q: "How long does an audit take?",
        a: "About ten minutes, start to finish, and it runs in the background, so you can close the tab. We ask the four engines, fetch and read the pages they cite, run the live gate tests at your door, and draft the fixes; the full report is waiting when you come back.",
      },
    ],
  },
  {
    category: "The audit & the numbers",
    items: [
      {
        q: "Why four engines?",
        a: "The four don't draw from the same web. One leans on best-of listicles, another on community threads, another on review directories. A brand can be strong in one and invisible in another, and the fix differs by engine. Measuring all four is the only way to see the whole picture, and it's the claim we stake the product on.",
      },
      {
        q: "How accurate is it, and can I trust the numbers?",
        a: "Every figure in a full report opens its receipt: the stored raw answer or the actual page behind it. Nothing asks to be trusted; everything can be checked. Where we couldn't verify something, the report says \"unverified\" rather than guessing. And because AI answers vary between runs, a single run is always labelled a SNAPSHOT. Movement is only ever claimed by re-asking the identical question set and comparing whole sets.",
      },
      {
        q: "Why do answers vary between runs?",
        a: "Because the engines themselves are non-deterministic. Ask ChatGPT or Perplexity the same question twice and the wording, and sometimes the recommendation, can shift. It's the industry's open secret, and most tools hide it behind a smooth trend line. We don't: no single answer decides your score: every scored question is re-asked until a majority settles it, so you see the range, a single run is labelled a SNAPSHOT, small samples are reported as counts rather than dressed-up percentages, and we only ever claim movement by re-asking the identical question set and comparing whole set against whole set. When we say you moved, you moved; when a change sits within normal variation, your report says so instead of dressing up a coin-flip.",
      },
      {
        q: "Why don't you show a single \"AI visibility score\"?",
        a: "Because one number would hide the thing you actually need. A brand can be strong on Claude and invisible on Perplexity, recommended in one buying moment and framed as \"limited\" in another, and the fix differs each time. A single score blends all of that into a figure you can't act on and can't defend. So instead of a gauge, your report shows the specific answers, the pages behind them, and where in the buyer journey you win or lose, each with its receipt.",
      },
      {
        q: "What is a verify run, and what does it prove?",
        a: "A verify re-asks the exact same question set as your last audit and compares the two, whole set against whole set, so any change reflects the world moving rather than the questions changing. It's how you prove a fix worked, with receipts rather than vibes. Real fixes take time to land (getting added to a cited page can take weeks), so when a verify reads \"no movement yet,\" that's an honest measurement doing its job, not a failure. Your audit includes one verify; how many more you can run is set by whoever operates this deployment.",
      },
    ],
  },
  {
    category: "Limits",
    items: [
      {
        q: "What do I get from an audit?",
        a: "One brand, the full report, and one verify re-run, so you can measure whether the fixes worked. It runs in about ten minutes. Re-measuring after that is the same product run again, within whatever limits your operator has set.",
      },
      {
        q: "Are there plans or paid tiers?",
        a: "No. This deployment is self-hosted and has no billing and no tiers: your operator sets the limits (how many brands you can add, how many audits and verifies you can run, and the daily spend cap), not a price list. Settings › Limits shows exactly where you stand. If you need more, ask your operator.",
      },
      {
        q: "How often should I re-measure?",
        a: "Start with one audit: it tells you exactly where you stand and hands you the fixes. Then ship the fixes and run a verify to see whether they moved anything — real changes take weeks to land, so there is no point re-asking daily. After that, an audit every few weeks catches drift. There are no product tiers here: how many audits and verifies you can run, and the daily spend cap behind them, are limits your operator sets.",
      },
    ],
  },
  {
    category: "Data & trust",
    items: [
      {
        q: "Is my data safe?",
        a: "Your account, brands and reports are private to you and isolated at the database level, so one customer can never see another's data. We measure through the engines' official APIs; we never post your data anywhere or sell it. You can export everything we hold at any time, and delete your account and all its data permanently from Settings.",
      },
      {
        q: "What do you do with my site's data?",
        a: "We fetch your public pages the way an AI crawler does and read them to check what the engines can actually see, then store that evidence in your private report so every finding keeps its receipt. That's the whole use. We don't sell it, we don't post it anywhere, and we don't train anything on it. You can export everything we hold, or delete your account and all of it permanently, from Settings.",
      },
      {
        q: "Can I share my report?",
        a: "Yes, with a public link that is unlisted — not a private one. From a finished report, \"Share report\" asks you to confirm, then creates a URL that anyone who has it can read, with no sign-in: the whole report, every engine answer, every rival named. It is marked noindex so search engines skip it, and you can revoke it from the same place at any time. If a report is about your company and you didn't authorise it, you can request a review and we'll act on it.",
      },
      {
        q: "How do I delete my data?",
        a: "Go to Settings › Account and delete your account. Deletion is permanent and type-to-confirm, and it removes your profile, brands, runs, answers and fixes. You can download a full JSON export of everything we hold first, from the same screen.",
      },
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-display text-4xl leading-tight">Help &amp; FAQ</h1>
      <p className="mt-4 text-lg text-ink/80">
        The questions we get most, answered plainly. Still stuck? We read every message.
      </p>

      <div className="mt-10 flex flex-col gap-12">
        {FAQ_GROUPS.map((group) => (
          <div key={group.category}>
            <h2 className="font-mono text-xs uppercase tracking-widest text-wire">
              {group.category}
            </h2>
            <div className="mt-2 divide-y divide-line border-t border-line">
              {group.items.map((f) => (
                <section key={f.q} className="py-6">
                  <h3 className="font-display text-lg">{f.q}</h3>
                  <p className="mt-2 text-ink/80">{f.a}</p>
                </section>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-lg border border-line bg-card p-6">
        <h2 className="font-display text-xl">Didn&apos;t find your answer?</h2>
        <p className="mt-2 text-ink/80">
          Signed-in users can{" "}
          <Link href="/app/support" className="text-signal underline underline-offset-2">
            contact support
          </Link>
          . Your account and latest audit come attached automatically. You can also check the{" "}
          <Link href="/status" className="text-signal underline underline-offset-2">
            system status
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
