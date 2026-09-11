import "server-only";
// The admin gate. requireAdmin() runs FIRST in every /admin route AND
// every admin server action (never rely on the layout alone). The role check
// uses the USER's session client on the caller's OWN profile row (RLS-safe: a
// user may read their own row); cross-user admin reads/writes use the service
// role elsewhere. auth.uid()=admin? is the single source of truth for access.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Is the CALLER an operator on this deployment? Read-only and never redirects
 *  — for product pages that want to offer an operator an extra link (Settings ›
 *  Limits → Budget & limits) without becoming an admin route. Same RLS-safe
 *  own-row role read as requireAdmin; any failure reads as "not an admin". */
export async function isAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    return profile?.role === "admin";
  } catch {
    return false;
  }
}

export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/app");

  return { id: user.id, email: user.email ?? "" };
}
