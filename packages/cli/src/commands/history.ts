// `saylent history <dir>` — lists past runs for a directory. With --digest it
// is the weekly digest: what changed between the newest run and the newest run
// at least --days older (the same alert rules as `verify --notify`), printed
// or sent with --notify. Schedule it like a verify (cron, a scheduled CI job).
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { formatHistoryTable, scanHistoryDir } from "../history";
import { HELP_OPTION, opt, options } from "../help";
import { notify, parseNotifyFlag, payloadForBundles } from "../notify";
import { loadBundleFileAsync } from "../run";

const HELP = `saylent history <dir> [options]

Lists past runs in a brand's output directory (./<domain>/<YYYY-MM-DD>/), or a
single run.json sitting directly in <dir>.

Options:
${options([
  opt(
    "--digest",
    "What changed between the newest run and the newest run at",
    "least --days older: recommendations gained/lost, new rivals,",
    "new off-site opportunities. $0, reads the saved runs only.",
  ),
  opt("--days <n>", "Digest window in days (default 7)"),
  opt("--notify <a,b>", "Send the digest to slack, webhook and/or email (see verify --help)"),
  opt("--notify-allow-loopback", "Let the webhook or Slack URL point at this machine (see verify --help)"),
  opt("--json", "Print the digest payload (saylent.alert/v1) as JSON"),
  HELP_OPTION,
])}`;

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** The newest run and its digest baseline: the newest run dated at least
 *  `days` before it, else the oldest run. Null with fewer than two runs. */
export function digestPair(dir: string, days: number): { current: string; baseline: string } | null {
  if (!existsSync(dir)) return null;
  const dated = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && DATE_DIR.test(e.name) && existsSync(path.join(dir, e.name, "run.json")))
    .map((e) => e.name)
    .sort();
  if (dated.length < 2) return null;
  const newest = dated[dated.length - 1];
  const cutoff = new Date(Date.parse(`${newest}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const older = dated.slice(0, -1).filter((d) => d <= cutoff);
  const base = older.length ? older[older.length - 1] : dated[0];
  return { current: path.join(dir, newest, "run.json"), baseline: path.join(dir, base, "run.json") };
}

async function runDigest(
  dir: string,
  values: { days?: string; notify?: string; json?: boolean; "notify-allow-loopback"?: boolean },
): Promise<number> {
  const days = values.days === undefined ? 7 : Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    process.stderr.write(`\n  --days ${values.days}: expected a whole number of days, 1-366.\n`);
    return 1;
  }
  const flag = parseNotifyFlag(values.notify);
  if ("error" in flag) {
    process.stderr.write(`\n  ${flag.error}\n`);
    return 1;
  }
  const pair = digestPair(dir, days);
  if (!pair) {
    process.stdout.write(`A digest needs two runs under ${dir} (<YYYY-MM-DD>/run.json); found fewer.\n`);
    return 0;
  }
  const [baseline, current] = await Promise.all([loadBundleFileAsync(pair.baseline), loadBundleFileAsync(pair.current)]);
  if (baseline.brand_model.domain !== current.brand_model.domain) {
    process.stderr.write(`\n  Those runs are for different brands; a digest needs one brand.\n`);
    return 1;
  }
  const reportOf = (runJson: string) => {
    const dirOf = path.dirname(runJson);
    for (const f of ["report.html", "movement.html"]) if (existsSync(path.join(dirOf, f))) return path.join(dirOf, f);
    return runJson;
  };
  const payload = payloadForBundles({
    baseline,
    current,
    type: "digest.weekly",
    reportPath: reportOf(pair.current),
    baselinePath: reportOf(pair.baseline),
  });
  if (values.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    const { alertHeadline } = await import("@saylent/report/alerts");
    process.stdout.write(`\n  ${alertHeadline(payload)}\n`);
    process.stdout.write(`  ${path.basename(path.dirname(pair.baseline))} -> ${path.basename(path.dirname(pair.current))}\n\n`);
    for (const e of payload.events) process.stdout.write(`  - ${e.text}${e.qid ? ` (${e.qid}${e.engine_label ? `, ${e.engine_label}` : ""})` : ""}\n`);
    if (payload.more_events) process.stdout.write(`  - +${payload.more_events} more\n`);
  }
  const allowLoopback = Boolean(values["notify-allow-loopback"]);
  for (const l of await notify(payload, flag.channels, { always: true, allowLoopback })) process.stdout.write(`${l}\n`);
  return 0;
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      digest: { type: "boolean", default: false },
      days: { type: "string" },
      notify: { type: "string" },
      "notify-allow-loopback": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const dir = positionals[0];
  if (!dir) {
    process.stderr.write(`Missing <dir>.\n\n${HELP}\n`);
    return 1;
  }
  if (values.digest) return runDigest(dir, values);
  const rows = scanHistoryDir(dir);
  if (rows.length === 0) {
    // The old message was `No runs found in ${dir}.` — with `dir` = "." that
    // printed a literal double period, and it never said what layout it
    // expected, so nobody could tell a wrong folder from an empty one.
    process.stdout.write(
      `No runs found under ${dir} (expected ${dir}/<YYYY-MM-DD>/run.json or a run.json directly inside it).\n`,
    );
    return 0;
  }
  for (const line of formatHistoryTable(rows)) process.stdout.write(`${line}\n`);
  return 0;
}
