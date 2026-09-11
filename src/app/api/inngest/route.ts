// /api/inngest — Inngest handler
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  monthlyAuditCron,
  runAudit,
  verifyReminder,
  weeklyVerifyCron,
} from "@/inngest/functions";

// Per-engine observe steps run for minutes; Vercel's default function timeout
// (10s Hobby / 15s Pro) would kill the invocation mid-audit. Raise the ceiling to
// 300s (route-segment config, METHODOLOGY.md-app .../route-segment-config/maxDuration).
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [runAudit, verifyReminder, weeklyVerifyCron, monthlyAuditCron],
});
