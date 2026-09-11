"use client";
// Package-free theme control. theme = light | dark | system, persisted in
// localStorage("saylent-theme"); applied by toggling the `dark` class on <html>.
// The no-FOUC inline script in the root layout sets the class before hydration;
// this reads the stored choice on mount (so SSR renders without a mismatch) and
// writes + applies live on change. "system" tracks prefers-color-scheme changes.
import { useEffect, useState } from "react";
import { cn } from "@saylent/report/utils";

type Theme = "light" | "dark" | "system";

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function prefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && prefersDark());
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle() {
  // Start at "system" on both server and client → no hydration mismatch; the real
  // choice is read from localStorage after mount.
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    // Intentional: read the persisted choice AFTER mount. Initializing from
    // localStorage in useState would diverge from the server's "system" render
    // and cause a hydration mismatch — the class is already correct pre-paint
    // via the no-FOUC script; this only syncs the toggle's active state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme((localStorage.getItem("saylent-theme") as Theme) || "system");
  }, []);

  // Follow OS changes while on "system".
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    localStorage.setItem("saylent-theme", next);
    applyTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-lg border border-line bg-card p-0.5"
    >
      {OPTIONS.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "motion-reduce:transition-none",
              active ? "bg-ink text-paper" : "text-wire hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
