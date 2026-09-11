// website/src/og/card.mjs — open-graph images: per docs page,
// title + one-line + mark, 1200x630; the wordmark is used on repo, npm
// and site. The site is a static export (`output: "export"`), so there is no
// image server and no request-time ImageResponse route; the cards are therefore
// built ahead of time as deterministic SVG and rasterized by `npm run media`
// (scripts/media/og.mjs). Nothing here needs a browser or a network font: the
// serif/sans stacks fall back on every OS and every text run is width-pinned
// with textLength, so the card is byte-identical wherever it is generated.
//
// Palette is copied from the app's tokens (src/app/globals.css, dark values):
// ink #ece6da on paper #16130f, signal #e5703a.

export const OG = {
  width: 1200,
  height: 630,
  bg: "#14212b",
  fg: "#f7f5f0",
  muted: "#9aa8b2",
  signal: "#e5703a",
  serif: "Georgia,'Times New Roman',Times,serif",
  sans: "'Helvetica Neue',Helvetica,Arial,sans-serif",
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Greedy wrap using an average glyph width, so no font metrics are needed. */
export function wrap(text, { fontSize, maxWidth, ratio = 0.52, maxLines = 3 }) {
  const perChar = fontSize * ratio;
  const limit = Math.max(1, Math.floor(maxWidth / perChar));
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > limit && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[.,;:]$/, "")}...`;
    return kept;
  }
  return lines;
}

/**
 * The card. `title` is the page title, `line` the one-liner under it.
 * `size` picks the aspect: "og" = 1200x630, "share" = 1200x675 (X/LinkedIn).
 */
export function ogCardSvg({
  title = "What do AI assistants say about your brand?",
  line = "The open-source audit, with the receipts: every verdict traced to the answer, the cited page, and the fix.",
  footer = "github.com/yotambraun/saylent",
  size = "og",
} = {}) {
  const w = OG.width;
  const h = size === "share" ? 675 : OG.height;
  const pad = 72;
  const titleSize = title.length > 34 ? 60 : 72;
  const titleLines = wrap(title, { fontSize: titleSize, maxWidth: w - pad * 2, ratio: 0.58, maxLines: 2 });
  const lineLines = wrap(line, { fontSize: 30, maxWidth: w - pad * 2, ratio: 0.5, maxLines: 3 });

  // Anchor the text block to the baseline of the card, not the top, so a
  // one-line title and a three-line title both sit on the same optical floor.
  const titleStep = titleSize + 14;
  const lineStep = 42;
  const blockBottom = h - 118;
  const lineTop = blockBottom - (lineLines.length - 1) * lineStep;
  const titleBottom = lineTop - 66;
  const titleY = titleLines.map((_, i) => titleBottom - (titleLines.length - 1 - i) * titleStep);

  const titleTspans = titleLines
    .map((t, i) => `<text x="${pad}" y="${titleY[i]}" font-family="${OG.serif}" font-size="${titleSize}" font-weight="600" fill="${OG.fg}">${esc(t)}</text>`)
    .join("\n  ");
  const lineTspans = lineLines
    .map((t, i) => `<text x="${pad}" y="${lineTop + i * lineStep}" font-family="${OG.sans}" font-size="30" fill="${OG.muted}">${esc(t)}</text>`)
    .join("\n  ");

  // The mark, inlined at 0.75 scale from website/public/brand/icon.svg so the
  // card is a single self-contained file (no external image reference).
  const mark = `<g transform="translate(${pad},${pad})">
    <rect width="60" height="60" rx="12.2" fill="${OG.fg}"/>
    <text x="26.25" y="41.25" font-family="${OG.serif}" font-size="33.75" font-weight="600" fill="${OG.bg}" text-anchor="middle" textLength="20.16" lengthAdjust="spacingAndGlyphs">S</text>
    <circle cx="43.6" cy="16.4" r="4.9" fill="${OG.signal}"/>
    <text x="78" y="43" font-family="${OG.serif}" font-size="38" font-weight="600" fill="${OG.fg}" textLength="150" lengthAdjust="spacingAndGlyphs">Saylent</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${OG.bg}"/>
  <rect x="0" y="${h - 8}" width="${w}" height="8" fill="${OG.signal}"/>
  ${mark}
  ${titleTspans}
  ${lineTspans}
  <text x="${pad}" y="${h - 56}" font-family="${OG.sans}" font-size="24" fill="${OG.muted}">${esc(footer)}</text>
</svg>
`;
}
