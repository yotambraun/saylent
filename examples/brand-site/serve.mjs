#!/usr/bin/env node
// Serve the Kestrel brand site locally so the audit engine can crawl a real
// site before GitHub Pages exists. Builds dist/ for http://localhost:<port>
// first, so links, sitemap.xml and robots.txt all point at the local root.
//
//   node examples/brand-site/serve.mjs --port 8787
//
// Node http only, no dependencies. Binds 127.0.0.1 by default.
//
// NOTE: the engine's safeFetch() blocks loopback and private hosts (SSRF
// guard) and has NO localhost exemption, so a run against this server needs
// an explicit opt-in flag on the CLI side. See PLANTED-GAPS.md "Running the
// audit against this site".
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, "dist");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function parseArgs(argv) {
  let port = 8787;
  let host = "127.0.0.1";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port") port = Number(argv[++i]);
    else if (argv[i].startsWith("--port=")) port = Number(argv[i].slice(7));
    else if (argv[i] === "--host") host = argv[++i];
    else if (argv[i].startsWith("--host=")) host = argv[i].slice(7);
    else if (argv[i] === "--help" || argv[i] === "-h") {
      process.stdout.write("Usage: node examples/brand-site/serve.mjs [--port 8787] [--host 127.0.0.1]\n");
      process.exit(0);
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write(`Invalid --port: ${port}\n`);
    process.exit(1);
  }
  return { port, host };
}

/** Map a request path to a file inside dist/, or null when it escapes or is missing. */
function resolveFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const abs = path.resolve(DIST, rel);
  if (abs !== DIST && !abs.startsWith(DIST + path.sep)) return null; // path traversal
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const index = path.join(abs, "index.html");
    return existsSync(index) ? index : null;
  }
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  // /pricing -> /pricing/index.html
  const asDir = path.join(abs, "index.html");
  if (existsSync(asDir)) return asDir;
  return null;
}

const { port, host } = parseArgs(process.argv.slice(2));
const root = `http://localhost:${port}`;
const built = build({ root });

const server = createServer((req, res) => {
  const urlPath = req.url || "/";
  // A bare directory path without the trailing slash redirects, like a real host.
  if (/^\/[^?]*[^/]$/.test(urlPath.split("?")[0]) && !path.extname(urlPath.split("?")[0])) {
    const dir = path.resolve(DIST, urlPath.split("?")[0].replace(/^\/+/, ""));
    if ((dir === DIST || dir.startsWith(DIST + path.sep)) && existsSync(dir) && statSync(dir).isDirectory()) {
      res.writeHead(301, { location: `${urlPath.split("?")[0]}/` });
      return res.end();
    }
  }
  const file = resolveFile(urlPath);
  if (!file) {
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    return res.end(
      `<!doctype html><meta charset="utf-8"><title>Not found | Kestrel Uptime</title>` +
        `<p style="font-family:system-ui;padding:2rem">Not found. <a href="/">Back to the home page</a>.</p>`,
    );
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : body);
});

server.listen(port, host, () => {
  process.stdout.write(`Kestrel brand site: ${root} (${built.files.length} files from dist/)\n`);
  process.stdout.write(`  robots.txt  ${root}/robots.txt\n`);
  process.stdout.write(`  sitemap.xml ${root}/sitemap.xml\n`);
  process.stdout.write("Stop with ctrl-c.\n");
});
