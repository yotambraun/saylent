// Unit test for scripts/pseudonymize-run.ts against a tiny synthetic bundle
// (not the real Kestrel run — that's exercised end-to-end by regenerating
// examples/kestrel/run.json + fixtures/run.json). Verifies: word-boundary +
// case-preserving replace, possessive/
// plural suffixes, domain replacement inside URLs and bare hosts, whole-
// bundle coverage (raw_text + nested samples), and that our own brand is
// never touched.
import { describe, expect, it } from "vitest";
import type { RunBundleV1 } from "@saylent/engine/bundle";
import {
  auditOutputHosts,
  isInfrastructureHost,
  buildHostPolicy,
  collectHosts,
  fixTitle,
  mergeMaps,
  pseudonymizeBundle,
  repairTruncatedTail,
  scrubHandleUrl,
  type PseudonymMap,
} from "./pseudonymize-run";

const TEST_MAP: PseudonymMap = {
  names: { Rivalco: "Fictico", "Rival Systems": "Ficti Systems" },
  hosts: { "rivalco.com": "fictico.example", "docs.rivalco.com": "docs.fictico.example" },
};

function tinyBundle(): RunBundleV1 {
  return {
    version: 1,
    run: {
      id: "run-1",
      kind: "audit",
      profile: "smoke",
      status: "done",
      brand: { name: "Our Brand", domain: "ourbrand.example" },
      engines: ["chatgpt"],
      models: { chatgpt: "gpt-test" },
      template_set_version: 1,
      question_set_version: 1,
      started_at: "2026-01-01T00:00:00.000Z",
      finished_at: "2026-01-01T00:05:00.000Z",
      est_cost_usd: 0.1,
      failure: null,
    },
    brand_model: {
      brand: "Our Brand",
      domain: "ourbrand.example",
      aliases: ["Our Brand", "ourbrand"],
      category: "widgets",
      icp: "small teams",
      products: ["Widgets"],
      value_props: ["fast widgets"],
      problems: ["finding widgets"],
      competitors: ["Rivalco"],
      language: "en",
    },
    questions: [{ qid: "q01", text: "Best widget vendor?", qtype: "category" }],
    answers: [
      {
        qid: "q01",
        qtype: "category",
        question: "Best widget vendor?",
        engine: "chatgpt",
        ok: true,
        // possessive + plural + a bare host mention in prose, twice (upper/lower)
        raw_text:
          "RIVALCO's widgets are fine, but many Rivalcos exist. See rivalco.com or https://docs.rivalco.com/intro for details. Our Brand is not mentioned.",
        citations: [{ url: "https://rivalco.com/pricing", title: "Rivalco Pricing" }],
        verdict: {
          brand_present: false,
          mention_type: "absent",
          prominence: "none",
          sentiment: "neutral",
          claims: [],
          other_brands: [{ name: "Rivalco", why: "cheaper widgets" }],
          excerpt: "Rivalco is the top pick.",
        },
        samples: [
          {
            runId: "run-1",
            qid: "q01",
            engine: "chatgpt",
            sampleIdx: 0,
            raw_text: "Nested sample: Rival Systems also competes here.",
            citations: [{ url: "https://rivalco.com/about" }],
            verdict: {
              brand_present: false,
              mention_type: "absent",
              prominence: "none",
              sentiment: "neutral",
              claims: [],
              other_brands: [{ name: "Rival Systems", why: "enterprise widgets" }],
              excerpt: "Rival Systems dominates enterprise.",
            },
            usage: null,
          },
        ],
      },
    ],
    citations: [
      {
        runId: "run-1",
        brandId: "b1",
        qid: "q01",
        engine: "chatgpt",
        url: "https://rivalco.com/pricing",
        normUrl: "https://rivalco.com/pricing",
        host: "rivalco.com",
        position: 1,
      },
    ],
    corpus_pages: [
      {
        url: "https://rivalco.com/pricing",
        final_url: "https://rivalco.com/pricing",
        title: "Rivalco Pricing",
        page_type: "brand_owned",
        cited_by: { chatgpt: 1 },
        cited_for_qids: ["q01"],
        fetch_status: 200,
        brand_present: true,
        brand_context: "Rivalco offers tiered plans.",
        competitors_present: [],
        opportunity: false,
      },
    ],
    domain_checks: [{ check: "robots: GPTBot", status: "pass", detail: "allowed" }],
    fixes: [
      {
        fixKey: "beat-rivalco",
        title: "Get cited where Rivalco is cited",
        factor: "citation_source_gap",
        weight: 5,
        effort: "M",
        timeToImpact: "weeks",
        engines: ["chatgpt"],
        evidence: ["Rivalco cited x2"],
        artifact: "Reach out and mention Rivalco's roundup at rivalco.com.",
      },
    ],
    scores: {
      overall: { answered: 1, rec_rate: 0, mentioned: 0, recommended: 0, mention_rate: 0 },
      per_engine: {},
      share_of_voice: { Rivalco: 3, "Our Brand": 1 },
    } as unknown as RunBundleV1["scores"],
    health: null,
  };
}

