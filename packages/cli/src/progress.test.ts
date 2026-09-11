import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fmtElapsed, formatBand, formatStageLine, Progress, wrapSetStage } from "./progress";
import { clearRegisteredSecrets, registerSecret } from "./redact";
import type { RunResult } from "@saylent/engine";
import { resolveRoles } from "@saylent/engine/models";
import { CRAWL_BLOCKED_MARKER, CRAWL_THIN_MARKER } from "@saylent/engine/crawl";

let home: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), "saylent-progress-home-"));
  process.env.HOME = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  process.env.HOME = prevHome;
});

function captureOut() {
  const chunks: string[] = [];
  const out = new PassThrough();
  out.on("data", (c) => chunks.push(c.toString()));
  return { out, lines: () => chunks.join("").split("\n"), raw: () => chunks.join("") };
}

describe("Progress.onStage", () => {
  it("numbers each coarse stage and prints elapsed on transition", () => {
    let now = 1000;
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => now });
    p.onStage("crawl", "acme.example");
    now += 3200;
    p.onStage("brand-model", "Acme Cloud");
    const text = lines().join("\n");
    expect(text).toMatch(/01 crawl.*acme\.example.*3\.2s/);
  });

  it("combines repeated observe calls into one '04 engines' line", () => {
    let now = 0;
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => now });
    p.onStage("observe", "chatgpt");
    p.onLiveLabel("Asking ChatGPT · 8/8 answered");
    p.onStage("observe", "claude"); // same coarse stage — must NOT flush yet
    p.onLiveLabel("Asking Claude · 8/8 answered");
    now = 5000;
    p.onStage("judge", "16 draws"); // stage change flushes the combined line
    const text = lines().join("\n");
    expect(text).toMatch(/04 engines/);
    // "done/total" only — NOT a success claim (observe.ts counts draws
    // PROCESSED, ok or failed; a provider that 429'd every draw still reaches
    // N/N here, so no ✓ belongs on this live line — see reportEngineFailures
    // for the honest post-hoc success/failure line).
    expect(text).toContain("chatgpt 8/8");
    expect(text).not.toContain("chatgpt 8/8 ✓");
    expect(text).toContain("claude 8/8");
    // only ONE "engines" line, not two
    expect(text.match(/04 engines/g)?.length).toBe(1);
  });

  // A stage run-audit.ts skipped by request never
  // actually ran, so the line must not carry an elapsed time next to it.
  it("a stage marked 'skipped by request' prints without an elapsed time", () => {
    let now = 1000;
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => now });
    p.onStage("corpus", "skipped by request");
    now += 3200;
    p.onStage("domain-checks", "skipped by request");
    const text = lines().join("\n");
    expect(text).toMatch(/06 cited pages skipped by request\s*$/m);
    expect(text).not.toMatch(/06 cited pages skipped by request.*\d+\.\ds/);
  });

  it("a normal (non-skipped) stage keeps printing its elapsed time", () => {
    let now = 1000;
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => now });
    p.onStage("corpus", "8 answers");
    now += 1500;
    p.onStage("domain-checks", "acme.example");
    const text = lines().join("\n");
    expect(text).toMatch(/06 cited pages 8 answers\s+1\.5s/);
  });
});

