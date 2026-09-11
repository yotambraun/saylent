// `saylent keys` — list|set <provider>|test|remove <provider>.
import {
  keyHelpLines,
  PROVIDERS,
  readConfigFile,
  readMasked,
  resolveKeys,
  saveKeys,
  writeConfigFile,
  type Provider,
} from "../keys";
import { testProviderKey } from "../key-test";
import { formatJudgeMode } from "../preflight";
import { maskKey } from "../redact";
import { glyph } from "../glyphs";
import { HELP_OPTION } from "../help";

const PROVIDER_IDS = PROVIDERS.map((p) => p.id).join("|");

// The most likely reason anyone types `saylent keys` is that they have no key
// yet, so the example that SETS one comes first — the old help opened with
// `list`, and the first-run error used to send people here saying "run
// `saylent keys`", which prints a list and sets nothing.
const HELP = `saylent keys <subcommand>

Set your first key:
  saylent keys set openai        (or anthropic — one of the two is enough)

Subcommands:
  list                 List configured providers (masked) and the judge mode
  set <provider>       Set a key interactively (${PROVIDER_IDS})
  test                 Verify every configured key with a free call
  remove <provider>    Remove a stored key

Keys resolve env > .env in this folder > ~/.saylent/config.json, and are never
accepted as a command-line flag (a key on the command line ends up in your
shell history).

Options:
${HELP_OPTION}`;

/** A key is typed like a password: masked per keystroke (keys.ts readMasked),
 *  plain echo only when the terminal cannot be put into raw mode. */
function readLine(question: string): Promise<string> {
  return readMasked({ input: process.stdin, output: process.stdout }, question);
}

function isProvider(v: string | undefined): v is Provider {
  return Boolean(v) && PROVIDERS.some((p) => p.id === v);
}

export async function run(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const [sub, arg] = argv;

  if (sub === "list") {
    const { keys, sources } = resolveKeys(process.cwd());
    process.stdout.write(`\nSaylent ${glyph("sep")} keys\n\n`);
    for (const p of PROVIDERS) {
      const value = keys[p.id];
      const line = value ? `${maskKey(value)}  (${sources[p.id]})` : "not set";
      process.stdout.write(`  ${p.label.padEnd(11)} ${line}\n`);
    }
    // SINGLE-PROVIDER MODE: one of OpenAI/Anthropic is enough to run; the second
    // one buys cross-family judging. Say which mode these keys give you.
    process.stdout.write(`\n  Judge       ${formatJudgeMode(keys)}\n`);
    // A screen that says four things are missing has to say how to fix it —
    // with the command that actually sets a key and the console that mints one.
    if (!keys.openai && !keys.anthropic) {
      process.stdout.write("\n  Next\n");
      for (const line of keyHelpLines("    ")) process.stdout.write(`${line}\n`);
    }
    return 0;
  }

  if (sub === "set") {
    if (!isProvider(arg)) {
      process.stderr.write(`Usage: saylent keys set <provider>  (openai|anthropic|gemini|perplexity)\n`);
      return 1;
    }
    const spec = PROVIDERS.find((p) => p.id === arg)!;
    const value = await readLine(`  ${spec.label} key (${spec.hint}): `);
    if (!value) {
      process.stderr.write("No key entered. Nothing saved.\n");
      return 1;
    }
    const existing = readConfigFile().keys ?? {};
    saveKeys(existing, { [arg]: value });
    process.stdout.write(`  Saved to ~/.saylent/config.json (chmod 600).\n`);
    return 0;
  }

  if (sub === "test") {
    const { keys } = resolveKeys(process.cwd());
    let anyFailed = false;
    for (const p of PROVIDERS) {
      const value = keys[p.id];
      if (!value) {
        process.stdout.write(`  ${p.label.padEnd(11)} not set\n`);
        continue;
      }
      const result = await testProviderKey(p.id, value);
      if (result.ok === false) anyFailed = true;
      const mark = result.ok === true ? glyph("check") : result.ok === false ? glyph("cross") : "-";
      process.stdout.write(`  ${p.label.padEnd(11)} ${mark} ${result.detail}\n`);
    }
    return anyFailed ? 1 : 0;
  }

  if (sub === "remove") {
    if (!isProvider(arg)) {
      process.stderr.write(`Usage: saylent keys remove <provider>  (openai|anthropic|gemini|perplexity)\n`);
      return 1;
    }
    const existing = readConfigFile();
    const keys = { ...(existing.keys ?? {}) };
    delete keys[arg];
    writeConfigFile({ ...existing, keys });
    process.stdout.write(`  Removed ${arg}.\n`);
    return 0;
  }

  process.stderr.write(`Unknown subcommand: ${sub}\n\n${HELP}\n`);
  return 1;
}
