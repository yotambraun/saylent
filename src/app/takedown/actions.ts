"use server";
// The PUBLIC takedown intake. Unauthenticated:
// "this dossier is about us, we didn't consent." Writes a takedown_requests row
// through the SERVICE ROLE (the table grants anon/authenticated nothing — see
// migration 0026), rate-limited per-IP via the durable limiter. When a share
// token is supplied (the /share footer link passes it), we resolve the run +
// brand so the admin queue has context. No auth, so keep the surface tight:
// bounded inputs, honest errors, fail-closed on rate limit.
import { headers } from "next/headers";
import { z } from "zod";
import { RATE_LIMITS, checkRateLimit, clientIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

const Input = z.object({
  reporterEmail: z.string().trim().email("Enter a valid email.").max(254).optional().or(z.literal("")),
  claim: z.string().trim().min(10, "Please describe the issue (at least a sentence).").max(4000),
  token: z.string().trim().max(64).optional(),
});

export async function submitTakedown(input: {
  reporterEmail?: string;
  claim: string;
  token?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { reporterEmail, claim, token } = parsed.data;

  // per-IP rate limit (durable, shared across instances). headers() is the only
  // way to see the client IP from a server action.
  const h = await headers();
  const ip = clientIp(new Request("http://local", { headers: h }));
  if (!(await checkRateLimit(RATE_LIMITS.takedown, ip))) {
    return { ok: false, error: "Too many requests. Please try again later." };
  }

  const admin = createAdminClient();

  // resolve run/brand context from a share token, if one was passed.
  let runId: string | null = null;
  let brandId: string | null = null;
  if (token && /^[0-9a-f-]{36}$/i.test(token)) {
    const { data: run } = await admin
      .from("runs")
      .select("id,brand_id")
      .eq("share_token", token)
      .maybeSingle();
    if (run) {
      runId = run.id;
      brandId = (run as { brand_id: string }).brand_id;
    }
  }

  const { error } = await admin.from("takedown_requests").insert({
    reporter_email: reporterEmail || null,
    claim,
    run_id: runId,
    brand_id: brandId,
  });
  if (error) return { ok: false, error: "Could not submit. Please try again." };
  return { ok: true };
}
