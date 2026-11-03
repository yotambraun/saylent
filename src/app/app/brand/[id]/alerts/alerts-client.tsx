"use client";
// The alerts form: when (after each run, weekly digest), where (email, Slack,
// a signed webhook), a test send, and the honest notes on what each one needs.
// Webhook URLs are write-only here: the page shows whether one is stored, never
// the value.
import { useState, useTransition } from "react";
import { Button } from "@saylent/report/ui/button";
import { Input } from "@saylent/report/ui/input";
import { saveAlertSettings, sendTestAlertAction, type ActionResult } from "./actions";

export interface AlertsClientProps {
  brandId: string;
  initial: { onRun: boolean; weeklyDigest: boolean; email: boolean };
  stored: { slack: boolean; webhook: boolean; secret: boolean };
  emailConfigured: boolean;
  sealingAvailable: boolean;
  ownerEmail: string | null;
}

const check = "size-4 accent-[var(--color-signal,currentColor)]";

export function AlertsClient(props: AlertsClientProps) {
  const [onRun, setOnRun] = useState(props.initial.onRun);
  const [weeklyDigest, setWeeklyDigest] = useState(props.initial.weeklyDigest);
  const [email, setEmail] = useState(props.initial.email);
  const [slackUrl, setSlackUrl] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [removeSlack, setRemoveSlack] = useState(false);
  const [removeWebhook, setRemoveWebhook] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setResult(await saveAlertSettings({ brandId: props.brandId, onRun, weeklyDigest, email, slackUrl, removeSlack, webhookUrl, webhookSecret, removeWebhook }));
      setSlackUrl("");
      setWebhookUrl("");
      setWebhookSecret("");
    });
  const test = () => start(async () => setResult(await sendTestAlertAction(props.brandId)));

  return (
    <div className="flex flex-col gap-8">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink">When</legend>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className={`${check} mt-0.5`} checked={onRun} onChange={(e) => setOnRun(e.target.checked)} />
          <span>
            After every finished run, when something changed against its baseline
            <span className="block text-xs text-wire">Recommendations gained or lost, a rival no earlier answer named, a new off-site opportunity, or a jump in AI-crawler errors. Nothing changed, nothing sent.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className={`${check} mt-0.5`} checked={weeklyDigest} onChange={(e) => setWeeklyDigest(e.target.checked)} />
          <span>
            A weekly digest, Mondays at 09:30 UTC
            <span className="block text-xs text-wire">The newest run against the newest one a week older. Sent only in a week with a run.</span>
          </span>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium text-ink">Where</legend>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className={`${check} mt-0.5`} checked={email} onChange={(e) => setEmail(e.target.checked)} />
          <span>
            Email {props.ownerEmail ? <span className="font-mono text-xs">{props.ownerEmail}</span> : "the account owner"}
            {!props.emailConfigured && (
              <span className="block text-xs text-pill-dismissed">This deployment has no email configured (RESEND_API_KEY and EMAIL_FROM), so email alerts would not send today.</span>
            )}
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="slack-url" className="text-sm text-ink">
            Slack incoming webhook {props.stored.slack && <span className="ml-1 font-mono text-xs text-success">stored</span>}
          </label>
          <Input id="slack-url" type="url" autoComplete="off" placeholder={props.stored.slack ? "Leave blank to keep the stored URL" : "https://hooks.slack.com/services/..."} value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} disabled={!props.sealingAvailable} />
          {props.stored.slack && (
            <label className="flex items-center gap-2 text-xs text-wire">
              <input type="checkbox" className={check} checked={removeSlack} onChange={(e) => setRemoveSlack(e.target.checked)} /> Remove the stored Slack URL
            </label>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="webhook-url" className="text-sm text-ink">
            Webhook {props.stored.webhook && <span className="ml-1 font-mono text-xs text-success">stored{props.stored.secret ? ", signed" : ""}</span>}
          </label>
          <Input id="webhook-url" type="url" autoComplete="off" placeholder={props.stored.webhook ? "Leave blank to keep the stored URL" : "https://example.com/saylent-alerts"} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} disabled={!props.sealingAvailable} />
          <Input aria-label="Webhook signing secret" type="password" autoComplete="new-password" placeholder={props.stored.secret ? "Leave blank to keep the stored secret" : "Signing secret, 16+ characters (optional)"} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} disabled={!props.sealingAvailable} />
          <p className="text-xs text-wire">
            POSTs the saylent.alert/v1 JSON. With a secret, each request carries <span className="font-mono">X-Saylent-Signature: t=…,v1=…</span>, an HMAC-SHA256 of <span className="font-mono">t.body</span>.
          </p>
          {props.stored.webhook && (
            <label className="flex items-center gap-2 text-xs text-wire">
              <input type="checkbox" className={check} checked={removeWebhook} onChange={(e) => setRemoveWebhook(e.target.checked)} /> Remove the stored webhook and secret
            </label>
          )}
        </div>
        {!props.sealingAvailable && (
          <p className="text-xs text-pill-dismissed">This deployment has no APP_SECRET (16+ characters), so webhook URLs cannot be stored safely. Email alerts still work.</p>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" onClick={test} disabled={pending}>
          Send a test
        </Button>
        {result && (
          <p role="status" className={`text-sm ${result.ok ? "text-success" : "text-pill-dismissed"}`}>
            {result.ok ? result.message : result.error}
          </p>
        )}
      </div>
    </div>
  );
}
