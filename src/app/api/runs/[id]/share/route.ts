// Share-link management (owner-only): POST {action:"enable"|"rotate"|"revoke"}.
// Ownership enforced by RLS — the update runs on the user's client, and the
// "own runs" policy makes foreign run ids invisible (update matches 0 rows).
//
// PUBLISHING NEEDS AN EXPLICIT CONFIRMATION. Minting a token puts a named
// brand's whole competitive dossier on an unauthenticated URL, so "enable" and
// "rotate" require `confirm: true` in the body. The confirmation dialog in
// src/app/app/run/[id]/report-actions.tsx is what sets it; this check is the
// server-side half, so no other caller — a stale bundle, a script, a future
// button — can publish a report on one click. Revoking needs no confirmation:
// it only ever removes access.
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { track } from "@/lib/analytics";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return NextResponse.json(demo, { status: 403 });

  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { action, confirm } = (await req.json().catch(() => ({}))) as {
    action?: string;
    confirm?: boolean;
  };
  if (action !== "revoke" && confirm !== true) {
    return NextResponse.json(
      {
        error:
          "Creating a public link needs an explicit confirmation. Use the Share report button, which explains what becomes public before it publishes anything.",
      },
      { status: 428 },
    );
  }
  const token = action === "revoke" ? null : randomUUID();

  const { data, error } = await supabase
    .from("runs")
    .update({ share_token: token })
    .eq("id", id)
    .eq("status", "done")
    .eq("kind", "audit")
    .select("id,share_token")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "update failed" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "run not found or not shareable" }, { status: 404 });
  // Analytics: fired only when a share link is (re)issued, not on
  // revoke. Fire-and-forget: track() never throws.
  if (token) await track("share_created", { userId: user.id, props: { run_id: id } });
  return NextResponse.json({ shareToken: data.share_token });
}
