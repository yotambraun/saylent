// `saylent models` — the resolved model table for the keys,
// config and env this machine actually has, with the SOURCE of every choice.
// Read-only: no crawl, no LLM call, no network, $0.
//
// Precedence (models.ts owns it, this command only prints it):
//   CLI flag (--judge / --model role=id) > MODEL_* env var
//   > saylent.config `models` > the shipped registry default.
import { parseArgs } from "node:util";
import type { EngineConfigModule, EngineModule } from "../engine-loader";
import { loadEngine, loadEngineConfig } from "../engine-loader";
import { PROVIDERS, resolveKeys } from "../keys";
import { MODEL_FLAG_HELP, MODEL_FLAG_OPTIONS, parseModelFlags } from "../model-flags";
import { formatJudgeMode } from "../preflight";
import { glyph } from "../glyphs";
import { HELP_OPTION } from "../help";

const HELP = `saylent models [options]

Print the model registry as it resolves right now: which model serves which
role, and where that choice came from. No network, no keys needed, $0.

Options:
${MODEL_FLAG_HELP}
${HELP_OPTION}

Precedence: flag > MODEL_* env var > saylent.config models > shipped default.`;

const ROLE_ORDER = [
  "brand",
  "brandOpenai",
  "drafter",
  "drafterOpenai",
  "judgeAnthropic",
  "judgeOpenai",
  "chatgptAnswer",
  "claudeAnswer",
  "geminiAnswer",
  "perplexityAnswer",
] as const;

export async function runModelsCommandWith(
  engineMod: Pick<EngineModule, "resolveModelTable" | "resolveRoles" | "availableFamilies" | "judgeFamilies" | "familyOfModel">,
  configMod: Pick<EngineConfigModule, "loadConfig">,
  argv: string[],
  out: (line: string) => void = (l) => process.stdout.write(l),
): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(`${HELP}\n`);
    return 0;
  }

  const { values } = parseArgs({ args: argv, allowPositionals: true, options: { ...MODEL_FLAG_OPTIONS } });

  let flags;
  try {
    flags = parseModelFlags(values, engineMod.familyOfModel);
  } catch (e) {
    process.stderr.write(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  const cwd = process.cwd();
  const { config } = await configMod.loadConfig(cwd);
  const { keys } = resolveKeys(cwd);
  const table = engineMod.resolveModelTable({ flags, config: config.models });
  const available = { openai: Boolean(keys.openai), anthropic: Boolean(keys.anthropic) };
  const roles = engineMod.resolveRoles(available, { flags, config: config.models });
  const judges = engineMod.judgeFamilies(roles);

  out(`\nSaylent ${glyph("sep")} models\n\n`);
  out(`  Keys      ${PROVIDERS.map((p) => `${p.label} ${keys[p.id] ? glyph("check") : glyph("ndash")}`).join("   ")}\n`);
  out(`  Judge     ${formatJudgeMode(keys)}\n`);
  out(`  Config    ${config.models ? "saylent.config models applied" : "no saylent.config models block"}\n\n`);

  const rows = ROLE_ORDER.map((role) => {
    const choice = table[role];
    return [choice.label, choice.model, choice.source, choice.envVar];
  });
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  out(`  ${"role".padEnd(widths[0])}  ${"model".padEnd(widths[1])}  ${"source".padEnd(widths[2])}  env override\n`);
  for (const r of rows) {
    out(`  ${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padEnd(widths[2])}  ${r[3]}\n`);
  }

  out("\n  This run would judge:\n");
  for (const engine of ["chatgpt", "claude", "gemini", "perplexity"] as const) {
    const assignment = roles.roles[`judge:for-${engine}`];
    out(`    ${engine.padEnd(11)} ${assignment.model}  (${judges[engine]})\n`);
  }
  if (roles.selfJudged.length > 0) {
    out(
      `\n  Warning   ${roles.selfJudged.join(", ")}: the judge model is the same model that answered — that is self-judging, not an independent check.\n`,
    );
  }
  out(
    `\n  Sources   flag = --judge/--model ${glyph("sep")} env = MODEL_* ${glyph("sep")} config = saylent.config models ${glyph("sep")} default = shipped registry\n`,
  );
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const [engineMod, configMod] = await Promise.all([loadEngine(), loadEngineConfig()]);
  return runModelsCommandWith(engineMod, configMod, argv);
}
