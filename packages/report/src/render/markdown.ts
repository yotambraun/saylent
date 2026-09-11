// renderMarkdown — the report as text, for a ticket, a PR description, or an LLM
// context window. Same rows, same composer (buildBrief), so a line here can never
// disagree with the same line in report.html.
//
// Two parts: the Brief (hero + every card, all nine block kinds) and the evidence
// tables under it (answers per question and engine, attributed and dated; cited
// pages; gates; fixes). Nothing is summarised or re-worded: the numbers come from
// the composers and the quotes stay verbatim.
import { decodeEntities } from "../entities";
import { buildBrief, type BriefBlock, type BriefScores } from "../brief";
import { hostOf } from "../source-map";
import { previewText, sliceCodePoints } from "../strip-md";
import { runTotals, totalsLine, failuresLine } from "../totals";
import { gateTally, robotsVsLiveNote, type GateCheck } from "../gates-lede";
import { artifactToMarkdown } from "../artifact";
import { DOCS_URL, REPO_URL, RUN_COMMAND, PROJECT_TAGLINE } from "../components/report-outro";
import type { ReportData } from "./types";

const ENGINE_LABEL: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

const engineName = (e: string) => ENGINE_LABEL[e] ?? e;

/** en-GB day-month-year, the same face the app prints. */
function day(iso: string | null | undefined): string {
  if (!iso) return "date not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "date not recorded";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** A cited page whose stored title is just the site's own name ("Medium") tells
 *  the reader nothing the host does not, and reads as a broken row next to a
 *  link that goes nowhere. Fall back to the host in that case. */
export function titleOrHost(title: string | null | undefined, url: string): string {
  const t = decodeEntities((title ?? "").trim());
  const host = hostOf(url);
  if (!t) return host;
  const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const label = host.replace(/^www\./, "").split(".")[0];
  return flat(t) === flat(label) || flat(t) === flat(host) ? host : t;
}

/** A table cell must not break the row. Pipes are escaped, newlines collapsed. */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s*\n+\s*/g, " ").trim();
}

/** A drafted artifact is itself markdown, and ours routinely CONTAIN fenced
 *  code blocks (a robots.txt snippet, a JSON-LD `<script>`, a whole draft
 *  page). Wrapping such an artifact in a plain three-backtick fence closes it
 *  at the artifact's own first fence, and every following line of the report
 *  renders as one giant code block. CommonMark's rule: the opening fence must
 *  be LONGER than any backtick run inside the content, and the closing fence
 *  at least as long as the opening one. */
export function fenceFor(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function table(headers: string[], rows: string[][]): string[] {
  if (rows.length === 0) return [];
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ];
}

/** The nine block kinds of the summary contract,
 *  each in the flattest Markdown that keeps its meaning. */
function renderBlock(b: BriefBlock): string[] {
  switch (b.kind) {
    case "text":
      return [b.text];
    case "stat":
      return [`**${b.value}** ${b.label}`];
    case "bars":
      return [
        ...b.rows.map((r) => `- ${r.label}: ${r.count}${r.highlight ? " (you)" : ""}`),
        "",
        b.takeaway,
      ];
    case "list":
      return b.items.map((i) => `- ${i.text}`);
    case "quote": {
      const attribution = [b.attribution, b.count ? `${b.count} answers` : null]
        .filter(Boolean)
        .join(", ");
      return [`> ${b.text}`, ...(attribution ? ["", `_${attribution}_`] : [])];
    }
    case "status":
      return table(
        ["Check", "State", "Detail"],
        b.rows.map((r) => [r.label, r.state, r.detail ?? ""]),
      );
    case "pages":
      return table(
        ["Page", "Cited", "Engines", "You appear", "Decides"],
        b.rows.map((r) => [
          `${titleOrHost(r.title, r.url)} (${r.url})`,
          String(r.cited),
          r.engines.map(engineName).join(", "),
          r.present === null ? "unknown" : r.present ? "yes" : "no",
          r.decides ?? "",
        ]),
      );
    case "moves":
      return table(
        ["#", "Move", "Effort", "Time to impact", "Engines", "Draft"],
        b.rows.map((r) => [
          String(r.rank),
          r.title,
          r.effort ?? "",
          r.timeToImpact ?? "",
          (r.engines ?? []).map(engineName).join(", "),
          r.draftReady ? "ready" : "",
        ]),
      );
    case "kv":
      // a real header row: four GitHub-facing tables used to open with "|  |  |"
      return table(
        ["Measure", "Value"],
        b.rows.map((r) => [r.k, r.v]),
      );
  }
}

export interface RenderMarkdownOptions {
  /** One line marking a report rendered from a published SAMPLE bundle
   *  (a fictional brand, replaced competitor names). Rendered as the very
   *  first line of the file, above the title, so a reader who opens the
   *  markdown out of context cannot mistake it for a real audit. */
  sampleNotice?: string;
}

