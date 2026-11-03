import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readBundle, type RunBundleV1 } from "@saylent/engine/bundle";
import {
  applyPlan,
  checkRepo,
  fencesOf,
  fixesPayload,
  freeBranchName,
  jsonLdBlocksFrom,
  lineDiff,
  parseRobots,
  planDiff,
  planFixApply,
  repoView,
  robotsGroupsFrom,
  safeTarget,
  type RepoView,
} from "./fixes-apply";

const kestrel = (): RunBundleV1 =>
  readBundle(JSON.parse(readFileSync(path.resolve(__dirname, "../../../examples/kestrel/run.json"), "utf8")));

const view = (files: Record<string, string>, dirs: string[] = []): RepoView => ({
  exists: (rel) => rel in files || dirs.includes(rel),
  read: (rel) => {
    if (!(rel in files)) throw new Error(`no ${rel}`);
    return files[rel];
  },
});

const gitRepo = (files: Record<string, string>): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "saylent-fixes-"));
  const g = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  g("init", "-q");
  g("config", "user.name", "Test");
  g("config", "user.email", "test@example.com");
  g("config", "commit.gpgsign", "false");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  g("add", ".");
  g("commit", "-q", "-m", "init");
  return dir;
};

describe("artifact parsing", () => {
  it("reads top-level fences and stops at the first bare closing fence", () => {
    const f = fencesOf("intro\n```markdown\nUser-agent: A\nAllow: /\n```\nmid\n```html\n<x>\n```\n");
    expect(f.map((x) => x.info)).toEqual(["markdown", "html"]);
    expect(f[1].before).toBe("mid");
  });

  it("takes only uncommented robots directives from the access fix", () => {
    const access = kestrel().fixes.find((f) => f.fixKey === "access")!;
    const groups = robotsGroupsFrom(access.artifact ?? "");
    expect(groups.map((g) => g.agents[0])).toEqual(["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"]);
    // the commented-out training bots are not drafted rules
    expect(groups.some((g) => g.agents.includes("GPTBot"))).toBe(false);
    expect(groups.every((g) => g.rules.join() === "Allow: /")).toBe(true);
  });

  it("validates JSON-LD blocks and keeps the artifact's placement note", () => {
    const schema = kestrel().fixes.find((f) => f.fixKey === "schema_missing")!;
    const blocks = jsonLdBlocksFrom(schema.artifact ?? "");
    expect(blocks.map((b) => b.type)).toEqual(["Organization", "Product", "FAQPage"]);
    expect(blocks[0].where).toContain("homepage");
    expect(blocks[2].todoVerify).toBe(1);
    expect(jsonLdBlocksFrom('```html\n<script type="application/ld+json">{not json</script>\n```')).toEqual([]);
  });

  it("parses robots groups with their line span", () => {
    const { groups } = parseRobots("User-agent: *\nDisallow: /tmp\n\nUser-agent: A\nUser-agent: B\nDisallow: /\nSitemap: x");
    expect(groups.map((g) => g.agents)).toEqual([["*"], ["A", "B"]]);
    expect(groups[1].start).toBe(3);
  });
});

