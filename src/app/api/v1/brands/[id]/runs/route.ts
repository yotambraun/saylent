// GET /api/v1/brands/{id}/runs: a brand's finished runs, newest first, with
// their recommended and mentioned counts. 404 for a brand that is not yours.
import { apiError, callerError, resolveApiCaller } from "@/lib/api-auth";
import { listBrandRuns, ownBrand } from "@/lib/api-data";
import { apiJson } from "@/lib/api-respond";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const caller = await resolveApiCaller(req);
  if (!caller.ok) return callerError(caller);
  try {
    const brand = await ownBrand(caller.client, caller.userId, id);
    if (!brand) return apiError(404, "brand not found");
    return apiJson({ brand, runs: await listBrandRuns(caller.client, caller.userId, id) });
  } catch {
    return apiError(500, "read failed");
  }
}
