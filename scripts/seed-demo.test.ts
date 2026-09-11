// seed-demo.ts must be safe to
// run twice (an operator WILL), must never leave the demo account holding the
// operator role, and must refuse to point at anything that is not a demo.
// Driven against an in-memory double of the service-role client, so no project is
// touched and no LLM call is possible.
import { describe, expect, it, vi } from "vitest";
import {
  assertSeedAllowed,
  NO_OPERATOR_ADMIN_MESSAGE,
  operatorAdmins,
  seedDemo,
  type SeedClient,
} from "./seed-demo";

const CREDS = { email: "demo@example.com", password: "pw-1" };

const FIXTURE = {
  brand: { name: "Kestrel Uptime", domain: "kestrel.example", category: "Uptime Monitoring" },
  run: { kind: "audit", status: "done", profile: "smoke" },
  // `fts` is a generated column — Postgres refuses it on insert, so it must be stripped.
  answers: [{ qid: "q01", engine: "chatgpt", fts: "GENERATED" }, { qid: "q02", engine: "claude" }],
  corpus_pages: [{ url: "https://kestrel.example/" }],
  domain_checks: [{ check: "robots" }],
  fixes: [{ title: "Add a comparison page" }],
};

/** Minimal stand-in for the supabase service-role client: enough of the query builder
 *  for seedDemo, plus the migration-0040 behavior that makes the FIRST profile row an
 *  admin (the trap this script has to defuse). */
