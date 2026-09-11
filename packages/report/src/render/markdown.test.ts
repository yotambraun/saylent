// Golden test for renderMarkdown against fixtures/run.json ($0, no DB, no LLM).
// The snapshot is the contract: if a composer changes what the Brief says, this
// file changes with it in the same commit, and a reviewer sees exactly what moved.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureToReportData } from "./fixture";
import { fenceFor, renderMarkdown, titleOrHost } from "./markdown";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");
const fx = JSON.parse(readFileSync(path.join(repoRoot, "fixtures/run.json"), "utf8"));
const data = fixtureToReportData(fx);
const md = renderMarkdown(data);

describe("renderMarkdown", () => {
  it("matches the fixture golden", () => {
    expect(md).toMatchSnapshot();
  });

  it("puts the sample banner above everything, and omits it for a real run", () => {
    const notice = "Kestrel Uptime is a fictional company we audit; names of other companies are replaced";
    const banner = renderMarkdown(data, { sampleNotice: notice });
    expect(banner.split("\n")[0]).toBe(`> **${notice}**`);
    // the title still follows, unchanged
    expect(banner).toContain(`# ${data.brand.name} · Saylent report`);
    // a run with no notice is byte-identical to before the option existed
    expect(md).not.toContain(notice);
    expect(md.split("\n")[0]).toBe(`# ${data.brand.name} · Saylent report`);
  });

  it("leads with the brand and the run's own provenance", () => {
    expect(md.split("\n")[0]).toBe(`# ${data.brand.name} · Saylent report`);
    expect(md).toContain(data.brand.domain);
    expect(md).toContain("profile smoke");
  });

  it("carries every section a delivered report owes the reader", () => {
    for (const heading of ["## The summary", "## The answers", "## Cited pages", "## Site gates", "## Fixes"]) {
      expect(md).toContain(heading);
    }
  });

  it("attributes every answer row to an engine and a date", () => {
    // the evidence tables are the receipt: engine + date on every row
    const answerRows = md
      .split("\n")
      .filter((l) => /^\| (ChatGPT|Claude|Gemini|Perplexity) \| \d{2} /.test(l));
    expect(answerRows.length).toBe(data.answers.length);
  });

  it("never breaks a table row with a raw pipe or a newline", () => {
    for (const line of md.split("\n")) {
      if (!line.startsWith("|")) continue;
      // every cell separator is a real column boundary, so an unescaped pipe
      // inside engine text would silently shift a column
      expect(line.includes("|\n")).toBe(false);
    }
  });

  it("emits no markdown residue from the preview pipeline", () => {
    // teasers and quotes route through previewText; a literal ** or a [n] ref
    // in the Brief section is the bug class preview-invariants guards upstream
    const brief = md.slice(md.indexOf("## The summary"), md.indexOf("## The answers"));
    expect(brief).not.toMatch(/\[\d+\]/);
    expect(brief).not.toMatch(/\S\*\*\S/);
  });
});

// stage skips. `run.skip` rides along as an
// extra, cast-only field (same convention as run.health/run.brand_model —
// see markdown.ts's runRow cast), so this builds it directly rather than
// through the shared fixture (which predates the feature and carries none).
describe("renderMarkdown — stage skips", () => {
  const skippedData = {
    ...data,
    run: { ...data.run, skip: { drafts: true, corpus: true, gates: true } },
    corpus: [],
    checks: [],
  };
  const skippedMd = renderMarkdown(skippedData);

  it("names every skipped stage right under the header", () => {
    expect(skippedMd).toContain(
      "> Skipped by request: drafts, corpus, gates. Nothing skipped is reported as a pass or an absence",
    );
  });

  it("says corpus presence is unverified instead of silently omitting the section", () => {
    expect(skippedMd).toContain("## Cited pages");
    expect(skippedMd).toContain(
      "Presence unverified (skipped by request): cited-page fetches did not run this run.",
    );
  });

  it("says gate checks were skipped instead of silently omitting the section, never a pass", () => {
    expect(skippedMd).toContain("## Site gates");
    expect(skippedMd).toContain("Gate checks were skipped by request.");
    expect(skippedMd).not.toMatch(/\| pass \|/);
  });

  it("marks a fix that has no artifact as skipped, not silently blank", () => {
    expect(skippedMd).toContain(
      "Drafting was skipped by request: the fixes below are the deterministic diagnosis only",
    );
    // the fixture's OWN fixes still carry whatever artifact they were captured
    // with — this only proves the Draft column is honest about the ones that
    // don't have one, not that skip.drafts retroactively strips existing rows.
    const undrafted = data.fixes.find((f) => !f.artifact);
    expect(undrafted).toBeDefined();
    const fixLines = skippedMd
      .slice(skippedMd.indexOf("## Fixes"))
      .split("\n")
      .filter((l) => l.startsWith("|") && !l.startsWith("| Fix") && !l.startsWith("| ---"));
    const undraftedLine = fixLines.find((l) => l.includes(undrafted!.title));
    expect(undraftedLine).toContain("skipped by request");
  });

  it("nothing skipped (no run.skip) renders exactly as before — no notices, no header line", () => {
    expect(md).not.toContain("Skipped by request");
    expect(md).not.toContain("skipped by request");
  });
});

