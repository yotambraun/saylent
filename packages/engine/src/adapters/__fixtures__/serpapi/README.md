Recorded-shape fixtures for the SerpApi adapter (`../../serpapi.ts`). No real
call produced these: each file is a hand-built response that follows the shape
SerpApi documents (checked 2026-11-02), trimmed to the fields the adapter reads,
with fictional `.example` hosts. Sources:

- `google-inline.json`, `google-token.json`, `google-error.json`, `google-none.json`,
  `ai-overview.json`: https://serpapi.com/ai-overview (inline `text_blocks`, the
  `page_token` + `serpapi_link` form, the `error` form) and
  https://serpapi.com/google-ai-overview-api
- `ai-mode.json`: https://serpapi.com/google-ai-mode-api
- `bing-copilot.json`: https://serpapi.com/bing-copilot-api
- `error-401.json`: https://serpapi.com/api-status-and-error-codes
