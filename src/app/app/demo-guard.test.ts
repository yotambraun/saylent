// "Hosted read-only demo" — the write guard, per mutation.
//
// Every Supabase client factory is mocked to THROW. So a test that gets a friendly
// "read-only demo" result back proves two things at once: the mutation is refused, and
// assertNotDemo() runs BEFORE anything touches the database. Turning the flag off must
// let the same call reach the (throwing) client — that is the proof the guard is inert
// on a normal deployment.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_READ_ONLY_MESSAGE } from "@/lib/demo-mode";

const REACHED_DB = "REACHED_DB";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error(REACHED_DB);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error(REACHED_DB);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/analytics", () => ({ track: async () => {} }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

import { saveConfirmEdits } from "./brand/[id]/confirm/actions";
import { createBrand } from "./onboarding/actions";
import { cancelRun, hideRun, markFixShipped, unhideRun } from "./run/[id]/actions";
import { deleteBrand, updateBrand } from "./settings/actions";
import { toggleEmailReports, updateDisplayName, updateTimezone } from "./settings/profile-actions";
import { createRun, retryRun } from "@/lib/runs";

/** Every mutation a demo visitor can reach, with the smallest valid call. */
const MUTATIONS: [string, () => Promise<{ ok: boolean; error?: string; reason?: string }>][] = [
  ["settings/actions.ts updateBrand", () =>
    updateBrand({
      brandId: "b1",
      name: "n",
      domain: "d.example",
      competitorsCsv: "",
      category: "c",
      confirmedRebaseline: false,
    })],
  ["settings/actions.ts deleteBrand", () => deleteBrand({ brandId: "b1", confirmName: "n" })],
  ["settings/profile-actions.ts updateDisplayName", () => updateDisplayName("Ada")],
  ["settings/profile-actions.ts updateTimezone", () => updateTimezone("UTC")],
  ["settings/profile-actions.ts toggleEmailReports", () => toggleEmailReports(true)],
  ["run/[id]/actions.ts markFixShipped", () => markFixShipped("f1", "r1")],
  ["run/[id]/actions.ts hideRun", () => hideRun("r1")],
  ["run/[id]/actions.ts unhideRun", () => unhideRun("r1")],
  ["run/[id]/actions.ts cancelRun", () => cancelRun("r1")],
  ["onboarding/actions.ts createBrand", () =>
    createBrand({ name: "n", domain: "d.example", authorized: true })],
  ["brand/[id]/confirm/actions.ts saveConfirmEdits", () =>
    saveConfirmEdits({ brandId: "b1", category: "c", competitorsCsv: "", icp: "" })],
  ["lib/runs.ts createRun", () => createRun({ userId: "u1", brandId: "b1", kind: "audit" })],
  ["lib/runs.ts retryRun", () => retryRun("u1", "r1")],
];

afterEach(() => vi.unstubAllEnvs());

describe("demo mode blocks every mutation", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEMO_READONLY", "1"));

  for (const [name, call] of MUTATIONS) {
    it(`${name} is refused before it touches the database`, async () => {
      const res = await call();
      expect(res.ok).toBe(false);
      expect(res.error ?? res.reason).toBe(DEMO_READ_ONLY_MESSAGE);
    });
  }
});

describe("the guard is inert on a normal deployment", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_DEMO_READONLY", ""));

  for (const [name, call] of MUTATIONS) {
    it(`${name} falls straight through to its client`, async () => {
      // The mocked factory throws REACHED_DB — reaching it is exactly the point.
      await expect(call()).rejects.toThrow(REACHED_DB);
    });
  }
});
