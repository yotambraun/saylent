// The send helper. Proves it stays INERT without
// RESEND_API_KEY, POSTs once the key + the flag are present, and NEVER throws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEmail, sendEmail } from "./email";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  // clean slate — remove the vars the helper reads
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.FLAG_EMAILS;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("renderEmail (pure dispatch)", () => {
  it("routes each template name to its renderer", () => {
    expect(renderEmail({ template: "welcome", props: { appUrl: "x" } }).subject).toBe(
      "Your Saylent account is ready",
    );
  });
});

describe("sendEmail — inert without RESEND_API_KEY", () => {
  it("no-ops (no fetch) when the key/from are missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sent = await sendEmail({ to: "u@x.com", template: "welcome", props: { appUrl: "x" } });
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when the emails flag is off, even with a key", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "hi@saylent.test";
    process.env.FLAG_EMAILS = "off";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const sent = await sendEmail({ to: "u@x.com", template: "welcome", props: { appUrl: "x" } });
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendEmail — active with RESEND_API_KEY", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "hi@saylent.test";
  });

  it("POSTs to the email API and returns true on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    const sent = await sendEmail({
      to: "u@x.com",
      template: "welcome",
      props: { appUrl: "https://app.test" },
    });
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.authorization).toBe("Bearer re_test");
    const body = JSON.parse(init.body);
    expect(body.from).toBe("hi@saylent.test");
    expect(body.to).toBe("u@x.com");
    expect(body.subject).toBe("Your Saylent account is ready");
    expect(typeof body.html).toBe("string");
  });

  it("returns false (no throw) on a non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    const sent = await sendEmail({ to: "u@x.com", template: "welcome", props: { appUrl: "x" } });
    expect(sent).toBe(false);
  });

  it("returns false (no throw) when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const sent = await sendEmail({ to: "u@x.com", template: "welcome", props: { appUrl: "x" } });
    expect(sent).toBe(false);
  });
});
