// Legal TEMPLATE. A self-hosted deployment must publish its own privacy policy,
// not somebody else's. The operator's name comes from NEXT_PUBLIC_OPERATOR_NAME;
// until that is set this page renders a blocking notice INSTEAD of the policy, so
// an unconfigured deployment can never publish a policy attributed to nobody.
import { contactPhrase } from "@/lib/branding";

export const metadata = { title: "Privacy · Saylent" };

const OPERATOR_NAME = process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim();

function NotConfigured() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl">Privacy Policy</h1>
      <div className="mt-6 rounded-lg border-2 border-signal bg-card p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-signal">
          Not published
        </p>
        <p className="mt-3 leading-relaxed text-ink/80">
          The operator of this deployment has not configured this page. No privacy policy is
          published here yet, so nothing on this page describes how your data is handled.
        </p>
        <p className="mt-4 leading-relaxed text-ink/80">
          If you run this deployment: set <code className="font-mono">NEXT_PUBLIC_OPERATOR_NAME</code>{" "}
          to your legal entity or personal name, then replace the body of this page with a policy
          that matches your jurisdiction and your data-retention practice.
        </p>
      </div>
    </div>
  );
}

export default function PrivacyPage() {
  if (!OPERATOR_NAME) return <NotConfigured />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl">Privacy Policy</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-widest text-signal">
        Template: edit before publishing
      </p>
      <p className="mt-6 leading-relaxed text-ink/80">
        This deployment of Saylent is operated by <strong>{OPERATOR_NAME}</strong>. This page is a
        starting template, not a finished policy. Replace it with one that matches your
        jurisdiction, your data-retention practice, and how people actually reach{" "}
        {contactPhrase()}.
      </p>
      <p className="mt-4 leading-relaxed text-ink/80">
        At minimum, describe: what account and brand data you store, that answers and pages
        fetched during an audit are stored per-brand and isolated at the database level, what
        third-party services process data on your behalf (the LLM providers you configure, your
        Supabase project, your email provider), and how a user can export or delete their data
        (Settings › Account).
      </p>
      <p className="mt-4 leading-relaxed text-ink/80">
        Questions about this deployment&apos;s data handling: {contactPhrase()}.
      </p>
    </div>
  );
}
