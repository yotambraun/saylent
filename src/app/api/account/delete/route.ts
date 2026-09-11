// Account deletion: authed user, typed confirmation verified
// client-side, service-role deleteUser → FK cascades wipe every row.
import { NextResponse } from "next/server";
import { assertNotDemo } from "@/lib/demo-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  // Hosted read-only demo — refuse every write.
  const demo = assertNotDemo();
  if (demo) return NextResponse.json(demo, { status: 403 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
