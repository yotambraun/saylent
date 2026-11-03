// Alert delivery with mocked transports: a recording fetch for the webhook and
// Slack, and a tiny in-process SMTP server on localhost for email. Nothing
// leaves the machine.
import http from "node:http";
import net from "node:net";
import type { HostLookup } from "@saylent/engine/util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAlertPayload, type AlertSet } from "./alerts";
import {
  checkTargetUrl,
  checkTargetUrlResolved,
  deliverAlert,
  sendSlack,
  sendSmtp,
  sendWebhook,
  signBody,
  verifySignature,
  type DeliveryLog,
  type DeliveryRecord,
} from "./alerts-deliver";

const alerts: AlertSet = {
  comparable: true,
  summary: { recommendation_gained: 1, recommendation_lost: 0, rival_new: 0, opportunity_new: 0, crawler_errors_spike: 0 },
  events: [
    {
      type: "recommendation_gained",
      text: 'ChatGPT now recommends Acme for "best tool" (was absent).',
      qid: "q01",
      engine: "chatgpt",
      engine_label: "ChatGPT",
      before: "absent",
      after: "recommended",
      receipt: { kind: "answer", qid: "q01", engine: "chatgpt", url: "https://app.example/app/run/r1#q-q01" },
    },
  ],
};
const payload = buildAlertPayload({
  brand: { name: "Acme", domain: "acme.example" },
  run: { id: "r1", finishedAt: "2026-11-02T09:00:00Z" },
  baseline: { id: "r0", finishedAt: "2026-10-01T09:00:00Z" },
  alerts,
  now: new Date("2026-11-02T09:00:05Z"),
});

// Every webhook and Slack send goes through the engine's guarded safePost,
// which resolves the host first: tests hand it a resolver that answers a
// public address, and stub the global fetch underneath it.
const publicLookup: HostLookup = async () => [{ address: "93.184.216.34" }];
const privateLookup: HostLookup = async () => [{ address: "169.254.169.254" }];

function recorder(status = 200, body = "ok", headers: Record<string, string> = {}) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body) });
    return new Response(status === 204 || status < 200 || (status >= 300 && status < 400) ? null : body, { status, headers });
  });
  return { calls };
}

afterEach(() => vi.restoreAllMocks());

describe("signing", () => {
  it("signs t.body with HMAC-SHA256 and verifies within the tolerance only", () => {
    const sig = signBody('{"a":1}', "whsec_test", 1_800_000_000);
    expect(sig).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignature('{"a":1}', sig, "whsec_test", { now: 1_800_000_100 })).toBe(true);
    expect(verifySignature('{"a":2}', sig, "whsec_test", { now: 1_800_000_100 })).toBe(false);
    expect(verifySignature('{"a":1}', sig, "other", { now: 1_800_000_100 })).toBe(false);
    expect(verifySignature('{"a":1}', sig, "whsec_test", { now: 1_800_001_000 })).toBe(false);
  });
});

describe("webhook", () => {
  it("posts the payload with event, delivery and signature headers", async () => {
    const r = recorder(204, "");
    const res = await sendWebhook(payload, { url: "https://hooks.example/saylent", secret: "whsec_test" }, { lookup: publicLookup });
    expect(res).toEqual({ channel: "webhook", ok: true, status: "sent" });
    const call = r.calls[0];
    expect(JSON.parse(call.body)).toEqual(payload);
    expect(call.headers["x-saylent-event"]).toBe("run.changed");
    expect(call.headers["x-saylent-delivery"]).toBe(payload.id);
    expect(verifySignature(call.body, call.headers["x-saylent-signature"], "whsec_test")).toBe(true);
  });

  it("retries once on 5xx and never leaks the URL in an error", async () => {
    const r = recorder(503, "");
    const res = await sendWebhook(payload, { url: "https://hooks.example/secret-token" }, { lookup: publicLookup, wait: async () => {} });
    expect(r.calls).toHaveLength(2);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("webhook answered HTTP 503");
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED https://hooks.example/secret-token"));
    const res2 = await sendWebhook(payload, { url: "https://hooks.example/secret-token" }, { lookup: publicLookup });
    expect(res2.ok).toBe(false);
    expect(res2.error).not.toContain("secret-token");
  });

  it("treats a redirect as a failed delivery and never follows it, nor retries", async () => {
    const r = recorder(302, "", { location: "http://169.254.169.254/latest/meta-data/" });
    const res = await sendWebhook(payload, { url: "https://hooks.example/x" }, { lookup: publicLookup, wait: async () => {} });
    expect(r.calls).toHaveLength(1);
    expect(res).toMatchObject({ ok: false, status: "failed" });
    expect(res.error).toBe("webhook answered HTTP 302, a redirect; alerts do not follow redirects, so use the final URL");
    expect(res.error).not.toContain("169.254");
  });

  it("refuses a host that resolves to a private address, without sending", async () => {
    const r = recorder(200, "ok");
    const res = await sendWebhook(payload, { url: "https://rebind.example/secret-token" }, { lookup: privateLookup });
    expect(r.calls).toHaveLength(0);
    expect(res).toMatchObject({ ok: false, status: "failed", error: "webhook not sent: the host resolves to a private, loopback or link-local address" });
  });

  it("refuses private and encoded-IP URLs before any DNS or network", async () => {
    const r = recorder(200, "ok");
    for (const url of ["https://10.0.0.5/x", "https://169.254.169.254/x", "https://[fd00::1]/x", "https://2130706433/x", "https://0x7f.1/x", "https://0251.0376.0251.0376/x"]) {
      const res = await sendWebhook(payload, { url }, { lookup: publicLookup });
      expect(res.ok, url).toBe(false);
    }
    expect(r.calls).toHaveLength(0);
  });
});

