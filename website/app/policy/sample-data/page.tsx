// website/app/policy/sample-data/page.tsx - the three-layer
// public-data policy, in plain words, plus how to request a correction.
export const metadata = { title: "Sample data policy" };

const LAYERS = [
  {
    name: "Layer 1 - Factual",
    subjects: "Real brands, real categories",
    body: "Share of voice, who is recommended per question and how often, which sources and page types the engines cite, and bot-access facts of public sites. Quotes are used only when attributed to the engine and the date, and only when neutral or positive.",
  },
  {
    name: "Layer 2 - Full report",
    subjects: "A brand we own, or a brand with written consent",
    body: "Sentiment, risk claims, rival comparisons, and generated fixes - the complete picture a report gives its own subject. Until a brand consents or we own one, this layer's public sample is Kestrel Uptime, a fictional company we audit.",
  },
  {
    name: "Layer 3 - Aggregate",
    subjects: "No brand named",
    body: "Cross-site studies - bot-blocking rates, citation-source patterns - with no opinion about any named company.",
  },
];

export default function SampleDataPolicy() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl text-ink">Sample data policy</h1>
      <p className="mt-3 text-wire">
        What we publish about real brands, and what stays on our own fictional demo brand.
      </p>

      <p className="mt-8 text-ink">
        Saylent audits real AI assistants and records what they actually answered. Publishing
        that fact honestly - who an assistant recommends, and which page it built the answer from
        - is reporting, the same category norm every AI-visibility tool in this space follows for
        real brands. Publishing our own negative or unverified opinion about a company we don&apos;t
        own is a different thing, and we don&apos;t do it. The line stays the same everywhere on this
        site and in the product:
      </p>

      <p className="mt-4 rounded-lg border border-line bg-card p-4 font-medium text-ink">
        No verbatim negative claim, and no generated fix, about a named company we do not own -
        anywhere public.
      </p>

      <div className="mt-10 flex flex-col gap-6">
        {LAYERS.map((l) => (
          <div key={l.name} className="rounded-lg border border-line bg-card p-5">
            <h2 className="font-display text-lg text-ink">{l.name}</h2>
            <p className="mt-1 font-mono text-xs uppercase tracking-wide text-signal">
              {l.subjects}
            </p>
            <p className="mt-2 text-sm text-wire">{l.body}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 font-display text-xl text-ink">On every public sample</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-wire">
        <li>The date the assistants were asked, and the model names that answered.</li>
        <li>A disclaimer that a report records what the assistants answered on that date - it is not our assessment of the company.</li>
        <li>Attribution on every quote: which engine, which date.</li>
        <li>A visible way to request a correction or a takedown.</li>
        <li>
          Every other company&apos;s name and website is replaced with a fictional one. Only two kinds of
          names stay real: public platforms anyone can publish on (Wikipedia, Reddit, Hacker News,
          Stack Overflow, GitHub, YouTube, Medium) and the infrastructure vendors a fix tells you to open
          in your own dashboard (CDNs, web servers, hosting platforms), which are never the subject of a
          claim.
        </li>
      </ul>

      <h2 className="mt-10 font-display text-xl text-ink">Request a correction</h2>
      <p className="mt-3 text-sm text-wire">
        If something published here about your brand is wrong, or you&apos;d like it removed, open an
        issue on the repository. We read every one.
      </p>
      <a
        href="https://github.com/yotambraun/saylent/issues/new?template=correction_request.yml"
        className="mt-3 inline-block text-sm text-signal underline"
      >
        Open a correction request on GitHub
      </a>
    </main>
  );
}
