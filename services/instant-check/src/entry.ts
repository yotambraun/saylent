// The deployed function. esbuild bundles THIS file (scripts/build.mjs) into
// .vercel/output/functions/api/check.func/index.js, so the deployed artifact
// carries @saylent/engine's source inline and has no workspace dependency at
// runtime — the same trick packages/action/scripts/build.mjs uses to make a
// JavaScript Action self-contained.
//
// Exported as a classic Node `(req, res)` handler rather than a web handler:
// with the Build Output API the launcher loads this module directly
// (`launcherType: "Nodejs"`, `shouldAddHelpers: false`), and the Node signature
// needs no runtime detection at all. The 30 lines below are the only adapter —
// all the logic lives in handler.ts, against a standard Request/Response.
import type { IncomingMessage, ServerResponse } from "node:http";
import { runGate } from "./gate";
import { createHandler, DEFAULT_ALLOWED_ORIGINS } from "./handler";

/** Extra browser origins, comma-separated (a preview deployment, a local docs
 *  server at http://localhost:3000). The Pages origin is always allowed. */
const extraOrigins = (process.env.INSTANT_CHECK_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

/** The whole of our telemetry (see below). */
const counts = { hit: 0, miss: 0, error: 0 };

// Module scope, so the cache and the rate-limit buckets survive between
// invocations on the same warm instance (Fluid Compute). Both are best-effort
// by design — see the header comments in cache.ts and rate-limit.ts.
const handle = createHandler({
  gate: (domain) => runGate(domain),
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins],
  onCheck: (outcome) => {
    // The whole of our telemetry: one counter line per check, in the platform
    // log. No domain, no IP, no body — see website/content/docs/check.mdx.
    counts[outcome] += 1;
    console.log(`instant-check ${outcome} (hit=${counts.hit} miss=${counts.miss} error=${counts.error})`);
  },
});

/** Rebuild a standard Request from Node's IncomingMessage. GET only, so there
 *  is no body to forward. `x-forwarded-proto`/`host` are set by Vercel's edge. */
function toRequest(req: IncomingMessage): Request {
  const proto = String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost");
  const url = new URL(req.url ?? "/", `${proto}://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(url, { method: req.method ?? "GET", headers });
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let response: Response;
  try {
    response = await handle(toRequest(req));
  } catch {
    response = new Response(JSON.stringify({ error: { code: "check_failed", message: "Unexpected error." } }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}
