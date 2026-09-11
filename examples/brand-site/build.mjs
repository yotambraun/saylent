#!/usr/bin/env node
// Kestrel brand-site build: copy src/ to dist/, substituting {{SITE_ROOT}} with
// the root the site will be served from. No dependencies, no framework.
//
//   node examples/brand-site/build.mjs                       # defaults to https://saylent-kestrel.vercel.app
//   node examples/brand-site/build.mjs --root http://localhost:8787
//
// The root is written WITHOUT a trailing slash: every href in src/ is
// "{{SITE_ROOT}}/pricing/" and so on, which makes the same source work both at a
// bare host and under a GitHub Pages subpath.
import { readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const DIST = path.join(HERE, "dist");
const PLACEHOLDER = /\{\{SITE_ROOT\}\}/g;
const TEXT = new Set([".html", ".css", ".txt", ".xml", ".json", ".js", ".svg"]);

/** Normalize a site root: absolute http(s) URL, no trailing slash. */
export function normalizeRoot(root) {
  const r = String(root ?? "").trim();
  if (!/^https?:\/\//i.test(r)) {
    throw new Error(`--root must be an absolute http(s) URL, got: ${r || "(empty)"}`);
  }
  return r.replace(/\/+$/, "");
}

function walk(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const abs = path.join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out;
}

/** Build the site into `outDir` for `root`. Returns the relative file list. */
export function build({ root, srcDir = SRC, outDir = DIST } = {}) {
  const siteRoot = normalizeRoot(root);
  rmSync(outDir, { recursive: true, force: true });
  const files = walk(srcDir);
  for (const rel of files) {
    const from = path.join(srcDir, rel);
    const to = path.join(outDir, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    if (TEXT.has(path.extname(rel).toLowerCase())) {
      writeFileSync(to, readFileSync(from, "utf8").replace(PLACEHOLDER, siteRoot));
    } else {
      writeFileSync(to, readFileSync(from));
    }
  }
  return { siteRoot, outDir, files };
}

function parseArgs(argv) {
  let root = process.env.SITE_ROOT || "https://saylent-kestrel.vercel.app";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i] ?? "";
    else if (argv[i].startsWith("--root=")) root = argv[i].slice(7);
    else if (argv[i] === "--help" || argv[i] === "-h") {
      process.stdout.write(
        "Usage: node examples/brand-site/build.mjs [--root <absolute url>]\n" +
          "  default (no --root, no SITE_ROOT): https://saylent-kestrel.vercel.app\n" +
          "  e.g. --root http://localhost:8787\n",
      );
      process.exit(0);
    }
  }
  return { root };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const { root } = parseArgs(process.argv.slice(2));
    const res = build({ root });
    process.stdout.write(`Kestrel brand site built for ${res.siteRoot}\n`);
    process.stdout.write(`  out: ${path.relative(process.cwd(), res.outDir) || res.outDir}\n`);
    for (const f of res.files) process.stdout.write(`  ${f}\n`);
    process.stdout.write(`${res.files.length} files\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
