// `saylent questions <domain>` — see the buyer questions
// BEFORE you spend anything on answering them, then edit them and hand the file
// back to `saylent audit --questions`.
//
// Cost: ONE brand-model call (about $0.02 of your own credits) plus a free
// crawl, because the questions are generated FROM the brand model (category,
// ICP, problems, rivals). `--no-brand-model` skips both and generates from the
// template defaults with the domain name, for $0 and no keys at all.
//
// Split into runQuestionsCommandWith(engineMod, configMod, argv, io) and
// run(argv) for the same reason audit.ts is split — see run.ts's TESTABILITY
// NOTE (a dynamic import() of the engine barrel hangs under vitest).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { ResolvedSampling } from "@saylent/engine";
import type { SamplingConfig } from "@saylent/engine/config";
import type { EngineConfigModule } from "../engine-loader";
import { loadEngine, loadEngineConfig } from "../engine-loader";
import { applyKeysToEnv, hasMinimumKeys, missingKeysError, resolveKeys, type KeyMap } from "../keys";
import { confirmRun, formatSamplingLine, recordSpend } from "../preflight";
import { parseProfileName } from "../validate";
import { formatQuestionLines, previewQuestions, typeCounts, type PreviewEngine } from "../question-preview";
import { toQuestionsJson, SCORED_TYPES } from "../questions-file";
import { glyph } from "../glyphs";
import { HELP_OPTION, opt, options } from "../help";

const HELP = `saylent questions <domain> [options]

Print the buyer questions an audit would ask, and write them to a file you can
edit. Cost: one brand-model call (about $0.02 of your credits) plus a free
crawl. Nothing is asked of any answer engine.

Options:
${options([
  opt("--brand <name>", "Brand name (default: the domain)"),
  opt("--competitors <a,b>", "Comma-separated competitor domains/names"),
  opt(
    "--profile <profile>",
    "Which profile's sampling line to print: smoke (default)",
    "or full. Same resolution as \`audit\`: flag > AUDIT_PROFILE >",
    "saylent.config profile. The printed question library",
    "itself is the full one either way.",
  ),
  opt("--out <file>", "Where to write the set (default: ./questions.json)"),
  opt(
    "--no-brand-model",
    "Skip the crawl + brand-model call: generate from the",
    "template defaults and the domain name. $0, no keys.",
  ),
  opt("--print", "Print only, write no file"),
  opt("--yes", 'Skip the "Run it?" confirmation'),
  HELP_OPTION,
])}

Edit the file, then: saylent audit <domain> --questions questions.json
Only ${SCORED_TYPES.join(" and ")} questions count toward the score and the
recommended band; every other type (including "custom") is asked, judged and
reported but never scored.`;

export interface QuestionsCommandIo {
  confirmIo?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream };
}