describe("pseudonymizeBundle", () => {
  const { bundle: out, counts } = pseudonymizeBundle(tinyBundle(), TEST_MAP);

  it("replaces the name case-preservingly, with possessive and plural suffixes kept", () => {
    expect(out.answers[0].raw_text).toContain("FICTICO's widgets"); // upper preserved + possessive kept
    expect(out.answers[0].raw_text).toContain("many Ficticos exist"); // plural kept
  });

  it("replaces bare hosts and hosts embedded in full URLs, longest-subdomain first", () => {
    expect(out.answers[0].raw_text).toContain("See fictico.example or https://docs.fictico.example/intro");
    expect(out.citations[0].url).toBe("https://fictico.example/pricing");
    expect(out.citations[0].host).toBe("fictico.example");
    expect(out.corpus_pages[0].url).toBe("https://fictico.example/pricing");
  });

  it("reaches nested answer.samples, not just the top-level answer", () => {
    expect(out.answers[0].samples[0].raw_text).toBe("Nested sample: Ficti Systems also competes here.");
    expect(out.answers[0].samples[0].verdict?.other_brands).toEqual([
      { name: "Ficti Systems", why: "enterprise widgets" },
    ]);
  });

  it("applies inside verdict.other_brands, fixes, evidence, and artifacts", () => {
    expect(out.answers[0].verdict?.other_brands).toEqual([{ name: "Fictico", why: "cheaper widgets" }]);
    expect(out.fixes[0].title).toBe("Get cited where Fictico is cited");
    expect(out.fixes[0].evidence[0]).toBe("Fictico cited x2");
    expect(out.fixes[0].artifact).toBe("Reach out and mention Fictico's roundup at fictico.example.");
  });

  it("applies inside share-of-voice rows", () => {
    const sov = (out.scores as unknown as { share_of_voice: Record<string, number> }).share_of_voice;
    expect(sov.Fictico).toBe(3);
    expect(sov["Our Brand"]).toBe(1);
  });

  it("keeps our own brand and its aliases byte-for-byte untouched", () => {
    expect(out.run.brand).toEqual({ name: "Our Brand", domain: "ourbrand.example" });
    expect(out.brand_model.aliases).toEqual(["Our Brand", "ourbrand"]);
    expect(out.brand_model.brand).toBe("Our Brand");
    expect(out.brand_model.domain).toBe("ourbrand.example");
  });

  it("counts replacements per field, all nonzero where a real name/host appeared", () => {
    expect(counts.answers).toBeGreaterThan(0);
    expect(counts.citations).toBeGreaterThan(0);
    expect(counts.corpus_pages).toBeGreaterThan(0);
    expect(counts.fixes).toBeGreaterThan(0);
    expect(counts.scores).toBeGreaterThan(0);
    expect(counts.brand_model).toBeGreaterThan(0); // brand_model.competitors: ["Rivalco"]
    expect(counts.health).toBe(0); // null field, nothing to replace
  });

  it("repairs a lone surrogate (an upstream mid-emoji truncation) so output is deterministic", () => {
    const bundle = tinyBundle();
    // "\ud83d" alone is a lone high surrogate — one half of an emoji, exactly
    // what a raw UTF-16 length cut can leave behind (found for real in the
    // Kestrel Uptime capture's verdict.excerpt for q14/claude).
    bundle.answers[0].verdict!.excerpt = "cut mid-emoji: \ud83d";
    const { bundle: fixed, repairs } = pseudonymizeBundle(bundle, TEST_MAP);
    expect(fixed.answers[0].verdict?.excerpt).toBe("cut mid-emoji: ");
    expect(/[\uD800-\uDFFF]/.test(fixed.answers[0].verdict?.excerpt ?? "")).toBe(false);
    expect(repairs).toBeGreaterThan(0);
  });

  it("mergeMaps lets an external map override a built-in entry by key", () => {
    const merged = mergeMaps(TEST_MAP, { names: { Rivalco: "Overridden" }, hosts: {} });
    expect(merged.names.Rivalco).toBe("Overridden");
    expect(merged.names["Rival Systems"]).toBe("Ficti Systems"); // untouched entries survive
    expect(merged.hosts["rivalco.com"]).toBe("fictico.example");
  });
});