describe("checkTargetUrl", () => {
  it("accepts https to a public host, refuses plain http", () => {
    expect(checkTargetUrl("https://hooks.example/x")).toBeNull();
    expect(checkTargetUrl("http://hooks.example/x")).toBe("must be an https URL");
    expect(checkTargetUrl("ftp://hooks.example/x")).toBe("must be an https URL");
    expect(checkTargetUrl("not a url")).toBe("is not a valid URL");
  });

  it("refuses private, link-local and reserved IPv4 and IPv6 literals", () => {
    for (const u of ["https://10.0.0.5/", "https://172.20.1.1/", "https://192.168.0.10/", "https://169.254.169.254/", "https://100.64.1.1/", "https://0.0.0.0/", "https://[fd12::1]/", "https://[fe80::1]/", "https://[::ffff:10.0.0.1]/"]) {
      expect(checkTargetUrl(u), u).toBe("points at a private, link-local or reserved address");
    }
  });

  it("refuses decimal, octal and hex encodings of internal addresses", () => {
    for (const u of ["https://2852039166/", "https://0xa9fea9fe/", "https://0251.0376.0251.0376/", "https://0x0a.0.0.1/", "https://012.0.0.1/"]) {
      expect(checkTargetUrl(u), u).not.toBeNull();
    }
  });

  it("refuses loopback unless explicitly allowed, and the opt-in opens loopback only", () => {
    for (const u of ["http://localhost:8080/x", "https://127.0.0.1/x", "http://[::1]:8080/x", "https://2130706433/x"]) {
      expect(checkTargetUrl(u), u).toMatch(/loopback/);
    }
    for (const u of ["http://localhost:8080/x", "http://127.0.0.1:8787/x", "http://[::1]:8080/x", "https://localhost/x"]) {
      expect(checkTargetUrl(u, { allowLoopback: true }), u).toBeNull();
    }
    expect(checkTargetUrl("https://10.0.0.5/", { allowLoopback: true })).not.toBeNull();
    expect(checkTargetUrl("http://hooks.example/x", { allowLoopback: true })).toBe("must be an https URL");
  });

  it("checkTargetUrlResolved also resolves the host", async () => {
    expect(await checkTargetUrlResolved("https://hooks.example/x", { lookup: publicLookup })).toBeNull();
    expect(await checkTargetUrlResolved("https://hooks.example/x", { lookup: privateLookup })).toBe("has a host that resolves to a private, loopback or link-local address");
    expect(await checkTargetUrlResolved("https://hooks.example/x", { lookup: async () => [] })).toBe("has a host that does not resolve");
    expect(await checkTargetUrlResolved("https://hooks.example/x", { lookup: async () => [{ address: "127.0.0.1" }] })).not.toBeNull();
    expect(await checkTargetUrlResolved("http://localhost:8787/x", { lookup: async () => [{ address: "127.0.0.1" }], allowLoopback: true })).toBeNull();
    expect(await checkTargetUrlResolved("http://10.0.0.5/x", { lookup: publicLookup })).toBe("must be an https URL");
  });
});

