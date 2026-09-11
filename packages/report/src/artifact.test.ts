import { describe, expect, it } from "vitest";
import {
  artifactCodeBlocks,
  artifactPlainText,
  artifactToMarkdown,
  parseArtifact,
  stripOuterFence,
  applyAuditedDomain,
} from "./artifact";

const B = "`";

describe("stripOuterFence", () => {
  it("strips a wrapper fence around the whole artifact", () => {
    const text = [`${B.repeat(3)}markdown`, "# Title", "", "Body.", B.repeat(3)].join("\n");
    expect(stripOuterFence(text)).toBe("# Title\n\nBody.");
  });

  it("leaves a whole-artifact code fence that is a FILE, not a markdown wrapper", () => {
    const text = [`${B.repeat(3)}txt`, "# a robots.txt comment", B.repeat(3)].join("\n");
    expect(stripOuterFence(text)).toBe(text);
  });

  it("leaves an artifact whose first fence is its own content", () => {
    // the real shape: a robots.txt block, then prose OUTSIDE the fence
    const text = [`${B.repeat(3)}txt`, "User-agent: *", B.repeat(3), "", "Then verify it."].join("\n");
    expect(stripOuterFence(text)).toBe(text);
  });

  it("leaves a longer wrapper that contains same-length fences alone", () => {
    const text = [`${B.repeat(3)}md`, `${B.repeat(3)}json`, "{}", B.repeat(3), B.repeat(3)].join("\n");
    expect(stripOuterFence(text)).toBe(text);
  });

  it("is a no-op on plain markdown", () => {
    expect(stripOuterFence("# Hello\n\nWorld")).toBe("# Hello\n\nWorld");
  });
});

describe("applyAuditedDomain", () => {
  it("swaps the placeholder domain for the audited one", () => {
    expect(applyAuditedDomain("curl https://yourdomain.com/robots.txt", "acme.example")).toBe(
      "curl https://acme.example/robots.txt",
    );
  });
  it("accepts a domain written as a URL and leaves other hosts alone", () => {
    expect(applyAuditedDomain("see www.yourdomain.com and acme.com", "https://acme.example/")).toBe(
      "see acme.example and acme.com",
    );
  });
  it("does nothing without a domain", () => {
    expect(applyAuditedDomain("yourdomain.com", "")).toBe("yourdomain.com");
  });
});

describe("parseArtifact", () => {
  const artifact = [
    `${B.repeat(3)}txt`,
    "User-agent: PerplexityBot",
    "Allow: /",
    B.repeat(3),
    "",
    "## How to verify",
    "",
    "Run **this** and check `Allow: /` on https://yourdomain.com/robots.txt:",
    "",
    "| Step | What to look for |",
    "|---|---|",
    "| 1 | a 200 |",
    "",
    "> Why this matters: a CDN block returns 403 first.",
    "",
    "- first",
    "- second",
    "",
    "---",
  ].join("\n");

  it("splits the file to paste from the prose around it", () => {
    const blocks = parseArtifact(artifact, { domain: "acme.example" });
    expect(blocks.map((b) => b.kind)).toEqual([
      "code",
      "heading",
      "paragraph",
      "table",
      "quote",
      "bullets",
      "rule",
    ]);
    const code = artifactCodeBlocks(blocks);
    expect(code).toHaveLength(1);
    expect(code[0].text).toBe("User-agent: PerplexityBot\nAllow: /");
    expect(code[0].lang).toBe("txt");
  });

  it("uses the audited domain in the prose", () => {
    const blocks = parseArtifact(artifact, { domain: "acme.example" });
    const para = blocks.find((b) => b.kind === "paragraph");
    expect(para?.kind === "paragraph" && para.text).toContain("https://acme.example/robots.txt");
  });

  it("keeps table headers and rows", () => {
    const table = parseArtifact(artifact).find((b) => b.kind === "table");
    expect(table?.kind === "table" && table.headers).toEqual(["Step", "What to look for"]);
    expect(table?.kind === "table" && table.rows).toEqual([["1", "a 200"]]);
  });

  it("does not read a robots.txt comment inside a code block as a heading", () => {
    const blocks = parseArtifact([`${B.repeat(3)}txt`, "# a comment", B.repeat(3)].join("\n"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("code");
  });

  it("keeps ordered and unordered lists apart", () => {
    const blocks = parseArtifact("1. one\n2. two\n\n- a\n- b");
    expect(blocks.map((b) => (b.kind === "bullets" ? b.ordered : b.kind))).toEqual([true, false]);
  });
});

describe("artifactPlainText", () => {
  it("is the clipboard payload: no wrapper fence, real domain", () => {
    const text = [`${B.repeat(3)}markdown`, "Visit yourdomain.com", B.repeat(3)].join("\n");
    expect(artifactPlainText(text, "acme.example")).toBe("Visit acme.example");
  });
});

describe("artifactToMarkdown", () => {
  it("re-emits real markdown, demoting the draft's headings", () => {
    const md = artifactToMarkdown("# Draft page\n\nBody text.", { headingBase: 4 });
    expect(md).toBe("#### Draft page\n\nBody text.");
  });

  it("keeps a code block fenced and long enough to close", () => {
    // the ````md wrapper is stripped (it is a wrapper); the json file inside it
    // stays a code block that closes correctly
    const md = artifactToMarkdown([`${B.repeat(4)}md`, `${B.repeat(3)}json`, "{}", B.repeat(3), B.repeat(4)].join("\n"));
    expect(md).toBe([`${B.repeat(3)}json`, "{}", B.repeat(3)].join("\n"));
  });

  it("keeps a fence long enough for content that itself shows a fence", () => {
    const md = artifactToMarkdown(["Intro:", "", `${B.repeat(4)}md`, `${B.repeat(3)}json`, "{}", B.repeat(3), B.repeat(4)].join("\n"));
    expect(md).toContain(`${B.repeat(4)}md`);
    expect(md).toContain(`${B.repeat(3)}json`);
  });

  it("re-emits a table with its header row", () => {
    const md = artifactToMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(md).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
});