export async function runQuestionsCommandWith(
  engineMod: PreviewEngine & {
    ROLE_COST_CENTS: { brand: number };
    PROFILES: Record<string, unknown>;
    resolveSampling: (
      profile: "full" | "smoke",
      opts?: { flag?: number; env?: string; config?: SamplingConfig | null },
    ) => ResolvedSampling;
  },
  configMod: Pick<EngineConfigModule, "loadConfig">,
  argv: string[],
  io: QuestionsCommandIo = {},
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      brand: { type: "string" },
      competitors: { type: "string" },
      profile: { type: "string" },
      out: { type: "string" },
      "no-brand-model": { type: "boolean", default: false },
      print: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });

  const domain = positionals[0];
  if (!domain) {
    process.stderr.write(`Missing <domain>.\n\n${HELP}\n`);
    return 1;
  }

  const cwd = process.cwd();
  // A saylent.config with a bad value is a user mistake, not a crash: the
  // schema's own message already names the key and the accepted values, so it
  // is printed like every other refusal (2-space indent, exit 1, no stack).
  let config;
  try {
    ({ config } = await configMod.loadConfig(cwd));
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const brandName = values.brand ?? domain;
  const competitors = (values.competitors?.split(",").map((c) => c.trim()).filter(Boolean) ??
    config.competitors ??
    []) as string[];
  const useBrandModel = !values["no-brand-model"];
  const outFile = path.resolve(cwd, values.out ?? "questions.json");
  const version = engineMod.templateSetVersion(config.questionTemplates);
  // No --samples flag on this command (only audit/verify take it), but the
  // sampling line must quote the SAME profile `audit` would run — this command
  // is the $0 front door, and it used to hardcode "full" and print "2x scored
  // questions (profile default)" for a run that would actually be smoke at 1x.
  // Resolution is audit's: --profile > AUDIT_PROFILE > saylent.config > smoke.
  let profile: "full" | "smoke";
  let resolvedSampling: ResolvedSampling;
  try {
    const names = Object.keys(engineMod.PROFILES) as ("full" | "smoke")[];
    profile =
      parseProfileName(values.profile, names, "flag") ??
      parseProfileName(process.env.AUDIT_PROFILE, names, "env") ??
      parseProfileName(config.profile, names, "config") ??
      "smoke";
    resolvedSampling = engineMod.resolveSampling(profile, {
      env: process.env.AUDIT_SAMPLES,
      config: config.sampling ?? null,
    });
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  process.stdout.write(`\nSaylent ${glyph("sep")} questions ${glyph("sep")} ${domain}\n\n`);
  if (useBrandModel) {
    const cents = engineMod.ROLE_COST_CENTS.brand;
    process.stdout.write(
      `  Cost      one brand-model call, about $${(cents / 100).toFixed(2)} of your credits (the crawl is free)\n`,
    );
  } else {
    process.stdout.write("  Cost      $0 — template defaults, no crawl, no model call\n");
  }
  process.stdout.write(`  Templates ${config.questionTemplates ? `saylent.config overrides ${glyph("sep")} ` : ""}set v${version}\n`);
  process.stdout.write(`  Sampling  ${formatSamplingLine(resolvedSampling, profile)}\n`);
  if (!values.print) process.stdout.write(`  Output    ${outFile}\n`);

  if (useBrandModel) {
    const { keys } = resolveKeys(cwd);
    const keyMap: KeyMap = keys;
    if (!hasMinimumKeys(keyMap)) {
      process.stderr.write(
        `\n${missingKeysError().message}\n\nOr run it for $0: saylent questions ${domain} --no-brand-model\n`,
      );
      return 1;
    }
    applyKeysToEnv(keyMap);
    if (!values.yes) {
      process.stdout.write("\n");
      const ok = await confirmRun(io.confirmIo);
      if (!ok) {
        process.stdout.write("Aborted. Nothing was sent to any provider.\n");
        return 0;
      }
    }
  }

  const preview = await previewQuestions(engineMod, {
    domain,
    brandName,
    competitors,
    useBrandModel,
    questionTemplates: config.questionTemplates,
    onStage: (stage) =>
      process.stdout.write(
        stage === "crawl"
          ? `\n  01 crawl          reading the site${glyph("ellipsis")}\n`
          : `  02 brand model    building it${glyph("ellipsis")}\n`,
      ),
  });
  if (useBrandModel) recordSpend(engineMod.ROLE_COST_CENTS.brand / 100);

  const { brandModel: bm, questions } = preview;
  const scoredTotal = questions.filter((q) => (SCORED_TYPES as readonly string[]).includes(q.qtype)).length;
  process.stdout.write(
    `\n  ${questions.length} questions (${typeCounts(questions)}) ${glyph("sep")} "${bm.brand}" ${glyph("sep")} ${bm.category} ${glyph("sep")} for ${bm.icp}${useBrandModel ? "" : "  (template defaults)"}\n\n`,
  );
  process.stdout.write(`${formatQuestionLines(questions, SCORED_TYPES)}\n`);
  process.stdout.write(
    `\n  Scored    ${scoredTotal} of ${questions.length} (${SCORED_TYPES.join(" + ")} only; the rest are asked and reported, never scored)\n` +
      heldBackRivalsLine(questions),
  );

  if (!values.print) {
    mkdirSync(path.dirname(outFile), { recursive: true });
    const json = toQuestionsJson(bm.brand, domain, preview.version, questions);
    writeFileSync(outFile, `${JSON.stringify(json, null, 2)}\n`, "utf8");
    process.stdout.write(`  Written   ${outFile}\n`);
    process.stdout.write(
      `  Next      edit it, then: saylent audit ${domain} --questions ${path.relative(cwd, outFile) || outFile}\n`,
    );
  }
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const [engineMod, configMod] = await Promise.all([loadEngine(), loadEngineConfig()]);
  return runQuestionsCommandWith(engineMod, configMod, argv);
}

/** One line when templates that need a named rival were held back (engine
 *  questions.ts: no competitor given and none detected yet). */
export function heldBackRivalsLine(questions: readonly unknown[]): string {
  const n = (questions as { skipped?: { reason: string; count: number } }).skipped?.count ?? 0;
  if (!n) return "";
  return `  Rivals    ${n} head-to-head question${n === 1 ? "" : "s"} held back: name a rival with --competitors, or the audit adds them once it detects one on the site\n`;
}
