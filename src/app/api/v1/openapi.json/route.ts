// GET /api/v1/openapi.json: the read-only API as OpenAPI 3.1. Public: it
// describes the API, it reads no data.
import { buildOpenApi } from "@/lib/openapi";

export function GET() {
  return new Response(JSON.stringify(buildOpenApi(), null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