describe("loopback opt-in against a real local receiver", () => {
  let server: http.Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  function receiver(): Promise<{ port: number; hits: { path: string; body: string }[] }> {
    const hits: { path: string; body: string }[] = [];
    return new Promise((resolve) => {
      server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          hits.push({ path: req.url ?? "", body });
          if (req.url === "/bounce") {
            res.writeHead(307, { location: "/internal" });
            res.end();
          } else {
            res.writeHead(204);
            res.end();
          }
        });
      });
      server.listen(0, "127.0.0.1", () => resolve({ port: (server!.address() as net.AddressInfo).port, hits }));
    });
  }

  it("delivers to 127.0.0.1 only with the opt-in, and does not follow its redirect", async () => {
    const { port, hits } = await receiver();
    const off = await sendWebhook(payload, { url: `http://127.0.0.1:${port}/hook` });
    expect(off.ok).toBe(false);
    expect(off.error).toMatch(/loopback/);
    expect(hits).toHaveLength(0);

    const on = await sendWebhook(payload, { url: `http://127.0.0.1:${port}/hook` }, { allowLoopback: true });
    expect(on).toEqual({ channel: "webhook", ok: true, status: "sent" });
    expect(JSON.parse(hits[0].body).id).toBe(payload.id);

    const bounced = await sendWebhook(payload, { url: `http://127.0.0.1:${port}/bounce` }, { allowLoopback: true, wait: async () => {} });
    expect(bounced.ok).toBe(false);
    expect(bounced.error).toMatch(/HTTP 307, a redirect/);
    expect(hits.map((h) => h.path)).toEqual(["/hook", "/bounce"]);
  });
});

describe("slack", () => {
  it("posts Block Kit with a text fallback and reads Slack's error code", async () => {
    const ok = recorder(200, "ok");
    expect((await sendSlack(payload, { url: "https://hooks.slack.com/services/T/B/x" }, { lookup: publicLookup })).ok).toBe(true);
    const body = JSON.parse(ok.calls[0].body);
    expect(body.text).toContain("Acme");
    expect(body.blocks[0].type).toBe("header");
    vi.restoreAllMocks();
    recorder(400, "invalid_payload");
    const res = await sendSlack(payload, { url: "https://hooks.slack.com/services/T/B/x" }, { lookup: publicLookup });
    expect(res.error).toBe("Slack answered HTTP 400 invalid_payload");
  });

  it("goes through the same guard: private hosts and redirects are refused", async () => {
    const r = recorder(200, "ok");
    const res = await sendSlack(payload, { url: "https://hooks.slack.com/services/T/B/x" }, { lookup: privateLookup });
    expect(res).toMatchObject({ ok: false, error: "Slack webhook not sent: the host resolves to a private, loopback or link-local address" });
    expect((await sendSlack(payload, { url: "https://192.168.1.1/services/x" }, { lookup: publicLookup })).ok).toBe(false);
    expect(r.calls).toHaveLength(0);
    vi.restoreAllMocks();
    recorder(301, "", { location: "http://10.0.0.1/" });
    const moved = await sendSlack(payload, { url: "https://hooks.slack.com/services/T/B/x" }, { lookup: publicLookup });
    expect(moved.error).toBe("Slack answered HTTP 301, a redirect; alerts do not follow redirects, so use the final URL");
  });
});