// ---------------------------------------------------------------------------
// host policy: the public sample's promise is enforced by the SCRIPT, not by
// whoever curated the private map remembering to add a row.
// ---------------------------------------------------------------------------

/** tinyBundle() with an unmapped third-party host, a public platform, a
 *  personal handle (in a path AND in a per-user subdomain), and a page title
 *  that names the site it came from. */
function policyBundle(): RunBundleV1 {
  const b = tinyBundle();
  b.answers[0].citations = [
    { url: "https://www.widgetsly.io/blog/best-widgets", title: "The 9 Best Widgets of 2026 | Widgetsly" },
    { url: "https://en.wikipedia.org/wiki/Widget", title: "Widget" },
    { url: "https://medium.com/@somebody/why-widgets-2f7a60", title: "Why widgets | by A Person | Medium" },
    { url: "https://someperson.medium.com/widgets-again", title: "Widgets again" },
  ];
  b.citations = [
    { runId: "run-1", brandId: "b1", qid: "q01", engine: "chatgpt", url: "https://www.widgetsly.io/blog/best-widgets", normUrl: "https://www.widgetsly.io/blog/best-widgets", host: "www.widgetsly.io", position: 1 },
    { runId: "run-1", brandId: "b1", qid: "q01", engine: "chatgpt", url: "https://someperson.medium.com/widgets-again", normUrl: "https://someperson.medium.com/widgets-again", host: "someperson.medium.com", position: 2 },
  ] as unknown as RunBundleV1["corpus_pages"] extends never ? never : RunBundleV1["citations"];
  b.corpus_pages[0].url = "https://docs.widgetsly.io/pricing";
  b.corpus_pages[0].final_url = "https://docs.widgetsly.io/pricing";
  b.corpus_pages[0].title = "Pricing — Widgetsly Docs";
  b.corpus_pages[0].contact = { mailto: "hello@widgetsly.io" } as unknown as never;
  b.corpus_pages[0].brand_context = "Linked from https://ourbrand.example/pricing.";
  return b;
}

describe("infrastructure keep-list", () => {
  it("keeps a protected phrase real even when a shorter map entry would eat part of it", () => {
    const bundle = JSON.parse(JSON.stringify(tinyBundle())) as RunBundleV1;
    bundle.fixes[0].artifact = "Check AWS CloudFront and Cloudflare bot rules; AWS Lambda is separate.";
    const map: PseudonymMap = {
      names: { AWS: "Cloudmere", Cloudflare: "Edgeshield" },
      hosts: {},
      keep: ["AWS CloudFront", "Cloudflare"],
    };
    const out = pseudonymizeBundle(bundle, map).bundle;
    expect(out.fixes[0].artifact).toContain("AWS CloudFront");
    expect(out.fixes[0].artifact).toContain("Cloudflare");
    expect(out.fixes[0].artifact).toContain("Cloudmere Lambda");
    expect(out.fixes[0].artifact).not.toContain("Edgeshield");
  });

  it("keeps infrastructure documentation hosts real and does not report them as leaks", () => {
    const bundle = JSON.parse(JSON.stringify(tinyBundle())) as RunBundleV1;
    bundle.fixes[0].artifact = "See https://developers.cloudflare.com/bots/ and https://docs.fastly.com/";
    const out = pseudonymizeBundle(bundle, { names: {}, hosts: {} }).bundle;
    expect(out.fixes[0].artifact).toContain("developers.cloudflare.com");
    expect(out.fixes[0].artifact).toContain("docs.fastly.com");
    expect(auditOutputHosts(out)).toEqual([]);
    expect(isInfrastructureHost("developers.cloudflare.com")).toBe(true);
    expect(isInfrastructureHost("cloudflare.com.evil.example")).toBe(false);
  });
});

