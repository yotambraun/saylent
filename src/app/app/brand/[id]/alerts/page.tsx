// Alerts & digest for one brand: tell me when the answers move. The rules and
// the payload are the packages' (@saylent/report/alerts); this page stores
// when and where (migration 0047) and shows the last deliveries, so a silent
// webhook is visible. Stored webhook URLs are shown as "stored", never echoed.
import { notFound } from "next/navigation";
import { PendingLink } from "@/components/pending-link";
import { emailConfigured } from "@/lib/email";
import { sealingAvailable } from "@/lib/secret-box";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AlertsClient } from "./alerts-client";

export const metadata = { title: "Alerts · Saylent" };

export default async function AlertsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: brand, error } = await supabase.from("brands").select("id,name,domain").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  if (!brand || !user) notFound();

  // non-secret settings on the owner's client (RLS + column grant, 0047)
  const { data: settings } = await supabase
    .from("brand_alerts")
    .select("on_run,weekly_digest,email")
    .eq("brand_id", id)
    .maybeSingle();
  // presence of the sealed targets only, after the ownership read above
  const { data: sealed } = await createAdminClient()
    .from("brand_alerts")
    .select("slack_url_sealed,webhook_url_sealed,webhook_secret_sealed")
    .eq("brand_id", id)
    .maybeSingle();
  const { data: deliveries } = await supabase
    .from("alert_deliveries")
    .select("channel,kind,status,error,created_at")
    .eq("brand_id", id)
    .order("created_at", { ascending: false })
    .limit(8);

  const s = settings as { on_run: boolean; weekly_digest: boolean; email: boolean } | null;
  const z = sealed as { slack_url_sealed: string | null; webhook_url_sealed: string | null; webhook_secret_sealed: string | null } | null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PendingLink href={`/app/brand/${brand.id}`} className="font-mono text-xs text-wire hover:text-ink">
          ← {brand.name}
        </PendingLink>
        <h1 className="font-display text-2xl">Alerts</h1>
        <p className="text-sm text-wire">
          What changed in the answers about {brand.name}, sent when it changes. Every alert lists its events with a link to the
          answer behind each one. Alerts never include an API key, and the log of what was sent keeps no URL.
        </p>
      </header>

      <AlertsClient
        brandId={brand.id}
        initial={{ onRun: s?.on_run ?? true, weeklyDigest: s?.weekly_digest ?? false, email: s?.email ?? false }}
        stored={{ slack: !!z?.slack_url_sealed, webhook: !!z?.webhook_url_sealed, secret: !!z?.webhook_secret_sealed }}
        emailConfigured={emailConfigured()}
        sealingAvailable={sealingAvailable()}
        ownerEmail={user.email ?? null}
      />

      <section>
        <h2 className="font-display text-lg">Recent deliveries</h2>
        {deliveries && deliveries.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {(deliveries as { channel: string; kind: string; status: string; error: string | null; created_at: string }[]).map((d, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 text-sm">
                <span className="font-mono text-xs text-wire" suppressHydrationWarning>
                  {new Date(d.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-ink">{d.channel}</span>
                <span className="text-wire">{d.kind === "digest.weekly" ? "weekly digest" : "after a run"}</span>
                <span className={d.status === "sent" ? "text-success" : "text-pill-dismissed"}>{d.status === "sent" ? "sent" : d.error ?? "failed"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-wire">Nothing sent yet. Alerts go out after the next finished run that changed something.</p>
        )}
      </section>
    </div>
  );
}
