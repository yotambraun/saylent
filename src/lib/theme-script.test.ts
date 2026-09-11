// The CSP hash invariant. The enforced Content-Security-Policy allow-lists the
// pre-paint inline script BY HASH; if the allow-listed hash is not the hash of
// the exact string the layout emits, the browser refuses the script and dark
// mode dies on every /app, /login and /share page (that regression shipped once,
// on 2026-09-10). These tests fail the build instead.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_SCRIPT } from "./theme-script";
import { buildContentSecurityPolicy, THEME_SCRIPT_HASH } from "../proxy";

const sha256 = (s: string) => `sha256-${createHash("sha256").update(s, "utf8").digest("base64")}`;

describe("theme script CSP hash", () => {
  it("the allow-listed hash is the hash of the exact script string", () => {
    expect(THEME_SCRIPT_HASH).toBe(sha256(THEME_SCRIPT));
  });

  it("the enforced policy carries that hash in script-src", () => {
    const csp = buildContentSecurityPolicy("test-nonce");
    expect(csp).toContain(`'${sha256(THEME_SCRIPT)}'`);
  });

  it("layout.tsx emits the shared constant and holds no second copy of the script", () => {
    const layout = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).toContain('from "@/lib/theme-script"');
    expect(layout).toContain("__html: THEME_SCRIPT");
    // A literal re-inlining of the script body is the exact drift this guards.
    expect(layout).not.toContain("document.documentElement.classList");
  });

  it("the script sets both the js class and the dark class", () => {
    expect(THEME_SCRIPT).toContain("classList.add('js')");
    expect(THEME_SCRIPT).toContain("classList.toggle('dark'");
  });
});
