// The Alerts page's URL rules (src/lib/alert-targets.ts): the same guard as
// delivery, a DNS check at save time, Slack's host rule, and the operator's
// loopback opt-in. Resolvers are stubbed; nothing leaves the machine.
import { describe, expect, it } from "vitest";
import type { HostLookup } from "@saylent/engine/util";
import { alertsAllowLoopback, validateAlertTargets } from "./alert-targets";

const publicLookup: HostLookup = async () => [{ address: "93.184.216.34" }];
const SLACK = "https://hooks.slack.com/services/T000/B000/xyz";

describe("validateAlertTargets", () => {
  it("accepts a Slack webhook and a public https webhook; blank fields are skipped", async () => {
    expect(await validateAlertTargets({ slackUrl: SLACK, webhookUrl: "https://hooks.example.com/saylent" }, { lookup: publicLookup })).toBeNull();
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "" })).toBeNull();
  });

  it("keeps the Slack host rule and its message unchanged", async () => {
    expect(await validateAlertTargets({ slackUrl: "https://hooks.example.com/services/x", webhookUrl: "" }, { lookup: publicLookup })).toBe(
      "A Slack incoming webhook URL starts with https://hooks.slack.com/.",
    );
    // and the loopback opt-in does not loosen it
    expect(await validateAlertTargets({ slackUrl: "http://localhost:9000/slack", webhookUrl: "" }, { lookup: publicLookup, allowLoopback: true })).toBe(
      "A Slack incoming webhook URL starts with https://hooks.slack.com/.",
    );
  });

  it("refuses private, link-local and encoded-IP webhook URLs", async () => {
    for (const url of ["https://10.0.0.5/hook", "https://169.254.169.254/latest/meta-data/", "https://[fd00::1]/hook", "https://0xa9fea9fe/hook", "https://0251.0376.0251.0376/hook"]) {
      expect(await validateAlertTargets({ slackUrl: "", webhookUrl: url }, { lookup: publicLookup }), url).toBe(
        "Webhook URL points at a private, link-local or reserved address.",
      );
    }
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "http://hooks.example.com/x" }, { lookup: publicLookup })).toBe("Webhook URL must be an https URL.");
  });

  it("resolves the host on save: an internal name or a typo is refused", async () => {
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "https://metadata.internal.example/x" }, { lookup: async () => [{ address: "169.254.169.254" }] })).toBe(
      "Webhook URL has a host that resolves to a private, loopback or link-local address.",
    );
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "https://hooks.exmaple.com/x" }, { lookup: async () => [] })).toBe(
      "Webhook URL has a host that does not resolve.",
    );
    expect(await validateAlertTargets({ slackUrl: SLACK, webhookUrl: "" }, { lookup: async () => [{ address: "10.0.0.1" }] })).toBe(
      "Slack webhook URL has a host that resolves to a private, loopback or link-local address.",
    );
  });

  it("refuses loopback unless the operator opted in, and then only loopback", async () => {
    const loop: HostLookup = async () => [{ address: "127.0.0.1" }];
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "http://localhost:8787/hook" }, { lookup: loop })).toMatch(/^Webhook URL points at a loopback address/);
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "http://localhost:8787/hook" }, { lookup: loop, allowLoopback: true })).toBeNull();
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "http://127.0.0.1:8787/hook" }, { lookup: loop, allowLoopback: true })).toBeNull();
    expect(await validateAlertTargets({ slackUrl: "", webhookUrl: "https://192.168.1.20/hook" }, { lookup: publicLookup, allowLoopback: true })).not.toBeNull();
  });
});

describe("alertsAllowLoopback", () => {
  it("is off unless SAYLENT_ALERTS_ALLOW_LOOPBACK is truthy", () => {
    expect(alertsAllowLoopback({})).toBe(false);
    expect(alertsAllowLoopback({ SAYLENT_ALERTS_ALLOW_LOOPBACK: "" })).toBe(false);
    expect(alertsAllowLoopback({ SAYLENT_ALERTS_ALLOW_LOOPBACK: "0" })).toBe(false);
    expect(alertsAllowLoopback({ SAYLENT_ALERTS_ALLOW_LOOPBACK: "1" })).toBe(true);
    expect(alertsAllowLoopback({ SAYLENT_ALERTS_ALLOW_LOOPBACK: " True " })).toBe(true);
  });
});
