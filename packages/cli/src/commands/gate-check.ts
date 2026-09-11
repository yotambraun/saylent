// `saylent gate-check <domain>` (alias `check`) — no keys, no LLM calls: a live
// per-UA probe plus a real (small) crawl feeding runDomainChecks, curated into
// the training/search/user robots summary, the live-probe line, the JSON-LD line
// and the meta line.
//
// It reports only on pages it actually crawled (home + a few linked pages), and
// adds its own lightweight "noai" scan of the homepage HTML (a plain string
// search) because runDomainChecks itself has no noai directive check.
//
// Split into runGateCheckWith(engineMod, domain) (pure-ish logic over an
// injected @saylent/engine module) and run(argv) (arg parsing + the real
// dynamic loadEngine()) so a test can call the former with a STATIC import —
// see run.ts's TESTABILITY NOTE for why a dynamic import() of @saylent/engine
// is avoided in tests.
import { parseArgs } from "node:util";
import type { DomainCheck, Fetcher } from "@saylent/engine";
import type { EngineModule } from "../engine-loader";
import { loadGateCheckEngine } from "../engine-loader";
import { maybeStarAsk } from "../star-ask";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";

/** Exit codes, documented in --help because the docs tell people to wire this
 *  into CI. 1 keeps its existing meaning (at least one check FAILED); 2 is the
 *  new, distinct "nothing was measured" case, so a typo'd or dead domain can
 *  never be mistaken for a passing gate. */
export const EXIT_PASS = 0;
export const EXIT_CHECK_FAILED = 1;
export const EXIT_UNREACHABLE = 2;

const HELP = `saylent gate-check <domain>

No keys needed, no LLM calls. Checks robots.txt, a live per-UA probe,
JSON-LD presence and meta directives.

Options:
${options([
  opt("--json", "Print the checks array and the verdict as JSON, nothing else"),
  HELP_OPTION,
])}

Exit codes (for CI):
  0  pass  — nothing blocked (a WARN-only result also exits 0)
  1  fail  — at least one check failed; the Result line names which
  2  unreachable — the site could not be fetched, so nothing was measured`;

/** One short phrase per failing check, built from the SAME checks array the
 *  ✓/· lines above are built from — the Result line used to print two
 *  hand-picked buckets ("0 blocked-at-CDN · 3 missing schema") that could both
 *  read zero next to the word FAIL. Pure, so the wording is unit-testable.
 *
 *  Missing schema stays a COUNT (a list of eight JSON-LD types would drown the
 *  line) and counts warn as well as fail, which is what "missing" means here:
 *  Organization missing is a fail, the other types are warns. */
export function summarizeChecks(checks: DomainCheck[]): {
  verdict: "PASS" | "WARN" | "FAIL";
  reasons: string[];
} {
  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  const verdict = fails.length > 0 ? "FAIL" : warns.length > 0 ? "WARN" : "PASS";

  const named = (verdict === "FAIL" ? fails : warns).filter((c) => !c.check.startsWith("JSON-LD "));
  const phrases = named.map((c) => {
    if (c.check.startsWith("robots: ")) return `${c.check.slice(8)} blocked in robots.txt`;
    if (c.check.startsWith("live fetch as ")) {
      const code = /HTTP (\d+|unreachable)/.exec(c.detail)?.[1];
      return `${c.check.slice(14)} blocked at the CDN${code ? ` (HTTP ${code})` : ""}`;
    }
    if (c.check === "meta noindex") return "noindex on a crawled page";
    if (c.check === "meta nosnippet") return "nosnippet on a crawled page";
    return c.check;
  });

  // Three names is as much as one line carries; the rest is counted, never
  // dropped silently (--json has all of them).
  const reasons = phrases.slice(0, 3);
  if (phrases.length > 3) reasons.push(`+${phrases.length - 3} more`);

  const missingSchema = checks.filter((c) => c.check.startsWith("JSON-LD ") && c.status !== "pass").length;
  if (missingSchema > 0) reasons.push(`${missingSchema} schema missing`);
  if (reasons.length === 0) reasons.push("nothing blocked, no schema missing");
  return { verdict, reasons };
}

