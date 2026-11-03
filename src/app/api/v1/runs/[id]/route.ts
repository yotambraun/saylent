// GET /api/v1/runs/{id}: one finished run as the saylent.export/v1 document
// (format=json, optionally table=...), one table as CSV (format=csv&table=...)
// or the lossless run bundle (format=bundle). The app's Export menu links here.
import { apiError, callerError, resolveApiCaller } from "@/lib/api-auth";
import { runExport } from "@/lib/api-data";
import { exportResponse } from "@/lib/api-respond";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const caller = await resolveApiCaller(req);
  if (!caller.ok) return callerError(caller);
  try {
    const r = await runExport(caller.client, caller.userId, id);
    if (!r.ok) return apiError(r.status, r.error);
    return exportResponse(r.doc, new URL(req.url).searchParams, { brandName: r.brandName, bundle: r.bundle, scope: "run" });
  } catch {
    return apiError(500, "read failed");
  }
}
