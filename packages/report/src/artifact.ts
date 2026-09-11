// THE DRAFTED ARTIFACT, MADE COPY-READY.
//
// A fix's artifact is markdown the drafter wrote. It used to be dumped into one
// <pre> behind one Copy button, which meant the reader saw a literal ```markdown
// line, then `## headings`, `**bold**` and raw pipe tables, with a robots.txt
// snippet, a curl command and a prose checklist all inside the same blob. It is
// called "copy-ready"; copying that into robots.txt gives you a broken file.
//
// So the artifact is parsed here, once, into blocks: every fenced code block is
// a FILE TO PASTE (its own Copy button in the view), everything else is prose
// that renders as formatted text. Pure + unit-tested: no React, no HTML, no
// dangerouslySetInnerHTML anywhere downstream — the view maps these blocks to
// elements and React escapes every string.

export type ArtifactBlock =
  | { kind: "code"; lang: string; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "rule" };

const FENCE_RE = /^\s*(`{3,})\s*([A-Za-z0-9_+-]*)\s*$/;

/** Only a fence labelled as MARKDOWN is a wrapper. An artifact that is entirely
 *  one ```txt / ```json / ```html block is a FILE to paste, and unwrapping it
 *  would re-read its contents as prose (a robots.txt comment line becoming an
 *  H1). */
const WRAPPER_LANGS = new Set(["markdown", "md", "mdown"]);

/** The drafter is told to output markdown and routinely wraps the WHOLE artifact
 *  in one ```markdown fence. Stored that way, the first line a reader sees is a
 *  literal fence and the Markdown export ends up double-fenced. Strip that outer
 *  wrapper (and only that one: an artifact whose fences are its own content —
 *  a robots.txt snippet, a JSON-LD block — is left exactly as written). */
export function stripOuterFence(input: string): string {
  const text = (input ?? "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") first += 1;
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last -= 1;
  if (last <= first) return text;
  const open = FENCE_RE.exec(lines[first]);
  if (!open || !WRAPPER_LANGS.has((open[2] ?? "").toLowerCase())) return text;
  const close = FENCE_RE.exec(lines[last]);
  if (!close || close[2] !== "" || close[1].length < open[1].length) return text;
  // the closing fence must really close the OPENING one: no fence of the same
  // length may sit between them at an odd position, or we would be eating the
  // artifact's own first code block.
  const inner = lines.slice(first + 1, last);
  let depth = 0;
  for (const line of inner) {
    const f = FENCE_RE.exec(line);
    if (!f) continue;
    if (f[1].length >= open[1].length) return text; // a same-or-longer fence inside: not a wrapper
    depth += 1;
  }
  if (depth % 2 !== 0) return text; // unbalanced inner fences: leave it alone
  return inner.join("\n").trim();
}

/** The drafter sometimes writes a placeholder domain even though the audited
 *  domain is known. Swap it wherever it appears (the fix is the drafter prompt;
 *  this is the deterministic net under it, and it also repairs already-stored
 *  artifacts). */
export function applyAuditedDomain(text: string, domain: string | null | undefined): string {
  const d = (domain ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!d) return text;
  return text.replace(/\b(?:www\.)?yourdomain\.com\b/gi, d).replace(/\byourdomain\b(?!\.)/gi, d);
}

const isRule = (l: string) => /^\s*([-*_])\s*(?:\1\s*){2,}$/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l.trimEnd());
const isTableDivider = (l: string) => /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l.trimEnd());

const splitRow = (l: string): string[] =>
  l
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

/**
 * Parse a drafted artifact into display blocks. Handles exactly the markdown our
 * drafter emits: fenced code, ATX headings, hr, bullet + numbered lists, block
 * quotes, pipe tables and paragraphs. Inline emphasis and links are left in the
 * strings for the view's inline parser (parseInline).
 */
