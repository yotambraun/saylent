import "server-only";
// Operator flexibility in the app — the one place the
// app resolves WHICH provider key and WHICH model each role runs on, given three
// layers the operator can change independently:
//
//   env (a deploy-time variable)  >  console (migration 0042, encrypted at rest)
//   >  the shipped registry default (packages/engine/src/models.ts)
//
// ENV WINS, ALWAYS. A key or MODEL_* set in the environment is the deployment
// owner's explicit instruction; the console can only fill a gap, never override it.
// That rule is what makes the console safe to hand to a second operator, and it is
// why an env-set provider shows as read-only on /admin/providers.
//
// A KEY IS NEVER READ BACK TO A HUMAN. The page renders `masked()` — three states
// ("present (env)" / "present (console)" / "absent") and nothing else. Plaintext
// leaves this module in exactly two directions: as the RETURN VALUE of
// getEffectiveProviderKeys() (handed straight to the call that needs it) and into
// the free "Test" call. It is never written to process.env (a key
// published into the process environment survives its own revocation — the next
// resolution sees it as an "env" key and env wins, so removing it from the console
// changes nothing until the instance is recycled), never returned to a client
// component, never logged, never audited.
//
// server-only: this module holds the service-role client and
// decrypted secrets — the build fails if it is ever pulled into a client bundle.
import { cache } from "react";
import {
  injectModelOverrides,
  type ModelOverrides,
  type ModelRole,
  type ModelSource,
  resolveModelTable,
} from "@saylent/engine/models";
import { log } from "./log";
import { createAdminClient } from "./supabase/admin";

// ── providers ───────────────────────────────────────────────────────────────
export type ProviderId = "openai" | "anthropic" | "gemini" | "perplexity";

/** The canonical provider list — id, env var and label in ONE place so
 *  provider-check.ts, the console and migration 0042's CHECK cannot drift. */
export const PROVIDER_META: { id: ProviderId; envVar: string; label: string }[] = [
  { id: "openai", envVar: "OPENAI_API_KEY", label: "OpenAI" },
  { id: "anthropic", envVar: "ANTHROPIC_API_KEY", label: "Anthropic" },
  { id: "gemini", envVar: "GEMINI_API_KEY", label: "Gemini" },
  { id: "perplexity", envVar: "PERPLEXITY_API_KEY", label: "Perplexity" },
];

export const PROVIDER_IDS: ProviderId[] = PROVIDER_META.map((p) => p.id);

export function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

/** Where a resolved key came from. "absent" = this deployment cannot use it. */
export type KeySource = "env" | "console" | "absent";

export type ProviderKeys = Partial<Record<ProviderId, string>>;
export type KeySources = Record<ProviderId, KeySource>;

// ── APP_SECRET ──────────────────────────────────────────────────────────────
/** pgcrypto's passphrase. Unset → console key management is simply OFF: the page
 *  says so, keys stay env-only, and MODELS stay editable (they are not secret).
 *  16 chars is the same floor migration 0042 enforces, checked here too so the
 *  console can explain the problem instead of surfacing a Postgres exception. */
export const APP_SECRET_MIN_LENGTH = 16;

export function appSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.APP_SECRET?.trim();
  if (!raw || raw.length < APP_SECRET_MIN_LENGTH) return null;
  return raw;
}

/** True when APP_SECRET is present but too short — worth naming on the page,
 *  because "I set it and nothing happened" is the confusing case. */
export function appSecretTooShort(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.APP_SECRET?.trim();
  return Boolean(raw) && (raw as string).length < APP_SECRET_MIN_LENGTH;
}

// ── reads (cached per request; see the cache() note) ────────────────────────
// React's cache() memoizes per REQUEST inside the app. Outside a request scope
// (the Inngest worker) it degrades to a plain call — which is what we want there:
// one resolution per run, no cross-run key caching.

/** provider -> ciphertext-decrypted key, or nothing. Never throws: a wrong/rotated
 *  APP_SECRET degrades to "no console keys" and is logged, so a run still executes
 *  on whatever the environment provides. */
const readStoredKeys = cache(async (): Promise<ProviderKeys> => {
  const secret = appSecret();
  if (!secret) return {};
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("get_provider_keys", { p_secret: secret });
    if (error) {
      log.warn("provider_settings.decrypt_failed", { message: error.message });
      return {};
    }
    const out: ProviderKeys = {};
    for (const [provider, value] of Object.entries((data ?? {}) as Record<string, unknown>)) {
      if (isProviderId(provider) && typeof value === "string" && value.trim()) {
        out[provider] = value.trim();
      }
    }
    return out;
  } catch (e) {
    log.warn("provider_settings.read_failed", { message: e instanceof Error ? e.message : String(e) });
    return {};
  }
});

/** The console's resting state — which providers have a STORED key (presence only,
 *  no secret needed, no ciphertext moved) plus the stored model overrides. */
