"use client";
// THE STATIC REPORT HOST — the offline half of the seam in ../host.tsx.
//
// A report.html on someone's disk has no server, no router, no analytics and no
// database. So: plain <a> for links, a no-op beacon, no favicon fetch (the
// deterministic letter tile draws instead, which is why the file makes ZERO
// network requests), and actions marked unavailable so every write control
// structurally disappears rather than rendering a dead button.
//
// The one rewrite that matters: in the app the Brief links to the dossier with
// `?view=full#anchor`, because the two layers are separate views of one URL. In
// the file they are stacked in ONE document, so the query is dropped and the
// anchor alone is followed.
import { useMemo, type ReactNode } from "react";
import { ReportHost, type ReportHostValue, type ReportLinkProps } from "../host";

/** `?view=full#q-03` → `#q-03`; `?view=full` → `#dossier`; everything else
 *  is left exactly as the component wrote it. */
export function staticHref(href: string): string {
  if (!href.startsWith("?")) return href;
  const hash = href.indexOf("#");
  return hash === -1 ? "#dossier" : href.slice(hash);
}

const StaticLink = ({ href, children, ...rest }: ReportLinkProps) => (
  <a href={staticHref(href)} {...rest}>
    {children}
  </a>
);

export interface StaticHostOptions {
  /** the address a reader writes to about the report's content. There is NO
   *  default: a placeholder mailbox (reports@example.com) rendered a "Report an
   *  inaccuracy" link that went nowhere in every published sample. Unset ⇒ the
   *  affordance is not rendered at all. */
  contactEmail?: string;
  /** an absolute URL for "How we measure". Unset ⇒ the public methodology page,
   *  because a delivered file with no link back is a dead end. */
  methodologyUrl?: string | null;
}

/** The public methodology page. A static report.html has no app to link into,
 *  so the docs site is the honest destination for "how we measure". */
export const DEFAULT_METHODOLOGY_URL = "https://yotambraun.github.io/saylent/docs/methodology";

export function staticHostValue(opts: StaticHostOptions = {}): Partial<ReportHostValue> {
  return {
    Link: StaticLink,
    track: () => {},
    // null ⇒ <Favicon> draws its deterministic gradient letter tile. No request
    // leaves the file, so the report works air-gapped and leaks no reading.
    faviconUrl: () => null,
    actions: {
      available: false,
      markFixShipped: async () => ({ ok: false, error: "This report is a static file." }),
      cancelRun: async () => ({ ok: false, error: "This report is a static file." }),
      hideRun: async () => ({ ok: false, error: "This report is a static file." }),
      unhideRun: async () => ({ ok: false, error: "This report is a static file." }),
    },
    contactEmail: opts.contactEmail ?? null,
    methodologyUrl: opts.methodologyUrl ?? DEFAULT_METHODOLOGY_URL,
    refresh: () => {},
    subscribeRunFeed: () => () => {},
    notify: { canOffer: () => false, request: async () => "unsupported" as const },
  };
}

export function StaticReportHost({
  children,
  contactEmail,
  methodologyUrl,
}: StaticHostOptions & { children: ReactNode }) {
  // Stable across renders so the whole report is not re-rendered by the provider.
  const value = useMemo(
    () => staticHostValue({ contactEmail, methodologyUrl }),
    [contactEmail, methodologyUrl],
  );
  return <ReportHost value={value}>{children}</ReportHost>;
}
