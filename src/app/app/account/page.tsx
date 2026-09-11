// /app/account retired → unified settings (2026-07-09). Kept as a redirect so
// old links/bookmarks land in the right place.
import { redirect } from "next/navigation";

export default function AccountRedirect() {
  redirect("/app/settings/profile");
}
