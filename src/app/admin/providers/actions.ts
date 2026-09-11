"use server";
// The "Providers & models" writes. Same contract as
// every other admin action: the demo guard first (a read-only demo changes
// nothing), then requireAdmin() (never trusts the layout), then the service-role
// RPC that applies the change AND writes its audit_log row in one transaction
// (migration 0042). No action ever returns, logs or echoes a key value.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-auth";
import { assertNotDemo } from "@/lib/demo-mode";
import { testConfiguredProviders, type ProviderTestResult } from "@/lib/provider-check";
import {
  isProviderId,
  removeProviderKey,
  saveModelOverrides,
  setProviderKey,
} from "@/lib/provider-settings";
import type { ModelOverrides, ModelRole } from "@saylent/engine/models";

type ActionResult = { ok: boolean; error?: string };

/** Store (or replace) one provider key, encrypted. The plaintext exists only for
 *  the length of this call: it goes straight into the RPC and is never returned. */
export async function saveProviderKey(provider: string, key: string): Promise<ActionResult> {
  const demo = assertNotDemo();
  if (demo) return demo;
  const actor = await requireAdmin();
  if (!isProviderId(provider)) return { ok: false, error: "Unknown provider." };
  const res = await setProviderKey(actor.id, provider, key);
  if (!res.ok) return res;
  revalidatePath("/admin/providers");
  revalidatePath("/admin");
  return { ok: true };
}

export async function clearProviderKey(provider: string): Promise<ActionResult> {
  const demo = assertNotDemo();
  if (demo) return demo;
  const actor = await requireAdmin();
  if (!isProviderId(provider)) return { ok: false, error: "Unknown provider." };
  const res = await removeProviderKey(actor.id, provider);
  if (!res.ok) return res;
  revalidatePath("/admin/providers");
  revalidatePath("/admin");
  return { ok: true };
}

/** The free per-provider check (`saylent keys test`), for one provider. Read-only
 *  — no demo guard needed, but it still costs a network round trip, so it stays
 *  admin-only. */
export async function testOneProvider(
  provider: string,
): Promise<{ ok: boolean; error?: string; result?: ProviderTestResult }> {
  await requireAdmin();
  if (!isProviderId(provider)) return { ok: false, error: "Unknown provider." };
  const [result] = await testConfiguredProviders([provider]);
  return { ok: true, result };
}

/** Replace the whole per-role override map. An empty map is "Reset to defaults" —
 *  the same call, so both paths land one complete before/after audit entry. */
export async function saveModels(
  overrides: Record<string, string>,
  reason: string,
): Promise<ActionResult> {
  const demo = assertNotDemo();
  if (demo) return demo;
  const actor = await requireAdmin();
  const clean: ModelOverrides = {};
  for (const [role, model] of Object.entries(overrides ?? {})) {
    if (typeof model === "string" && model.trim()) clean[role as ModelRole] = model.trim();
  }
  const res = await saveModelOverrides(actor.id, clean, reason);
  if (!res.ok) return res;
  revalidatePath("/admin/providers");
  return { ok: true };
}

export async function resetModels(reason: string): Promise<ActionResult> {
  return saveModels({}, reason);
}
