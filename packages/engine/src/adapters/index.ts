// the spec (see METHODOLOGY.md) — one file per engine, one shared contract.
import type { Engine } from "../types";
import type { Ask } from "./shared";
import { askChatgpt } from "./chatgpt";
import { askClaude } from "./claude";
import { askGemini } from "./gemini";
import { askPerplexity } from "./perplexity";

export type { AdapterConfig, Ask, AskResult } from "./shared";

export const ADAPTERS: Record<Engine, Ask> = {
  chatgpt: askChatgpt,
  claude: askClaude,
  gemini: askGemini,
  perplexity: askPerplexity,
};

export const ENGINES: Engine[] = ["chatgpt", "claude", "gemini", "perplexity"];
