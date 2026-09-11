// Render fixtures/run.json to the three delivered artifacts, at $0 and with no
// database. This is the standing offline proof that the app's report components
// and the static renderer are one pipeline.
//
//   npx tsx packages/report/scripts/render-fixture.ts [outDir]
//
// Writes <outDir>/report-fixture.html and <outDir>/report-fixture.md
// (default outDir: ./ in the repo root).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { renderMarkdown } from "../src/render/markdown";
import { renderReportHtml } from "../src/render/html";
import { renderMovementHtml } from "../src/render/movement";
import { fixtureToReportData } from "../src/render/fixture";

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const outDir = path.resolve(process.argv[2] ?? repoRoot);
  mkdirSync(outDir, { recursive: true });

  const fx = JSON.parse(readFileSync(path.join(repoRoot, "fixtures/run.json"), "utf8"));
  const data = fixtureToReportData(fx);

  // Engines that actually answered. The fixture predates per-answer model ids,
  // so the models map stays empty and the masthead prints "none recorded"
  // rather than inventing a model string.
  const engines = [...new Set(data.answers.filter((a) => a.ok !== false).map((a) => a.engine))];
  const models: Record<string, string> = {};
  const run = data.run as unknown as {
    profile?: string;
    est_cost_usd?: number | null;
    finished_at?: string | null;
  };

  const html = await renderReportHtml(data, {
    repoRoot,
    title: `${data.brand.name} · Saylent report`,
    generatedAt: run.finished_at ?? new Date().toISOString(),
    theme: "auto",
    contactEmail: "reports@example.com",
    methodologyUrl: null,
    meta: {
      profile: run.profile ?? "unknown",
      engines,
      models,
      cost: run.est_cost_usd ?? null,
    },
  });
  const md = renderMarkdown(data);

  // movement.html from the same fixture on both sides: the honest answer is "no
  // measurable movement", which is exactly the case the verify view has to render
  // well. It proves the second pipeline end to end at $0.
  const movement = await renderMovementHtml(data, data, {
    repoRoot,
    title: `${data.brand.name} · movement`,
    contactEmail: "reports@example.com",
  });

  const htmlPath = path.join(outDir, "report-fixture.html");
  const mdPath = path.join(outDir, "report-fixture.md");
  const movementPath = path.join(outDir, "movement-fixture.html");
  writeFileSync(htmlPath, html, "utf8");
  writeFileSync(mdPath, md, "utf8");
  writeFileSync(movementPath, movement, "utf8");
  const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`${htmlPath}  ${kb(Buffer.byteLength(html))}`);
  console.log(`${mdPath}  ${kb(Buffer.byteLength(md))}`);
  console.log(`${movementPath}  ${kb(Buffer.byteLength(movement))}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
