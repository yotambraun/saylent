// Operator/dev use: live smoke test — one question per engine, print text
// length + citation count for all four. Run:
//   npx tsx --env-file=.env.local scripts/smoke-adapters.ts
// Missing keys print as flagged results (the engine's partial-coverage behavior).
import { ADAPTERS, ENGINES } from "@saylent/engine/adapters";
import { MODELS } from "@saylent/engine/models";

const QUESTION = "What is the best CDN for a high-traffic SaaS in 2026?";

const CONFIG = {
  chatgpt: { model: MODELS.chatgptAnswer, apiKey: process.env.OPENAI_API_KEY },
  claude: { model: MODELS.claudeAnswer, apiKey: process.env.ANTHROPIC_API_KEY },
  gemini: { model: MODELS.geminiAnswer, apiKey: process.env.GEMINI_API_KEY },
  perplexity: { model: MODELS.perplexityAnswer, apiKey: process.env.PERPLEXITY_API_KEY },
} as const;

async function main() {
  console.log(`Q: ${QUESTION}\n`);
  const results = await Promise.all(
    ENGINES.map(async (engine) => {
      const started = Date.now();
      const r = await ADAPTERS[engine](QUESTION, CONFIG[engine]);
      return { engine, r, ms: Date.now() - started };
    }),
  );
  let okCount = 0;
  for (const { engine, r, ms } of results) {
    if (r.ok) {
      okCount++;
      console.log(
        `${engine.padEnd(10)} ok=${r.ok}  text=${r.text.length} chars  citations=${r.citations.length}  (${ms}ms)`,
      );
      if (r.citations[0]) console.log(`${" ".repeat(11)}first citation: ${r.citations[0].url.slice(0, 90)}`);
    } else {
      console.log(`${engine.padEnd(10)} ok=false  error: ${r.error}  (${ms}ms)`);
    }
  }
  console.log(`\n${okCount}/4 engines answered.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