export interface GateCheckOptions {
  /** machine-readable output: the checks array + the verdict, and nothing else */
  json?: boolean;
}

export async function runGateCheckWith(
  engineMod: Pick<EngineModule, "crawlSite" | "runDomainChecks" | "MemoryDbWriter" | "BOT_REGISTRY" | "safeFetch">,
  domain: string,
  out: (line: string) => void = (l) => process.stdout.write(l),
  /** default: the real SSRF-guarded safeFetch. Tests inject a fake Fetcher
   *  (matching run-audit.test.ts's own pattern) instead of mocking the
   *  global fetch — safeFetch's DNS-rebind guard would reject a fictional
   *  test domain before a mocked fetch ever ran. */
  fetcher: Fetcher = engineMod.safeFetch,
  opts: GateCheckOptions = {},
): Promise<number> {
  const started = Date.now();
  const { crawlSite, runDomainChecks, MemoryDbWriter, BOT_REGISTRY } = engineMod;

  // A domain that does not resolve is not a passing gate — it is a
  // measurement that never happened. crawlSite/runDomainChecks can also throw
  // outright (DNS failure, a refused connection), which used to surface as a
  // raw stack trace; both cases land on the same "unreachable" report below.
  let pages: Awaited<ReturnType<typeof crawlSite>> = [];
  let crawlError: string | null = null;
  try {
    pages = await crawlSite(domain, 5, undefined, { fetcher });
  } catch (e) {
    crawlError = e instanceof Error ? e.message : String(e);
  }
  const bm = {
    brand: domain,
    domain,
    aliases: [domain],
    category: "",
    icp: "",
    products: [],
    value_props: [],
    problems: [],
    competitors: [],
    language: "en",
  };
  const db = new MemoryDbWriter();
  const runId = "gate-check";
  let checks: DomainCheck[] = [];
  try {
    checks = await runDomainChecks(bm, [], pages, db, runId, {
      currentYear: new Date().getFullYear(),
      fetcher,
    });
  } catch (e) {
    crawlError ??= e instanceof Error ? e.message : String(e);
  }

  // ---- reachability ----
  // Nothing crawled AND no robots.txt row means every line below would be a
  // guess: the old output printed "noai: absent ✓ · noindex: absent ✓" and
  // exited 0 for a domain that does not resolve, which is a permanently green
  // CI check on a typo. A ✓ is never printed for a check that did not run.
  const byBot = new Map(checks.filter((c) => c.check.startsWith("robots: ")).map((c) => [c.check.slice(8), c]));
  const reachable = pages.length > 0 || byBot.size > 0;
  const UNREACHABLE = "unreachable";

  const liveChecks = checks.filter((c) => c.check.startsWith("live fetch as "));
  const ldChecks = checks.filter((c) => c.check.startsWith("JSON-LD "));
  const noindexChecks = checks.filter((c) => c.check === "meta noindex");
  const elapsedMs = Date.now() - started;
  const elapsedS = (elapsedMs / 1000).toFixed(1);

  const summary = reachable
    ? summarizeChecks(checks)
    : { verdict: "FAIL" as const, reasons: ["site unreachable"] };
  const exitCode = !reachable
    ? EXIT_UNREACHABLE
    : summary.verdict === "FAIL"
      ? EXIT_CHECK_FAILED
      : EXIT_PASS;

  // ---- meta (noindex from domainChecks; noai via a direct homepage scan) ----
  const home = pages[0];
  let noaiPresent = false;
  if (home) {
    try {
      const homeRes = await fetcher(home.url);
      noaiPresent = /noai|noimageai/i.test(homeRes.text.slice(0, 20000));
    } catch {
      /* the page was crawlable a moment ago; a re-fetch failure is not a finding */
    }
  }

  if (opts.json) {
    // The machine-readable twin of everything above: the whole checks array
    // (nothing summarised away), the verdict, and the exit code, so a CI job
    // can say WHICH bot regressed without screen-scraping a Unicode table.
    out(
      `${JSON.stringify(
        {
          domain,
          verdict: summary.verdict,
          reasons: summary.reasons,
          exit_code: exitCode,
          reachable,
          pages_crawled: pages.length,
          elapsed_ms: elapsedMs,
          cost_usd: 0,
          error: crawlError,
          checks,
        },
        null,
        2,
      )}\n`,
    );
    return exitCode;
  }

  // ---- robots.txt, grouped by bot kind ----
  const groupLine = (kind: "training" | "search" | "user") => {
    if (!reachable) return UNREACHABLE;
    const bots = BOT_REGISTRY.filter((b) => b.kind === kind);
    const line = bots
      .map((b) => {
        const c = byBot.get(b.agent);
        if (!c) return null;
        return `${b.agent} ${c.status === "pass" ? "allowed" : "blocked"}`;
      })
      .filter(Boolean)
      .join(` ${glyph("sep")} `);
    return line || "not checked (robots.txt unreachable)";
  };
  out(`\nSaylent ${glyph("sep")} gate-check ${glyph("sep")} ${domain}\n\n`);
  const googleExtended = byBot.get("Google-Extended");
  out(
    `  robots.txt   training: ${groupLine("training")}${googleExtended ? ` ${glyph("sep")} Google-Extended ${googleExtended.detail.startsWith("present") ? "present (token, not a crawler)" : "not mentioned"}` : ""}\n`,
  );
  out(`               search:   ${groupLine("search")}\n`);
  out(`               user:     ${groupLine("user")}\n`);

  // ---- live per-UA probe ----
  const liveLine = liveChecks
    .map((c) => {
      const agent = c.check.replace("live fetch as ", "");
      const httpMatch = /HTTP (\d+|unreachable)/.exec(c.detail);
      const code = httpMatch ? httpMatch[1] : "?";
      return `${agent} ${code}${c.status === "fail" ? ` ${glyph("warn")} (robots allows -> CDN/WAF override)` : ""}`;
    })
    .join(` ${glyph("sep")} `);
  out(`  live probe   ${reachable ? liveLine || "no pages reachable" : UNREACHABLE}\n`);

  // ---- JSON-LD ----
  const ldLine = ldChecks
    .map((c) => `${c.check.replace("JSON-LD ", "")} ${c.status === "pass" ? glyph("check") : glyph("cross")}`)
    .join(` ${glyph("sep")} `);
  out(`  JSON-LD      ${reachable ? ldLine || "no pages crawled" : UNREACHABLE}\n`);

  const metaLine = !reachable
    ? UNREACHABLE
    : pages.length === 0
      ? "not checked (no pages crawled)"
      : `noai: ${noaiPresent ? `present ${glyph("warn")}` : `absent ${glyph("check")}`} ${glyph("sep")} noindex: ${noindexChecks.length > 0 ? `present ${glyph("cross")}` : `absent ${glyph("check")}`}`;
  out(`  meta         ${metaLine}\n`);

  // ---- result ----
  // The verdict NAMES what it found, from the same checks array every line
  // above reads. "FAIL · 0 blocked-at-CDN · 3 missing schema" used to be a
  // headline that listed zero failing things.
  out(
    `  Result       ${summary.verdict} ${glyph("sep")} ${summary.reasons.join(` ${glyph("sep")} `)}      (${elapsedS}s, $0)\n`,
  );
  if (!reachable) {
    out(`               Could not fetch ${domain}${crawlError ? ` ${glyph("sep")} ${crawlError}` : ""}. Nothing was measured.\n`);
  }

  if (exitCode !== EXIT_PASS) return exitCode;
  // A clean gate-check is a $0 success — the one place the star ask belongs.
  maybeStarAsk((line) => out(`${line}\n`));
  return EXIT_PASS;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { json: { type: "boolean", default: false } },
  });
  const domain = positionals[0];
  if (!domain) {
    process.stderr.write(`Missing <domain>.\n\n${HELP}\n`);
    return 1;
  }
  const engineMod = await loadGateCheckEngine();
  return runGateCheckWith(engineMod, domain, (l) => process.stdout.write(l), engineMod.safeFetch, {
    json: Boolean(values.json),
  });
}