// A drafted artifact is markdown in its own right and routinely contains its
// own fenced code blocks. A plain ``` wrapper closes at the artifact's first
// inner fence and the rest of the report renders as one giant code block —
// which is exactly what examples/kestrel/report.md did on GitHub.
describe("renderMarkdown fences drafted artifacts per CommonMark", () => {
  const B = "`";
  const artifact = [
    "# Draft page",
    "",
    `${B.repeat(3)}txt`,
    "User-agent: *",
    B.repeat(3),
    "",
    "And a nested block that itself shows a fence:",
    "",
    `${B.repeat(4)}md`,
    `${B.repeat(3)}json`,
    '{ "a": 1 }',
    B.repeat(3),
    B.repeat(4),
  ].join("\n");

  it("fenceFor is one backtick longer than the longest run inside", () => {
    expect(fenceFor("no fences here")).toBe(B.repeat(3));
    expect(fenceFor(`a ${B.repeat(3)} b`)).toBe(B.repeat(4));
    expect(fenceFor(artifact)).toBe(B.repeat(5));
    // an inline double-backtick span must not push the wrapper past 3
    expect(fenceFor(`use ${B.repeat(2)}x${B.repeat(2)} inline`)).toBe(B.repeat(3));
  });

  it("renders a drafted artifact AS markdown: its code blocks survive, its headings are demoted", () => {
    const withArtifact = {
      ...data,
      fixes: data.fixes.map((f, i) => (i === 0 ? { ...f, artifact } : f)),
    };
    const out = renderMarkdown(withArtifact);
    // the file to paste stays a code block (not a line inside a wall of source)
    expect(out).toContain(`${B.repeat(3)}txt\nUser-agent: *\n${B.repeat(3)}`);
    // a block that itself shows a fence keeps its longer wrapper
    expect(out).toContain(`${B.repeat(4)}md\n${B.repeat(3)}json`);
    // the draft's own H1 cannot outrank the report's sections
    expect(out).toContain("#### Draft page");
    expect(out).not.toContain("\n# Draft page");
    // and nothing is left open for the rest of the document
    expect(fenceBalance(out).open).toBe(false);
  });

  it("leaves no unclosed fence anywhere in the fixture report", () => {
    expect(fenceBalance(md).open).toBe(false);
    expect(fenceBalance(renderMarkdown({ ...data, fixes: data.fixes.map((f, i) => (i === 0 ? { ...f, artifact } : f)) })).open).toBe(false);
  });
});

/** Walk the document the way a CommonMark reader does: a fence line opens a
 *  block, and only a fence line of at least the same length closes it. */
function fenceBalance(doc: string): { open: boolean; depth: number } {
  let openLen = 0;
  for (const line of doc.split("\n")) {
    const m = /^ {0,3}(`{3,})/.exec(line);
    if (!m) continue;
    const len = m[1].length;
    if (openLen === 0) openLen = len;
    else if (len >= openLen && line.trim() === "`".repeat(len)) openLen = 0;
  }
  return { open: openLen !== 0, depth: openLen };
}

// A cited page whose stored title is just the site's own name told the reader
// nothing and read as a broken row ("Medium" at https://medium.com/...).
describe("titleOrHost", () => {
  it("falls back to the host when the title IS the site name", () => {
    expect(titleOrHost("Medium", "https://medium.com/author-profile")).toBe("medium.com");
    expect(titleOrHost("medium.com", "https://medium.com/x")).toBe("medium.com");
  });
  it("keeps a real page title", () => {
    expect(titleOrHost("11 Best Uptime Tools", "https://medium.com/x")).toBe("11 Best Uptime Tools");
  });
  it("decodes entities on the way out", () => {
    expect(titleOrHost("Ranked &amp;amp; Compared", "https://x.example/a")).toBe("Ranked & Compared");
  });
  it("uses the host when there is no title at all", () => {
    expect(titleOrHost(null, "https://www.acme.example/a")).toBe("acme.example");
  });
});
