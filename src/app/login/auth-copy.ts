// Supabase auth errors → the product's own voice.
//
// The sign-in card used to render `error.message` verbatim, so a mistyped
// password produced "Invalid login credentials" — a library string, not a
// sentence anyone wrote, and it does not tell a first-time visitor the one thing
// they need: that "Create an account" is right below. The raw
// string still reaches the console for the operator; the person sees this.
//
// Pure and dependency-free so vitest pins every mapping.

export type AuthAction = "signin" | "signup" | "magic-link";

/** Matched case-insensitively against the raw message, first hit wins. */
const RULES: { match: RegExp; action?: AuthAction; copy: string }[] = [
  {
    match: /invalid login credentials|invalid email or password/i,
    copy: "That email and password don’t match. New here? Create an account below.",
  },
  {
    match: /email not confirmed|confirm your email/i,
    copy:
      "Confirm your email first: open the link we sent you, then come back and sign in. No link? Ask your operator — this deployment may not be able to send email.",
  },
  {
    match: /user already registered|already been registered/i,
    copy: "That email already has an account. Sign in instead, or reset your password.",
  },
  {
    match: /password should be at least (\d+)/i,
    copy: "Pick a longer password — at least 6 characters.",
  },
  {
    match: /weak password|password is too weak/i,
    copy: "That password is too easy to guess. Try a longer one.",
  },
  {
    match: /signups? (are )?not allowed|signup is disabled/i,
    copy: "This deployment isn’t accepting new accounts. Ask whoever operates it for access.",
  },
  {
    match: /for security purposes|rate limit|too many requests|over_email_send_rate_limit/i,
    copy: "Too many attempts just now. Wait a minute, then try again.",
  },
  {
    match: /error sending (confirmation |recovery |magic )?(e-?mail|link)|smtp/i,
    copy:
      "This deployment can’t send email yet, so the sign-in link never went out. Ask the operator to configure SMTP in Supabase Auth, or sign in with a password above.",
  },
  {
    match: /invalid email|unable to validate email/i,
    copy: "That doesn’t look like an email address. Check it and try again.",
  },
  {
    match: /failed to fetch|network|load failed/i,
    copy: "Couldn’t reach the server. Check your connection and try again.",
  },
];

const FALLBACK: Record<AuthAction, string> = {
  signin: "Couldn’t sign you in. Try again, or reset your password below.",
  signup: "Couldn’t create the account. Try again in a moment.",
  "magic-link":
    "Couldn’t send the sign-in link. This deployment may have no email configured — ask the operator, or sign in with a password above.",
};

/** The sentence to show a person for a raw Supabase auth error. Never returns
 *  the raw string: log that separately. */
export function authErrorCopy(raw: string | null | undefined, action: AuthAction): string {
  const message = String(raw ?? "");
  for (const rule of RULES) {
    if (rule.action && rule.action !== action) continue;
    if (rule.match.test(message)) return rule.copy;
  }
  return FALLBACK[action];
}
