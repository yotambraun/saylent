// The shipped default model id for every registry slot (METHODOLOGY.md (model
// registry)). A pure constant with no imports, so client-safe modules (the rate
// table in rates.ts, the report's cost drawer) can read the defaults without
// pulling in models.ts's env resolution. models.ts reads its fallbacks from here.
//
// Verified 2026-11-02 against each provider's official model and pricing pages;
// the sources sit next to the prices in rates.ts.

export const DEFAULT_MODELS = {
  chatgptAnswer: "gpt-6.1-sol",
  claudeAnswer: "claude-sonnet-5-5",
  geminiAnswer: "gemini-3.6-flash",
  perplexityAnswer: "sonar",
  judgeAnthropic: "claude-haiku-5-5",
  judgeOpenai: "gpt-6-luna",
  brand: "claude-haiku-5-5",
  drafter: "claude-sonnet-5-5",
  brandOpenai: "gpt-6-luna",
  drafterOpenai: "gpt-6.1-sol",
} as const;

export type DefaultModelSlot = keyof typeof DEFAULT_MODELS;
