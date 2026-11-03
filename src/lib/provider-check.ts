import "server-only";
// Operator tools stay and are marketed — the admin
// console's "Providers" card, extended to cover console-managed keys.
// Server-only: it never returns a key value, only presence + provenance + a masked
// test result, so the console can show "which keys this deployment can use, and
// where each one came from" without leaking a secret to the client bundle or the
// page HTML.
//
// Presence is no longer "is the env var set?" but the EFFECTIVE
// resolution (env wins, else the console-stored encrypted key) — provider-settings.ts
// owns that rule and the provider list, so there is one source of truth.
//
// The live per-provider check is the SAME free call the CLI makes (`saylent keys
// test`, packages/cli/src/key-test.ts) — reused directly here rather than
// duplicated, since it is pure (takes the key as a parameter, no CLI-only I/O).
//
// SerpApi (the answer surfaces' SERP-data provider) is not one of the CLI's
// key-test providers, so its free check lives here: SerpApi's Account API,
// `GET https://serpapi.com/account.json?api_key=…`, which SerpApi documents as
// "free of charge, and using it will not be counted toward your monthly quota"
// (https://serpapi.com/account-api, read 2026-11-02). Its response echoes the
// api_key and the account email back, so only two numbers are ever read from it.
import { testProviderKey, type FetchLike } from "../../packages/cli/src/key-test";
import { redactSecrets } from "../../packages/cli/src/redact";
import {
  getEffectiveProviderKeys,
  getKeySources,
  type KeySource,
  PROVIDER_META,
  type ProviderId,
} from "./provider-settings";

export interface ProviderStatus {
  provider: ProviderId;
  label: string;
  /** true/false only — never the key value. */
  configured: boolean;
  /** "env" | "console" | "absent" — which layer supplies it. */
  source: KeySource;
  /** the env var that would override the console (shown as the read-only reason). */
  envVar: string;
}

/** Presence + provenance only, for the card's resting state — no network call and
 *  no decryption (the stored-key check is presence, not a read). */
export async function listProviderStatus(): Promise<ProviderStatus[]> {
  const sources = await getKeySources();
  return PROVIDER_META.map(({ id, envVar, label }) => ({
    provider: id,
    label,
    configured: sources[id] !== "absent",
    source: sources[id],
    envVar,
  }));
}

export interface ProviderTestResult {
  provider: ProviderId;
  /** null = no free check exists, the key's format was validated instead */
  ok: boolean | null;
  detail: string;
  label: string;
}

export const SERPAPI_ACCOUNT_URL = "https://serpapi.com/account.json";

/** The free SerpApi check: the Account API costs no search. Reports validity and
 *  the searches left this month, nothing else (the response also carries the key
 *  and the account email, which are deliberately never read). A thrown error is
 *  redacted, since the key travels in the query string. */
export async function testSerpApiKey(
  key: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetchImpl(`${SERPAPI_ACCOUNT_URL}?api_key=${encodeURIComponent(key)}`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => null)) as {
      error?: unknown;
      total_searches_left?: unknown;
      plan_searches_left?: unknown;
    } | null;
    if (body && typeof body.error === "string") return { ok: false, detail: "rejected by SerpApi" };
    const left =
      typeof body?.total_searches_left === "number"
        ? body.total_searches_left
        : typeof body?.plan_searches_left === "number"
          ? body.plan_searches_left
          : null;
    return { ok: true, detail: left === null ? "valid" : `valid, ${left} searches left` };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: redactSecrets(raw, [key, encodeURIComponent(key)]) };
  }
}

/** "Test" — the free per-provider check against whichever keys this deployment can
 *  actually use (env or console). An unconfigured provider is reported without a
 *  network call. `only` narrows it to one provider (the per-row Test button). */
export async function testConfiguredProviders(only?: ProviderId[]): Promise<ProviderTestResult[]> {
  const keys = await getEffectiveProviderKeys();
  const results: ProviderTestResult[] = [];
  for (const { id, label } of PROVIDER_META) {
    if (only && !only.includes(id)) continue;
    const key = keys[id];
    if (!key) {
      results.push({ provider: id, label, ok: false, detail: "not configured" });
      continue;
    }
    if (id === "serpapi") {
      const serp = await testSerpApiKey(key);
      results.push({ provider: id, label, ok: serp.ok, detail: serp.detail });
      continue;
    }
    const result = await testProviderKey(id, key);
    results.push({ provider: id, label, ok: result.ok, detail: result.detail });
  }
  return results;
}
