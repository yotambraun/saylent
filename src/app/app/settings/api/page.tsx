// Settings › API tokens — personal tokens for the read-only API (/api/v1/*,
// migration 0048). Listed on the user's own RLS client, which can read every
// column except the token hash.
import { createClient } from "@/lib/supabase/server";
import { SettingRow, SettingsSection } from "../setting-row";
import { TokensClient, type TokenRow } from "./tokens-client";

export const metadata = { title: "API tokens · Saylent" };

export default async function ApiTokensPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id,name,prefix,created_at,last_used_at,revoked_at")
    .order("created_at", { ascending: false });
  const missing = !!error;

  return (
    <SettingsSection
      title="API tokens"
      description="Read your brands, runs and exports from scripts, dashboards and agents. Read-only: a token can never start a run, spend credits or change anything."
    >
      {missing ? (
        <SettingRow
          label="Not set up yet"
          description="This deployment's database does not have API tokens yet. The operator applies migration 0048_api_tokens.sql, then this page works."
        />
      ) : (
        <TokensClient tokens={(data ?? []) as TokenRow[]} />
      )}
      <SettingRow
        label="Using a token"
        description={
          <>
            Send it as <span className="font-mono">Authorization: Bearer slt_…</span>. Each user gets 60 requests a minute.{" "}
            <a href="https://yotambraun.github.io/saylent/docs/export#read-only-api" className="text-ink underline underline-offset-2">
              Endpoints and columns
            </a>{" "}
            ·{" "}
            <a href="/api/v1/openapi.json" className="text-ink underline underline-offset-2">
              OpenAPI
            </a>
          </>
        }
      />
    </SettingsSection>
  );
}