const readState = cache(
  async (): Promise<{ storedProviders: ProviderId[]; modelOverrides: ModelOverrides }> => {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc("provider_settings_state");
      if (error || !data) return { storedProviders: [], modelOverrides: {} };
      const raw = data as { stored_providers?: unknown; model_overrides?: unknown };
      const storedProviders = Array.isArray(raw.stored_providers)
        ? raw.stored_providers.filter((p): p is ProviderId => typeof p === "string" && isProviderId(p))
        : [];
      const modelOverrides: ModelOverrides = {};
      for (const [role, value] of Object.entries((raw.model_overrides ?? {}) as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) modelOverrides[role as ModelRole] = value.trim();
      }
      return { storedProviders, modelOverrides };
    } catch (e) {
      log.warn("provider_settings.state_failed", {
        message: e instanceof Error ? e.message : String(e),
      });
      return { storedProviders: [], modelOverrides: {} };
    }
  },
);

/** THE key resolver: env wins per provider, else the decrypted stored key, else
 *  absent. Everything that needs a provider key at runtime calls this. */
export const getEffectiveProviderKeys = cache(async (): Promise<ProviderKeys> => {
  const stored = await readStoredKeys();
  const out: ProviderKeys = {};
  for (const { id, envVar } of PROVIDER_META) {
    const fromEnv = process.env[envVar]?.trim();
    const key = fromEnv || stored[id];
    if (key) out[id] = key;
  }
  return out;
});

/** The same resolution expressed as provenance — the ONLY key fact the UI sees. */
export const getKeySources = cache(async (): Promise<KeySources> => {
  const { storedProviders } = await readState();
  const out = {} as KeySources;
  for (const { id, envVar } of PROVIDER_META) {
    out[id] = process.env[envVar]?.trim()
      ? "env"
      : storedProviders.includes(id)
        ? "console"
        : "absent";
  }
  return out;
});

export interface MaskedProvider {
  provider: ProviderId;
  label: string;
  envVar: string;
  source: KeySource;
  /** exactly what the page prints — three fixed strings, never key material */
  display: "present (env)" | "present (console)" | "absent";
  /** an env-set key cannot be changed from the console (env wins) */
  editable: boolean;
}

export const DISPLAY_BY_SOURCE: Record<KeySource, MaskedProvider["display"]> = {
  env: "present (env)",
  console: "present (console)",
  absent: "absent",
};

/** The page's view model. Pure over the sources map so a test can prove no key
 *  material can reach it — there is no key-shaped value in scope. */
export function masked(sources: KeySources, secretAvailable: boolean): MaskedProvider[] {
  return PROVIDER_META.map(({ id, envVar, label }) => ({
    provider: id,
    label,
    envVar,
    source: sources[id],
    display: DISPLAY_BY_SOURCE[sources[id]],
    // env wins → nothing to edit here; and with no APP_SECRET there is nowhere
    // safe to put a key, so the console shows the env var name instead.
    editable: sources[id] !== "env" && secretAvailable,
  }));
}

export async function maskedProviders(): Promise<MaskedProvider[]> {
  return masked(await getKeySources(), appSecret() !== null);
}

// ── model overrides ─────────────────────────────────────────────────────────
/** The stored map exactly as saved (what the console's form edits). */
export async function getStoredModelOverrides(): Promise<ModelOverrides> {
  return (await readState()).modelOverrides;
}

/** The overrides a run should actually apply: env MODEL_* wins, else stored, else
 *  none. (models.ts layers env above `overrides` too, so this is belt-and-braces —
 *  it also makes the effective map inspectable on its own.) */
export const getEffectiveModelOverrides = cache(async (): Promise<ModelOverrides> => {
  const stored = await getStoredModelOverrides();
  const out: ModelOverrides = {};
  for (const [role, model] of Object.entries(stored)) {
    const { envVar } = MODEL_ROLE_META[role as ModelRole] ?? {};
    if (envVar && process.env[envVar]?.trim()) continue; // env wins
    out[role as ModelRole] = model as string;
  }
  return out;
});

export interface ModelChoiceRow {
  role: ModelRole;
  label: string;
  envVar: string;
  model: string;
  source: ModelSource;
  /** the shipped registry default, so the console can offer "Reset to default" */
  fallback: string;
}

/** role → {label, envVar, default} straight from the engine registry (no second
 *  copy of the role list in the app). Computed once at import: SLOTS is static. */
export const MODEL_ROLE_META: Record<ModelRole, { label: string; envVar: string; fallback: string }> =
  (() => {
    // env:{} + overrides:{} + config:{} ⇒ every slot resolves to its shipped default.
    const defaults = resolveModelTable({ env: {} as NodeJS.ProcessEnv, overrides: {}, config: {} });
    const out = {} as Record<ModelRole, { label: string; envVar: string; fallback: string }>;
    for (const [role, choice] of Object.entries(defaults)) {
      out[role as ModelRole] = { label: choice.label, envVar: choice.envVar, fallback: choice.model };
    }
    return out;
  })();

