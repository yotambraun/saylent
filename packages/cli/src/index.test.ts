// The CLI door: help and --version. These are the two surfaces a user hits
// before anything else, so they are pinned — including the promise that
// `--version` prints a version and nothing a script has to filter out.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editDistance, main, suggestCommand, unknownCommandMessage } from "./index";
import { cliDescription, cliVersion } from "./version";

// The star ask writes a marker under $HOME/.saylent — redirect HOME.
let home: string;
let prevHome: string | undefined;
beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-cli-home-"));
  process.env.HOME = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.HOME = prevHome;
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    out.push(String(c));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
    err.push(String(c));
    return true;
  });
  return {
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

const COMMANDS = [
  "audit",
  "verify",
  "gate-check",
  "report",
  "history",
  "keys",
  "questions",
  "models",
  "mcp",
];

describe("saylent --help", () => {
  it("lists all nine commands", async () => {
    const cap = capture();
    const code = await main(["--help"]);
    cap.restore();
    expect(code).toBe(0);
    const body = cap.stdout();
    for (const c of COMMANDS) expect(body).toMatch(new RegExp(`^  ${c}\\b`, "m"));
  });

  it("aligns the description column — every command's description starts at the same offset", async () => {
    const cap = capture();
    await main(["--help"]);
    cap.restore();
    const offsets = cap
      .stdout()
      .split("\n")
      .filter((l) => COMMANDS.some((c) => l.startsWith(`  ${c} `) || l.startsWith(`  ${c}  `)))
      .map((l) => l.length - l.replace(/^\s+\S+(\s+<\S+>)?\s+/, "").length);
    expect(new Set(offsets).size).toBe(1);
  });
});

describe("saylent --help content", () => {
  it("opens with package.json's own one-line description, then one example", async () => {
    const cap = capture();
    await main(["--help"]);
    cap.restore();
    const body = cap.stdout();
    expect(body.startsWith(cliDescription())).toBe(true);
    expect(body).toContain("  npx saylent audit example.com");
    // the example comes BEFORE the command list
    expect(body.indexOf("npx saylent audit")).toBeLessThan(body.indexOf("Commands:"));
  });

  it("points Docs at the docs site, not the repo", async () => {
    const cap = capture();
    await main(["--help"]);
    cap.restore();
    expect(cap.stdout()).toContain("Docs  https://yotambraun.github.io/saylent/");
  });
});

describe("an unknown command", () => {
  it("suggests the nearest command within two edits", () => {
    expect(suggestCommand("chek")).toBe("check");
    expect(suggestCommand("audits")).toBe("audit");
    expect(suggestCommand("kesy")).toBe("keys");
    expect(suggestCommand("gate-chek")).toBe("gate-check");
  });

  it("does NOT guess when nothing is close", () => {
    expect(suggestCommand("frobnicate")).toBeNull();
  });

  it("edit distance is plain Levenshtein", () => {
    expect(editDistance("chek", "check")).toBe(1);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("prints the typo, the suggestion and a SHORT usage — not the whole help", async () => {
    const cap = capture();
    const code = await main(["chek"]);
    cap.restore();
    expect(code).toBe(1);
    const err = cap.stderr();
    expect(err).toContain('Unknown command "chek". Did you mean "check"?');
    expect(err).toContain("saylent <command> [options]");
    // the short usage, not the nine-line command block
    expect(err.split("\n").length).toBeLessThan(8);
  });

  it("says nothing it cannot back up when there is no near match", async () => {
    const cap = capture();
    expect(await main(["frobnicate"])).toBe(1);
    cap.restore();
    expect(cap.stderr()).toContain('Unknown command "frobnicate".');
    expect(cap.stderr()).not.toContain("Did you mean");
  });

  it("unknownCommandMessage is pure and names every command", () => {
    const msg = unknownCommandMessage("zzz");
    for (const c of COMMANDS) expect(msg).toContain(c);
  });
});

describe("saylent --version", () => {
  it("prints the version and NOTHING else on stdout, so a script can capture it", async () => {
    const cap = capture();
    const code = await main(["--version"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout()).toBe(`${cliVersion()}\n`);
  });

  it("accepts -V, the conventional capital-V version flag", async () => {
    const cap = capture();
    const code = await main(["-V"]);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.stdout()).toBe(`${cliVersion()}\n`);
  });

  it("puts the one-time star ask on stderr, once", async () => {
    const first = capture();
    await main(["--version"]);
    first.restore();
    expect(first.stderr()).toContain("Star the repo");

    const second = capture();
    await main(["--version"]);
    second.restore();
    expect(second.stderr()).toBe("");
  });
});
