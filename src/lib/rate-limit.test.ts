// SEC-HARDEN durable limiter — clientIp extraction + the fail-OPEN contract.
import { describe, expect, it, vi } from "vitest";

let rpcImpl: () => Promise<{ data: unknown; error: unknown }>;
vi.mock("./supabase/admin", () => ({
  createAdminClient: () => ({ rpc: () => rpcImpl() }),
}));

import { RATE_LIMITS, checkRateLimit, clientIp } from "./rate-limit";

const reqWith = (headers: Record<string, string>) => new Request("https://x.test", { headers });

describe("clientIp", () => {
  it("prefers x-real-ip over the x-forwarded-for list", () => {
    expect(clientIp(reqWith({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9, 8.8.8.8" }))).toBe("1.2.3.4");
  });
  it("falls back to the leftmost x-forwarded-for hop", () => {
    expect(clientIp(reqWith({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" }))).toBe("9.9.9.9");
  });
  it("defaults to 'local' when no proxy header is present", () => {
    expect(clientIp(reqWith({}))).toBe("local");
  });
});

describe("checkRateLimit", () => {
  it("allows when the RPC reports within the limit", async () => {
    rpcImpl = async () => ({ data: true, error: null });
    expect(await checkRateLimit(RATE_LIMITS.runs, "user-1")).toBe(true);
  });
  it("blocks when the RPC reports over the limit", async () => {
    rpcImpl = async () => ({ data: false, error: null });
    expect(await checkRateLimit(RATE_LIMITS.runs, "user-1")).toBe(false);
  });
  it("fails OPEN on an RPC error (never blocks a legit request)", async () => {
    rpcImpl = async () => ({ data: null, error: { message: "boom" } });
    expect(await checkRateLimit(RATE_LIMITS.takedown, "1.2.3.4")).toBe(true);
  });
  it("fails OPEN when the limiter throws", async () => {
    rpcImpl = async () => {
      throw new Error("db down");
    };
    expect(await checkRateLimit(RATE_LIMITS.takedown, "1.2.3.4")).toBe(true);
  });
});