export function parseArtifact(
  input: string,
  opts: { domain?: string | null } = {},
): ArtifactBlock[] {
  const text = applyAuditedDomain(stripOuterFence(input ?? ""), opts.domain);
  const lines = text.split("\n");
  const out: ArtifactBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      out.push({ kind: "paragraph", text: para.join(" ").trim() });
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const lang = fence[2] ?? "";
      const body: string[] = [];
      i += 1;
      for (; i < lines.length; i++) {
        const close = FENCE_RE.exec(lines[i]);
        if (close && close[2] === "" && close[1].length >= marker.length) break;
        body.push(lines[i]);
      }
      out.push({ kind: "code", lang, text: body.join("\n").replace(/\s+$/, "") });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    if (isRule(line)) {
      flush();
      out.push({ kind: "rule" });
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flush();
      const headers = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      for (; i < lines.length && isTableRow(lines[i]); i++) rows.push(splitRow(lines[i]));
      i -= 1;
      out.push({ kind: "table", headers, rows });
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      const parts = [quote[1]];
      while (i + 1 < lines.length && /^\s*>\s?/.test(lines[i + 1])) {
        i += 1;
        parts.push(lines[i].replace(/^\s*>\s?/, ""));
      }
      out.push({ kind: "quote", text: parts.join(" ").trim() });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !!numbered && !bullet;
      const items: string[] = [(bullet ?? numbered)![1].trim()];
      while (i + 1 < lines.length) {
        const nb = /^\s*[-*+]\s+(.*)$/.exec(lines[i + 1]);
        const nn = /^\s*\d+[.)]\s+(.*)$/.exec(lines[i + 1]);
        const nextOrdered = !!nn && !nb;
        if ((!nb && !nn) || nextOrdered !== ordered) break;
        i += 1;
        items.push((nb ?? nn)![1].trim());
      }
      out.push({ kind: "bullets", ordered, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return out;
}

/** The artifact as plain text, ready for a clipboard: outer wrapper fence gone,
 *  placeholder domain swapped for the audited one. */
export function artifactPlainText(input: string, domain?: string | null): string {
  return applyAuditedDomain(stripOuterFence(input ?? ""), domain);
}

/** The code blocks, in order — "the file to paste". */
export function artifactCodeBlocks(blocks: ArtifactBlock[]): Extract<ArtifactBlock, { kind: "code" }>[] {
  return blocks.filter((b): b is Extract<ArtifactBlock, { kind: "code" }> => b.kind === "code");
}

/** A fence at least one backtick longer than the longest run inside the content
 *  (CommonMark), so a code block that itself contains backticks still closes. */
function fenceFor(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The same parsed blocks, re-emitted as Markdown for the .md export. The old
 * export wrapped the whole artifact in one fence, so GitHub showed the draft as
 * a wall of raw markdown source. Emitting it as REAL markdown means the file to
 * paste stays a code block and the prose around it reads as prose; headings are
 * demoted so a drafted `# H1` cannot outrank the report's own sections.
 */
export function artifactToMarkdown(
  input: string,
  opts: { domain?: string | null; headingBase?: number } = {},
): string {
  const blocks = parseArtifact(input, { domain: opts.domain });
  const base = opts.headingBase ?? 4;
  const top = blocks.reduce(
    (min, b) => (b.kind === "heading" ? Math.min(min, b.level) : min),
    7,
  );
  const shift = top <= 6 ? base - top : 0;
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "code": {
        const fence = fenceFor(b.text);
        out.push(`${fence}${b.lang}`, b.text, fence, "");
        break;
      }
      case "heading": {
        const level = Math.min(6, Math.max(1, b.level + shift));
        out.push(`${"#".repeat(level)} ${b.text}`, "");
        break;
      }
      case "paragraph":
        out.push(b.text, "");
        break;
      case "bullets":
        out.push(...b.items.map((t, i) => (b.ordered ? `${i + 1}. ${t}` : `- ${t}`)), "");
        break;
      case "quote":
        out.push(`> ${b.text}`, "");
        break;
      case "table": {
        const cell = (s: string) => s.replace(/\|/g, "\\|");
        out.push(
          `| ${b.headers.map(cell).join(" | ")} |`,
          `| ${b.headers.map(() => "---").join(" | ")} |`,
          ...b.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
          "",
        );
        break;
      }
      case "rule":
        out.push("---", "");
        break;
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
