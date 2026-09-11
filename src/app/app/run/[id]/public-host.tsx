"use client";
// THE PUBLIC REPORT HOST — /demo and /share/[token] render the same package
// components as the owner's run page, but they are anonymous, read-only surfaces:
// no server actions, no analytics beacon, no Supabase client. Keeping them on
// their own provider means none of that code reaches the marketing bundle.
//
// What they DO get is the house nav standard: PendingLink, so the Brief's
// "Open the full dossier →" is a client transition and not a document reload.
import { type ReactNode } from "react";
import { ReportHost, type ReportHostValue, type ReportLinkProps } from "@saylent/report/host";
import { PendingLink } from "@/components/pending-link";

const HostLink = ({ href, children, ...rest }: ReportLinkProps) => (
  <PendingLink href={href} {...rest}>
    {children}
  </PendingLink>
);

/** Contact address for report corrections, or null when this deployment has
 *  published none. NULL, NOT A PLACEHOLDER: the report host's contract is that a
 *  null address means the correction affordance is not rendered at all, rather
 *  than pointing a reader of a public dossier about a named third party at a
 *  mailbox nobody reads. The takedown intake in the share footer
 *  is unaffected — it is a form, not an address. */
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null;

// Module-level constant: a stable object, so the provider never re-renders the
// report for an unrelated parent update.
const PUBLIC_HOST: Partial<ReportHostValue> = {
  Link: HostLink,
  contactEmail: CONTACT_EMAIL,
  methodologyUrl: "/methodology",
};

export function PublicReportHost({ children }: { children: ReactNode }) {
  return <ReportHost value={PUBLIC_HOST}>{children}</ReportHost>;
}
