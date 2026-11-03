// `saylent sources <run.json> [more run.json ...]` — where an audit's answers
// come from, $0 (no network, no model call): off-site opportunities with
// receipts, citation share by domain per engine/surface, and who the answers
// name. Two or more bundles of the same brand print the history instead:
// citations per domain per run, and how many runs each one was an off-site
// opportunity in. The numbers are the same ones report.html shows (one engine
// function, @saylent/engine/sources); --json prints the MCP `sources` tool's
// payload.
import { parseArgs } from "node:util";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import { DOMAIN_TYPES, DOMAIN_TYPE_LABEL, type DomainType, buildSourceHistory } from "@saylent/engine/sources";
import { engineLabel } from "@saylent/engine/surfaces";
import { loadBundleFileAsync } from "../run";
import { intelFor, querySources, SOURCE_VIEWS, type SourceView } from "../mcp/sources";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";

const HELP = `saylent sources <run.json> [<run.json> ...] [options]

Where the answers in an audit come from, with receipts. $0: reads the
bundle only. One bundle prints its off-site opportunities (domains cited in
answers that name a rival and not you), citation share by domain and who the
answers name. Two or more bundles of the same brand print the history.

Options:
${options([
  opt("--view <name>", `${SOURCE_VIEWS.join(", ")} (default: all, as text)`),
  opt("--engine <id>", "Only rows cited by this engine or surface"),
  opt("--type <type>", `Only domains of this type: ${DOMAIN_TYPES.join(", ")}`),
  opt("--domain <host>", "One domain: its pages and every answer citing it"),
  opt("--limit <n>", "Rows per list (default 10, max 50)"),
  opt("--json", "Print the same JSON the MCP `sources` tool returns"),
  HELP_OPTION,
])}`;

const resolveBundlePath = (p: string): string => {
  const resolved = path.resolve(p);
  return existsSync(resolved) && statSync(resolved).isDirectory() ? path.join(resolved, "run.json") : resolved;
};

const pad = (s: string, n: number) => (s.length >= n ? `${s.slice(0, n - 1)}${glyph("ellipsis")}` : s.padEnd(n));

export function formatSources(bundle: RunBundleV1, q: Parameters<typeof querySources>[1]): string {
  const r = querySources(bundle, { ...q, view: q.view ?? "all" }) as ReturnType<typeof querySources> & {
    opportunities?: { host: string; type: DomainType; evidence: number; why: string; receipts: { qid: string; engine: string }[] }[];
    domains?: { host: string; type: DomainType; citations: number; share: number; brand_named_answers: number; rival_won_answers: number }[];
    voice?: { name: string; is_brand: boolean; named: number; recommended: number | null }[];
    domain_detail?: { host: string; type_label: string; typeRule: string; pages: { url: string; title: string | null; citations: number; brandOnPage: boolean | null }[]; answers: { qid: string; engine: string; question: string }[] };
  };
  const out: string[] = [];
  const t = r.totals;
  out.push(`\nSaylent ${glyph("sep")} sources ${glyph("sep")} ${bundle.brand_model.brand}\n`);
  out.push(
    `  ${t.citations} citations ${glyph("sep")} ${t.domains} domains ${glyph("sep")} ${t.answersWithCitations} of ${t.answers} answers cite a page ${glyph("sep")} ${t.rivalWonAnswers} answers name a rival and not you`,
  );
  if (r.domain_detail) {
    const d = r.domain_detail;
    out.push("", `  ${d.host}  ${d.type_label} (${d.typeRule})`);
    for (const p of d.pages) {
      const presence = p.brandOnPage === null ? "not read" : p.brandOnPage ? "you are on it" : "you are not on it";
      out.push(`    ${glyph("dot")} ${p.title ?? p.url}  x${p.citations}  ${presence}`, `      ${p.url}`);
    }
    out.push("", "  Answers citing it");
    for (const a of d.answers) out.push(`    ${a.qid} ${glyph("sep")} ${engineLabel(a.engine)}  ${a.question}`);
    return `${out.join("\n")}\n`;
  }
  if (r.opportunities) {
    out.push("", "  Off-site opportunities (ranked by answers that name a rival and not you)");
    if (r.opportunities.length === 0) out.push("    none on this run");
    r.opportunities.forEach((o, i) => {
      out.push(`  ${String(i + 1).padStart(2)}. ${o.host}  ${DOMAIN_TYPE_LABEL[o.type]}  ${glyph("sep")} in ${o.evidence} answer${o.evidence === 1 ? "" : "s"}`);
      out.push(`      ${o.why}`);
      out.push(`      receipts: ${o.receipts.map((x) => `${x.qid} ${engineLabel(x.engine)}`).join(", ")}`);
    });
  }
  if (r.domains) {
    out.push("", `  ${pad("Domain", 34)} ${pad("Type", 18)} ${"Cites".padStart(5)} ${"Share".padStart(6)} ${"Name you".padStart(8)} ${"Skip you".padStart(8)}`);
    for (const d of r.domains) {
      out.push(
        `  ${pad(d.host, 34)} ${pad(DOMAIN_TYPE_LABEL[d.type], 18)} ${String(d.citations).padStart(5)} ${`${Math.round(d.share * 100)}%`.padStart(6)} ${String(d.brand_named_answers).padStart(8)} ${String(d.rival_won_answers).padStart(8)}`,
      );
    }
  }
  if (r.voice) {
    out.push("", `  ${pad("Who the answers name", 34)} ${"Named".padStart(6)} ${"Recommended".padStart(12)}`);
    for (const v of r.voice) {
      out.push(`  ${pad(v.is_brand ? `${v.name} (you)` : v.name, 34)} ${String(v.named).padStart(6)} ${(v.recommended === null ? "" : String(v.recommended)).padStart(12)}`);
    }
  }
  out.push("", `  Receipts open in report.html, section 04 ${glyph("sep")} saylent sources ${"<run.json>"} --domain <host> for one domain`);
  return `${out.join("\n")}\n`;
}

