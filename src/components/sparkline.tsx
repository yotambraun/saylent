// Word-sized run-history sparkline (Tufte spec: no axes, no
// frame, shape-only scale; single accent dot on the latest run, color-linked
// to the number beside it). Pure SVG — safe in server components. Renders
// nothing under 3 points: two dots aren't a trend.
import { sparklinePath } from "@saylent/report/trend";

export function Sparkline({
  values,
  width = 72,
  height = 20,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** accessible one-liner, e.g. "recommended answers across 4 runs" */
  label: string;
}) {
  const path = sparklinePath(values, width - 6, height - 6);
  if (!path) return null;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className="shrink-0 self-center overflow-visible"
    >
      <g transform="translate(3,3)">
        <polyline
          points={path.points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-wire"
        />
        <circle cx={path.last.x} cy={path.last.y} r="2.5" className="fill-signal" />
      </g>
    </svg>
  );
}
