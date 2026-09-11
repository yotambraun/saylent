// Pure helpers for the password-reset flow. Split out of the client components so
// the URL contract and the new-password rules are unit-testable without a browser
// or a Supabase client.

/** Where Supabase must send the recovery link. It has to land on /auth/callback,
 *  because that route is the only place that exchanges the emailed code for a
 *  session — and without a session the update-password page cannot write the new
 *  password. `next` then carries the user on to the form. */
export function resetRedirectUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/auth/callback?next=/auth/reset/update`;
}

/** Supabase's own floor is 6 characters; the confirm field exists because a
 *  mistyped password on a page you reached from a one-time email link locks you
 *  out again. Returns null when the pair is acceptable, else the message to show. */
export const MIN_PASSWORD_LENGTH = 6;

export function newPasswordError(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
