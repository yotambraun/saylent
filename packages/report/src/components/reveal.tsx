"use client";
// Calm scroll-reveal for report sections (2026 report-UX research):
// motion guides reading, never performs. Fade-rise once, 500ms,
// staggerable. Honors prefers-reduced-motion; print always shows everything.
import { type ReactNode, useEffect, useRef, useState } from "react";

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  /** ms stagger for grouped items */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  // reduced-motion needs no JS branch: the CSS media query renders .reveal
  // fully visible with no transition regardless of the class toggle
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${shown ? "reveal-shown" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** Counts a stat up once when it scrolls into view; non-numeric values render as-is.
 * The resting display is ALWAYS the correct value — `n === null` renders `value`
 * verbatim. We only drop to a running count while actively animating, and only
 * when the stat scrolls in promptly after mount. So the number can never sit on
 * a wrong value: a silent/never-firing observer, a late fire, or reduced-motion
 * all leave the true value on screen (the "0%" stuck-at-mount bug is gone). */
export function CountUp({ value }: { value: string }) {
  const m = /^(\d+)(.*)$/.exec(value);
  const target = m ? parseInt(m[1], 10) : null;
  const suffix = m?.[2] ?? "";
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState<number | null>(null); // null = render the true value

  useEffect(() => {
    const el = ref.current;
    if (target === null || !el) return;
    // reduced motion: no JS animation — the true value already renders (n=null)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const mounted = performance.now();
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect(); // one-shot
        // only animate a fresh, in-view stat; a late fire just keeps the value
        if (performance.now() - mounted > 1500) return;
        const t0 = performance.now();
        const D = 700;
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / D);
          if (p >= 1) return setN(null); // land back on the exact value string
          setN(Math.round(target * (1 - Math.pow(1 - p, 3)))); // ease-out cubic
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  if (target === null) return <>{value}</>;
  return (
    <span ref={ref} suppressHydrationWarning>
      {n === null ? value : `${n}${suffix}`}
    </span>
  );
}
