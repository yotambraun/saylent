// What this deployment actually accepts at sign-in.
//
// NEXT_PUBLIC_AUTH_METHODS is a csv of "password" | "magic-link" | "google"
// (default "password,magic-link"). The login card has always read it; Settings ›
// Account did not, and hard-coded "You sign in with a magic link. There is no
// password to lose." — flatly false for the shipped default, which leads with
// email + password and ships a reset flow the reader would never go looking for
//. One parser, both screens.
//
// Pure and Next-free so vitest pins the copy.

export type AuthMethod = "password" | "magic-link" | "google";

const KNOWN: readonly AuthMethod[] = ["password", "magic-link", "google"];

/** Parse the csv. Unknown entries are dropped; an empty/absent value is the
 *  shipped default. */
export function parseAuthMethods(raw: string | undefined | null): AuthMethod[] {
  const list = String(raw ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter((m): m is AuthMethod => (KNOWN as readonly string[]).includes(m));
  return list.length > 0 ? list : ["password", "magic-link"];
}

/** The methods this build was compiled with. */
export function authMethods(): AuthMethod[] {
  return parseAuthMethods(process.env.NEXT_PUBLIC_AUTH_METHODS);
}

/** The Settings › Account "Sign-in and recovery" sentence, and whether that row
 *  should link to the password-reset flow. */
export function signInRecoveryCopy(methods: readonly AuthMethod[]): {
  sentence: string;
  showReset: boolean;
} {
  const password = methods.includes("password");
  const magic = methods.includes("magic-link");
  const google = methods.includes("google");
  const extras = [magic ? "a sign-in link emailed to you" : null, google ? "Google" : null].filter(
    Boolean,
  ) as string[];

  if (password) {
    const also = extras.length
      ? ` This deployment also accepts ${extras.join(" and ")}.`
      : "";
    return {
      sentence: `You sign in with your email address and a password.${also} Forgotten it? Reset it — you only need access to your inbox.`,
      showReset: true,
    };
  }
  if (magic) {
    return {
      sentence: `You sign in with a link emailed to you${google ? ", or with Google" : ""}. There is no password to lose, so losing access to your email inbox means losing access to this account.`,
      showReset: false,
    };
  }
  if (google) {
    return {
      sentence: "You sign in with Google. Your password lives with Google, not here.",
      showReset: false,
    };
  }
  return {
    sentence: "This deployment has no sign-in method configured. Ask your operator.",
    showReset: false,
  };
}
