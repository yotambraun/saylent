// The 5 transactional emails, as pure HTML template FUNCTIONS.
// No @react-email dependency (not installed, no new packages): each template is a
// typed props → { subject, html } function and the email API accepts a raw `html` string
// (src/lib/email.ts POSTs it). Voice = the product's: editorial, plain, honest,
// zero hype. One shared frame so every email reads as one system.
//
// Templates are PURE (no env, no I/O, no Date.now) so they render
// identically in a test and in prod and the send helper owns all the side effects.
// The non-transactional email (Movement) carries an unsubscribe link
// (one-click unsubscribe); the four transactional ones do not.

export interface EmailContent {
  subject: string;
  html: string;
}

/** Absolute app URL for links inside emails. Passed in (not read from env) so the
 *  templates stay pure; the send helper supplies it from NEXT_PUBLIC_APP_URL. */
export interface BaseProps {
  appUrl: string;
}

// ---- shared frame -----------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function button(href: string, label: string): string {
  return (
    `<a href="${esc(href)}" ` +
    `style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;` +
    `font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px">${esc(label)}</a>`
  );
}

/** Wrap body HTML in the shared shell. `footerExtra` carries the unsubscribe line
 *  for the one non-transactional template; transactional emails pass nothing. */
function frame(bodyHtml: string, footerExtra = ""): string {
  return (
    `<!-- Saylent transactional email -->` +
    `<div style="margin:0;padding:24px;background:#f6f7f9;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `color:#111827;line-height:1.55">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;` +
    `border-radius:12px;padding:28px 28px 24px">` +
    `<div style="font-weight:700;font-size:15px;letter-spacing:.02em;color:#111827;` +
    `margin-bottom:20px">Saylent</div>` +
    bodyHtml +
    `</div>` +
    `<div style="max-width:520px;margin:16px auto 0;font-size:12px;color:#6b7280;text-align:center">` +
    `Saylent: AI visibility, with receipts.${footerExtra}</div>` +
    `</div>`
  );
}

function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px">${text}</p>`;
}

// ---- 1. Welcome (transactional) --------------------------------------------
// Subject/body core: "Your Saylent account is ready" / "Add your brand and
// domain — the audit takes about ten minutes."

export function welcomeEmail(props: BaseProps): EmailContent {
  const href = `${props.appUrl}/app`;
  return {
    subject: "Your Saylent account is ready",
    html: frame(
      p("Welcome. Your account is set up.") +
        p("Add your brand and its domain. That's all we need. The audit takes about ten minutes, and you'll get a dossier with every claim's receipt.") +
        `<div style="margin:20px 0 4px">${button(href, "Add your brand")}</div>`,
    ),
  };
}

// ---- 2. Dossier ready (transactional) --------------------------------------
// "Your AI visibility dossier: recommended in {X} of {N}" / verdict strip + top
// fix title + button "Open your dossier".

export interface DossierReadyProps extends BaseProps {
  brand: string;
  recommended: number;
  answered: number;
  topFixTitle?: string;
  runId: string;
}

export function dossierReadyEmail(props: DossierReadyProps): EmailContent {
  const href = `${props.appUrl}/app/run/${props.runId}`;
  const topFix = props.topFixTitle
    ? p(`Your highest-leverage fix: <strong>${esc(props.topFixTitle)}</strong>.`)
    : "";
  return {
    subject: `Your AI visibility dossier: recommended in ${props.recommended} of ${props.answered}`,
    html: frame(
      p(`Your <strong>${esc(props.brand)}</strong> dossier is ready.`) +
        p(
          `Across the four engines, you were recommended in <strong>${props.recommended} of ${props.answered}</strong> answers. Every number links to the raw answer that produced it.`,
        ) +
        topFix +
        `<div style="margin:20px 0 4px">${button(href, "Open your dossier")}</div>`,
    ),
  };
}

// ---- 3. Movement / verify (NON-transactional — needs unsubscribe) ----------
// "Verify results: {before}→{after} of {N}" / per-fix watch line + honest noise
// note when |Δ|≤1.

export interface MovementProps extends BaseProps {
  brand: string;
  before: number;
  after: number;
  answered: number;
  runId: string;
  /** One-line-per-fix watch notes (already computed by the engine). */
  watchLines?: string[];
  /** One-click unsubscribe target. TODO route is a stub today. */
  unsubscribeUrl: string;
}

export function movementEmail(props: MovementProps): EmailContent {
  const href = `${props.appUrl}/app/run/${props.runId}/verify`;
  const delta = props.after - props.before;
  const noiseNote =
    Math.abs(delta) <= 1
      ? p(
          `<em>A move of ${delta >= 0 ? "+" : ""}${delta} is inside the noise floor. Set-vs-set, we don't dress up a coin-flip. Watch the trend, not one point.</em>`,
        )
      : "";
  const watch =
    props.watchLines && props.watchLines.length
      ? `<ul style="margin:0 0 14px;padding-left:18px;font-size:14px;color:#374151">` +
        props.watchLines.map((l) => `<li style="margin:0 0 6px">${esc(l)}</li>`).join("") +
        `</ul>`
      : "";
  const footer =
    ` &middot; <a href="${esc(props.unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">` +
    `Unsubscribe from movement reports</a>`;
  return {
    subject: `Verify results: ${props.before}→${props.after} of ${props.answered}`,
    html: frame(
      p(`We re-measured <strong>${esc(props.brand)}</strong> after your fixes.`) +
        p(
          `Recommended: <strong>${props.before} → ${props.after}</strong> of ${props.answered}, measured set-vs-set against your baseline.`,
        ) +
        watch +
        noiseNote +
        `<div style="margin:20px 0 4px">${button(href, "See the movement")}</div>`,
      footer,
    ),
  };
}

// ---- 4. Verify reminder, day 10 (transactional) ----------------------------
// "Time to measure your fixes" / one button.

export interface VerifyReminderProps extends BaseProps {
  brand: string;
  brandId: string;
}

export function verifyReminderEmail(props: VerifyReminderProps): EmailContent {
  const href = `${props.appUrl}/app/brand/${props.brandId}`;
  return {
    subject: "Time to measure your fixes",
    html: frame(
      p(`It's been about ten days since your <strong>${esc(props.brand)}</strong> audit.`) +
        p("If you've shipped some of the fixes, a verify run re-asks the same frozen questions and measures the movement, honestly, set-vs-set.") +
        `<div style="margin:20px 0 4px">${button(href, "Run your verify")}</div>`,
    ),
  };
}
