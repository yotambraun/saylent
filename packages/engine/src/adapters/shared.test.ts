// Error classification (classifyAdapterError,
// failed's "<kind>: <message>" tag) and the bounded 429/5xx retry (withRetry).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyAdapterError, failed, keyMissing, redactSecretsInText, withRetry } from "./shared";

describe("classifyAdapterError", () => {
  it("classifies a 401/403-shaped error as auth", () => {
    expect(classifyAdapterError({ status: 401, message: "Unauthorized" }).kind).toBe("auth");
    expect(classifyAdapterError({ status: 403, message: "Forbidden" }).kind).toBe("auth");
    expect(classifyAdapterError(new Error("Incorrect API key provided")).kind).toBe("auth");
  });

  it("classifies a 402/insufficient_quota-shaped error as quota", () => {
    expect(classifyAdapterError({ status: 402, message: "no credit" }).kind).toBe("quota");
    expect(classifyAdapterError({ code: "insufficient_quota", message: "x" }).kind).toBe("quota");
  });

  it("classifies a 429-shaped error as rate_limit", () => {
    expect(classifyAdapterError({ status: 429, message: "Too Many Requests" }).kind).toBe("rate_limit");
    expect(classifyAdapterError(new Error("perplexity 429: rate limited")).kind).toBe("rate_limit");
  });

  it("classifies a 404/model_not_found-shaped error as not_found", () => {
    expect(classifyAdapterError({ status: 404, message: "x" }).kind).toBe("not_found");
    expect(classifyAdapterError({ code: "model_not_found", message: "x" }).kind).toBe("not_found");
  });

  it("classifies a 5xx / timeout / overloaded error as server", () => {
    expect(classifyAdapterError({ status: 503, message: "Service Unavailable" }).kind).toBe("server");
    expect(classifyAdapterError({ status: 529, message: "overloaded_error" }).kind).toBe("server");
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(classifyAdapterError(abort).kind).toBe("server");
  });

  it("falls back to unknown for an unrecognized shape", () => {
    expect(classifyAdapterError(new Error("something odd happened")).kind).toBe("unknown");
  });

  it("never throws on a non-Error, non-object input", () => {
    expect(() => classifyAdapterError("plain string")).not.toThrow();
    expect(() => classifyAdapterError(null)).not.toThrow();
    expect(() => classifyAdapterError(undefined)).not.toThrow();
  });
});

describe("failed() / keyMissing() tag AskResult.error with the classified kind", () => {
  it("tags a rate-limit error", () => {
    const r = failed({ status: 429, message: "Too Many Requests" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^rate_limit: /);
  });

  it("tags an auth error", () => {
    const r = failed({ status: 401, message: "Unauthorized" });
    expect(r.error).toMatch(/^auth: /);
  });

  it("keyMissing tags missing_key", () => {
    expect(keyMissing().error).toBe("missing_key: KEY missing");
  });
});

describe("withRetry", () => {
  it("retries a rate_limit failure and succeeds on the 2nd attempt (1 retry)", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw { status: 429, message: "rate limited" };
      return "ok";
    });
    const sleep = vi.fn(async () => {});
    const result = await withRetry(fn, { sleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("retries a server (5xx) failure up to the retry cap, then throws", async () => {
    const fn = vi.fn(async () => {
      throw { status: 503, message: "unavailable" };
    });
    const sleep = vi.fn(async () => {});
    await expect(withRetry(fn, { retries: 2, sleep })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retryable classification (auth, quota, not_found, unknown)", async () => {
    const fn = vi.fn(async () => {
      throw { status: 401, message: "unauthorized" };
    });
    const sleep = vi.fn(async () => {});
    await expect(withRetry(fn, { sleep })).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("succeeds immediately with no retry needed", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The adapter boundary is the one place every provider error passes
// through on its way to AnswerRow.error, run.json, the report and Inngest
// step state. A key must not survive it.
// ---------------------------------------------------------------------------
describe("failed() redacts secrets", () => {
  const GEMINI_KEY = "AIzaSyD-fake-key-for-tests-0123456789ab";
  const OPENAI_KEY = "sk-" + "proj-fake0123456789abcdefghijklmnop";
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ["GEMINI_API_KEY", "OPENAI_API_KEY"]) prev[k] = process.env[k];
    process.env.GEMINI_API_KEY = GEMINI_KEY;
    process.env.OPENAI_API_KEY = OPENAI_KEY;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("strips the key out of the Gemini URL a transport error echoes back", () => {
    // the real shape: @google/genai puts the key in the query string, and the
    // fetch failure message carries the whole URL.
    const thrown = new Error(
      `got status: 400 Bad Request. {"error":{"message":"request to https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=${GEMINI_KEY} failed"}}`,
    );
    const out = failed(thrown);
    expect(out.ok).toBe(false);
    expect(out.error).not.toContain(GEMINI_KEY);
    expect(out.error).toContain("[redacted]");
    // the classification prefix errors.ts parses still survives
    expect(out.error?.startsWith("unknown: ")).toBe(true);
  });

  it("strips an Authorization header echoed inside an SDK error", () => {
    const out = failed(new Error(`401 Unauthorized (authorization: Bearer ${OPENAI_KEY})`));
    expect(out.error).not.toContain(OPENAI_KEY);
  });

  it("redacts a key it does NOT hold, by shape alone", () => {
    delete process.env.OPENAI_API_KEY;
    const strange = "sk-" + "ant-api03-notinourenv-0123456789abcdef";
    const out = failed(new Error(`500 upstream said ${strange}`));
    expect(out.error).not.toContain(strange);
  });

  it("redacts BEFORE the 500-char truncation, so a half-cut key cannot survive", () => {
    const long = `${"padding ".repeat(60)}?key=${GEMINI_KEY} tail`;
    const out = failed(new Error(long));
    expect(out.error).not.toContain(GEMINI_KEY.slice(0, 20));
  });

  it("leaves ordinary error text alone", () => {
    expect(redactSecretsInText("Anthropic is overloaded, try again")).toBe("Anthropic is overloaded, try again");
    expect(failed(new Error("connect ECONNRESET")).error).toBe("server: connect ECONNRESET");
  });

  // The `sk-` shape carries a left boundary, matching the snapshot scanner and
  // the CLI's copy in packages/cli/src/redact.ts. Without it the "safety net"
  // ate ordinary words that merely CONTAIN `sk-`: applied to a rendered
  // report.html it turned Tailwind's own `mask-linear-from-…` into
  // `ma[redacted]` and broke the embedded bundle.
  it("does not treat sk- in the middle of a word as a key", () => {
    for (const word of ["mask-linear-from-position", "task-scheduler-identifier", "risk-assessment-summary"]) {
      expect(redactSecretsInText(`the ${word} value`)).toBe(`the ${word} value`);
    }
  });

  it("still catches a real key shape at a word boundary", () => {
    const key = "sk-" + "boundarytest0123456789abcdefghij";
    expect(redactSecretsInText(`leaked ${key} here`)).toBe("leaked [redacted] here");
    expect(redactSecretsInText(`"${key}"`)).toBe('"[redacted]"');
  });

  it("keyMissing() is unchanged", () => {
    expect(keyMissing().error).toBe("missing_key: KEY missing");
  });
});