describe("host policy", () => {
  const map: PseudonymMap = { names: {}, hosts: {} };
  const bundle = policyBundle();

  it("finds every host in the bundle, not just citation.host rows", () => {
    const hosts = collectHosts(bundle);
    expect(hosts).toContain("www.widgetsly.io");
    expect(hosts).toContain("docs.widgetsly.io");
    expect(hosts).toContain("someperson.medium.com");
    expect(hosts).toContain("en.wikipedia.org");
  });

  it("pseudonymizes an unmapped third-party host onto .example, base included", () => {
    const { hosts } = buildHostPolicy(bundle, map);
    expect(hosts["widgetsly.io"]).toMatch(/^[a-z0-9-]+\.example$/);
    expect(hosts["www.widgetsly.io"]).toBe(`www.${hosts["widgetsly.io"]}`);
    expect(hosts["docs.widgetsly.io"]).toBe(`docs.${hosts["widgetsly.io"]}`);
  });

  it("is deterministic — the same real host always lands on the same pseudonym", () => {
    const a = buildHostPolicy(policyBundle(), { names: {}, hosts: {} }).hosts["widgetsly.io"];
    const b = buildHostPolicy(policyBundle(), { names: {}, hosts: {} }).hosts["widgetsly.io"];
    expect(a).toBe(b);
  });

  it("keeps public platforms, technical hosts and our own brand domain", () => {
    const { hosts, rows } = buildHostPolicy(bundle, map);
    expect(hosts["en.wikipedia.org"]).toBeUndefined();
    const reason = (h: string) => rows.find((r) => r.host === h)?.reason;
    expect(reason("en.wikipedia.org")).toBe("public-platform");
    expect(reason("ourbrand.example")).toBe("own-brand");
  });

  it("a curated row still wins over the allow-list (stricter direction only)", () => {
    const { hosts } = buildHostPolicy(bundle, { names: {}, hosts: { "en.wikipedia.org": "encyclopedia.example" } });
    expect(hosts["en.wikipedia.org"]).toBe("encyclopedia.example");
  });

  it("leaves no non-.example host outside the kept set in the output", () => {
    const { bundle: out } = pseudonymizeBundle(bundle, map);
    expect(auditOutputHosts(out)).toEqual([]);
  });
});

describe("personal identities", () => {
  it("scrubs a handle path on a kept platform to /author-profile", () => {
    expect(scrubHandleUrl("https://medium.com/@somebody/why-widgets-2f7a60").url).toBe(
      "https://medium.com/author-profile",
    );
    expect(scrubHandleUrl("https://reddit.com/u/somebody").url).toBe("https://reddit.com/author-profile");
    expect(scrubHandleUrl("https://reddit.com/r/sysadmin/comments/abc").changed).toBe(false);
    expect(scrubHandleUrl("https://en.wikipedia.org/wiki/Widget").changed).toBe(false);
  });

  it("folds a per-user subdomain back onto the bare platform", () => {
    expect(scrubHandleUrl("https://someperson.medium.com/widgets-again").url).toBe(
      "https://medium.com/author-profile",
    );
  });

  it("strips an author byline out of a page title", () => {
    expect(fixTitle("Why widgets | by A Person | Medium", "medium.com", {})).toBe("Why widgets | Medium");
  });

  it("removes every trace of the handle from the pseudonymized bundle", () => {
    const { bundle: out } = pseudonymizeBundle(policyBundle(), { names: {}, hosts: {} });
    const json = JSON.stringify(out);
    expect(json).not.toContain("medium.com/@");
    expect(json).not.toContain("someperson.medium.com");
    expect(json).not.toContain("by A Person");
    expect(json).toContain("medium.com/author-profile");
  });
});

