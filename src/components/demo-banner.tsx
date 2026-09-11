// Hosted read-only demo — the slim strip that sits on
// top of every /app page on the hosted demo, so a visitor is never confused about
// whose data they are looking at or why nothing saves.
//
// Server component, and it renders NOTHING unless NEXT_PUBLIC_DEMO_READONLY is set:
// a normal deployment (self-hosted or ours) is pixel-identical to before.
import { DEMO_BRAND_NAME, isDemoReadOnly } from "@/lib/demo-mode";

/** Where "read the docs" points. Overridable so a fork's demo links to its own docs. */
const DOCS_URL =
  process.env.NEXT_PUBLIC_DEMO_DOCS_URL || "https://yotambraun.github.io/saylent/docs/quickstart";

export function DemoBanner() {
  if (!isDemoReadOnly()) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-line bg-ink px-4 py-2 text-center text-xs text-paper"
    >
      <span>
        <strong className="font-semibold">Read-only demo</strong> on the {DEMO_BRAND_NAME} sample, a
        fictional company we audit. Nothing here saves.
      </span>
      <span className="opacity-90">
        Run it on your brand:{" "}
        <code className="rounded bg-paper/15 px-1.5 py-0.5 font-mono">
          npx saylent audit &lt;domain&gt;
        </code>
      </span>
      <a href={DOCS_URL} className="underline underline-offset-2 hover:opacity-80">
        Read the docs →
      </a>
    </div>
  );
}
