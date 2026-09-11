// Three-state run-over-run delta. "~ within noise" is the
// honest default (|Δ| ≤ 1 answer, METHODOLOGY.md verify rule); arrows only when the
// movement clears the band. Never color-alone: glyph + text always present.
import { deltaState } from "@saylent/report/trend";

export function DeltaBadge({ series }: { series: { rec: number }[] }) {
  const { state, d } = deltaState(series);
  if (state === "none") return null;
  if (state === "noise") {
    return (
      <span className="self-start whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-wire">
        ~ within noise
      </span>
    );
  }
  const up = state === "up";
  return (
    <span
      className={`self-start whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] ${
        up ? "bg-success/15 text-success" : "bg-pill-dismissed/15 text-pill-dismissed"
      }`}
    >
      {up ? "▲" : "▼"} {d > 0 ? `+${d}` : d} answers vs last run
    </span>
  );
}
