// What a brand owner may save as an alert target (the Alerts page), and the
// operator's loopback opt-in. The checks are the packages' own
// (checkTargetUrlResolved in @saylent/report/alerts-deliver), so a URL the
// page accepts is one delivery would send to, and the reverse.
//
// Saving resolves the host once, as a usability check: a typo or an internal
// name is refused with a sentence instead of failing every alert later. DNS
// can change after that, so the send-time guard (the engine's safePost:
// resolve, refuse private answers, pin the socket, never follow a redirect)
// is the defence that counts.
import { checkTargetUrl, checkTargetUrlResolved, type TargetUrlPolicy } from "@saylent/report/alerts-deliver";
import type { HostLookup } from "@saylent/engine/util";

const TRUTHY = new Set(["1", "true", "on", "yes"]);

/** SAYLENT_ALERTS_ALLOW_LOOPBACK: let a webhook or Slack URL point at the
 *  server's own loopback interface (localhost, 127.0.0.0/8, ::1; http
 *  allowed). For local development only: on a shared deployment it would let
 *  every user send requests to services listening on the server itself.
 *  Off unless set to 1, true, on or yes. */
export function alertsAllowLoopback(env: Record<string, string | undefined> = process.env): boolean {
  return TRUTHY.has((env.SAYLENT_ALERTS_ALLOW_LOOPBACK ?? "").trim().toLowerCase());
}

const SLACK_PREFIX = /^https:\/\/hooks\.slack\.com\//;

/** Validate the URLs a brand owner typed. Blank fields are skipped (blank
 *  keeps the stored value). Returns the first error as a sentence, or null. */
export async function validateAlertTargets(
  input: { slackUrl: string; webhookUrl: string },
  policy: TargetUrlPolicy & { lookup?: HostLookup } = {},
): Promise<string | null> {
  const fields = [
    ["Slack webhook URL", input.slackUrl],
    ["Webhook URL", input.webhookUrl],
  ] as const;
  // the order of the checks that existed before the DNS check is unchanged:
  // the URL itself, then Slack's host rule, then (new) the resolved address
  for (const [label, url] of fields) {
    if (!url) continue;
    const bad = checkTargetUrl(url, policy);
    if (bad) return `${label} ${bad}.`;
  }
  if (input.slackUrl && !SLACK_PREFIX.test(input.slackUrl)) {
    return "A Slack incoming webhook URL starts with https://hooks.slack.com/.";
  }
  for (const [label, url] of fields) {
    if (!url) continue;
    const bad = await checkTargetUrlResolved(url, policy);
    if (bad) return `${label} ${bad}.`;
  }
  return null;
}