export const MODEL_ROLES = Object.keys(MODEL_ROLE_META) as ModelRole[];

/** What `saylent models` prints, for the console: role, resolved model, and where
 *  the choice came from (env / console / default). */
export async function modelChoiceRows(): Promise<ModelChoiceRow[]> {
  const overrides = await getStoredModelOverrides();
  const table = resolveModelTable({ overrides, config: {} });
  return MODEL_ROLES.map((role) => ({
    role,
    label: table[role].label,
    envVar: table[role].envVar,
    model: table[role].model,
    source: table[role].source,
    fallback: MODEL_ROLE_META[role].fallback,
  }));
}

// ── the run seam ────────────────────────────────────────────────────────────
/**
 * This module NEVER writes a key into `process.env`.
 *
 * It used to (applyProviderKeysToEnv), so that packages/engine/src/llm.ts, which
 * reads `process.env.OPENAI_API_KEY` / `ANTHROPIC_API_KEY` directly, would see a
 * console-stored key. The cost was that the key could not be revoked: once
 * published, the NEXT resolution saw it as an env key, "env wins" pinned it, and
 * deleting or rotating it in the console changed nothing until the instance was
 * recycled. A leaked key stayed live for as long as the lambda did.
 *
 * The rule now: getEffectiveProviderKeys() is the ONE source, and its return value
 * is passed explicitly to whatever makes the provider call (the answer-engine
 * adapters already take `apiKey`; see src/inngest/functions.ts). "env wins" still
 * holds — it is applied inside the resolver, per provider — but it is a read, not
 * a write, so a console change takes effect on the very next run.
 *
 * The judgment-layer callers (brand model, drafter, judge) receive the same resolved
 * keys explicitly through makeLlmCallers (src/inngest/functions.ts), so a key set
 * only in the console reaches every stage of a run.
 */
/** True when a provider's usable key exists ONLY in the console — i.e. the
 *  engine's env-reading judgment callers cannot see it. Used to log an honest
 *  warning instead of degrading a run in silence. */
export function consoleOnlyProviders(keys: ProviderKeys, env: NodeJS.ProcessEnv = process.env): ProviderId[] {
  return PROVIDER_META.filter(({ id, envVar }) => Boolean(keys[id]) && !env[envVar]?.trim()).map(
    (p) => p.id,
  );
}

/** Everything a run needs, resolved once: keys + the override map, with the map
 *  also injected into the engine registry so llm.ts/judge.ts see it. Read-only
 *  with respect to the process environment. */
export async function resolveRunProviders(): Promise<{
  keys: ProviderKeys;
  overrides: ModelOverrides;
}> {
  const keys = await getEffectiveProviderKeys();
  const overrides = await getEffectiveModelOverrides();
  injectModelOverrides(Object.keys(overrides).length > 0 ? overrides : null);
  return { keys, overrides };
}

// ── writes (audit-logged inside the RPC — state + audit in one transaction) ──
export type WriteResult = { ok: boolean; error?: string };

export async function setProviderKey(
  actorId: string,
  provider: ProviderId,
  key: string,
): Promise<WriteResult> {
  const secret = appSecret();
  if (!secret) return { ok: false, error: "Set APP_SECRET to manage keys here." };
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: "Paste a key first." };
  if (process.env[PROVIDER_META.find((p) => p.id === provider)?.envVar ?? ""]?.trim()) {
    return { ok: false, error: "This key is set in the environment — the environment wins." };
  }
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_provider_key", {
    p_actor: actorId,
    p_provider: provider,
    p_key: trimmed,
    p_secret: secret,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeProviderKey(actorId: string, provider: ProviderId): Promise<WriteResult> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("remove_provider_key", {
    p_actor: actorId,
    p_provider: provider,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Replaces the WHOLE map (an empty object is "Reset to defaults"). */
export async function saveModelOverrides(
  actorId: string,
  overrides: ModelOverrides,
  reason: string,
): Promise<WriteResult> {
  const clean: Record<string, string> = {};
  for (const [role, model] of Object.entries(overrides)) {
    const trimmed = typeof model === "string" ? model.trim() : "";
    if (!trimmed) continue;
    if (!MODEL_ROLE_META[role as ModelRole]) return { ok: false, error: `Unknown role "${role}".` };
    clean[role] = trimmed;
  }
  const trimmedReason = reason.trim();
  if (!trimmedReason) return { ok: false, error: "A reason is required." };
  const admin = createAdminClient();
  const { error } = await admin.rpc("set_model_overrides", {
    p_actor: actorId,
    p_overrides: clean,
    p_reason: trimmedReason,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** One provider's usable key for the free "Test" button (env first, then stored). */
export async function keyForTest(provider: ProviderId): Promise<string | undefined> {
  return (await getEffectiveProviderKeys())[provider];
}
