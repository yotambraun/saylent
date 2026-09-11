// The ONE transactional-email send path. Inert until
// RESEND_API_KEY + EMAIL_FROM are set (and the `emails` flag is on) — then it
// POSTs to the email API directly (raw fetch, no SDK ceremony); otherwise it
// no-ops with a structured "skipped" log line and returns cleanly.
//
// HARD RULE: sendEmail NEVER throws. An email failure must never fail a run, a
// webhook, or a cron — every call site treats a false return as "not sent" and
// moves on. All network work is fire-safe (caught, logged, swallowed).
import {
  type BaseProps,
  type DossierReadyProps,
  type EmailContent,
  type MovementProps,
  type VerifyReminderProps,
  dossierReadyEmail,
  movementEmail,
  verifyReminderEmail,
  welcomeEmail,
} from "../emails/templates";
import { flag } from "./flags";
import { log } from "./log";

/** Discriminated union: each template name pins its own props shape, so a wrong
 *  prop bag for a template is a compile error at the call site. */
export type EmailMessage =
  | { template: "welcome"; props: BaseProps }
  | { template: "dossier-ready"; props: DossierReadyProps }
  | { template: "movement"; props: MovementProps }
  | { template: "verify-reminder"; props: VerifyReminderProps };

/** Pure render: message → {subject, html}. Exported for tests (no network). */
export function renderEmail(msg: EmailMessage): EmailContent {
  switch (msg.template) {
    case "welcome":
      return welcomeEmail(msg.props);
    case "dossier-ready":
      return dossierReadyEmail(msg.props);
    case "movement":
      return movementEmail(msg.props);
    case "verify-reminder":
      return verifyReminderEmail(msg.props);
    default: {
      // exhaustiveness guard — a new template without a case is a type error here
      const _never: never = msg;
      throw new Error(`unknown email template: ${JSON.stringify(_never)}`);
    }
  }
}

export type SendEmailArgs = EmailMessage & { to: string };

/** Can this deployment actually send outbound email right now? The same three
 *  conditions sendEmail checks, exported so a page can tell the truth before it
 *  promises a reply. */
export function emailConfigured(): boolean {
  return flag("emails") && !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

/** True only when we actually handed the message to the email API (2xx). false = the
 *  key/flag guard skipped it OR the send failed (both logged). Never throws. */
export async function sendEmail(args: SendEmailArgs): Promise<boolean> {
  const { to, ...msg } = args;
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  // Inert path: no key, no from, or the feature flag is off → structured skip.
  if (!flag("emails")) {
    log.info("email skipped (emails flag off)", { template: msg.template, to });
    return false;
  }
  if (!key || !from) {
    log.info("email skipped (no RESEND_API_KEY)", { template: msg.template, to });
    return false;
  }

  let content: EmailContent;
  try {
    content = renderEmail(msg);
  } catch (err) {
    // A render bug must not throw into a run — log and bail.
    log.error("email render failed", {
      template: msg.template,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: content.subject,
        html: content.html,
      }),
    });
    if (!res.ok) {
      log.warn("email send non-2xx", { template: msg.template, to, status: res.status });
      return false;
    }
    log.info("email sent", { template: msg.template, to });
    return true;
  } catch (err) {
    log.warn("email send threw", {
      template: msg.template,
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
