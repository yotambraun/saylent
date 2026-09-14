// The admin takedown queue. Open requests first,
// each with context (reporter, claim, linked run/brand) and the audited actions:
// unpublish share · disable brand · resolve/dismiss. A general block-domain form
// sits above. Service-role reads; requireAdmin() gates it (layout + here).
import { Badge } from "@saylent/report/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoadError } from "../load-error";
import { BlockDomainForm, TakedownActions } from "./takedown-client";

export const metadata = { title: "Takedowns · Operator console · Saylent" };

export default async function AdminTakedownPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: requests, error } = await admin
    .from("takedown_requests")
    .select("id,brand_id,run_id,reporter_email,claim,status,created_at,resolved_at")
    .order("status", { ascending: true }) // 'open' sorts before 'resolved'/'dismissed'
    .order("created_at", { ascending: false });

  if (error) return <LoadError what="the takedown queue" message={error.message} />;

  const rows = requests ?? [];
  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status !== "open");

  // resolve brand names/domains for context.
  const brandIds = Array.from(new Set(rows.map((r) => r.brand_id).filter(Boolean) as string[]));
  const brandById = new Map<string, { name: string; domain: string }>();
  if (brandIds.length) {
    const { data: brands } = await admin
      .from("brands")
      .select("id,name,domain")
      .in("id", brandIds);
    for (const b of brands ?? []) brandById.set(b.id, { name: b.name, domain: b.domain });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl">Takedowns</h1>
        <span className="font-mono text-xs text-wire tabular-nums">{open.length} open</span>
      </div>

      {/* Block a domain (general — not tied to a request) */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Block a domain</CardTitle>
        </CardHeader>
        <CardContent>
          <BlockDomainForm />
        </CardContent>
      </Card>

      {/* Open queue */}
      <div className="flex flex-col gap-4">
        {open.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-wire">No open requests.</CardContent>
          </Card>
        ) : (
          open.map((r) => {
            const brand = r.brand_id ? brandById.get(r.brand_id) : null;
            return (
              <Card key={r.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 font-display text-base">
                    <span>{r.reporter_email || "anonymous reporter"}</span>
                    <span className="font-mono text-xs text-wire" suppressHydrationWarning>
                      {new Date(r.created_at).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 text-sm">
                  <p className="whitespace-pre-wrap text-ink">{r.claim}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {brand ? (
                      <Badge variant="outline">
                        {brand.name} · {brand.domain}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">no linked brand</Badge>
                    )}
                    {r.run_id ? (
                      <Badge variant="outline">run {r.run_id.slice(0, 8)}</Badge>
                    ) : (
                      <Badge variant="secondary">no linked run</Badge>
                    )}
                  </div>
                  <TakedownActions id={r.id} runId={r.run_id} brandId={r.brand_id} />
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Recently closed */}
      {closed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Recently closed</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0 text-sm">
            {closed.slice(0, 20).map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0">
                <span className="truncate text-wire">{r.claim}</span>
                <Badge variant={r.status === "dismissed" ? "secondary" : "default"}>{r.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
