// The engines' raw answers are Markdown. We show their verbatim sentences in the
// Pulse (and elsewhere), so `**bold**` and `[label](url)` would render as literal
// noise. This parses the light inline markdown the engines actually emit into
// display segments: **bold** → bold, and markdown links → just their label (the
// full source is one click away via the receipt). Pure + unit-tested; the caller
// maps segments to <strong>/text. Not a full markdown parser — only what shows up.

export interface InlineSeg {
  text: string;
  bold: boolean;
}

export function parseInline(input: string): InlineSeg[] {
  // [label](url) → label (drop the raw URL noise; the receipt carries the source)
  const text = input.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  const segs: InlineSeg[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), bold: false });
    segs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ text: text.slice(last), bold: false });
  return segs.length > 0 ? segs : [{ text, bold: false }];
}
