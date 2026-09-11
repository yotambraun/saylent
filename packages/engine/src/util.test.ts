// the spec (see METHODOLOGY.md) "Done when" + the spec (see METHODOLOGY.md) testing floor — vitest cases incl. the
// "Acmeology" non-match.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostLookup } from "./util";
import {
  clearVettedHosts,
  contextExcerpt,
  isBlockedHost,
  isPrivateIp,
  makePinnedLookup,
  normUrl,
  parseJsonLoosely,
  safeFetch,
  stripHtmlToText,
  unwrapArchiveUrl,
  wordPresent,
} from "./util";

describe("isBlockedHost", () => {
  it("blocks localhost + loopback", () => {
    expect(isBlockedHost("localhost")).toBe(true);
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("::1")).toBe(true);
    expect(isBlockedHost("0.0.0.0")).toBe(true);
  });
  it("blocks RFC1918 + link-local ranges", () => {
    expect(isBlockedHost("10.0.0.5")).toBe(true);
    expect(isBlockedHost("192.168.1.1")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("172.16.0.1")).toBe(true);
    expect(isBlockedHost("172.31.255.255")).toBe(true);
  });
  it("allows public hosts (incl. 172.x outside the private block)", () => {
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false);
    expect(isBlockedHost("172.15.0.1")).toBe(false);
  });
  it("blocks encoded IPv4 evasion forms (decimal/hex/octal)", () => {
    expect(isBlockedHost("2130706433")).toBe(true); // decimal 127.0.0.1
    expect(isBlockedHost("0x7f000001")).toBe(true); // hex 127.0.0.1
    expect(isBlockedHost("0177.0.0.1")).toBe(true); // octal-leading first octet
    expect(isBlockedHost("192.168.001.1")).toBe(true); // leading-zero octet
  });
  it("blocks private/reserved IPv6 literals (bracketed or bare) but allows public v6", () => {
    expect(isBlockedHost("[::1]")).toBe(true);
    expect(isBlockedHost("::1")).toBe(true);
    expect(isBlockedHost("[fc00::1]")).toBe(true); // unique-local
    expect(isBlockedHost("fe80::1")).toBe(true); // link-local
    expect(isBlockedHost("[::ffff:127.0.0.1]")).toBe(true); // v4-mapped loopback
    expect(isBlockedHost("[2606:4700:4700::1111]")).toBe(false); // public (Cloudflare DNS)
  });
  it("blocks empty host", () => {
    expect(isBlockedHost("")).toBe(true);
  });
});

describe("isPrivateIp (post-DNS-resolution check)", () => {
  it("flags private/loopback/link-local IPv4", () => {
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
  });
  it("flags private/reserved IPv6 (incl. v4-mapped)", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.5")).toBe(true);
  });
  it("passes public addresses through", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
});

