// THE LAUNCH BUG, PINNED DOWN.
//
// report.html embeds an ~800 KB minified React/Tailwind hydration bundle. The
// CLI used to redact the FINISHED document on its way to disk, so the shape
// regexes ran over that bundle as if it were prose and rewrote code:
// `this.key=t` -> `key=[redacted]`, Tailwind's `mask-linear-from-…` ->
// `ma[redacted]`. The committed sample carried 54 such corruptions, threw
// `SyntaxError: Invalid left-hand side in assignment`, never hydrated, and left
// all 11 `.reveal` sections at opacity 0 — three quarters of a blank page with
// every button dead. typecheck, lint and the whole suite were green throughout.
//
// The fix redacts the INPUTS (redactDeep over ReportData/meta/title/notice), so
// these tests plant a fake key in the fixture bundle and then assert BOTH
// halves of the contract: the key is gone from every delivered surface, AND
// nothing outside the data was touched — proved by compiling every embedded
// script with node:vm.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterAll, describe, expect, it } from "vitest";
import * as engineMod from "@saylent/engine";
import * as reportRenderMod from "@saylent/report/render";
// relative, not the package alias — see run.test.ts's note on the TypeScript
// Debug Failure that "@saylent/report/render/from-bundle" triggers.
import { reportDataFromBundle } from "../../report/src/render/from-bundle";
import { redactDeep, redactKnownSecrets } from "./redact";
import { renderReportFilesWith, type ReportModules } from "./run";

const reportMod: ReportModules = {
  reportDataFromBundle,
  renderReportHtml: reportRenderMod.renderReportHtml,
  renderMarkdown: reportRenderMod.renderMarkdown,
  renderMovementHtml: reportRenderMod.renderMovementHtml,
};

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/kestrel/run.json");

// Not a real key: shaped like one so SECRET_SHAPES has to catch it, and built
// by concatenation so a secret scanner never sees a literal `sk-` + 30 chars.
const PLANTED_KEY = "sk-" + "planted" + "0".repeat(30);
// A legitimate string that the OLD `sk-` shape mangled (it is a real Tailwind
// utility name, and the reason the bundle broke). It must survive verbatim.
const TAILWIND_CLASS = "mask-linear-from-position";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), "saylent-report-redaction-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const DATA_OPEN = '<script type="application/json" id="saylent-report-data">';

/** The JSON payload the browser hydrates from. */
function dataIsland(html: string): string {
  const start = html.indexOf(DATA_OPEN);
  expect(start, "report.html has no data island").toBeGreaterThan(-1);
  const from = start + DATA_OPEN.length;
  return html.slice(from, html.indexOf("</script>", from));
}

/** The server-rendered markup — everything inside #saylent-report-root. */
function rootMarkup(html: string): string {
  const open = '<div id="saylent-report-root">';
  const start = html.indexOf(open);
  expect(start, "report.html has no report root").toBeGreaterThan(-1);
  return html.slice(start + open.length, html.indexOf(DATA_OPEN));
}

