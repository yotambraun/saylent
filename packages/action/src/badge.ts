// A shields.io-look-alike badge, hand-rolled so the Action never makes an external
// request (no img.shields.io round trip) - written straight into the repo at
// `badge_path` — a badge SVG written into the repo, not a hosted
// service. No fonts, no <image>, no external stylesheet - self-contained XML only.
import type { ClassStatus } from "./types";

const LABEL = "AI access";

const COLOR: Record<ClassStatus, string> = {
  pass: "#2ea44f", // green
  warn: "#dbab09", // amber
  fail: "#cf222e", // red
};

// Rough per-glyph advance widths for an 11px Verdana-ish sans, good enough for a
// self-drawn badge (not pixel-identical to shields.io, which is not a goal here).
const NARROW = new Set(["i", "l", "I", ".", ":", "'"]);
const WIDE = new Set(["m", "w", "M", "W"]);

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += 4;
    else if (NARROW.has(ch)) w += 4;
    else if (WIDE.has(ch)) w += 10;
    else if (ch >= "A" && ch <= "Z") w += 8;
    else w += 7;
  }
  return w;
}

/** Renders the "AI access: pass|warn|fail" status badge for the given overall
 *  GateResult status. Pure - no filesystem, no network. */
export function renderBadgeSvg(status: ClassStatus): string {
  const message = status;
  const color = COLOR[status];
  const pad = 10;
  const labelW = textWidth(LABEL) + pad * 2;
  const msgW = textWidth(message) + pad * 2;
  const totalW = labelW + msgW;
  const h = 20;
  const labelX = labelW / 2;
  const msgX = labelW + msgW / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" role="img" aria-label="${LABEL}: ${message}">
  <title>${LABEL}: ${message}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="${h}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${h}" fill="#555"/>
    <rect x="${labelW}" width="${msgW}" height="${h}" fill="${color}"/>
    <rect width="${totalW}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelX}" y="14">${LABEL}</text>
    <text x="${msgX}" y="14">${message}</text>
  </g>
</svg>
`;
}