describe("safeFetch SSRF guards (mocked fetch + resolver)", () => {
  const publicLookup: HostLookup = async () => [{ address: "93.184.216.34" }];
  afterEach(() => vi.restoreAllMocks());

  it("rejects a non-http(s) scheme without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("file:///etc/passwd");
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a private IP literal (cloud metadata) without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("http://169.254.169.254/latest/meta-data/");
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an encoded-decimal IPv4 host without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("http://2130706433/");
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks DNS rebinding — a public hostname resolving to a private IP", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("http://rebind.evil.example/", {
      lookup: async () => [{ address: "10.0.0.5" }],
    });
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-resolves each redirect hop — a redirect to a host resolving private is blocked", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://rebind.example/" } }));
    const lookup: HostLookup = async (h) =>
      h === "example.com" ? [{ address: "93.184.216.34" }] : [{ address: "10.0.0.5" }];
    const r = await safeFetch("https://example.com/", { lookup });
    expect(r.status).toBe(0);
    expect(fetchSpy).toHaveBeenCalledOnce(); // hop 0 fetched; hop 1 blocked before fetch
  });

  it("fetches a public host that resolves public", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html>ok</html>", { status: 200 }));
    const r = await safeFetch("https://example.com/", { lookup: publicLookup });
    expect(r.status).toBe(200);
    expect(r.text).toContain("ok");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("caps the response body at ~2MB", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("a".repeat(3_000_000), { status: 200 }));
    const r = await safeFetch("https://example.com/", { lookup: publicLookup });
    expect(r.text.length).toBeLessThanOrEqual(2_000_000);
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("fails closed when DNS resolution returns nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("https://example.com/", { lookup: async () => [] });
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// allowPrivate. The regression requirement is
// literal: every test above (allowPrivate unset / false) must keep passing
// unchanged — these only ADD coverage for the true case.
describe("safeFetch allowPrivate (F6)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("default (allowPrivate unset) still rejects a private-IP literal — byte-identical guard", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("http://192.168.1.50/");
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allowPrivate:true fetches a private-IP literal host", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("<html>staging</html>", { status: 200 }));
    const r = await safeFetch("http://192.168.1.50/", {
      allowPrivate: true,
      lookup: async () => [{ address: "192.168.1.50" }],
    });
    expect(r.status).toBe(200);
    expect(r.text).toContain("staging");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("allowPrivate:true still fetches a host that DNS-resolves into a private range (no rebind rejection)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));
    const r = await safeFetch("http://staging.internal.example/", {
      allowPrivate: true,
      lookup: async () => [{ address: "10.0.0.9" }],
    });
    expect(r.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("allowPrivate:true still fails closed when DNS resolves nothing at all", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("http://unresolvable.example/", {
      allowPrivate: true,
      lookup: async () => [],
    });
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allowPrivate:true does NOT bypass the non-http(s) scheme rejection", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await safeFetch("file:///etc/passwd", { allowPrivate: true });
    expect(r.status).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The reserved ranges the original guard missed. Each row is an
// address a resolver can legitimately hand back for an attacker-chosen name.
// ---------------------------------------------------------------------------
describe("isPrivateIp / isBlockedHost — reserved ranges", () => {
  it("blocks 100.64.0.0/10 (CGNAT)", () => {
    expect(isPrivateIp("100.64.0.1")).toBe(true);
    expect(isPrivateIp("100.100.50.7")).toBe(true);
    expect(isPrivateIp("100.127.255.255")).toBe(true);
    expect(isBlockedHost("100.64.0.1")).toBe(true);
    // the edges of the range are still public
    expect(isPrivateIp("100.63.255.255")).toBe(false);
    expect(isPrivateIp("100.128.0.1")).toBe(false);
  });

  it("blocks 192.0.0.0/24 (IETF protocol assignments)", () => {
    expect(isPrivateIp("192.0.0.170")).toBe(true);
    expect(isBlockedHost("192.0.0.8")).toBe(true);
    expect(isPrivateIp("192.0.1.1")).toBe(false);
  });

  it("blocks 198.18.0.0/15 (benchmarking)", () => {
    expect(isPrivateIp("198.18.0.1")).toBe(true);
    expect(isPrivateIp("198.19.255.254")).toBe(true);
    expect(isBlockedHost("198.18.0.1")).toBe(true);
    expect(isPrivateIp("198.20.0.1")).toBe(false);
  });

  it("blocks 224.0.0.0/4 (multicast)", () => {
    expect(isPrivateIp("224.0.0.1")).toBe(true);
    expect(isPrivateIp("239.255.255.250")).toBe(true);
    expect(isBlockedHost("239.255.255.250")).toBe(true);
    expect(isPrivateIp("223.255.255.255")).toBe(false);
  });

  it("blocks 240.0.0.0/4 including 255.255.255.255 (reserved / broadcast)", () => {
    expect(isPrivateIp("240.0.0.1")).toBe(true);
    expect(isPrivateIp("255.255.255.255")).toBe(true);
    expect(isBlockedHost("255.255.255.255")).toBe(true);
  });

  it("blocks the HEX spelling of an IPv4-mapped IPv6 address (::ffff:xxxx:xxxx)", () => {
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateIp("::ffff:0a00:0005")).toBe(true); // 10.0.0.5
    expect(isBlockedHost("[::ffff:a9fe:a9fe]")).toBe(true);
    expect(isPrivateIp("::ffff:5db8:d822")).toBe(false); // 93.184.216.34, public
  });

  it("blocks NAT64 64:ff9b::/96 by the v4 it embeds", () => {
    expect(isPrivateIp("64:ff9b::a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateIp("64:ff9b::169.254.169.254")).toBe(true);
    expect(isBlockedHost("[64:ff9b::7f00:1]")).toBe(true); // 127.0.0.1
    expect(isPrivateIp("64:ff9b::5db8:d822")).toBe(false); // 93.184.216.34, public
  });

  it("keeps every pre-existing verdict (regression floor)", () => {
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.5")).toBe(true);
    expect(isPrivateIp("fd12:3456::1")).toBe(true);
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isBlockedHost("example.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The vetted address is pinned for the socket. The proving case is
// a resolver that answers "public" for the guard's check and "private" for
// the connection: the request must FAIL, not connect.
// ---------------------------------------------------------------------------
describe("safeFetch pins the vetted address (TOCTOU)", () => {
  afterEach(() => {
    clearVettedHosts();
    vi.restoreAllMocks();
  });

  it("fails closed when the lookup flips public -> private between the check and the connect", async () => {
    let calls = 0;
    const flipping: HostLookup = async () => {
      calls += 1;
      return calls === 1 ? [{ address: "93.184.216.34" }] : [{ address: "169.254.169.254" }];
    };
    const r = await safeFetch("https://toctou.example/", { lookup: flipping, timeoutMs: 5000 });
    expect(r.status).toBe(0);
    // >= 2 proves the pinned dispatcher re-resolved at connect time; if the
    // socket had used the OS resolver instead, this would still be 1.
    expect(calls).toBeGreaterThanOrEqual(2);
  }, 20000);

  it("the pinned connect.lookup only ever returns addresses that were vetted AND still public", async () => {
    const registry = new Map<string, { addresses: string[]; allowPrivate: boolean; lookup: HostLookup }>();
    const lookupOf = (addr: string): HostLookup => async () => [{ address: addr }];

    const call = (host: string, all: boolean) =>
      new Promise<{ err: Error | null; value: unknown }>((resolve) => {
        makePinnedLookup(registry)(host, { all }, (err, value) => resolve({ err, value }));
      });

    // never vetted at all
    expect((await call("unknown.example", true)).err?.message).toMatch(/not vetted/);

    // vetted public, answer unchanged -> allowed
    registry.set("ok.example", {
      addresses: ["93.184.216.34"],
      allowPrivate: false,
      lookup: lookupOf("93.184.216.34"),
    });
    const ok = await call("ok.example", true);
    expect(ok.err).toBeNull();
    expect(ok.value).toEqual([{ address: "93.184.216.34", family: 4 }]);
    const okSingle = await call("ok.example", false);
    expect(okSingle.value).toBe("93.184.216.34");

    // vetted public, but DNS now answers a private address -> refused
    registry.set("flip.example", {
      addresses: ["93.184.216.34"],
      allowPrivate: false,
      lookup: lookupOf("169.254.169.254"),
    });
    expect((await call("flip.example", true)).err?.message).toMatch(/changed after validation/);

    // vetted public, DNS now answers a DIFFERENT public address -> still
    // refused: only the pinned address may be connected to.
    registry.set("swap.example", {
      addresses: ["93.184.216.34"],
      allowPrivate: false,
      lookup: lookupOf("8.8.8.8"),
    });
    expect((await call("swap.example", true)).err?.message).toMatch(/changed after validation/);

    // allowPrivate:true keeps the F6 behavior for a host vetted that way
    registry.set("staging.example", {
      addresses: ["10.0.0.9"],
      allowPrivate: true,
      lookup: lookupOf("10.0.0.9"),
    });
    const priv = await call("staging.example", false);
    expect(priv.err).toBeNull();
    expect(priv.value).toBe("10.0.0.9");
  });
});

describe("normUrl", () => {
  it("lowercases scheme+host, keeps path case", () => {
    expect(normUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/Path");
  });
  it("strips fragment", () => {
    expect(normUrl("https://a.com/x#frag")).toBe("https://a.com/x");
  });
  it("strips utm_*/ref/fbclid/gclid, keeps others", () => {
    expect(normUrl("https://a.com/x?utm_source=1&ref=2&fbclid=3&gclid=4&page=5")).toBe(
      "https://a.com/x?page=5",
    );
  });
  it("strips trailing slash but keeps root", () => {
    expect(normUrl("https://a.com/path/")).toBe("https://a.com/path");
    expect(normUrl("https://a.com/")).toBe("https://a.com/");
    expect(normUrl("https://a.com")).toBe("https://a.com/");
  });
  it("returns unparseable input unchanged", () => {
    expect(normUrl("not a url")).toBe("not a url");
  });
});

describe("unwrapArchiveUrl", () => {
  it("passes a plain (non-archive) url through unchanged", () => {
    expect(unwrapArchiveUrl("https://reddit.com/r/cdn/best")).toBe("https://reddit.com/r/cdn/best");
    expect(unwrapArchiveUrl("not a url")).toBe("not a url");
  });
  it("recovers the original from the id_ snapshot form", () => {
    expect(
      unwrapArchiveUrl("https://web.archive.org/web/20240101000000id_/https://reddit.com/r/cdn/best"),
    ).toBe("https://reddit.com/r/cdn/best");
  });
  it("recovers the original from a bare timestamped capture (non-id_)", () => {
    expect(
      unwrapArchiveUrl("https://web.archive.org/web/20240101000000/https://reddit.com/r/cdn/best"),
    ).toBe("https://reddit.com/r/cdn/best");
  });
});

describe("wordPresent", () => {
  it("matches whole words case-insensitively", () => {
    expect(wordPresent("Acme", "we recommend ACME for teams")).toBe(true);
  });
  it("must NOT match substrings (Acmeology)", () => {
    expect(wordPresent("Acme", "the study of Acmeology")).toBe(false);
    expect(wordPresent("Acme", "superAcme is different")).toBe(false);
  });
  it("matches at punctuation boundaries", () => {
    expect(wordPresent("Acme", "Try Acme, it's great")).toBe(true);
    expect(wordPresent("Acme", "(Acme)")).toBe(true);
  });
  it("escapes regex specials in aliases", () => {
    expect(wordPresent("acme.com", "visit acme.com today")).toBe(true);
    expect(wordPresent("acme.com", "visit acmeXcom today")).toBe(false);
  });
  it("empty needle never matches", () => {
    expect(wordPresent("", "anything")).toBe(false);
  });
});

describe("contextExcerpt", () => {
  it("returns ±160 chars around first match with ellipses", () => {
    const text = "x".repeat(200) + " Acme " + "y".repeat(200);
    const ex = contextExcerpt("Acme", text);
    expect(ex).toContain("Acme");
    expect(ex.startsWith("…")).toBe(true);
    expect(ex.endsWith("…")).toBe(true);
    expect(ex.length).toBeLessThanOrEqual(160 * 2 + "Acme".length + 4);
  });
  it("returns empty string when absent", () => {
    expect(contextExcerpt("Acme", "nothing here")).toBe("");
  });
});

describe("parseJsonLoosely", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoosely('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips ```json fences", () => {
    expect(parseJsonLoosely('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("extracts first {...} block from prose", () => {
    expect(parseJsonLoosely('Here is the result: {"a":1} hope it helps')).toEqual({ a: 1 });
  });
  it("returns {} for truncated/garbage", () => {
    expect(parseJsonLoosely('{"a": [1, 2')).toEqual({});
    expect(parseJsonLoosely("no json at all")).toEqual({});
  });
});

describe("stripHtmlToText", () => {
  it("removes script/style/noscript/svg and collapses whitespace", () => {
    const html =
      "<html><body><script>evil()</script><style>.x{}</style><p>Hello   world</p><svg><title>ignore</title></svg></body></html>";
    expect(stripHtmlToText(html)).toBe("Hello world");
  });
  it("respects the char limit", () => {
    const html = `<body><p>${"a".repeat(500)}</p></body>`;
    expect(stripHtmlToText(html, 100).length).toBe(100);
  });
});
