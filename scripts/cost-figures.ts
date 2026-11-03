// Every cost figure Saylent publishes, recomputed from the code. $0: no network,
// no LLM call, no key read.
//
//   npx tsx --tsconfig scripts/tsconfig.json scripts/cost-figures.ts
//
// 1. TYPICAL_ANSWER_USAGE: the median per-answer usage of the bundled sample run
//    (examples/kestrel/run.json), per engine.
// 2. ROLE_CALL_USAGE: the input size of one judge / drafter / brand-model call,
//    measured by running the engine's own prompt builders with a stub caller
//    that records what it is handed (judge: the sample run's answers; drafter:
//    the sample run's fixes; brand: eight pages at the prompt's text cap), at
//    about 4 characters per token. Replies are priced at each role's max_tokens.
// 3. The estimator's smoke/full range for the shipped 23-question set across
//    four engines (src/lib/question-options.ts estimateRunCost), and the
//    published sentences that range rounds to (src/lib/cost-copy.ts).
//
// rates.ts and cost-copy.ts carry the outputs as constants; cost-figures.test.ts
// re-measures and fails when they drift.
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildBrandModel } from "@saylent/engine/brandModel";
import { draftArtifacts } from "@saylent/engine/fixes";
import { JUDGE_MAX_TOKENS, judgeOne } from "@saylent/engine/judge";
import { resolveRoles } from "@saylent/engine/models";
import { PROFILES } from "@saylent/engine/profiles";
import { generateQuestions } from "@saylent/engine/questions";
import type { CallUsage, CostEngine, CostRole } from "@saylent/engine/rates";
import { ALL_ENGINES } from "@saylent/engine/engines";
import type { AnswerRow, BrandModel, Fix, SitePage } from "@saylent/engine/types";
import { estimateRunCost, toDraftQuestions } from "../src/lib/question-options";
import { RECORDED_SMOKE_RUNS_USD, formatRange, publishedRange } from "../src/lib/cost-copy";

const SAMPLE = path.join(process.cwd(), "examples", "kestrel", "run.json");
const CHARS_PER_TOKEN = 4;

interface SampleBundle {
  brand_model: BrandModel;
  answers: (AnswerRow & { usage?: { input_tokens?: number; output_tokens?: number; searches?: number } })[];
  fixes: Fix[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const tokens = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);

function loadSample(): SampleBundle {
  return JSON.parse(readFileSync(SAMPLE, "utf8")) as SampleBundle;
}

export function measureTypicalAnswerUsage(bundle = loadSample()): Record<CostEngine, CallUsage> {
  const out = {} as Record<CostEngine, CallUsage>;
  for (const engine of ["chatgpt", "claude", "gemini", "perplexity"] as CostEngine[]) {
    const rows = bundle.answers.filter((a) => a.engine === engine && a.ok && a.usage);
    out[engine] = {
      input_tokens: median(rows.map((a) => a.usage?.input_tokens ?? 0)),
      output_tokens: median(rows.map((a) => a.usage?.output_tokens ?? 0)),
      searches: median(rows.map((a) => a.usage?.searches ?? 0)),
    };
  }
  return out;
}

export async function measureRoleCallUsage(bundle = loadSample()): Promise<Record<CostRole, CallUsage>> {
  const bm = bundle.brand_model;

  // judge — one call per ok answer (the stub returns null, so judgeOne retries
  // once with the identical prompt; the first call per answer is the sample).
  const judgeChars: number[] = [];
  const roles = resolveRoles({ anthropic: true, openai: true });
  for (const a of bundle.answers.filter((x) => x.ok)) {
    let first = true;
    await judgeOne(a, bm, async (_family, args) => {
      if (first) judgeChars.push(args.system.length + args.user.length);
      first = false;
      return null;
    }, roles);
  }

  // drafter — the sample's fixes with their drafted artifacts stripped, drafted
  // at the full profile's draftTop.
  const drafterChars: number[] = [];
  const undrafted = bundle.fixes.map((f) => ({ ...f, artifact: undefined }));
  await draftArtifacts(undrafted, bm, async (args) => {
    drafterChars.push(args.system.length + args.user.length);
    return "draft";
  }, PROFILES.full.draftTop);

  // brand model — the prompt at its cap: eight pages of 2,500 characters each,
  // which the builder trims at 16,000 characters of website text.
  let brandChars = 0;
  const pages: SitePage[] = Array.from({ length: 8 }, (_, i) => ({
    url: `https://example.com/page-${i}`,
    status: 200,
    title: `Page ${i}`,
    text: "x".repeat(2500),
    ldTypes: [],
    metaRobots: "",
  })) as unknown as SitePage[];
  await buildBrandModel({ brand: bm.brand, domain: bm.domain }, pages, async (args) => {
    brandChars = args.system.length + args.user.length;
    return null;
  });

  return {
    judge: { input_tokens: tokens(median(judgeChars)), output_tokens: JUDGE_MAX_TOKENS },
    drafter: { input_tokens: tokens(median(drafterChars)), output_tokens: 2200 },
    brand: { input_tokens: tokens(brandChars), output_tokens: 1000 },
  };
}

export function computeRanges() {
  const brand: BrandModel = {
    brand: "Kestrel Uptime",
    domain: "kestreluptime.com",
    aliases: ["Kestrel Uptime", "kestrel"],
    category: "uptime monitoring",
    icp: "small SaaS teams",
    products: [],
    value_props: [],
    problems: ["missed outages", "noisy alerts"],
    competitors: ["Upcheck", "Beacon Uptime"],
    language: "en",
  };
  const shipped = toDraftQuestions(generateQuestions(brand, 2026));
  const four = [...ALL_ENGINES];
  const full = estimateRunCost({ questions: shipped, engines: four, samples: 2, profile: "full" });
  const smoke = estimateRunCost({ questions: shipped, engines: four, samples: 1, profile: "smoke" });
  return {
    full: { lowUsd: full.lowUsd, highUsd: full.highUsd },
    smoke: { lowUsd: smoke.lowUsd, highUsd: smoke.highUsd },
  };
}

async function main() {
  const answers = measureTypicalAnswerUsage();
  const roles = await measureRoleCallUsage();
  const { full, smoke } = computeRanges();
  const out = (s: string) => process.stdout.write(`${s}\n`);
  out("TYPICAL_ANSWER_USAGE (median of examples/kestrel/run.json):");
  out(JSON.stringify(answers, null, 2));
  out("\nROLE_CALL_USAGE (input measured from the engine's prompts, output at max_tokens):");
  out(JSON.stringify(roles, null, 2));
  out("\nEstimator, shipped 23-question set, four engines:");
  out(`  full  (2 samples): $${full.lowUsd.toFixed(2)} - $${full.highUsd.toFixed(2)}`);
  out(`  smoke (1 sample):  $${smoke.lowUsd.toFixed(2)} - $${smoke.highUsd.toFixed(2)}`);
  out("\nPublished (rounded outward to $0.10; smoke widened to the recorded runs):");
  out(`  full:  ${formatRange(publishedRange(full))}`);
  out(`  smoke: ${formatRange(publishedRange(smoke, RECORDED_SMOKE_RUNS_USD))}`);
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("scripts", "cost-figures.ts"))) {
  void main();
}
