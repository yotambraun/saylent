// Operator flexibility in the app — /admin/providers:
// change provider keys and per-role models WITHOUT a redeploy. Three rules the page
// exists to make visible:
//   1. environment wins — an env-set key/model is read-only here and says so;
//   2. a key is never shown again after it is saved (masked() is the only view);
//   3. every change is audit-logged (migration 0042 writes state + audit together).
// Server component: requireAdmin() gates it (again — never trusts the layout), and
// every value it renders is presence/provenance, never key material.
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import {
  appSecret,
  appSecretTooShort,
  APP_SECRET_MIN_LENGTH,
  maskedProviders,
  modelChoiceRows,
} from "@/lib/provider-settings";
import { KeysPanel, ModelsPanel } from "./providers-client";

export const metadata = { title: "Providers & models · Operator console · Saylent" };

export default async function AdminProvidersPage() {
  await requireAdmin();

  const secretAvailable = appSecret() !== null;
  const [providers, models] = await Promise.all([maskedProviders(), modelChoiceRows()]);

  // Suggestions for the model fields: every shipped registry default, de-duplicated,
  // plus whatever is in force now (so a custom id stays one click away).
  const modelOptions = Array.from(
    new Set(models.flatMap((m) => [m.fallback, m.model])),
  ).sort();

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-2xl">Providers &amp; models</h1>
          <Link href="/admin#budget-limits" className="text-sm text-wire hover:text-ink">
            ← Budget &amp; limits
          </Link>
        </div>
        <p className="max-w-3xl text-sm text-wire">
          Change which API keys and which models this deployment runs on, with no redeploy.
          A key set in the environment always wins and cannot be edited here. Keys saved on
          this page are encrypted at rest and are never shown again. Every change is written
          to the audit log.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Provider keys</CardTitle>
        </CardHeader>
        <CardContent>
          {!secretAvailable && (
            <p className="mb-4 rounded border border-line bg-card p-3 text-sm text-wire">
              {appSecretTooShort()
                ? `APP_SECRET is set but shorter than ${APP_SECRET_MIN_LENGTH} characters, so keys cannot be encrypted. Replace it (openssl rand -hex 32) and restart.`
                : "Set APP_SECRET to manage keys here."}{" "}
              Until then keys are environment-only, and this list is read-only. Models below
              stay editable: a model id is not a secret.
            </p>
          )}
          <KeysPanel providers={providers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Models per role</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelsPanel rows={models} options={modelOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
