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
import { testProviderKey, type KeyTestResult } from "../../packages/cli/src/key-test";
import type { Provider } from "../../packages/cli/src/keys";
import {
  getEffectiveProviderKeys,
  getKeySources,
  type KeySource,
  PROVIDER_META,
} from "./provider-settings";

export interface ProviderStatus {
  provider: Provider;
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

export type ProviderTestResult = Pick<KeyTestResult, "provider" | "ok" | "detail"> & {
  label: string;
};

/** "Test" — the free per-provider check against whichever keys this deployment can
 *  actually use (env or console). An unconfigured provider is reported without a
 *  network call. `only` narrows it to one provider (the per-row Test button). */
export async function testConfiguredProviders(only?: Provider[]): Promise<ProviderTestResult[]> {
  const keys = await getEffectiveProviderKeys();
  const results: ProviderTestResult[] = [];
  for (const { id, label } of PROVIDER_META) {
    if (only && !only.includes(id)) continue;
    const key = keys[id];
    if (!key) {
      results.push({ provider: id, label, ok: false, detail: "not configured" });
      continue;
    }
    const result = await testProviderKey(id, key);
    results.push({ provider: result.provider, label, ok: result.ok, detail: result.detail });
  }
  return results;
}
