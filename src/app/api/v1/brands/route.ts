// GET /api/v1/brands: the caller's brands. Read-only API, see
// src/lib/api-auth.ts (token or session, rate limited) and src/lib/api-data.ts
// (owner-scoped reads). Documented at /docs/export#read-only-api.
import { callerError, resolveApiCaller, apiError } from "@/lib/api-auth";
import { listBrands } from "@/lib/api-data";
import { apiJson } from "@/lib/api-respond";

export async function GET(req: Request) {
  const caller = await resolveApiCaller(req);
  if (!caller.ok) return callerError(caller);
  try {
    return apiJson({ brands: await listBrands(caller.client, caller.userId) });
  } catch {
    return apiError(500, "read failed");
  }
}
