// A self-hosted deployment's root must not
// show OUR marketing (the old landing lived here, at (marketing)/page.tsx, now
// deleted). "/" only ever redirects: signed in → /app, signed out → /login. The
// deployer's front page for strangers is /demo (linked from /login and every
// help page).
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveRootRedirect } from "./root-redirect";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(resolveRootRedirect(user));
}
