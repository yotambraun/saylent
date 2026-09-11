// `saylent keys test` — verify each configured key with a free call. fetch is
// injectable so tests exercise every branch with zero network traffic.
import type { Provider } from "./keys";
import { redactSecrets } from "./redact";

export type FetchLike = typeof fetch;

export interface KeyTestResult {
  provider: Provider;
  ok: boolean | null; // null = "no free check, key format validated" (perplexity)
  detail: string;
}

/** Perplexity keys look like `pplx-<hex>`; there is no free endpoint to call. */
function looksLikePerplexityKey(key: string): boolean {
  return /^pplx-[A-Za-z0-9]{16,}$/.test(key);
}

export async function testProviderKey(
  provider: Provider,
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<KeyTestResult> {
  try {
    if (provider === "openai") {
      const res = await fetchImpl("https://api.openai.com/v1/models", {
        headers: { authorization: `Bearer ${key}` },
      });
      return { provider, ok: res.ok, detail: res.ok ? "valid" : `HTTP ${res.status}` };
    }
    if (provider === "anthropic") {
      const res = await fetchImpl("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      });
      return { provider, ok: res.ok, detail: res.ok ? "valid" : `HTTP ${res.status}` };
    }
    if (provider === "gemini") {
      const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      );
      return { provider, ok: res.ok, detail: res.ok ? "valid" : `HTTP ${res.status}` };
    }
    // perplexity: no free endpoint — validate the key's known format instead.
    const looksValid = looksLikePerplexityKey(key);
    return {
      provider,
      ok: null,
      detail: looksValid
        ? "no free check, key format validated"
        : "no free check; key format looks wrong (expected pplx-...)",
    };
  } catch (e) {
    // The Gemini check puts the key in the URL; some fetch/TypeError
    // messages echo the request URL back verbatim — redact defensively so a
    // network failure can never print the key.
    const raw = e instanceof Error ? e.message : String(e);
    return { provider, ok: false, detail: redactSecrets(raw, [key]) };
  }
}