// crawlSite relays a blocked/thin-site notice
// through its EXISTING onProgress parameter, tagged with CRAWL_BLOCKED_MARKER
// / CRAWL_THIN_MARKER; run-audit.ts's unchanged wiring turns that into a
// db.setStage("Crawling your site · <marker> ... (<n> pages)") call, which
// wrapSetStage routes to onLiveLabel below.
describe("Progress.onLiveLabel — crawl-issue notices (F3)", () => {
  it("prints a blocked-crawler notice immediately, once", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 0 });
    const label = `Crawling your site · ${CRAWL_BLOCKED_MARKER} 403 — looks like a bot-block/WAF challenge page (0 pages)`;
    p.onLiveLabel(label);
    p.onLiveLabel(label); // a repeat must not print twice
    const text = lines().join("\n");
    expect(text.split(CRAWL_BLOCKED_MARKER).length - 1).toBe(1);
    expect(text).toContain("403");
  });

  it("prints a thin-site notice immediately", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 0 });
    p.onLiveLabel(`Crawling your site · ${CRAWL_THIN_MARKER} mostly JS-rendered (4 pages)`);
    expect(lines().join("\n")).toContain(CRAWL_THIN_MARKER);
  });

  it("does not confuse an 'Asking <Engine>' label with a crawl-issue label", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 0 });
    p.onLiveLabel("Asking ChatGPT · 3/8 answered");
    const text = lines().join("\n");
    expect(text).not.toContain(CRAWL_BLOCKED_MARKER);
    expect(text).not.toContain(CRAWL_THIN_MARKER);
  });
});

function fakeResult(overrides: Partial<RunResult> = {}): RunResult {
  const emptyPerEngine = () => ({ answered: 0, recommended: 0, mentioned: 0, rec_rate: null, mention_rate: null });
  return {
    status: "done",
    runId: "r1",
    kind: "audit",
    profile: "smoke",
    engines: ["chatgpt", "claude"],
    brandModel: {
      brand: "Acme",
      domain: "acme.example",
      aliases: ["Acme"],
      category: "cdn",
      icp: "teams",
      products: [],
      value_props: [],
      problems: [],
      competitors: [],
      language: "en",
    },
    frozenQuestions: [],
    questions: [{ qid: "q01", text: "x", qtype: "category" }],
    questionSetVersion: 1,
    templateSetVersion: 1,
    models: {},
    // single-provider mode: every run states which family judged it
    judgeMode: "cross-family",
    roles: resolveRoles({ openai: true, anthropic: true }),
    sitePages: [],
    draws: [],
    answers: [
      { qid: "q01", qtype: "category", question: "x", engine: "chatgpt", ok: true, raw_text: "", citations: [] },
      // F2 — the real shape shared.ts's failed() now produces: "<kind>: <message>".
      { qid: "q01", qtype: "category", question: "x", engine: "claude", ok: false, raw_text: "", citations: [], error: "rate_limit: 429 Too Many Requests" },
    ],
    samples: [],
    citations: [],
    corpus: [],
    checks: [],
    fixes: [],
    scores: {
      per_engine: { chatgpt: { answered: 1, recommended: 1, mentioned: 1, rec_rate: 1, mention_rate: 1 }, claude: emptyPerEngine(), gemini: emptyPerEngine(), perplexity: emptyPerEngine() },
      overall: { answered: 1, recommended: 1, mentioned: 1, rec_rate: 1, mention_rate: 1 },
      share_of_voice: {},
    },
    judgeCalls: 1,
    parseFailures: 0,
    costUsd: 0.42,
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1000).toISOString(),
    sampling: { samples: 1, tiebreak: false, source: "profile" },
    ...overrides,
  };
}

