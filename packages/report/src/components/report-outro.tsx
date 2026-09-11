"use client";
// THE CLOSING BLOCK. A shared report used to end on "What we won't do: scrape AI
// apps against their terms…" and simply stop: one outbound link in the whole
// document (a mailto to a placeholder mailbox), no way to find the project, no
// way to run it on your own brand. A delivered artifact that travels has to say
// what it is and how to get one.
//
// Display only, no host calls: the same block renders in the app's public views
// and in a report.html sitting on someone's disk with no network.

export const PROJECT_NAME = "Saylent";
export const PROJECT_TAGLINE =
  "Saylent is the open-source audit of what AI assistants say about your brand, with the receipts.";
export const DOCS_URL = "https://yotambraun.github.io/saylent/";
export const REPO_URL = "https://github.com/yotambraun/saylent";
export const RUN_COMMAND = "npx saylent audit <your domain>";

export function ReportOutro() {
  return (
    <section className="rounded-lg border border-line bg-card p-6 text-sm">
      <p className="font-mono text-[10px] uppercase tracking-widest text-wire">
        Run this on your own brand
      </p>
      <p className="mt-2 max-w-3xl leading-relaxed">
        {PROJECT_TAGLINE} The method is documented at{" "}
        <a href={DOCS_URL} className="underline hover:text-signal" target="_blank" rel="noreferrer">
          yotambraun.github.io/saylent
        </a>{" "}
        and every line of it is readable at{" "}
        <a href={REPO_URL} className="underline hover:text-signal" target="_blank" rel="noreferrer">
          github.com/yotambraun/saylent
        </a>
        .
      </p>
      <p className="mt-3 font-mono text-sm text-ink">{RUN_COMMAND}</p>
    </section>
  );
}
