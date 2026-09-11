// Settings › Limits — "your limits, set by your operator". There are no plans,
// no credits and no prices in this product: what a user can actually hit is the
// per-brand throttle, the brand cap, and the deployment-wide daily spend
// ceiling, so those are what this page names, alongside their own usage. Reads
// use the USER's session client (RLS = own rows); the spend cap comes from
// getAppSettings (service-role, but the number itself isn't sensitive — it's the
// same cap the admin console shows).
import Link from "next/link";
import { getAppSettings } from "@/lib/app-settings";
import { isAdmin } from "@/lib/admin-auth";
import {
  brandLimit,
  MAX_AUDITS_PER_WINDOW,
  MAX_VERIFIES_PER_WINDOW,
  THROTTLE_WINDOW_HOURS,
} from "@/lib/limits";
import { createClient } from "@/lib/supabase/server";
import { SettingRow, SettingsSection } from "../setting-row";
import { brandLimitCopy, fairUseCopy, spendCapCopy } from "./copy";

export const metadata = { title: "Limits · Saylent" };

export default async function PlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const uid = user!.id;

  const [{ data: runs }, { count: brandCount }, appSettings, admin] = await Promise.all([
    supabase.from("runs").select("kind,est_cost_usd"),
    supabase.from("brands").select("id", { count: "exact", head: true }).eq("user_id", uid),
    getAppSettings(),
    isAdmin(),
  ]);

  const runList = runs ?? [];
  const audits = runList.filter((r) => r.kind === "audit").length;
  const verifies = runList.filter((r) => r.kind === "verify").length;
  const spend = runList.reduce((sum, r) => sum + Number(r.est_cost_usd ?? 0), 0);

  return (
    <SettingsSection
      title="Limits"
      description={
        admin
          ? "Your limits on this deployment. You are an operator here, so you set them."
          : "Your limits, set by whoever operates this deployment. Ask them for a higher cap."
      }
    >
      {/* On a single-operator self-host the reader IS the operator, and there was
          no path from here to where the caps actually live. */}
      {admin && (
        <SettingRow
          label="You set these"
          description="The caps below come from this deployment's environment and admin settings."
        >
          <Link
            href="/admin#budget-limits"
            className="text-sm text-ink underline underline-offset-2"
          >
            Budget &amp; limits →
          </Link>
        </SettingRow>
      )}
      <SettingRow
        label="Brands"
        description="How many brands one account may audit on this deployment."
      >
        <p className="text-sm text-wire">
          {brandLimitCopy(brandLimit())} You have {brandCount ?? 0}.
        </p>
      </SettingRow>

      <SettingRow
        label="Fair use"
        description="The guardrails this deployment enforces on every brand, named up front."
      >
        <p className="text-sm text-wire">
          {fairUseCopy(MAX_AUDITS_PER_WINDOW, MAX_VERIFIES_PER_WINDOW, THROTTLE_WINDOW_HOURS)}
        </p>
      </SettingRow>

      <SettingRow
        label="Spend cap"
        description="The daily ceiling this deployment's operator has set across all users."
      >
        <p className="text-sm text-wire">{spendCapCopy(appSettings.dailySpendCapUsd)}</p>
      </SettingRow>

      <SettingRow
        label="Usage"
        description="AI cost is what this deployment spends running your audits."
        stack
      >
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs text-wire">Audits run</dt>
            <dd className="mt-1 font-mono text-ink">{audits}</dd>
          </div>
          <div>
            <dt className="text-xs text-wire">Verifies run</dt>
            <dd className="mt-1 font-mono text-ink">{verifies}</dd>
          </div>
          <div>
            <dt className="text-xs text-wire">AI cost</dt>
            <dd className="mt-1 font-mono text-ink">${spend.toFixed(2)}</dd>
          </div>
        </dl>
      </SettingRow>
    </SettingsSection>
  );
}
