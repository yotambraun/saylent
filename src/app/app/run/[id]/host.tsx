"use client";
// THE NEXT REPORT HOST — the app half of the seam declared in
// packages/report/src/host.tsx (open-source split).
//
// The Brief and the dossier are package components now; everything only a running
// Next app can do is handed to them here: PendingLink for client transitions,
// trackClient for analytics, the four server actions, the same-origin favicon
// proxy, and the live-run feed (Realtime channel + the 5s safety poll). The
// static renderer supplies its own host with the same shape.
import { type ReactNode, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ReportHost, type ReportHostValue, type ReportLinkProps } from "@saylent/report/host";
import { PendingLink } from "@/components/pending-link";
import { trackClient } from "@/lib/analytics-client";
import type { AnalyticsEvent } from "@/lib/analytics";
import { canOfferNotify, requestNotificationPermission } from "@/lib/browser-notify";
import { createClient } from "@/lib/supabase/browser";
import { cancelRun, hideRun, markFixShipped, unhideRun } from "./actions";

const HostLink = ({ href, children, ...rest }: ReportLinkProps) => (
  <PendingLink href={href} {...rest}>
    {children}
  </PendingLink>
);

/** The live-run feed, lifted verbatim out of run-view.tsx. Lean by design:
 *  (1) fetch only answers newer than the cursor (raw_text fetched at most once per
 *  row); (2) fetch a tiny brand_present projection for judged rows so slots gain
 *  their verdict tone without re-pulling text. Realtime pushes stage changes
 *  instantly; the 5s poll is the safety net for a dropped channel. */
const subscribeRunFeed: ReportHostValue["subscribeRunFeed"] = ({
  runId,
  wantAnswers,
  onRun,
  onAnswers,
}) => {
  const supabase = createClient();
  let cursor = "1970-01-01T00:00:00Z";

  const pollAnswers = async () => {
    if (!wantAnswers) return; // no board ⇒ nothing to feed
    const [fresh, judged] = await Promise.all([
      supabase
        .from("answers")
        .select("qid,engine,ok,question,qtype,citations,raw_text,created_at")
        .eq("run_id", runId)
        .gt("created_at", cursor)
        .order("created_at", { ascending: true }),
      supabase
        .from("answers")
        .select("qid,engine,bp:verdict->brand_present")
        .eq("run_id", runId)
        .not("verdict", "is", null),
    ]);
    const freshRows = (fresh.data ?? []) as Array<{
      qid: string;
      engine: string;
      ok: boolean;
      question: string;
      qtype: string;
      citations: { url?: string | null; title?: string | null }[] | null;
      raw_text: string | null;
      created_at: string;
    }>;
    const judgedRows = (judged.data ?? []) as Array<{
      qid: string;
      engine: string;
      bp: boolean | null;
    }>;
    for (const r of freshRows) if (r.created_at > cursor) cursor = r.created_at;
    onAnswers(freshRows, judgedRows);
  };

  // fast path: Realtime pushes stage changes instantly
  const ch = supabase
    .channel(`run-${runId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "runs", filter: `id=eq.${runId}` },
      (p) => onRun(p.new as Record<string, unknown>),
    )
    .subscribe();
  // seed the board immediately so it isn't blank for the first 5s
  void pollAnswers();
  // seed hidden_at/brand_id immediately (the lean `initial` prop omits them) so the
  // hidden badge + hygiene menu render correctly before the first 5s poll tick.
  void (async () => {
    const { data } = await supabase
      .from("runs")
      .select("hidden_at,brand_id")
      .eq("id", runId)
      .maybeSingle();
    if (data) onRun(data);
  })();
  // safety net: the channel can drop silently — poll every 5s while active
  const poll = setInterval(async () => {
    const { data } = await supabase
      .from("runs")
      .select(
        "id,kind,status,stage,profile,scores,est_cost_usd,error,created_at,finished_at,hidden_at,brand_id",
      )
      .eq("id", runId)
      .single();
    if (data) {
      onRun(data);
      if (data.status === "done" || data.status === "failed") {
        void pollAnswers(); // final sweep so the board lands complete
        clearInterval(poll);
      }
    }
    void pollAnswers();
  }, 5000);

  return () => {
    supabase.removeChannel(ch);
    clearInterval(poll);
  };
};

const actions: ReportHostValue["actions"] = {
  available: true,
  markFixShipped,
  cancelRun,
  hideRun,
  unhideRun,
};

const notify: ReportHostValue["notify"] = {
  canOffer: canOfferNotify,
  request: requestNotificationPermission,
};

/** Contact address for report corrections, or null when this deployment has
 *  published none. NULL, NOT A PLACEHOLDER: the report host's contract is that a
 *  null address means the correction affordance is not rendered at all, rather
 *  than pointing a reader of a public dossier about a named third party at a
 *  mailbox nobody reads. The takedown intake in the share footer
 *  is unaffected — it is a form, not an address. */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

export function NextReportHost({ children }: { children: ReactNode }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const value = useMemo<Partial<ReportHostValue>>(
    () => ({
      Link: HostLink,
      track: (event: string, props?: Record<string, unknown>) =>
        trackClient(event as AnalyticsEvent, props),
      actions,
      contactEmail: CONTACT_EMAIL,
      methodologyUrl: "/methodology",
      refresh,
      subscribeRunFeed,
      notify,
    }),
    [refresh],
  );
  return <ReportHost value={value}>{children}</ReportHost>;
}
