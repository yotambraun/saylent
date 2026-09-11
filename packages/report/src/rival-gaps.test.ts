// "Where rivals beat you": over the answers the brand is
// absent from, which rivals keep getting named, why, and from which cited pages.
// Both verdict shapes (old string[], new {name,why}[]) must read via normOtherBrands.
import { describe, expect, it } from "vitest";
import { rivalGaps, type RivalGapAnswer, type RivalGapPage } from "./rival-gaps";

const absent = (
  qid: string,
  engine: string,
  other_brands: unknown,
  extra: Record<string, unknown> = {},
): RivalGapAnswer => ({
  qid,
  engine,
  ok: true,
  verdict: { brand_present: false, mention_type: "absent", other_brands, ...extra },
});

const page = (o: Partial<RivalGapPage> & Pick<RivalGapPage, "url" | "competitors_present" | "cited_by">): RivalGapPage => ({
  title: o.url,
  page_type: "listicle",
  ...o,
});

describe("rivalGaps", () => {
  it("tallies rivals over absent answers with the new {name,why} verdict shape", () => {
    const r = rivalGaps(
      [
        absent("q01", "chatgpt", [{ name: "Notecraft", why: "cheaper plan" }]),
        absent("q01", "claude", [{ name: "Notecraft", why: "better integrations" }]),
        absent("q02", "chatgpt", [{ name: "Otter", why: "" }]),
      ],
      [],
      "Fathom",
    )!;
    expect(r.totalAbsentAnswers).toBe(3);
    expect(r.rivals.map((x) => [x.name, x.count])).toEqual([
      ["Notecraft", 2],
      ["Otter", 1],
    ]);
    const notecraft = r.rivals[0];
    expect(notecraft.qids).toEqual(["q01"]);
    expect(notecraft.refs).toEqual([
      { qid: "q01", engine: "chatgpt" },
      { qid: "q01", engine: "claude" },
    ]);
    expect(notecraft.whys).toEqual([
      { text: "cheaper plan", count: 1 },
      { text: "better integrations", count: 1 },
    ]);
  });

  it("reads the old string[] verdict shape too (why defaults to empty)", () => {
    const r = rivalGaps([absent("q01", "gemini", ["Notecraft", "Otter"])], [], "Fathom")!;
    expect(r.rivals.map((x) => x.name)).toEqual(["Notecraft", "Otter"]);
    expect(r.rivals[0].whys).toEqual([]);
  });

  it("counts an answer as absent when mention_type is 'absent' even if brand_present is missing", () => {
    const r = rivalGaps(
      [{ qid: "q01", engine: "chatgpt", ok: true, verdict: { mention_type: "absent", other_brands: [{ name: "Otter", why: "" }] } }],
      [],
      "Fathom",
    )!;
    expect(r.totalAbsentAnswers).toBe(1);
    expect(r.rivals[0].name).toBe("Otter");
  });

  it("ignores present answers and never counts the audited brand or its aliases as a rival", () => {
    const r = rivalGaps(
      [
        { qid: "q01", engine: "chatgpt", ok: true, verdict: { brand_present: true, mention_type: "recommended", other_brands: [{ name: "Notecraft", why: "x" }] } },
        absent("q02", "claude", [{ name: "Fathom", why: "self" }, { name: "FathomHQ", why: "alias" }, { name: "Otter", why: "" }]),
      ],
      [],
      "Fathom",
      ["FathomHQ"],
    )!;
    expect(r.totalAbsentAnswers).toBe(1);
    expect(r.rivals.map((x) => x.name)).toEqual(["Otter"]);
  });

  it("aggregates repeated whys into counts, keeps the top 2, ties keep first-seen order", () => {
    const r = rivalGaps(
      [
        absent("q01", "chatgpt", [{ name: "Otter", why: "cheaper" }]),
        absent("q02", "claude", [{ name: "Otter", why: "Cheaper" }]),
        absent("q03", "gemini", [{ name: "Otter", why: "better UI" }]),
        absent("q04", "perplexity", [{ name: "Otter", why: "more accurate" }]),
      ],
      [],
      "Fathom",
    )!;
    const otter = r.rivals[0];
    expect(otter.count).toBe(4);
    expect(otter.whys).toEqual([
      { text: "cheaper", count: 2 },
      { text: "better UI", count: 1 },
    ]);
  });

  it("joins the top 3 cited pages that feature the rival, most-cited first", () => {
    const pages = [
      page({ url: "https://g2.com/best", competitors_present: ["Otter", "Notecraft"], cited_by: { chatgpt: 3, claude: 2 } }),
      page({ url: "https://reddit.com/x", competitors_present: ["Otter"], cited_by: { perplexity: 6 } }),
      page({ url: "https://blog.com/y", competitors_present: ["Otter"], cited_by: { claude: 1 } }),
      page({ url: "https://cap.com/z", competitors_present: ["Otter"], cited_by: { gemini: 4 } }),
      page({ url: "https://none.com/w", competitors_present: ["Notecraft"], cited_by: { chatgpt: 9 } }),
      page({ url: "https://uncited.com/v", competitors_present: ["Otter"], cited_by: {} }),
    ];
    const r = rivalGaps([absent("q01", "chatgpt", [{ name: "Otter", why: "" }])], pages, "Fathom")!;
    const otter = r.rivals[0];
    expect(otter.pages.map((p) => [p.page.url, p.citations])).toEqual([
      ["https://reddit.com/x", 6],
      ["https://g2.com/best", 5],
      ["https://cap.com/z", 4],
    ]);
  });

  it("sorts rivals by count desc, breaks ties by name, and caps at 5", () => {
    const answers: RivalGapAnswer[] = [];
    for (const [name, n] of [["A", 6], ["B", 5], ["C", 4], ["D", 3], ["E", 2], ["F", 1], ["G", 1]] as const) {
      for (let i = 0; i < n; i++) answers.push(absent(`q${name}${i}`, "chatgpt", [{ name, why: "" }]));
    }
    const r = rivalGaps(answers, [], "Fathom")!;
    expect(r.rivals.map((x) => x.name)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("returns null when no absent answer names any rival", () => {
    expect(rivalGaps([absent("q01", "chatgpt", [])], [], "Fathom")).toBeNull();
    expect(rivalGaps([], [], "Fathom")).toBeNull();
  });
});
