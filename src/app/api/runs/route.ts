// /api/runs POST: the thin authenticated wrapper the UI buttons
// call. Resolves userId from the session, then createRun/retryRun (the ONLY
// run-creation path). 409 carries `reason` verbatim — the UI renders it as-is.
import { NextResponse } from "next/server";
import { z } from "zod";
import { track } from "@/lib/analytics";
import { RATE_LIMITS, checkRateLimit } from "@/lib/rate-limit";
import { createRun, retryRun } from "@/lib/runs";
import { createClient } from "@/lib/supabase/server";

const Body = z.union([
  z.object({ brandId: z.string().uuid(), kind: z.enum(["audit", "verify"]) }),
  z.object({ retryRunId: z.string().uuid() }),
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ reason: "Sign in first." }, { status: 401 });

  // Durable per-user throttle (SEC-HARDEN): a spam guard on manual run creation,
  // above C-CTRL's economic caps in createRun. Fails open (never blocks legit use).
  if (!(await checkRateLimit(RATE_LIMITS.runs, user.id))) {
    return NextResponse.json({ reason: "Too many requests. Wait a minute and try again." }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ reason: "Invalid request." }, { status: 400 });
  }

  const result =
    "retryRunId" in parsed.data
      ? await retryRun(user.id, parsed.data.retryRunId)
      : await createRun({ userId: user.id, brandId: parsed.data.brandId, kind: parsed.data.kind });

  if (!result.ok) {
    return NextResponse.json({ reason: result.reason }, { status: 409 });
  }

  // Analytics: the run-creation chokepoint.
  // Only fresh runs, not retries (retryRun re-emits an existing runId — no new
  // activation). Wrapped so a tracking/count blip can never break run creation.
  if ("kind" in parsed.data) {
    try {
      if (parsed.data.kind === "verify") {
        await track("verify_run", { userId: user.id, props: { run_id: result.runId } });
      } else {
        // "first" = this user now has exactly one audit run (the one just inserted).
        const { count } = await supabase
          .from("runs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("kind", "audit");
        if ((count ?? 0) <= 1) {
          await track("first_audit_started", { userId: user.id, props: { run_id: result.runId } });
        }
      }
    } catch {
      // analytics is fire-and-forget — never let it fail the run path
    }
  }

  return NextResponse.json({ runId: result.runId });
}
