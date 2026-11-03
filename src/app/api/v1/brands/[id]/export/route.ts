// GET /api/v1/brands/{id}/export: the brand's last 24 finished runs as one
// saylent.export/v1 document (format=json), or one table as CSV
// (format=csv&table=...). The app's "Export history" links here.
import { apiError, callerError, resolveApiCaller } from "@/lib/api-auth";
import { brandExport } from "@/lib/api-data";
import { exportResponse } from "@/lib/api-respond";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const caller = await resolveApiCaller(req);
  if (!caller.ok) return callerError(caller);
  try {
    const r = await brandExport(caller.client, caller.userId, id);
    if (!r.ok) return apiError(r.status, r.error);
    return exportResponse(r.doc, new URL(req.url).searchParams, { brandName: r.brandName, scope: "history" });
  } catch {
    return apiError(500, "read failed");
  }
}
