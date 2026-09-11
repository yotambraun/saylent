// SEC-HARDEN (TODO Stage 4) — Google-favicon self-proxy. Host favicons were loaded
// straight from https://www.google.com/s2/favicons, which forced img-src to allow a
// remote host. This route fetches the favicon server-side and streams it back from our
// own origin, so the enforced CSP img-src can stay `'self' data:`. `?domain=` is validated
// as a bare hostname (strict); anything else is refused before any upstream fetch.
import { NextResponse, type NextRequest } from "next/server";

// Per-request (the domain comes from the query) — never prerendered.
export const dynamic = "force-dynamic";

// Bare hostname only: dot-separated labels of alphanumerics/hyphens (no leading/trailing
// hyphen per label), ≥ 2 labels, ≤ 253 chars total. Rejects schemes, paths, ports,
// userinfo, query strings, spaces — anything that is not a plain host. Case-insensitive.
const HOSTNAME =
  /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

/** True when `domain` is a plain hostname safe to hand to the upstream favicon service. */
export function isValidDomain(domain: string | null | undefined): domain is string {
  if (!domain) return false;
  return HOSTNAME.test(domain);
}

// Reserved / documentation TLDs can never resolve, so proxying them is pure
// latency. The report is full of `*.example` hosts (the sample brand, every
// fictional rival), which is why devtools on the flagship page showed a dozen
// failed favicon requests. RFC 2606 + RFC 6761.
const UNRESOLVABLE_TLDS = new Set(["example", "invalid", "test", "localhost"]);

/** True when the host's TLD is reserved and can never have a real favicon. */
export function isUnresolvableHost(domain: string): boolean {
  const tld = domain.toLowerCase().split(".").pop() ?? "";
  return UNRESOLVABLE_TLDS.has(tld);
}

// NO ICON IS NOT AN ERROR. This used to answer 404, so the
// flagship page logged "Failed to load resource: 404" a dozen times and any
// developer who opened devtools saw a wall of red on the best page in the
// product. 204 No Content says the same thing — there is nothing to show — with
// no error: an empty body still fails to decode, so <img onError> still fires
// and the Favicon component's gradient letter tile still renders, which is the
// behavior the 2026-07-22 visual pass established and must not regress.
function noIcon(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    // short POSITIVE ttl (perf audit #3): with no-store, every icon-less host
    // among ~37 battlefield/source rows re-proxied Google (5s timeout each) on
    // EVERY page view. Genuinely absent icons stay absent for an hour.
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const domain = request.nextUrl.searchParams.get("domain");
  if (!isValidDomain(domain)) return noIcon();
  // Short-circuit the hosts that cannot resolve: no upstream call, no 5s wait.
  if (isUnresolvableHost(domain)) return noIcon();

  try {
    const upstream = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
      { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(5000) },
    );
    if (!upstream.ok) return noIcon();
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        // Favicons are effectively immutable per host; cache hard to avoid re-proxying.
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return noIcon();
  }
}
