// The in-app "Contact support" sink. Creates a
// TRACKED support_requests row (not a mailto to a dead address). Authed-first: a
// logged-in user's id + their latest run/brand context are auto-attached; the
// endpoint also accepts an email so a future logged-out contact form works. The
// table grants anon/authenticated nothing (migration 0028), so the row is written
// through the SERVICE ROLE after we read the caller's own session. Rate-limited
// per IP, zod-bounded. An operator ping fires (fire-and-forget) when RESEND_API_KEY is set.
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertNotDemo } from "@/lib/demo-mode";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  subject: z.string().trim().max(200).optional().or(z.literal("")),
  body: z.string().trim().min(10, "Please describe your issue (at least a sentence).").max(4000),
  email: z.string().trim().email().max(254).optional().or(z.literal("")),
});

export async function POST(req: Request) {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return NextResponse.json(demo, { status: 403 });

  if (!(await checkRateLimit(RATE_LIMITS.support, clientIp(req)))) {
    return NextResponse.json({ ok: false, error: "Too many requests. Please try again later." }, { status: 429 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const { subject, body, email } = parsed.data;

  // Read the caller's own session (auth cookie). RLS scopes the context read to
  // this user, so we can only ever auto-attach the caller's OWN latest run/brand.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let context: Record<string, string> | null = null;
  const resolvedEmail = email || user?.email || null;
  if (user) {
    const { data: latestRun } = await supabase
      .from("runs")
      .select("id,brand_id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestRun) {
      context = { run_id: latestRun.id as string, brand_id: (latestRun as { brand_id: string }).brand_id };
    }
  }

  // A logged-out caller MUST leave an email so we can reply.
  if (!user && !resolvedEmail) {
    return NextResponse.json({ ok: false, error: "Please leave an email so we can reply." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("support_requests").insert({
    user_id: user?.id ?? null,
    email: resolvedEmail,
    subject: subject || null,
    body,
    context,
  });
  if (error) return NextResponse.json({ ok: false, error: "Could not submit. Please try again." }, { status: 500 });

  // fire-and-forget operator notification (silently skipped until RESEND_API_KEY is set up).
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    void fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: process.env.EMAIL_FROM,
        subject: `Saylent support: ${subject || "new request"}`,
        text: `From: ${resolvedEmail ?? "unknown"}${user ? ` (user ${user.id})` : ""}\n\n${body}`,
      }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
