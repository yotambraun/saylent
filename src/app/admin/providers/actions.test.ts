// The /admin/providers server actions' guard order.
// Every action must refuse BEFORE it can write: the demo guard first (a read-only
// demo changes nothing), then requireAdmin(). The proof is that the underlying
// writer is never reached — provider-settings is mocked with spies, and
// requireAdmin is mocked to throw the way redirect() does for a non-admin.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const setProviderKey = vi.fn(async () => ({ ok: true }));
const removeProviderKey = vi.fn(async () => ({ ok: true }));
const saveModelOverrides = vi.fn(async () => ({ ok: true }));
const testConfiguredProviders = vi.fn(async (only?: string[]) =>
  [{ provider: "openai" as const, label: "OpenAI", ok: true, detail: "ok" }].filter(
    (r) => !only || only.includes(r.provider),
  ),
);

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: () => requireAdmin() }));
vi.mock("@/lib/provider-check", () => ({
  testConfiguredProviders: (only?: string[]) => testConfiguredProviders(only),
}));
vi.mock("@/lib/provider-settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/provider-settings")>(
    "@/lib/provider-settings",
  );
  return {
    ...actual,
    setProviderKey: (...a: unknown[]) => setProviderKey(...(a as [])),
    removeProviderKey: (...a: unknown[]) => removeProviderKey(...(a as [])),
    saveModelOverrides: (...a: unknown[]) => saveModelOverrides(...(a as [])),
  };
});
// provider-settings imports the service client at module load; never used here.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("REACHED_DB");
  },
}));

import {
  clearProviderKey,
  resetModels,
  saveModels,
  saveProviderKey,
  testOneProvider,
} from "./actions";

const REDIRECTED = "NEXT_REDIRECT";
const WRITERS = [setProviderKey, removeProviderKey, saveModelOverrides];

/** Every mutating action, with the smallest valid call. */
const MUTATIONS: [string, () => Promise<{ ok: boolean; error?: string }>][] = [
  ["saveProviderKey", () => saveProviderKey("openai", "sk-test")],
  ["clearProviderKey", () => clearProviderKey("openai")],
  ["saveModels", () => saveModels({ drafter: "m" }, "because")],
  ["resetModels", () => resetModels("because")],
];

beforeEach(() => {
  for (const fn of [requireAdmin, ...WRITERS, testConfiguredProviders]) fn.mockClear();
  requireAdmin.mockResolvedValue({ id: "admin-1", email: "a@example.com" });
  delete process.env.NEXT_PUBLIC_DEMO_READONLY;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_READONLY;
});

describe("admin guard", () => {
  for (const [name, call] of MUTATIONS) {
    it(`${name} refuses (and writes nothing) without an admin`, async () => {
      requireAdmin.mockRejectedValue(new Error(REDIRECTED));
      await expect(call()).rejects.toThrow(REDIRECTED);
      for (const fn of WRITERS) expect(fn).not.toHaveBeenCalled();
    });
  }

  it("passes the acting admin's id to the writer, so the audit row names them", async () => {
    await saveProviderKey("anthropic", "sk-ant");
    expect(setProviderKey).toHaveBeenCalledWith("admin-1", "anthropic", "sk-ant");
    await saveModels({ drafter: " m " }, " reason ");
    expect(saveModelOverrides).toHaveBeenCalledWith("admin-1", { drafter: "m" }, " reason ");
  });

  it("scopes the free key-test to the one provider asked for", async () => {
    const res = await testOneProvider("openai");
    expect(testConfiguredProviders).toHaveBeenCalledWith(["openai"]);
    expect(res.result?.detail).toBe("ok");
  });

  it("rejects an unknown provider before any write", async () => {
    const res = await saveProviderKey("not-a-provider", "sk-1");
    expect(res.ok).toBe(false);
    expect(setProviderKey).not.toHaveBeenCalled();
  });
});

describe("demo guard", () => {
  it("refuses every mutation on a read-only demo, before requireAdmin or any write", async () => {
    process.env.NEXT_PUBLIC_DEMO_READONLY = "1";
    for (const [name, call] of MUTATIONS) {
      const res = await call();
      expect(res.ok, name).toBe(false);
      expect(res.error, name).toMatch(/read-only demo/i);
    }
    expect(requireAdmin).not.toHaveBeenCalled();
    for (const fn of WRITERS) expect(fn).not.toHaveBeenCalled();
  });
});