describe("planFixApply", () => {
  it("replaces a single-bot group, appends missing bots, writes JSON-LD snippets and a PR description", () => {
    const plan = planFixApply(kestrel(), view({ "public/robots.txt": "User-agent: *\nAllow: /\n\nUser-agent: PerplexityBot\nDisallow: /\n" }, ["public"]), { now: new Date("2026-11-02T00:00:00Z") });
    const robots = plan.files.find((f) => f.path === "public/robots.txt")!;
    expect(robots.kind).toBe("update");
    expect(robots.after).toContain("User-agent: PerplexityBot\nAllow: /");
    expect(robots.after).not.toContain("Disallow: /\n");
    expect(robots.after).toContain("User-agent: OAI-SearchBot");
    expect(plan.files.map((f) => f.path)).toEqual(
      expect.arrayContaining(["saylent-fixes/jsonld/organization.html", "saylent-fixes/jsonld/faqpage.html", "saylent-fixes/PULL_REQUEST.md"]),
    );
    expect(plan.applied.map((a) => a.fix_key)).toEqual(["access", "schema_missing"]);
    expect(plan.notApplied.length).toBe(kestrel().fixes.length - 2);
    expect(plan.prBody).toContain("robots: PerplexityBot: blocked");
    expect(plan.prBody).toContain("TODO-VERIFY");
    expect(plan.prBody).toContain("npx saylent gate-check saylent-kestrel.vercel.app");
    expect(plan.prBody).not.toMatch(/\/(home|mnt|Users)\//);
  });

  it("leaves a group shared with other bots alone and lists it for review", () => {
    const plan = planFixApply(kestrel(), view({ "robots.txt": "User-agent: PerplexityBot\nUser-agent: Bytespider\nDisallow: /\n" }), { only: ["access"] });
    const robots = plan.files.find((f) => f.path === "robots.txt")!;
    expect(robots.after).toContain("User-agent: PerplexityBot\nUser-agent: Bytespider\nDisallow: /");
    expect(plan.review.join(" ")).toContain("shared with other bots");
  });

  it("does not create a static robots.txt beside a generator", () => {
    const plan = planFixApply(kestrel(), view({ "app/robots.ts": "export default {}" }), { only: ["access"] });
    expect(plan.files.map((f) => f.path)).toContain("saylent-fixes/robots.txt");
    expect(plan.files.map((f) => f.path)).not.toContain("robots.txt");
    expect(plan.review.join(" ")).toContain("generated by app/robots.ts");
  });

  it("refuses an unknown fix key", () => {
    expect(() => planFixApply(kestrel(), view({}), { only: ["nope"] })).toThrow(/No fix "nope"/);
  });

  it("diffs only the changed lines with context", () => {
    expect(lineDiff(["a", "b", "c"], ["a", "x", "c", "d"]).map((o) => `${o.op}${o.line}`)).toEqual([" a", "-b", "+x", " c", "+d"]);
    const plan = planFixApply(kestrel(), view({ "robots.txt": "User-agent: PerplexityBot\nDisallow: /\n" }), { only: ["access"] });
    expect(planDiff(plan)).toContain("-Disallow: /");
  });
});

describe("fixesPayload", () => {
  it("lists every fix with its evidence and marks the site-side ones", () => {
    const p = fixesPayload(kestrel());
    expect(p.fixes).toHaveLength(kestrel().fixes.length);
    expect(p.site_fixes).toEqual(["access", "schema_missing"]);
    expect(p.fixes[0].evidence.length).toBeGreaterThan(0);
    expect(p.fixes[0]).not.toHaveProperty("artifact");
    expect(fixesPayload(kestrel(), { fixKey: "schema_missing" }).fixes[0].artifact).toContain("application/ld+json");
  });
});

describe("applying to a real git repository", () => {
  it("commits on a new branch and touches nothing else", () => {
    const repo = gitRepo({ "public/robots.txt": "User-agent: *\nAllow: /\n", "index.html": "<html></html>\n" });
    const { root, branch } = checkRepo(repo);
    const plan = planFixApply(kestrel(), repoView(root));
    const name = freeBranchName(root, "saylent/fixes-test");
    applyPlan(root, plan, name);
    const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8" }).trim();
    expect(g("rev-parse", "--abbrev-ref", "HEAD")).toBe(name);
    expect(g("status", "--porcelain")).toBe("");
    const changed = g("diff", "--name-only", `${branch}..${name}`).split("\n").sort();
    expect(changed).toEqual(plan.files.map((f) => f.path).sort());
    expect(g("log", "-1", "--format=%B")).not.toMatch(/Co-Authored-By|Generated with/i);
    expect(freeBranchName(root, "saylent/fixes-test")).toBe("saylent/fixes-test-2");
  });

  it("refuses a dirty work tree, a sub-folder and a symlink that leaves the repo", () => {
    const repo = gitRepo({ "a.txt": "a\n" });
    mkdirSync(path.join(repo, "sub"));
    writeFileSync(path.join(repo, "sub", "x"), "x");
    expect(() => checkRepo(path.join(repo, "sub"))).toThrow(/repository root/);
    expect(() => checkRepo(repo)).toThrow(/uncommitted changes/);
    const root = realpathSync.native(repo);
    expect(() => safeTarget(root, "../x")).toThrow(/not a path inside/);
    // creating a symlink needs extra rights on Windows runners
    if (process.platform !== "win32") {
      const outside = mkdtempSync(path.join(tmpdir(), "saylent-outside-"));
      symlinkSync(outside, path.join(repo, "escape"));
      expect(() => safeTarget(root, "escape/robots.txt")).toThrow(/outside the repository/);
    }
  });
});
