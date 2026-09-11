// Thin client→server event sink. Client components
// POST here via trackClient(); server code calls track() directly. COOKIE-FREE:
// an authed caller is keyed by their SESSION user id (read from the auth cookie,
// not a tracking cookie); an anonymous caller supplies an anon_id kept in
// sessionStorage. Rate-limited per IP and zod-validated (event must be in the
// fixed enum; props bounded) so the public surface can't be used to spam the log.
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAnalyticsEvent, track } from "@/lib/analytics";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  event: z.string().max(64).refine(isAnalyticsEvent, "unknown event"),
  anonId: z.string().max(64).optional(),
  // props are bounded: a small bag of primitives. Anything larger is dropped.
  props: z.record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

export async function POST(req: Request) {
  // Fail OPEN like the other limiters: a limiter hiccup must not drop analytics,
  // but a genuine flood is capped by the `track` bucket.
  if (!(await checkRateLimit(RATE_LIMITS.track, clientIp(req)))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  if (!isAnalyticsEvent(parsed.data.event)) return NextResponse.json({ ok: false }, { status: 400 });

  // Prefer the authenticated identity: read the session (auth cookie only — no
  // tracking cookie). Anonymous callers fall back to the sessionStorage anon id.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await track(parsed.data.event, {
    userId: user?.id ?? null,
    anonId: user ? null : (parsed.data.anonId ?? null),
    props: parsed.data.props ?? null,
  });

  return NextResponse.json({ ok: true });
}
