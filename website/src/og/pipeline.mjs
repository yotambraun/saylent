// website/src/og/pipeline.mjs — the nine-stage pipeline diagram required by the
// README spec: how it works in one diagram (nine stages).
// GitHub renders the Mermaid version in README.md; npm renders neither Mermaid
// nor CSS, so this deterministic SVG is the version that shows up everywhere.
// Stage names and order are exactly packages/cli/src/progress.ts STAGE_NUMBER /
// STAGE_LABEL, so the diagram cannot drift from what the CLI prints.

export const STAGES = [
  { n: 1, label: "crawl", note: "your pages" },
  { n: 2, label: "brand model", note: "category, buyers, rivals" },
  { n: 3, label: "questions", note: "the buyer question set" },
  { n: 4, label: "engines", note: "official APIs, verbatim" },
  { n: 5, label: "judge", note: "the other provider family" },
  { n: 6, label: "cited pages", note: "fetched and checked" },
  { n: 7, label: "site gates", note: "AI bots, tested live" },
  { n: 8, label: "fix plan", note: "drafted from evidence" },
  { n: 9, label: "score", note: "share of voice, band" },
];

const THEMES = {
  light: { bg: "#f7f5f0", card: "#ffffff", ink: "#14212b", wire: "#5b6b76", line: "#ded7c9", signal: "#c8551b" },
  dark: { bg: "#16130f", card: "#1d1a15", ink: "#ece6da", wire: "#9c9184", line: "#332c24", signal: "#e5703a" },
};

const SERIF = "Georgia,'Times New Roman',Times,serif";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const MONO = "'DejaVu Sans Mono','Liberation Mono',Menlo,Consolas,monospace";

export function pipelineSvg(themeName = "light") {
  const t = THEMES[themeName] ?? THEMES.light;
  const cols = 3;
  const cw = 300;
  const ch = 96;
  const gapX = 40;
  const gapY = 34;
  const padX = 28;
  const padY = 28;
  const width = padX * 2 + cols * cw + (cols - 1) * gapX;
  const rows = Math.ceil(STAGES.length / cols);
  const height = padY * 2 + rows * ch + (rows - 1) * gapY;

  const parts = [];
  STAGES.forEach((stage, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cw + gapX);
    const y = padY + row * (ch + gapY);
    parts.push(`<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="10" fill="${t.card}" stroke="${t.line}"/>`);
    parts.push(`<text x="${x + 20}" y="${y + 32}" font-family="${MONO}" font-size="13" fill="${t.signal}">${String(stage.n).padStart(2, "0")}</text>`);
    parts.push(`<text x="${x + 50}" y="${y + 34}" font-family="${SERIF}" font-size="21" fill="${t.ink}">${stage.label}</text>`);
    parts.push(`<text x="${x + 20}" y="${y + 66}" font-family="${SANS}" font-size="15" fill="${t.wire}">${stage.note}</text>`);
    // The connector: a short arrow to the next stage, wrapping at the row end.
    if (i === STAGES.length - 1) return;
    if (col < cols - 1) {
      const ax = x + cw;
      const ay = y + ch / 2;
      parts.push(`<path d="M${ax + 8} ${ay} H${ax + gapX - 12}" stroke="${t.line}" stroke-width="2"/>`);
      parts.push(`<path d="M${ax + gapX - 16} ${ay - 4} l5 4 -5 4" fill="none" stroke="${t.line}" stroke-width="2"/>`);
    } else {
      // Row wrap: an elbow from the end of this row back to the start of the
      // next one, so the reading order of the flow is never ambiguous.
      const startX = padX + cw / 2;
      const endX = x + cw / 2;
      const midY = y + ch + gapY / 2;
      parts.push(
        `<path d="M${endX} ${y + ch + 6} V${midY} H${startX} V${y + ch + gapY - 10}" fill="none" stroke="${t.line}" stroke-width="2"/>`,
      );
      parts.push(`<path d="M${startX - 4} ${y + ch + gapY - 14} l4 5 4 -5" fill="none" stroke="${t.line}" stroke-width="2"/>`);
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="The nine stages of a Saylent run: ${STAGES.map((s) => s.label).join(", ")}">
  <rect width="${width}" height="${height}" fill="${t.bg}"/>
  ${parts.join("\n  ")}
</svg>
`;
}

/** The same nine stages as a Mermaid graph, for the GitHub README. */
export function pipelineMermaid() {
  const nodes = STAGES.map((s) => `  S${s.n}["${String(s.n).padStart(2, "0")} ${s.label}<br/><small>${s.note}</small>"]`);
  const edges = STAGES.slice(0, -1).map((s) => `  S${s.n} --> S${s.n + 1}`);
  return ["flowchart LR", ...nodes, ...edges].join("\n");
}
