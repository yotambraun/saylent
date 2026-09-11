// /app/settings/plan → /app/settings/limits (permanent).
//
// The page has been called "Limits" for as long as this app has had no billing,
// but the URL still said "plan" — the one word a curious user reads as "where's
// the paywall". The folder is renamed; this redirect keeps every
// bookmark, every old link and the two in-app CTAs that pointed here working.
import { permanentRedirect } from "next/navigation";

export default function PlanRedirect() {
  permanentRedirect("/app/settings/limits");
}