export function formatHistory(bundles: RunBundleV1[]): string {
  const history = buildSourceHistory(
    bundles.map((b) => ({ runId: b.run.id, date: b.run.finished_at ?? b.run.started_at, intel: intelFor(b).intel })),
  );
  const out: string[] = [];
  out.push(`\nSaylent ${glyph("sep")} sources ${glyph("sep")} ${bundles[0].brand_model.brand} ${glyph("sep")} ${bundles.length} runs\n`);
  const dates = history.runs.map((r) => r.date.slice(0, 10));
  out.push(`  ${pad("Run", 34)} ${dates.map((d) => d.padStart(11)).join("")}`);
  out.push(`  ${pad("citations", 34)} ${history.runs.map((r) => String(r.citations).padStart(11)).join("")}`);
  out.push(`  ${pad("off-site opportunities", 34)} ${history.runs.map((r) => String(r.opportunities).padStart(11)).join("")}`);
  out.push("", `  ${pad("Domain (citations per run)", 34)} ${"".padStart(11 * dates.length)}  opportunity in`);
  for (const d of history.domains) {
    out.push(`  ${pad(d.host, 34)} ${d.citations.map((c) => String(c || glyph("dot")).padStart(11)).join("")}  ${d.opportunityRuns} of ${dates.length}`);
  }
  out.push("", `  ${pad("Named in (answers per run)", 34)}`);
  for (const v of history.voice) {
    out.push(`  ${pad(v.isBrand ? `${v.name} (you)` : v.name, 34)} ${v.named.map((c) => String(c).padStart(11)).join("")}`);
  }
  return `${out.join("\n")}\n`;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      view: { type: "string" },
      engine: { type: "string" },
      type: { type: "string" },
      domain: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  if (positionals.length === 0) {
    process.stderr.write(`Missing <run.json>.\n\n${HELP}\n`);
    return 1;
  }
  if (values.view && !(SOURCE_VIEWS as readonly string[]).includes(values.view)) {
    process.stderr.write(`\n  --view ${values.view}: expected one of ${SOURCE_VIEWS.join(", ")}.\n`);
    return 1;
  }
  const limit = values.limit !== undefined ? Number(values.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
    process.stderr.write(`\n  --limit ${values.limit}: expected a whole number 1-50.\n`);
    return 1;
  }
  const bundles: RunBundleV1[] = [];
  for (const p of positionals) {
    try {
      bundles.push(await loadBundleFileAsync(resolveBundlePath(p)));
    } catch (e) {
      process.stderr.write(`\n  ${p}: ${e instanceof Error ? e.message : String(e)}\n`);
      return 1;
    }
  }
  const query = {
    view: values.view as SourceView | undefined,
    engine: values.engine,
    type: values.type as DomainType | undefined,
    domain: values.domain,
    limit,
  };
  try {
    if (bundles.length > 1) {
      const domains = new Set(bundles.map((b) => b.brand_model.domain));
      if (domains.size > 1) {
        process.stderr.write(`\n  Those runs are for different brands (${[...domains].join(", ")}). A history needs one brand.\n`);
        return 1;
      }
      if (values.json) {
        const history = buildSourceHistory(
          bundles.map((b) => ({ runId: b.run.id, date: b.run.finished_at ?? b.run.started_at, intel: intelFor(b).intel })),
        );
        process.stdout.write(`${JSON.stringify(history, null, 2)}\n`);
      } else {
        process.stdout.write(formatHistory(bundles));
      }
      return 0;
    }
    if (values.json) {
      process.stdout.write(`${JSON.stringify({ ...querySources(bundles[0], query), cost_usd: 0 }, null, 2)}\n`);
    } else {
      process.stdout.write(formatSources(bundles[0], query));
    }
    return 0;
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}