/** Every <script> body that is NOT the JSON data island — i.e. real code. */
function codeScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (/type\s*=\s*"application\/json"/.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

/** The fixture bundle with a fake key and a Tailwind class planted in the first
 *  answer's raw_text — the exact route a leaked key would take into a report. */
function plantedBundle(): engineMod.RunBundleV1 {
  const bundle = engineMod.readBundle(JSON.parse(readFileSync(FIXTURE, "utf8")));
  const first = bundle.answers[0];
  expect(first, "fixture has no answers").toBeTruthy();
  first.raw_text =
    `A provider echoed its credential back: key=${PLANTED_KEY} ${PLANTED_KEY}\n` +
    `The report also quotes a CSS utility called ${TAILWIND_CLASS} verbatim.\n\n` +
    first.raw_text;
  return bundle;
}

describe("redactDeep", () => {
  it("redacts every string leaf and leaves the structure and non-strings alone", () => {
    const input = {
      key: `Authorization: bearer ${PLANTED_KEY}`,
      nested: { list: ["clean", `?key=${PLANTED_KEY}`, 42, null, true] },
      n: 7,
      nul: null,
      undef: undefined,
      empty: [],
    };
    const out = redactDeep(input);

    expect(out.key).toBe("Authorization: bearer [redacted]");
    expect(out.nested.list[0]).toBe("clean");
    expect(out.nested.list[1]).toBe("?key=[redacted]");
    expect(out.nested.list[2]).toBe(42);
    expect(out.nested.list[3]).toBeNull();
    expect(out.nested.list[4]).toBe(true);
    expect(out.n).toBe(7);
    expect(out.nul).toBeNull();
    expect(out.undef).toBeUndefined();
    expect(out.empty).toEqual([]);
    expect(Array.isArray(out.nested.list)).toBe(true);
    // a pure function: the caller's object is never mutated
    expect(input.key).toContain(PLANTED_KEY);
  });

  it("passes primitives and non-plain objects straight through", () => {
    const d = new Date(0);
    expect(redactDeep(d)).toBe(d);
    expect(redactDeep(5)).toBe(5);
    expect(redactDeep(null)).toBeNull();
    expect(redactDeep(undefined)).toBeUndefined();
  });
});

describe("the sk- shape has a left boundary (it used to eat ordinary words)", () => {
  it("leaves a Tailwind class alone but still redacts a real key shape", () => {
    // JSON data — the run.json path, which still redacts the finished text.
    const json = JSON.stringify({ note: `use ${TAILWIND_CLASS} here`, leak: PLANTED_KEY });
    const out = redactKnownSecrets(json);
    expect(out).toContain(TAILWIND_CLASS);
    expect(out).not.toContain(PLANTED_KEY);
    expect(out).toContain("[redacted]");
  });

  it("does not match sk- in the middle of a word", () => {
    for (const word of ["mask-linear-from-position", "task-scheduler-identifier", "risk-assessment-summary"]) {
      expect(redactKnownSecrets(word)).toBe(word);
    }
  });
});

describe("renderReportFilesWith — a planted key is redacted without corrupting the bundle", () => {
  it("removes the key everywhere and leaves every embedded script compilable", async () => {
    const outDir = tempDir();
    const { reportHtmlPath, reportMdPath } = await renderReportFilesWith(reportMod, plantedBundle(), outDir);

    const html = readFileSync(reportHtmlPath!, "utf8");
    const md = readFileSync(reportMdPath!, "utf8");
    const island = dataIsland(html);

    // 1. the key is gone from every delivered surface
    expect(html).not.toContain(PLANTED_KEY);
    expect(md).not.toContain(PLANTED_KEY);
    expect(island).not.toContain(PLANTED_KEY);
    expect(island).not.toContain("planted000");

    // 2. it was actually redacted, not merely dropped by the renderer
    expect(island).toContain("[redacted]");

    // 3. THE REGRESSION: every embedded script must still be valid JavaScript.
    //    `new vm.Script` compiles without executing — exactly the parse that
    //    threw "Invalid left-hand side in assignment" in the browser.
    const scripts = codeScripts(html);
    expect(scripts.length).toBeGreaterThanOrEqual(2); // boot script(s) + the hydration bundle
    expect(scripts.some((s) => s.length > 100_000), "no hydration bundle embedded").toBe(true);
    for (const [i, src] of scripts.entries()) {
      expect(() => new vm.Script(src), `embedded script #${i} does not parse`).not.toThrow();
    }
  }, 120_000);

  it("puts [redacted] only in the data and the markup — never in the code", async () => {
    const outDir = tempDir();
    const { reportHtmlPath } = await renderReportFilesWith(reportMod, plantedBundle(), outDir);
    const html = readFileSync(reportHtmlPath!, "utf8");

    const inIsland = count(dataIsland(html), "[redacted]");
    const inMarkup = count(rootMarkup(html), "[redacted]");
    const total = count(html, "[redacted]");

    expect(inIsland).toBeGreaterThan(0);
    // Every occurrence in the file is accounted for by data + server-rendered
    // markup. Anything left over is a corruption inside the bundle or the CSS.
    expect(total).toBe(inIsland + inMarkup);
    for (const src of codeScripts(html)) expect(count(src, "[redacted]")).toBe(0);

    // and the legitimate Tailwind utility name survived the trip intact
    expect(html).toContain(TAILWIND_CLASS);
  }, 120_000);
});
