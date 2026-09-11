// /api/inngest — Inngest handler
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  monthlyAuditCron,
  runAudit,
  verifyReminder,
  weeklyVerifyCron,
} from "@/inngest/functions";
import { isDemoReadOnly } from "@/lib/demo-mode";

// Per-engine observe steps run for minutes; Vercel's default function timeout
// (10s Hobby / 15s Pro) would kill the invocation mid-audit. Raise the ceiling to
// 300s (route-segment config, METHODOLOGY.md-app .../route-segment-config/maxDuration).
export const maxDuration = 300;

// The read-only demo has no job runner: every run is refused before it could be
// queued (src/lib/demo-mode.ts), so the endpoint is simply absent there and the
// Inngest keys are not required (src/lib/env.ts inngestKeysRequired).
const notOnDemo = () =>
  new Response("Not available on the read-only demo: it runs no audits.", { status: 404 });
const handlers = isDemoReadOnly()
  ? { GET: notOnDemo, POST: notOnDemo, PUT: notOnDemo }
  : serve({
      client: inngest,
      functions: [runAudit, verifyReminder, weeklyVerifyCron, monthlyAuditCron],
    });
export const { GET, POST, PUT } = handlers;
