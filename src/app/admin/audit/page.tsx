// /admin/audit: the append-only audit trail, newest first. Service-role
// read (RLS also allows admins to read via private.is_admin(), but the panel uses
// the service client throughout). Actor/target emails are resolved from profiles.
import { Badge } from "@saylent/report/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@saylent/report/ui/table";
import { requireAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LoadError } from "../load-error";

export const metadata = { title: "Audit log · Operator console · Saylent" };

export default async function AdminAuditPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: entries, error } = await admin
    .from("audit_log")
    .select("id,at,actor_id,action,target_user_id,reason,after")
    .order("at", { ascending: false })
    .limit(200);

  if (error) return <LoadError what="the audit log" message={error.message} />;

  const rows = entries ?? [];
  const ids = Array.from(
    new Set(rows.flatMap((e) => [e.actor_id, e.target_user_id].filter(Boolean) as string[])),
  );
  const emailById = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id,email")
      .in("id", ids);
    for (const p of profiles ?? []) emailById.set(p.id, p.email);
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl">Audit log</h1>
        <span className="font-mono text-xs text-wire tabular-nums">{rows.length} shown</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-wire">
                  No audit entries yet.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-wire tabular-nums" suppressHydrationWarning>
                    {new Date(e.at).toLocaleString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell>{emailById.get(e.actor_id) ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.action}</Badge>
                  </TableCell>
                  <TableCell className="text-wire">
                    {e.target_user_id ? emailById.get(e.target_user_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-wire">{e.reason}</TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs text-wire">
                    {e.after ? JSON.stringify(e.after) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