describe("Progress.reportEngineFailures / finish", () => {
  it("reports an engine with zero ok answers and its error, isolated per engine", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 0 });
    const failed = p.reportEngineFailures(fakeResult());
    expect(failed).toEqual(["claude"]);
    const text = lines().join("\n");
    expect(text).toContain("claude 0/1");
    // F2 — the raw "rate_limit: ..." tag is mapped to the plain-sentence +
    // one-action line, not printed raw.
    expect(text).toContain("Anthropic rate-limited this run");
    expect(text).toContain("continuing with 1 engine");
  });

  // A real production run: gemini 503'd once (5 of 6 ok) and perplexity 429'd 5 times
  // (1 of 6 ok) — neither engine failed OUTRIGHT, so the old zero-ok-only
  // check missed both. Both must print with their success/total, not be
  // silently swallowed, and neither counts as a full "failed" engine (some
  // answers still came back).
  it("reports a PARTIAL failure (some draws ok, some failed) without the 'continuing with N engines' wording", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 0 });
    const partial = fakeResult({
      engines: ["gemini", "perplexity"],
      answers: [
        { qid: "q01", qtype: "category", question: "x", engine: "gemini", ok: true, raw_text: "a", citations: [] },
        { qid: "q02", qtype: "category", question: "y", engine: "gemini", ok: true, raw_text: "b", citations: [] },
        {
          qid: "q03",
          qtype: "category",
          question: "z",
          engine: "gemini",
          ok: false,
          raw_text: "",
          citations: [],
          error: "server: 503 Service Unavailable",
        },
        ...Array.from({ length: 5 }, (_, i) => ({
          qid: `p0${i}`,
          qtype: "category" as const,
          question: "p",
          engine: "perplexity" as const,
          ok: false,
          raw_text: "",
          citations: [],
          error: "rate_limit: 429 Too Many Requests",
        })),
        {
          qid: "p05",
          qtype: "category",
          question: "p",
          engine: "perplexity",
          ok: true,
          raw_text: "c",
          citations: [],
        },
      ],
    });
    const failed = p.reportEngineFailures(partial);
    expect(failed).toEqual([]); // neither engine answered ZERO questions
    const text = lines().join("\n");
    // F2 — mapped to the plain-sentence line, not the raw "<kind>: <message>" tag.
    expect(text).toContain("gemini 2/3 · Gemini is having trouble. The other engines continue. · continuing");
    expect(text).not.toContain("· continuing with");
    expect(text).toContain("perplexity 1/6 · Perplexity rate-limited this run");
    expect(text).toContain("· continuing");
  });

  it("prints Verdict/Band/Report/Verify and the total line", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 90_000 });
    p.finish(fakeResult(), { reportPath: "./out/report.html", verifyPath: "./out/run.json", brandDomain: "acme.example" });
    const text = lines().join("\n");
    expect(text).toContain("Verdict");
    expect(text).toContain("Band");
    expect(text).toContain("Report    ./out/report.html");
    expect(text).toContain("Verify    npx saylent verify ./out/run.json");
    expect(text).toMatch(/Total.*\$0\.42/);
  });

  it("the Verdict denominator is the real judged-answer count, not the static question count", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 90_000 });
    // 5 questions asked, but the run only actually judged 3 answers (a
    // provider outage shrank overall.answered) — the Verdict line must say
    // "of 3", not the misleadingly larger "of 5".
    const result = fakeResult({
      questions: Array.from({ length: 5 }, (_, i) => ({ qid: `q0${i}`, text: "x", qtype: "category" as const })),
      scores: {
        per_engine: {
          chatgpt: { answered: 3, recommended: 1, mentioned: 2, rec_rate: 1 / 3, mention_rate: 2 / 3 },
          claude: { answered: 0, recommended: 0, mentioned: 0, rec_rate: null, mention_rate: null },
          gemini: { answered: 0, recommended: 0, mentioned: 0, rec_rate: null, mention_rate: null },
          perplexity: { answered: 0, recommended: 0, mentioned: 0, rec_rate: null, mention_rate: null },
        },
        overall: { answered: 3, recommended: 1, mentioned: 2, rec_rate: 1 / 3, mention_rate: 2 / 3 },
        share_of_voice: {},
      },
    });
    p.finish(result, { reportPath: "r.html", verifyPath: "r.json", brandDomain: "d" });
    const text = lines().join("\n");
    expect(text).toContain("Mentioned in 2 of 3 answers");
    expect(text).toContain("Recommended in 1 of 3");
    expect(text).not.toContain("of 5 answers");
  });

  it("never asks for a star after a run the user just paid for", () => {
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => 0 });
    p.finish(fakeResult(), { reportPath: "r.html", verifyPath: "r.json", brandDomain: "d" });
    expect(lines().join("\n")).not.toContain("Star the repo");
  });
});