describe("page titles agree with the URL they sit next to", () => {
  it("renames the site's own name in a title to the host's pseudonym", () => {
    const hostMap = { "widgetsly.io": "northvale.example" };
    expect(fixTitle("The 9 Best Widgets of 2026 | Widgetsly", "www.widgetsly.io", hostMap)).toBe(
      "The 9 Best Widgets of 2026 | Northvale",
    );
    // a bare-host title and a "Name.com" title collapse to the same pseudonym
    expect(fixTitle("widgetsly.io", "widgetsly.io", hostMap)).toBe("Northvale");
    expect(fixTitle("Widgetsly.io: Pricing", "widgetsly.io", hostMap)).toBe("Northvale: Pricing");
  });

  it("does not fuzzy-match an ordinary phrase that merely shares letters", () => {
    // "isdown.app" must not eat the words "is down"
    expect(fixTitle("The site is down again", "isdown.app", { "isdown.app": "northvale.example" })).toBe(
      "The site is down again",
    );
  });
});

describe("casing and truncation damage", () => {
  it("a multi-word entry does not eat an ordinary sentence in another casing", () => {
    const b = tinyBundle();
    b.answers[0].raw_text = "Will Rival alert us when a dependency fails? Rival Alert says yes.";
    const { bundle: out } = pseudonymizeBundle(b, {
      names: { "Rival Alert": "Ficti Alert" },
      hosts: {},
    });
    expect(out.answers[0].raw_text).toBe("Will Rival alert us when a dependency fails? Ficti Alert says yes.");
  });

  it("an ALL-CAPS acronym entry never up-cases its pseudonym", () => {
    const b = tinyBundle();
    b.answers[0].raw_text = "Running on ABC today.";
    (b.scores as unknown as { share_of_voice: Record<string, number> }).share_of_voice = { ABC: 4 };
    const { bundle: out } = pseudonymizeBundle(b, { names: { ABC: "Zephyr" }, hosts: {} });
    expect(out.answers[0].raw_text).toBe("Running on Zephyr today.");
    const sov = (out.scores as unknown as { share_of_voice: Record<string, number> }).share_of_voice;
    expect(Object.keys(sov)).toEqual(["Zephyr"]);
  });

  it("completes a real name that an upstream preview cut in half", () => {
    const head = "Top picks for small teams, ranked by what the assistants actually recommended: ";
    const cut = `${head}Rivalc`;
    const { text, repaired } = repairTruncatedTail(cut, [["Rivalco", "Fictico"]], {
      minFragment: 5,
      caseSensitive: true,
    });
    expect(text).toBe(`${head}Fictico`);
    expect(repaired).not.toBeNull();
  });

  it("never fires on a cut ordinary word (case-sensitive names, dotted hosts)", () => {
    const head = "This one is a general status page rather than a website uptime ";
    expect(repairTruncatedTail(`${head}monito`, [["monitorplatform.com", "x.example"]], {
      minFragment: 6,
      requireDot: true,
    }).repaired).toBeNull();
    expect(repairTruncatedTail(`${head}rivalc`, [["Rivalco", "Fictico"]], {
      minFragment: 5,
      caseSensitive: true,
    }).repaired).toBeNull();
  });

  it("repairs the cut inside a real excerpt field end to end", () => {
    const b = tinyBundle();
    b.answers[0].verdict!.excerpt =
      "Best for small teams: **Rivalco**. Best if you already run your own stack: **Rivalc";
    const { bundle: out, truncations } = pseudonymizeBundle(b, TEST_MAP);
    expect(out.answers[0].verdict?.excerpt?.endsWith("**Fictico")).toBe(true);
    expect(truncations.length).toBe(1);
  });
});

describe("our own domain is masked during replacement", () => {
  it("replaces a name in prose without corrupting the brand domain that contains it", () => {
    const b = tinyBundle();
    b.run.brand = { name: "Our Brand", domain: "ourbrand.driftly.app" };
    b.brand_model.domain = "ourbrand.driftly.app";
    b.answers[0].raw_text = "Deploy on Driftly, or self-host. Our site is https://ourbrand.driftly.app/pricing.";
    const { bundle: out } = pseudonymizeBundle(b, { names: { Driftly: "Skyward" }, hosts: {} });
    expect(out.answers[0].raw_text).toBe(
      "Deploy on Skyward, or self-host. Our site is https://ourbrand.driftly.app/pricing.",
    );
    expect(out.run.brand.domain).toBe("ourbrand.driftly.app");
  });
});
