// /app/settings → the first section. Real per-section URLs live below this.
import { redirect } from "next/navigation";

export default function SettingsIndex() {
  redirect("/app/settings/profile");
}
