"use client";
// THE REPORT HOST — the one seam between the report components and whatever is
// rendering them (see ARCHITECTURE.md).
//
// The Brief and the dossier are the SAME components in the Next app and in the
// static `report.html` the CLI writes. Everything that only a running app can do
// (route transitions, analytics, server actions, the live-run feed) is reached
// through this context, never imported. That keeps `packages/report` free of
// `next/*`, `@supabase/*` and `@/…` (enforced in eslint.config.mjs) without
// forking the views.
//
// Two implementations exist:
//   NextReportHost   — src/app/app/run/[id]/host.tsx (real Link, analytics,
//                      server actions, Supabase realtime).
//   staticReportHost — render/static-host.tsx (plain <a>, no-op track, inline
//                      favicon glyph, actions unavailable so the controls hide).
//
// The default below is the app's shape minus the app-only parts, so a component
// used outside a provider (e.g. <Favicon> on the /vs page) behaves as before.
import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from "react";

/* ---------- server actions the dossier / run view call ---------- */
export interface ActionResult {
  ok: boolean;
  error?: string;
}
export interface ReportActions {
  /** false when the host cannot mutate anything (a static file on disk).
   *  Components hide the control rather than render a dead button. */
  readonly available: boolean;
  markFixShipped(fixId: string, runId: string, alsoRevalidate?: string): Promise<ActionResult>;
  cancelRun(runId: string): Promise<ActionResult>;
  hideRun(runId: string): Promise<ActionResult>;
  unhideRun(runId: string): Promise<ActionResult>;
}

/* ---------- the live-run feed (RUNNING mode only) ---------- */
/** A raw `answers` row as the feed reads it. The view does the preview shaping
 *  (strip-md) so the host stays a pure transport. */
export interface RunFeedAnswer {
  qid: string;
  engine: string;
  ok: boolean;
  question: string;
  qtype: string;
  citations: { url?: string | null; title?: string | null }[] | null;
  raw_text: string | null;
  created_at: string;
}
export interface RunFeedOptions {
  runId: string;
  /** false ⇒ the theater board is absent, so the answer feed is not polled */
  wantAnswers: boolean;
  onRun(patch: Record<string, unknown>): void;
  onAnswers(rows: RunFeedAnswer[], judged: { qid: string; engine: string; bp: boolean | null }[]): void;
}

/* ---------- browser notification permission ---------- */
export interface ReportNotify {
  canOffer(): boolean;
  request(): Promise<NotificationPermission | "unsupported">;
}

export type ReportLinkProps = ComponentProps<"a"> & { href: string; children: ReactNode };

export interface ReportHostValue {
  /** in-app client transition in the app; a plain <a> in a static file */
  Link(props: ReportLinkProps): ReactNode;
  /** analytics beacon; no-op off-app */
  track(event: string, props?: Record<string, unknown>): void;
  /** favicon src for a host, or null to render the deterministic letter tile */
  faviconUrl(domain: string): string | null;
  actions: ReportActions;
  /** the address a reader writes to about the report's content, or null when
   *  this deployment has none — the correction affordance is then not rendered
   *  at all, rather than pointing at a placeholder mailbox nobody reads. */
  contactEmail: string | null;
  /** where "How we measure" points, or null to omit the link (offline file) */
  methodologyUrl: string | null;
  /** re-render from the server (router.refresh in the app) */
  refresh(): void;
  /** subscribe to a live run; returns the unsubscribe. No-op off-app. */
  subscribeRunFeed(opts: RunFeedOptions): () => void;
  notify: ReportNotify;
}

const unavailable = async (): Promise<ActionResult> => ({
  ok: false,
  error: "This report is a static file. Open it in the app to act on it.",
});

/** Kept for app callers that want a visible default; the report itself passes
 *  whatever the deployment configured, and renders nothing when that is null. */
export const DEFAULT_CONTACT_EMAIL = "hello@example.com";

/** The default host: everything the browser can do on its own, nothing that needs
 *  a server. `faviconUrl` keeps the app's same-origin proxy so components used
 *  outside a provider are unchanged. */
export const defaultReportHost: ReportHostValue = {
  Link: ({ href, children, ...rest }: ReportLinkProps) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  track: () => {},
  faviconUrl: (domain: string) => `/api/favicon?domain=${encodeURIComponent(domain)}`,
  actions: {
    available: false,
    markFixShipped: unavailable,
    cancelRun: unavailable,
    hideRun: unavailable,
    unhideRun: unavailable,
  },
  contactEmail: null,
  methodologyUrl: "/methodology",
  refresh: () => {},
  subscribeRunFeed: () => () => {},
  notify: { canOffer: () => false, request: async () => "unsupported" as const },
};

const ReportHostContext = createContext<ReportHostValue>(defaultReportHost);

export function ReportHost({
  value,
  children,
}: {
  value: Partial<ReportHostValue>;
  children: ReactNode;
}) {
  // Partial so a host only states what it changes; the rest stays the default.
  // Memoised on the caller's object so the whole report doesn't re-render when
  // an unrelated parent does (the provider objects are module-level constants).
  const merged = useMemo<ReportHostValue>(() => ({ ...defaultReportHost, ...value }), [value]);
  return <ReportHostContext.Provider value={merged}>{children}</ReportHostContext.Provider>;
}

export function useReportHost(): ReportHostValue {
  return useContext(ReportHostContext);
}
