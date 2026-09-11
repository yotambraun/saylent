// The admin support queue. Open requests first, each
// with the sender (user email / left email), body, and auto-attached run/brand
// context, plus the audited Resolve action. Service-role reads; requireAdmin()
// gates it (layout + here). Mirrors the takedown queue.
import { Badge } from "@saylent/report/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@saylent/report/ui/card";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoadError } from "../load-error";
import { ResolveSupport } from "./support-client";

export const metadata = { title: "Support · Admin · Saylent" };

type SupportRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  subject: string | null;
  body: string;
  context: { run_id?: string; brand_id?: string } | null;
  status: string;
  created_at: string;
};

export default async function AdminSupportPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: requests, error } = await admin
    .from("support_requests")
    .select("id,user_id,email,subject,body,context,status,created_at")
    .order("status", { ascending: true }) // 'open' sorts before 'resolved'
    .order("created_at", { ascending: false });

  if (error) return <LoadError what="the support queue" message={error.message} />;

  const rows = (requests ?? []) as SupportRow[];
  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status !== "open");

  // resolve linked brand names for context.
  const brandIds = Array.from(
    new Set(rows.map((r) => r.context?.brand_id).filter(Boolean) as string[]),
  );
  const brandById = new Map<string, { name: string; domain: string }>();
  if (brandIds.length) {
    const { data: brands } = await admin.from("brands").select("id,name,domain").in("id", brandIds);
    for (const b of brands ?? []) brandById.set(b.id, { name: b.name, domain: b.domain });
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl">Support</h1>
        <span className="font-mono text-xs text-wire tabular-nums">{open.length} open</span>
      </div>

      <div className="flex flex-col gap-4">
        {open.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-wire">No open requests.</CardContent>
          </Card>
        ) : (
          open.map((r) => {
            const brand = r.context?.brand_id ? brandById.get(r.context.brand_id) : null;
            return (
              <Card key={r.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 font-display text-base">
                    <span>{r.email || (r.user_id ? "user (no email on file)" : "anonymous")}</span>
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
                  {r.subject && <p className="font-medium text-ink">{r.subject}</p>}
                  <p className="whitespace-pre-wrap text-ink">{r.body}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {r.user_id ? (
                      <Badge variant="outline">user {r.user_id.slice(0, 8)}</Badge>
                    ) : (
                      <Badge variant="secondary">logged out</Badge>
                    )}
                    {brand ? (
                      <Badge variant="outline">
                        {brand.name} · {brand.domain}
                      </Badge>
                    ) : null}
                    {r.context?.run_id ? (
                      <Badge variant="outline">run {r.context.run_id.slice(0, 8)}</Badge>
                    ) : null}
                  </div>
                  <ResolveSupport id={r.id} />
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {closed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Recently resolved</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0 text-sm">
            {closed.slice(0, 20).map((r) => (
              <div
                key={r.id}
                className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0"
              >
                <span className="truncate text-wire">{r.subject || r.body}</span>
                <Badge variant="default">{r.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
