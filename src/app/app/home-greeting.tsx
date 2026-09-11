"use client";
// Dashboard greeting header (the "smart home" upgrade). Time-of-day and the
// local date are computed from the BROWSER clock, never the server — the
// server-guessed greetings were rejected in review (a UTC server "morning" is a
// customer's evening). Two-pass render: SSR + first client paint both render
// the neutral "Welcome back{, name}" with no date, so hydration matches exactly;
// a mount effect then swaps in the local time-of-day + weekday/date. The name
// is the self-set profiles.display_name (never an email), passed from the server.
import { useEffect, useState } from "react";

function timeOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeGreeting({
  name,
  brandCount,
  runningCount,
}: {
  name: string | null;
  brandCount: number;
  runningCount: number;
}) {
  // null until mounted → server and first client render agree (no mismatch).
  const [local, setLocal] = useState<{ greeting: string; date: string } | null>(null);

  useEffect(() => {
    // Intentional: time-of-day + local date are read from the BROWSER clock
    // AFTER mount. Computing them in useState/on the server would either guess
    // the wrong timezone or diverge from the server render (hydration mismatch);
    // the two-pass swap is the whole point (a server-computed greeting reads wrong across timezones).
    const now = new Date();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal({
      greeting: timeOfDay(now.getHours()),
      date: now.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    });
  }, []);

  const greeting = local?.greeting ?? "Welcome back";
  const suffix = name ? `, ${name}` : "";

  const bits = [
    local?.date, // client-only; absent on the server pass
    `${brandCount} ${brandCount === 1 ? "brand" : "brands"}`,
    runningCount > 0 ? `${runningCount} running` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-2xl" suppressHydrationWarning>
        {greeting}
        {suffix}
      </h1>
      <p className="font-mono text-xs text-wire" suppressHydrationWarning>
        {bits.join(" · ")}
      </p>
    </div>
  );
}