describe("smtp", () => {
  let server: net.Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  function fakeSmtp(): Promise<{ port: number; transcript: string[] }> {
    const transcript: string[] = [];
    return new Promise((resolve) => {
      server = net.createServer((sock) => {
        sock.setEncoding("utf8");
        sock.write("220 fake ESMTP\r\n");
        let inData = false;
        let buf = "";
        sock.on("data", (d: string) => {
          buf += d;
          let i: number;
          while ((i = buf.indexOf("\r\n")) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 2);
            transcript.push(line);
            if (inData) {
              if (line === ".") {
                inData = false;
                sock.write("250 queued\r\n");
              }
              continue;
            }
            if (line.startsWith("EHLO")) sock.write("250-fake\r\n250 AUTH PLAIN\r\n");
            else if (line.startsWith("AUTH PLAIN")) sock.write("235 ok\r\n");
            else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) sock.write("250 ok\r\n");
            else if (line === "DATA") {
              inData = true;
              sock.write("354 go\r\n");
            } else if (line === "QUIT") {
              sock.write("221 bye\r\n");
              sock.end();
            }
          }
        });
      });
      server.listen(0, "127.0.0.1", () => resolve({ port: (server!.address() as net.AddressInfo).port, transcript }));
    });
  }

  it("delivers a plain-text alert over localhost SMTP with AUTH PLAIN", async () => {
    const { port, transcript } = await fakeSmtp();
    const res = await sendSmtp(payload, { url: `smtp://u:p@127.0.0.1:${port}`, from: "alerts@acme.example", to: ["me@acme.example"] });
    expect(res).toEqual({ channel: "email", ok: true, status: "sent" });
    expect(transcript).toContain("MAIL FROM:<alerts@acme.example>");
    expect(transcript).toContain("RCPT TO:<me@acme.example>");
    expect(transcript.some((l) => l.startsWith("Subject: Acme: 1 recommendation gained"))).toBe(true);
    expect(transcript.some((l) => l.includes("https://app.example/app/run/r1#q-q01"))).toBe(true);
  });

  it("refuses a remote server without STARTTLS, and bad addresses", async () => {
    expect((await sendSmtp(payload, { url: "smtp://u:p@mail.example:587", from: "a@b.example", to: ["bad address"] })).error).toMatch(/plain addresses/);
    const res = await sendSmtp(
      payload,
      { url: "smtp://u:p@mail.example:587", from: "a@b.example", to: ["c@d.example"] },
      {
        connect: async () => {
          const { port } = await fakeSmtp();
          return net.connect({ host: "127.0.0.1", port });
        },
      },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no STARTTLS/);
    expect(res.error).not.toContain("u:p");
  });
});

describe("deliverAlert", () => {
  const memoryLog = (): DeliveryLog & { recs: DeliveryRecord[] } => {
    const recs: DeliveryRecord[] = [];
    return { recs, list: async () => recs, add: async (r) => void recs.push(r) };
  };

  it("sends once per channel and payload, then reports duplicates", async () => {
    const log = memoryLog();
    const r = recorder(200, "ok");
    const targets = { slack: { url: "https://hooks.slack.com/services/T/B/x" }, webhook: { url: "https://hooks.example/a" } };
    const first = await deliverAlert(payload, ["slack", "webhook", "email"], targets, { log, lookup: publicLookup });
    expect(first.map((x) => x.status)).toEqual(["sent", "sent", "not_configured"]);
    const again = await deliverAlert(payload, ["slack", "webhook"], targets, { log, lookup: publicLookup });
    expect(again.map((x) => x.status)).toEqual(["duplicate", "duplicate"]);
    expect(r.calls).toHaveLength(2);
    expect(JSON.stringify(log.recs)).not.toContain("hooks.");
  });

  it("rate-limits per channel and brand per hour", async () => {
    const log = memoryLog();
    const r = recorder(200, "ok");
    const now = new Date("2026-11-02T10:00:00Z");
    for (let i = 0; i < 2; i++) await log.add({ key: `slack:old${i}`, channel: "slack", brand: "acme.example", at: "2026-11-02T09:30:00Z" });
    const res = await deliverAlert(payload, ["slack"], { slack: { url: "https://hooks.slack.com/x" } }, { log, lookup: publicLookup, maxPerHour: 2, now });
    expect(res[0].status).toBe("rate_limited");
    expect(r.calls).toHaveLength(0);
  });

  it("passes the loopback opt-in through to every channel, off by default", async () => {
    const r = recorder(200, "ok");
    const targets = { slack: { url: "http://localhost:9/slack" }, webhook: { url: "http://127.0.0.1:9/hook" } };
    const loop: HostLookup = async () => [{ address: "127.0.0.1" }];
    const off = await deliverAlert(payload, ["slack", "webhook"], targets, { lookup: loop });
    expect(off.map((x) => x.ok)).toEqual([false, false]);
    expect(r.calls).toHaveLength(0);
    const on = await deliverAlert(payload, ["slack", "webhook"], targets, { lookup: loop, allowLoopback: true });
    expect(on.map((x) => x.status)).toEqual(["sent", "sent"]);
    expect(r.calls).toHaveLength(2);
  });

  it("hands email to the deployment's own provider when given", async () => {
    let sent = 0;
    const res = await deliverAlert(payload, ["email"], {}, { sendEmail: async () => (sent++, true) });
    expect(res[0].status).toBe("sent");
    expect(sent).toBe(1);
  });
});