function fakeClient() {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const passwords: Record<string, string> = {};
  let n = 0;
  const nextId = () => `id-${++n}`;

  function from(table: string) {
    const filters: [string, unknown][] = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: unknown = null;
    const rows = () => (tables[table] ??= []);
    const match = (r: Record<string, unknown>) => filters.every(([c, v]) => r[c] === v);
    const exec = () => {
      const t = rows();
      if (mode === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
        const made = list.map((r) => {
          const row = { ...r };
          if (!row.id) row.id = nextId();
          return row;
        });
        t.push(...made);
        return { data: made, error: null };
      }
      if (mode === "update") {
        const hit = t.filter(match);
        for (const r of hit) Object.assign(r, payload as Record<string, unknown>);
        return { data: hit, error: null };
      }
      return { data: t.filter(match), error: null };
    };
    const q = {
      select: () => q,
      insert: (r: unknown) => ((mode = "insert"), (payload = r), q),
      update: (p: Record<string, unknown>) => ((mode = "update"), (payload = p), q),
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      maybeSingle: async () => ({ data: exec().data[0] ?? null, error: null }),
      single: async () => {
        const row = exec().data[0];
        return row ? { data: row, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (res: (v: { data: Record<string, unknown>[]; error: null }) => unknown) =>
        Promise.resolve(exec()).then(res),
    };
    return q;
  }

  const createUser = vi.fn(async (p: { email: string; password: string }) => {
    const id = nextId();
    passwords[id] = p.password;
    const profiles = (tables.profiles ??= []);
    // migration 0040: the very first profile row is auto-promoted to operator.
    profiles.push({ id, email: p.email, role: profiles.length === 0 ? "admin" : "user" });
    return { data: { user: { id } }, error: null };
  });
  const updateUserById = vi.fn(async (id: string, p: { password: string }) => {
    passwords[id] = p.password;
    return { error: null };
  });

  return {
    client: { auth: { admin: { createUser, updateUserById } }, from } as unknown as SeedClient,
    tables,
    passwords,
    createUser,
    updateUserById,
  };
}

/** The real-world precondition: the operator signed up on this project first, so
 *  migration 0040 already crowned THEM (not the demo account). */
function withOperator(f: ReturnType<typeof fakeClient>) {
  (f.tables.profiles ??= []).push({
    id: "operator-1",
    email: "operator@example.com",
    role: "admin",
  });
  return f;
}

describe("seedDemo", () => {
  it("seeds the account, the brand, the run and its children on a fresh project", async () => {
    const f = withOperator(fakeClient());
    const out = await seedDemo(f.client, FIXTURE, CREDS, () => {});

    expect(out.reused).toEqual({ user: false, brand: false, run: false });
    expect(f.tables.brands).toHaveLength(1);
    expect(f.tables.runs).toHaveLength(1);
    expect(f.tables.answers).toHaveLength(2);
    expect(f.tables.fixes).toHaveLength(1);
    // children are re-keyed onto the new run + owner
    expect(f.tables.answers.every((a) => a.run_id === out.runId && a.user_id === out.userId)).toBe(true);
    // the generated column never reaches the insert
    expect(f.tables.answers.some((a) => "fts" in a)).toBe(false);
  });

  it("NEVER leaves the demo account holding the operator role (migration 0040 trap)", async () => {
    const f = withOperator(fakeClient());
    const out = await seedDemo(f.client, FIXTURE, CREDS, () => {});
    const demo = f.tables.profiles.find((p) => p.id === out.userId)!;
    expect(demo.role).toBe("user");
    expect(demo.plan).toBe("free");
  });

  it("is idempotent — a second run reuses everything and duplicates nothing", async () => {
    const f = withOperator(fakeClient());
    const first = await seedDemo(f.client, FIXTURE, CREDS, () => {});
    const second = await seedDemo(f.client, FIXTURE, CREDS, () => {});

    expect(second.reused).toEqual({ user: true, brand: true, run: true });
    expect(second).toMatchObject({ userId: first.userId, brandId: first.brandId, runId: first.runId });
    expect(f.tables.profiles).toHaveLength(2); // the operator + the demo account
    expect(f.tables.brands).toHaveLength(1);
    expect(f.tables.runs).toHaveLength(1);
    expect(f.tables.answers).toHaveLength(2);
    expect(f.createUser).toHaveBeenCalledTimes(1);
  });

  it("repairs the password so a rotated DEMO_USER_PASSWORD cannot strand the proxy", async () => {
    const f = withOperator(fakeClient());
    const out = await seedDemo(f.client, FIXTURE, CREDS, () => {});
    await seedDemo(f.client, FIXTURE, { ...CREDS, password: "pw-2" }, () => {});
    expect(f.updateUserById).toHaveBeenCalledWith(out.userId, { password: "pw-2" });
    expect(f.passwords[out.userId]).toBe("pw-2");
  });
});

describe("assertSeedAllowed", () => {
  it("refuses when the deployment is not a demo", () => {
    expect(() => assertSeedAllowed({}, [])).toThrow(/NEXT_PUBLIC_DEMO_READONLY/);
    expect(() => assertSeedAllowed({ NEXT_PUBLIC_DEMO_READONLY: "0" }, [])).toThrow();
  });

  it("refuses production unless the operator says --yes-production out loud", () => {
    const prod = { NEXT_PUBLIC_DEMO_READONLY: "1", VERCEL_ENV: "production" };
    expect(() => assertSeedAllowed(prod, [])).toThrow(/--yes-production/);
    expect(() => assertSeedAllowed(prod, ["--yes-production"])).not.toThrow();
  });

  it("allows a flagged non-production demo project", () => {
    expect(() => assertSeedAllowed({ NEXT_PUBLIC_DEMO_READONLY: "1" }, [])).not.toThrow();
    expect(() =>
      assertSeedAllowed({ NEXT_PUBLIC_DEMO_READONLY: "1", VERCEL_ENV: "preview" }, []),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The seed used to demote the demo account (correctly) and walk
// away, leaving a PUBLIC project with zero admins and migration 0040's
// "first profile row becomes the operator" trigger still armed. The next person
// to sign up on the internet became the operator of the deployment.
// ---------------------------------------------------------------------------
describe("seedDemo — never leaves the project without an operator (#2)", () => {
  it("refuses on a fresh project where the demo account would be the only admin", async () => {
    const f = fakeClient();

    await expect(seedDemo(f.client, FIXTURE, CREDS, () => {})).rejects.toThrow(
      /no operator admin exists/,
    );
  });

  it("refuses BEFORE demoting, so nothing is half-seeded", async () => {
    const f = fakeClient();

    await expect(seedDemo(f.client, FIXTURE, CREDS, () => {})).rejects.toThrow(
      NO_OPERATOR_ADMIN_MESSAGE,
    );

    // the demo account is still the 0040 admin (untouched), and no brand/run exists
    expect(f.tables.profiles).toHaveLength(1);
    expect(f.tables.profiles[0].role).toBe("admin");
    expect(f.tables.brands ?? []).toHaveLength(0);
    expect(f.tables.runs ?? []).toHaveLength(0);
  });

  it("proceeds once a real operator exists, and that operator survives the seed", async () => {
    const f = withOperator(fakeClient());

    const out = await seedDemo(f.client, FIXTURE, CREDS, () => {});

    const admins = f.tables.profiles.filter((p) => p.role === "admin");
    expect(admins.map((p) => p.id)).toEqual(["operator-1"]);
    expect(admins.map((p) => p.id)).not.toContain(out.userId);
  });

  it("operatorAdmins does not count the demo account itself", async () => {
    const f = fakeClient();
    f.tables.profiles = [
      { id: "demo-1", role: "admin" },
      { id: "operator-1", role: "admin" },
      { id: "someone", role: "user" },
    ];

    expect(await operatorAdmins(f.client, "demo-1")).toEqual(["operator-1"]);
    expect(await operatorAdmins(f.client, "operator-1")).toEqual(["demo-1"]);
  });
});
