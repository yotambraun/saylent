// Compact relative time for the notifications inbox ("just now",
// "5m", "3h", "2d", then a date). Pure; rendered client-only (suppressHydration)
// so it never mismatches SSR.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.floor((now - then) / 1000);
  if (secs < 45) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