export function renderMarkdown(data: ReportData, opts: RenderMarkdownOptions = {}): string {
  const { run, brand, answers, corpus, checks, fixes } = data;
  const runRow = run as unknown as {
    scores?: BriefScores | null;
    health?: unknown;
    site_pages?: unknown;
    brand_model?: { value_props?: unknown } | null;
    kind?: string;
    finished_at?: string | null;
    created_at?: string;
    profile?: string;
    // Same extra, cast-only field convention
    // as health/brand_model/site_pages above: `skip` is not on RunRow, so it
    // rides along the same way (from-bundle.ts) and reads null on every run
    // that predates this feature or skipped nothing.
    skip?: { drafts?: boolean; corpus?: boolean; gates?: boolean } | null;
  };
  const skip = runRow.skip ?? null;
  const skippedLabels: string[] = (["drafts", "corpus", "gates"] as const).filter((k) => skip?.[k]);
  const brief = buildBrief({
    brand,
    scores: (runRow.scores ?? null) as BriefScores | null,
    answers: answers as never,
    corpus: corpus as never,
    checks: checks as never,
    fixes: fixes as never,
    health: (runRow.health ?? null) as never,
    sitePages: (runRow.site_pages ?? null) as never,
    valueProps: Array.isArray(runRow.brand_model?.value_props)
      ? (runRow.brand_model?.value_props as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
    kind: runRow.kind,
    runDate: day(runRow.finished_at ?? runRow.created_at ?? null),
    previous: null,
  });

  const measuredOn = day(runRow.finished_at ?? runRow.created_at ?? null);
  // THE ONE TOTALS LINE — the same words the report header and the disclaimer
  // use. "24 live AI responses" was untrue: six of those calls returned nothing.
  const totals = runTotals(answers as { ok?: boolean; qtype?: string }[], runRow.scores?.overall?.answered ?? null);
  const out: string[] = [];

  if (opts.sampleNotice) {
    out.push(`> **${opts.sampleNotice}**`);
    out.push("");
  }
  out.push(`# ${brand.name} · Saylent report`);
  out.push("");
  out.push(
    `${brand.domain} · measured ${measuredOn} · profile ${runRow.profile ?? "unknown"} · ${totalsLine(totals)}`,
  );
  if (skippedLabels.length > 0) {
    out.push("");
    out.push(
      `> Skipped by request: ${skippedLabels.join(", ")}. Nothing skipped is reported as a pass or an absence — see the notices below each affected section.`,
    );
  }
  out.push("");
  out.push("## The summary");
  out.push("");
  out.push(`### ${brief.hero.headline}`);
  out.push("");
  out.push(brief.hero.sub);
  if (brief.hero.stats.length > 0) {
    out.push("");
    out.push(...brief.hero.stats.map((s) => `- **${s.value}** ${s.label}`));
  }
  // Facts counted on a different base than the headline travel with the hero,
  // each naming its own denominator.
  for (const note of brief.hero.notes) {
    out.push("");
    out.push(note);
  }
  out.push("");
  out.push(`> ${brief.hero.basis}`);

  for (const card of brief.cards) {
    out.push("");
    out.push(`### ${card.question}`);
    out.push("");
    out.push(card.teaser);
    for (const block of card.blocks) {
      const lines = renderBlock(block);
      if (lines.length === 0) continue;
      out.push("");
      out.push(...lines);
    }
  }

  /* ---------------- the evidence: what each engine actually said ------------- */
  out.push("");
  out.push("## The answers");
  out.push("");
  out.push(
    "Verbatim excerpts of what each engine returned, with the engine and the date. They document what the AI said; they are not statements of fact.",
  );
  out.push("");
  out.push(
    "How to read the verdicts: **absent** = not in the answer at all · **mentioned / listed / compared** = named but not recommended · **recommended** = the engine tells the buyer to pick you · **dismissed** = named and ruled out · **no answer** = the call returned nothing.",
  );
  const failed = failuresLine(totals);
  if (failed) {
    out.push("");
    out.push(failed);
  }

  const byQuestion = new Map<string, typeof answers>();
  for (const a of answers) {
    const list = byQuestion.get(a.qid) ?? [];
    list.push(a);
    byQuestion.set(a.qid, list);
  }
  for (const [qid, rows] of [...byQuestion.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push("");
    out.push(`### ${qid} · ${rows[0]?.question ?? ""}`);
    out.push("");
    out.push(
      ...table(
        ["Engine", "Date", "You appear", "Mention", "Excerpt"],
        rows
          .slice()
          .sort((a, b) => a.engine.localeCompare(b.engine))
          .map((a) => [
            engineName(a.engine),
            day(a.created_at ?? runRow.finished_at ?? null),
            a.ok === false ? "no answer" : a.verdict?.brand_present ? "yes" : "no",
            a.ok === false ? "the call returned nothing" : (a.verdict?.mention_type ?? ""),
            sliceCodePoints(previewText(a.verdict?.excerpt || a.raw_text || "", { tail: true }), 320),
          ]),
      ),
    );
  }

  /* ---------------- cited pages ---------------- */
  // corpus_pages stores citations as engine -> count; the battlefield row's
  // "cited" number is that map summed, and the engines are its keys.
  const citedTimes = (p: (typeof corpus)[number]) =>
    Object.values(p.cited_by ?? {}).reduce((n, v) => n + (v ?? 0), 0);
  const citedPages = corpus.filter((p) => citedTimes(p) > 0);
  if (citedPages.length > 0 || skip?.corpus) {
    out.push("");
    out.push("## Cited pages");
    out.push("");
    if (skip?.corpus) {
      out.push(
        "Presence unverified (skipped by request): cited-page fetches did not run this run.",
      );
    } else {
      out.push(
        ...table(
          ["Host", "URL", "Title", "Cited", "Engines", "You appear", "Decides"],
          citedPages
            .slice()
            .sort((a, b) => citedTimes(b) - citedTimes(a))
            .map((p) => {
              const url = p.final_url ?? p.url;
              return [
                hostOf(url),
                url,
                titleOrHost(p.title, url),
                String(citedTimes(p)),
                Object.keys(p.cited_by ?? {}).map(engineName).join(", "),
                p.brand_present === null ? "unknown" : p.brand_present ? "yes" : "no",
                (p.cited_for_qids ?? []).join(", "),
              ];
            }),
        ),
      );
    }
  }

  /* ---------------- gates ---------------- */
  if (checks.length > 0 || skip?.gates) {
    out.push("");
    out.push("## Site gates");
    out.push("");
    if (skip?.gates) {
      out.push("Gate checks were skipped by request. Nothing here is a pass or a fail; it simply wasn't run.");
    } else {
      const gc = checks as unknown as GateCheck[];
      const tally = gateTally(gc);
      out.push(`**${tally.line}** of ${tally.total} checks.`);
      const note = robotsVsLiveNote(gc);
      if (note) {
        out.push("");
        out.push(note);
      }
      out.push("");
      out.push(
        ...table(
          ["Check", "Status", "Detail"],
          [...checks]
            .sort(
              (a, b) =>
                ["fail", "warn", "info", "pass"].indexOf(a.status) -
                ["fail", "warn", "info", "pass"].indexOf(b.status),
            )
            .map((c) => [c.check_name, c.status, previewText(c.detail ?? "")]),
        ),
      );
    }
  }

  /* ---------------- fixes ---------------- */
  if (fixes.length > 0) {
    out.push("");
    out.push("## Fixes");
    out.push("");
    if (skip?.drafts) {
      out.push(
        "Drafting was skipped by request: the fixes below are the deterministic diagnosis only, each without a copy-ready artifact.",
      );
      out.push("");
    }
    out.push(
      ...table(
        ["Fix", "Factor", "Effort", "Time to impact", "Engines", "Draft", "Shipped"],
        fixes
          .slice()
          .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
          .map((f) => [
            f.title,
            f.factor ?? "",
            f.effort ?? "",
            f.time_to_impact ?? "",
            (f.engines ?? []).map(engineName).join(", "),
            f.artifact ? "ready" : skip?.drafts ? "skipped by request" : "",
            f.published_at ? day(f.published_at) : "",
          ]),
      ),
    );
    for (const f of fixes) {
      if (!f.artifact) continue;
      out.push("");
      out.push(`### Draft: ${f.title}`);
      out.push("");
      // The whole draft used to be wrapped in one fence, so GitHub rendered a
      // wall of raw markdown source (and the outer fence sat around the
      // artifact's own fences). Re-emitted as real markdown: the file to paste
      // stays a code block, the prose around it reads as prose, and drafted
      // headings are demoted so they cannot outrank the report's sections.
      out.push(artifactToMarkdown(f.artifact, { domain: brand.domain, headingBase: 4 }));
    }
  }

  out.push("");
  out.push("---");
  out.push("");
  out.push(
    `Measured on ${measuredOn}: ${totalsLine(totals)}. Engine answers vary between runs; scores are directional. This report records what the assistants answered on this date. It is not an assessment of the company named.`,
  );
  out.push("");
  // The closing block: what this is, where the code is, how to run it. The
  // published sample used to end here with no link back to the project.
  out.push(`${PROJECT_TAGLINE} Docs: ${DOCS_URL} · Code: ${REPO_URL}`);
  out.push("");
  out.push("```");
  out.push(RUN_COMMAND);
  out.push("```");
  out.push("");

  return out.join("\n");
}
