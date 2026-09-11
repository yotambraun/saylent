#!/usr/bin/env node
// tsup's `bundle: false` mode ("preserve modules": one output
// file per source file, needed so the many package.json "exports" subpaths
// each resolve to a real file) transpiles each file in isolation and leaves
// relative import/export specifiers EXACTLY as written in the TypeScript
// source — which, under this repo's `"moduleResolution": "bundler"`, omit
// the file extension (`from "../brief"`, `from "./html"`). Real Node ESM
// (no bundler) refuses to resolve those: every relative specifier needs an
// explicit extension, and a directory import needs "/index.js". `tsc`'s own
// emit has the identical gap (it does not add extensions either), so this
// runs as a postbuild fixup after either build tool, over the emitted files.
//
// Usage: node ../../scripts/fix-esm-extensions.mjs <distDir>
// (run from a package's "build" script, after tsup/tsc have written dist/)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.argv[2] ?? "dist");

/** All this walks for is *.js and *.d.ts — never touches *.map or *.d.ts.map. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (name.endsWith(".js") || name.endsWith(".d.ts")) out.push(abs);
  }
  return out;
}

// Matches the specifier string in `from "X"`, `import "X"`, `import("X")`,
// and `export * from "X"` / `export ... from "X"` — single or double quotes.
const SPEC_RE = /((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"]*)\2/g;

function resolveExtension(fromFile, spec) {
  const dir = path.dirname(fromFile);
  const abs = path.join(dir, spec);
  if (existsSync(`${abs}.js`)) return `${spec}.js`;
  if (existsSync(path.join(abs, "index.js"))) return `${spec}/index.js`;
  return null; // already has an extension, or points somewhere unexpected
}

// A source file that does `import pkg from "../package.json"` (util.ts, for
// the crawler's user-agent version string) compiles fine under this repo's
// `"moduleResolution": "bundler"`, but real Node ESM refuses a JSON import
// with no `with { type: "json" }` attribute (ERR_IMPORT_ATTRIBUTE_MISSING) —
// tsup/tsc, transpiling in isolation, don't add one. Only `.js` files run;
// `.d.ts` never carries this import (it only needs the inferred value type).
const JSON_IMPORT_RE =
  /(import\s+[\w${},*\s]+\s+from\s+(['"])[^'"]+\.json\2)(\s*;?)/g;

let filesChanged = 0;
let specsFixed = 0;
let jsonImportsFixed = 0;
for (const file of walk(distDir)) {
  const src = readFileSync(file, "utf8");
  let changed = false;
  let next = src.replace(SPEC_RE, (whole, prefix, quote, spec) => {
    // already extensioned (".js", ".json", etc.) or a bare package specifier
    if (/\.[a-zA-Z]+$/.test(spec)) return whole;
    const fixed = resolveExtension(file, spec);
    if (!fixed) return whole;
    changed = true;
    specsFixed++;
    return `${prefix}${quote}${fixed}${quote}`;
  });
  if (file.endsWith(".js")) {
    next = next.replace(JSON_IMPORT_RE, (whole, importClause, _quote, tail) => {
      if (/\bwith\s*\{/.test(whole)) return whole; // already has an attribute
      changed = true;
      jsonImportsFixed++;
      return `${importClause} with { type: "json" }${tail}`;
    });
  }
  if (changed) {
    writeFileSync(file, next, "utf8");
    filesChanged++;
  }
}

console.log(
  `fix-esm-extensions: ${specsFixed} specifier(s) + ${jsonImportsFixed} JSON import attribute(s) fixed across ${filesChanged} file(s) in ${path.relative(process.cwd(), distDir)}`,
);
