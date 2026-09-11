// GDPR Art. 20 data export ("download my data").
// Auth-gated exactly like /api/account/delete: reads the authed user, refuses
// anonymous callers. Assembles the caller's OWN data as one JSON document and
// returns it as a downloadable attachment.
//
// Caller-scoped by construction: every table is read through the USER's RLS
// client (createClient), whose owner-scoped SELECT policies make cross-user rows
// invisible. The explicit `.eq("user_id", user.id)` is belt-and-braces — RLS
// already filters, but the filter documents intent and holds even if a policy is
// ever loosened. No service-role client is used here.
import { NextResponse } from "next/server";
import { EXPORT_TABLES, buildExportFilename } from "@/lib/account-export";
import { assertNotDemo } from "@/lib/demo-mode";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return NextResponse.json(demo, { status: 403 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  // The profile row is keyed by id (not user_id).
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
  }

  // Every other export table has a user_id column + owner-scoped RLS.
  const results = await Promise.all(
    EXPORT_TABLES.map((table) =>
      supabase.from(table).select("*").eq("user_id", user.id),
    ),
  );

  const tables: Record<string, unknown[]> = {};
  for (let i = 0; i < EXPORT_TABLES.length; i++) {
    const { data, error } = results[i];
    if (error) {
      return NextResponse.json(
        { ok: false, error: `${EXPORT_TABLES[i]}: ${error.message}` },
        { status: 500 },
      );
    }
    tables[EXPORT_TABLES[i]] = data ?? [];
  }

  const document = {
    export_format: "saylent.account-export/v1",
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email },
    profile: profile ?? null,
    ...tables,
  };

  return new NextResponse(JSON.stringify(document, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildExportFilename()}"`,
      // A user's own data must never be cached by a shared proxy.
      "Cache-Control": "no-store",
    },
  });
}
