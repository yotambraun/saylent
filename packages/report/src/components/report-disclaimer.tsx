// Dated-methodology framing for the dossier. This reads as rigor, not apology:
// it states exactly what the report measures and when, so the verbatim AI
// quotes are documented as engine outputs on a date, never as this product's
// own claims about a real company (the standing legal concern for public
// dossiers).
// Display only over its props; the correction address and the methodology link come
// from the report host (app route vs. public docs URL), so the same component ships
// in the app and in a static report.html. Must NOT be print-hidden — the printed PDF
// travels, and the framing travels with it.
"use client";
import { cn } from "../utils";
import { useReportHost } from "../host";
import { totalsLine, type RunTotals } from "../totals";

export function ReportDisclaimer({
  variant,
  engines,
  models,
  dateRange,
  totals,
}: {
  variant: "owner" | "public";
  engines: string[];
  models?: string;
  dateRange: string;
  /** THE run totals, rendered in the same words everywhere (../totals.ts).
   *  "Measured from 24 live AI responses" was untrue: six of those calls
   *  returned nothing. */
  totals: RunTotals;
}) {
  // The correction address belongs to whoever operates this deployment, not to
  // a hard-coded mailbox — the wording is unchanged (see METHODOLOGY.md).
  const { contactEmail, methodologyUrl } = useReportHost();
  const engineList = engines.length > 0 ? engines.join(", ") : "the named AI engines";

  if (variant === "owner") {
    return (
      <p
        className="-mt-8 font-mono text-[13px] leading-relaxed text-wire"
        suppressHydrationWarning
      >
        Measured across {engineList} on {dateRange}: {totalsLine(totals)}. Engine answers
        vary between runs. Scores are directional.{" "}
        {methodologyUrl && (
          <a href={methodologyUrl} className="underline hover:text-ink">
            How we measure →
          </a>
        )}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "-mt-8 rounded-lg border border-line bg-card p-4 text-[13px] leading-relaxed text-wire",
      )}
      suppressHydrationWarning
    >
      <p>
        The quotes in this report are verbatim outputs the named AI engines
        {models ? ` (${models})` : ""}{" "}
        generated on the dates shown, in response to Saylent&apos;s standardized prompts. They
        document what each AI said. They are not statements of fact by Saylent, and AI systems
        can state inaccurate things about real companies.
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-ink/80">
          Measured across {engineList} on {dateRange}: {totalsLine(totals)}.
        </span>
        {contactEmail && (
          <a
            href={`mailto:${contactEmail}?subject=Report%20an%20inaccuracy`}
            className="underline hover:text-ink"
          >
            Report an inaccuracy
          </a>
        )}
        {methodologyUrl && (
          <a href={methodologyUrl} className="underline hover:text-ink">
            How we measure →
          </a>
        )}
      </p>
    </div>
  );
}
