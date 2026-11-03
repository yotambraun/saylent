// `saylent demo` renders the bundled sample run offline: no key read, no network,
// the same three files a real audit writes, and a next step that prices a real run.
// Rendering the full report is the slow part (seconds on a cold checkout), hence
// the longer timeouts on the two tests that render.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSampleBundle } from "../repo-root";
import { openCommand, run } from "./demo";

const KEY_VARS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY"] as const;

function captureStdout() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: string | Uint8Array) => {
    chunks.push(String(c));
    return true;
  });
  return { text: () => chunks.join(""), restore: () => spy.mockRestore() };
}

describe("saylent demo", () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "saylent-demo-"));
    for (const k of KEY_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const k of KEY_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  it("finds the sample bundle in a checkout", () => {
    const sample = findSampleBundle();
    expect(sample).not.toBeNull();
    expect(JSON.parse(readFileSync(sample!, "utf8")).run.brand.name).toBe("Kestrel Uptime");
  });

  it("writes report.html, report.md and run.json with no key and no network", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network used")));
    vi.stubGlobal("fetch", fetchSpy);
    const out = path.join(dir, "demo");
    const cap = captureStdout();
    const code = await run(["--out", out]);
    cap.restore();

    expect(code).toBe(0);
    for (const f of ["report.html", "report.md", "run.json"]) expect(existsSync(path.join(out, f))).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    const text = cap.text();
    expect(text).toContain("Saylent · demo · Kestrel Uptime");
    expect(text).toContain("no key, no network, $0");
    expect(text).toContain("saylent audit <your-domain> --dry-run");
    expect(readFileSync(path.join(out, "report.md"), "utf8")).toContain("Kestrel Uptime");
  }, 60_000);

  it("opens the report only when asked", async () => {
    const open = vi.fn();
    const cap = captureStdout();
    await run(["--out", path.join(dir, "a")], { open });
    expect(open).not.toHaveBeenCalled();
    await run(["--out", path.join(dir, "b"), "--open"], { open });
    cap.restore();
    expect(open).toHaveBeenCalledWith(path.join(dir, "b", "report.html"));
  }, 60_000);

  it("says what to do when the sample is missing from the install", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await run([], { sample: null });
    const said = err.mock.calls.map((c) => String(c[0])).join("");
    err.mockRestore();
    expect(code).toBe(1);
    expect(said).toContain("saylent report <run.json>");
  });

  it("picks the platform's open command", () => {
    expect(openCommand("darwin").cmd).toBe("open");
    expect(openCommand("linux").cmd).toBe("xdg-open");
    expect(openCommand("win32")).toEqual({ cmd: "cmd", args: ["/c", "start", '""'] });
  });
});