describe("formatBand — the Band line is a range, not a point", () => {
  it("prints min–max when the sample-sets disagreed", () => {
    expect(formatBand({ recommended_band: { overall: { min: 3, max: 5 } } }, 4, 12)).toBe(
      "recommended 3–5 of 12",
    );
  });

  it("prints one number when the sample-sets agreed exactly, still labelled a band", () => {
    expect(formatBand({ recommended_band: { overall: { min: 4, max: 4 } } }, 4, 12)).toBe(
      "recommended 4 of 12",
    );
  });

  it("falls back to the plain recommended count when a run carries no band", () => {
    expect(formatBand({}, 4, 12)).toBe("recommended 4 of 12");
    expect(formatBand(null, 4, 12)).toBe("recommended 4 of 12");
  });

  it("says not scored when nothing was scored", () => {
    expect(formatBand(null, null, 0)).toBe("recommended not scored");
  });
});

describe("wrapSetStage", () => {
  it("forwards every label to the callback and still calls the original setStage", async () => {
    const seen: string[] = [];
    const calls: { runId: string; label: string }[] = [];
    const fakeDb = {
      async setStage(runId: string, label: string) {
        calls.push({ runId, label });
      },
    };
    const wrapped = wrapSetStage(fakeDb, (l) => seen.push(l));
    await wrapped.setStage("run1", "Crawling your site");
    expect(seen).toEqual(["Crawling your site"]);
    expect(calls).toEqual([{ runId: "run1", label: "Crawling your site" }]);
  });
});

// ---------------------------------------------------------------------------
// Progress.write() is the single choke point for everything this CLI
// narrates, including the fail() line built from a caught exception.
// ---------------------------------------------------------------------------
describe("Progress redacts every line it prints", () => {
  afterEach(() => clearRegisteredSecrets());

  it("redacts a registered key from a narration line and from fail()", () => {
    const KEY = "AIzaSyD-progress-line-key-0123456789ab";
    registerSecret(KEY);
    const { out, lines } = captureOut();
    const p = new Progress({ out });
    p.write(`  gemini 0/6 · Gemini returned an error: ...?key=${KEY} · continuing`);
    p.fail(`request failed: https://x.example/v1?key=${KEY}`);
    const printed = lines().join("\n");
    expect(printed).not.toContain(KEY);
    expect(printed).toContain("[redacted]");
  });

  it("redacts a key it does NOT hold, by shape", () => {
    const stray = "sk-" + "ant-api03-unregistered-0123456789abcd";
    const { out, lines } = captureOut();
    new Progress({ out }).fail(`upstream said ${stray}`);
    expect(lines().join("\n")).not.toContain(stray);
  });

  it("leaves ordinary narration untouched", () => {
    const { out, lines } = captureOut();
    new Progress({ out }).write("  Crawl     12 pages");
    expect(lines().join("\n")).toContain("  Crawl     12 pages");
  });
});

// ---------------------------------------------------------------------------
// The live "04 engines" line — a pure formatter over a state object, so the
// shape a user stares at for four minutes is pinned without a pipeline.
// ---------------------------------------------------------------------------

describe("fmtElapsed", () => {
  it("stays in seconds under a minute", () => {
    expect(fmtElapsed(0)).toBe("0.0s");
    expect(fmtElapsed(12_400)).toBe("12.4s");
    expect(fmtElapsed(59_900)).toBe("59.9s");
  });

  it("reads as minutes over one — the engines stage runs for minutes", () => {
    expect(fmtElapsed(72_000)).toBe("1m 12s");
    expect(fmtElapsed(392_000)).toBe("6m 32s");
  });

  it("never rounds into a sixty-second minute", () => {
    expect(fmtElapsed(119_800)).toBe("2m 0s");
  });
});

