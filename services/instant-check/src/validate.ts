// Input validation for the public instant check ("abuse-safe via safeFetch").
// safeFetch's SSRF/DNS-rebind guard is the last
// line and stays on unconditionally (src/gate.ts never passes `allowPrivate`);
// this module is the FIRST line, so an obviously hostile or useless input never
// costs a DNS lookup or an outbound request at all.
//
// Public hostname only. No scheme other than http/https, no credentials, no
// port, no path, no query, no IP literal, no localhost/loopback/internal TLD.

/** RFC 1035 ceiling for a fully qualified domain name. */
export const MAX_DOMAIN_LENGTH = 253;

/** Hostnames that never belong to a public site, whatever DNS says. */
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

/** Suffixes reserved for private/internal networks (RFC 6762, RFC 8375,
 *  RFC 2606 + the ICANN "corp/home/mail" collision list). */
const BLOCKED_SUFFIXES = [
  ".local",
  ".localhost",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".test",
  ".example",
  ".invalid",
  ".onion",
];

/** One DNS label: 1-63 chars, alphanumeric or hyphen, never hyphen-edged. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type ValidationFailure = { ok: false; code: "missing_domain" | "invalid_domain"; message: string };
export type ValidationSuccess = { ok: true; domain: string };
export type ValidationResult = ValidationSuccess | ValidationFailure;

const invalid = (message: string): ValidationFailure => ({ ok: false, code: "invalid_domain", message });

/**
 * Normalize and validate a user-supplied domain.
 *
 * Accepts `acme.com`, `www.acme.com`, `https://acme.com`, `acme.com/` and an
 * IDN (`bücher.de` -> its punycode form, via WHATWG URL). Everything else is
 * rejected with a message a human can act on. The returned value is the bare,
 * lowercase, ASCII hostname — never a URL, so nothing downstream can be talked
 * into fetching a path, a port or a userinfo section a caller smuggled in.
 */
export function validateDomain(raw: string | null | undefined): ValidationResult {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, code: "missing_domain", message: "Pass ?domain=acme.com." };
  // Length is checked BEFORE parsing so a megabyte query string is cheap to reject.
  if (input.length > MAX_DOMAIN_LENGTH) {
    return invalid(`A domain is at most ${MAX_DOMAIN_LENGTH} characters.`);
  }
  if (/\s/.test(input)) return invalid("A domain contains no spaces.");
  if (input.includes("@")) return invalid("Pass a domain, not an email address or a URL with credentials.");

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
  if (hasScheme && !/^https?:\/\//i.test(input)) {
    return invalid("Only http and https URLs are accepted.");
  }

  let url: URL;
  try {
    url = new URL(hasScheme ? input : `https://${input}`);
  } catch {
    return invalid("That is not a valid domain.");
  }

  if (url.port) return invalid("Drop the port — the check always uses the public site on 80/443.");
  if (url.username || url.password) return invalid("Pass a bare domain, with no credentials.");
  if (url.search || url.hash) return invalid("Pass a bare domain, with no query string.");
  if (url.pathname !== "/") {
    return invalid("Pass a bare domain (the check always starts at the site root).");
  }

  const host = url.hostname.toLowerCase();
  if (!host) return invalid("That is not a valid domain.");
  if (host.length > MAX_DOMAIN_LENGTH) return invalid(`A domain is at most ${MAX_DOMAIN_LENGTH} characters.`);

  // IP literals: WHATWG URL normalizes an IPv6 host to "[...]" and any IPv4
  // form (including the decimal/octal evasions, "0x7f.1", "2130706433") to
  // dotted-quad, so both are caught by shape alone — no arithmetic needed.
  if (host.startsWith("[")) return invalid("Pass a domain name, not an IP address.");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return invalid("Pass a domain name, not an IP address.");

  if (BLOCKED_HOSTS.has(host)) return invalid("That host is not a public website.");
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return invalid("That host is not a public website.");
  }

  const labels = host.split(".");
  if (labels.length < 2) return invalid("Use a full domain, like acme.com.");
  if (!labels.every((label) => LABEL.test(label))) return invalid("That is not a valid domain.");
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,63}$/.test(tld)) return invalid("That is not a valid domain.");

  return { ok: true, domain: host };
}
