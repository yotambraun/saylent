// Legal TEMPLATE. A self-hosted deployment must publish its own terms, not
// somebody else's. The operator's name comes from NEXT_PUBLIC_OPERATOR_NAME;
// until that is set this page renders a blocking notice INSTEAD of the terms, so
// an unconfigured deployment can never publish an agreement attributed to nobody.
import { contactPhrase } from "@/lib/branding";

export const metadata = { title: "Terms · Saylent" };

const OPERATOR_NAME = process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim();

function NotConfigured() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl">Terms of Service</h1>
      <div className="mt-6 rounded-lg border-2 border-signal bg-card p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-signal">
          Not published
        </p>
        <p className="mt-3 leading-relaxed text-ink/80">
          The operator of this deployment has not configured this page. No terms of service are
          published here yet, so nothing on this page forms an agreement.
        </p>
        <p className="mt-4 leading-relaxed text-ink/80">
          If you run this deployment: set <code className="font-mono">NEXT_PUBLIC_OPERATOR_NAME</code>{" "}
          to your legal entity or personal name, then replace the body of this page with terms
          that match how you actually run it.
        </p>
      </div>
    </div>
  );
}

export default function TermsPage() {
  if (!OPERATOR_NAME) return <NotConfigured />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-display text-3xl">Terms of Service</h1>
      <p className="mt-2 font-mono text-xs uppercase tracking-widest text-signal">
        Template: edit before publishing
      </p>
      <p className="mt-6 leading-relaxed text-ink/80">
        This deployment of Saylent is operated by <strong>{OPERATOR_NAME}</strong>. This page is a
        starting template, not a finished agreement. Replace it with terms that match how you
        actually run this deployment: who may sign up, what the operator&apos;s limits
        mean, fair use of the audit pipeline, and how takedown/correction requests are handled
        (see the takedown form linked from every report).
      </p>
      <p className="mt-4 leading-relaxed text-ink/80">
        Questions about these terms: {contactPhrase()}.
      </p>
    </div>
  );
}