describe("formatStageLine", () => {
  const engines = [
    { engine: "chatgpt" as const, done: 3, total: 6 },
    { engine: "claude" as const, done: 6, total: 6 },
    { engine: "gemini" as const, done: 2, total: 6 },
    { engine: "perplexity" as const, done: 0, total: 6 },
  ];

  it("names every engine, the elapsed time and the running cost", () => {
    expect(
      formatStageLine({ number: "04", label: "engines", engines, detail: "", elapsedMs: 72_000, costCents: 31 }),
    ).toBe(
      "  04 engines     chatgpt 3/6 · claude 6/6 · gemini 2/6 · perplexity 0/6   1m 12s · $0.31 so far",
    );
  });

  it("prints NO cost column while nothing measured has arrived — never an estimate", () => {
    const line = formatStageLine({
      number: "04",
      label: "engines",
      engines,
      detail: "",
      elapsedMs: 72_000,
      costCents: null,
    });
    expect(line).toContain("1m 12s");
    expect(line).not.toContain("$");
    expect(line).not.toContain("so far");
  });

  it("falls back to the pipeline's own detail when there are no engine counts", () => {
    expect(
      formatStageLine({ number: "01", label: "crawl", detail: "8 pages", elapsedMs: 3_200, costCents: null }),
    ).toBe("  01 crawl       8 pages   3.2s");
  });
});

describe("running cost", () => {
  it("wrapSetStage reports each saved answer's MEASURED cost, and the stage line shows it", () => {
    let now = 0;
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => now, tty: false });
    const writer = {
      staged: [] as string[],
      saved: 0,
      async setStage(_id: string, label: string) {
        this.staged.push(label);
      },
      async saveAnswer(row: { engine: string; ok: boolean; usage?: unknown }) {
        void row;
        this.saved += 1;
      },
    };
    wrapSetStage(writer, p.onLiveLabel);

    p.onStage("judge", "24 draws");
    // chatgpt bills 125c/M in + 1000c/M out: 20k + 20k = 2.5c + 20c = 22.5c
    void writer.saveAnswer({ engine: "chatgpt", ok: true, usage: { input_tokens: 20_000, output_tokens: 20_000 } });
    now = 4000;
    p.onStage("score", "done");

    expect(writer.saved).toBe(1);
    // the cost marker is an internal channel and must never be printed
    expect(lines().join("\n")).not.toContain("cost ");
    expect(lines().join("\n")).toMatch(/05 judge\s+24 draws\s+4\.0s · \$0\.23 so far/);
  });

  it("a failed draw costs nothing, so no cost column appears", () => {
    let now = 0;
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => now, tty: false });
    const writer = {
      async setStage() {},
      async saveAnswer(row: { engine: string; ok: boolean; usage?: unknown }) {
        void row;
      },
    };
    wrapSetStage(writer, p.onLiveLabel);
    p.onStage("judge", "24 draws");
    void writer.saveAnswer({ engine: "chatgpt", ok: false, usage: null });
    now = 1000;
    p.onStage("score", "done");
    expect(lines().join("\n")).not.toContain("so far");
  });
});

describe("live repaint", () => {
  it("on a TTY, repaints ONE line with \\r instead of scrolling", () => {
    let now = 0;
    const { out, raw } = captureOut();
    const p = new Progress({ out, now: () => now, tty: true });
    p.onStage("observe", "chatgpt");
    p.onLiveLabel("Asking ChatGPT · 1/6 answered");
    now = 1000;
    p.onLiveLabel("Asking ChatGPT · 2/6 answered");
    const text = raw();
    expect(text).toContain("\r");
    expect(text).toContain("chatgpt 1/6");
    expect(text).toContain("chatgpt 2/6");
    // repaints, never new lines
    expect(text.split("\n")).toHaveLength(1);
  });

  it("off a TTY, holds to the 15s floor so a CI log is not one row per answer", () => {
    let now = 0;
    const { out, lines } = captureOut();
    const p = new Progress({ out, now: () => now, tty: false });
    p.onStage("observe", "chatgpt");
    for (let i = 1; i <= 6; i++) {
      now += 1000;
      p.onLiveLabel(`Asking ChatGPT · ${i}/6 answered`);
    }
    expect(lines().filter((l) => l.includes("04 engines"))).toHaveLength(0);
    now += 15_000;
    p.onLiveLabel("Asking Claude · 1/6 answered");
    expect(lines().filter((l) => l.includes("04 engines"))).toHaveLength(1);
  });
});
