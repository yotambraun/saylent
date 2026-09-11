// Titles arrive double-escaped from real CMSes ("&amp;amp;" for one "&"). Pins
// the chain-unwrap, the numeric forms, idempotence and the leave-it-alone rules.
import { describe, expect, it } from "vitest";
import { decodeEntities } from "./entities";

describe("decodeEntities", () => {
  it("decodes a single entity", () => {
    expect(decodeEntities("Ranked &amp; Compared")).toBe("Ranked & Compared");
  });

  it("unwraps a DOUBLE-escaped title (the kestrel sample's real shape)", () => {
    expect(decodeEntities("11 Best Uptime Monitoring Tools in 2026 (Ranked &amp;amp; Compared)")).toBe(
      "11 Best Uptime Monitoring Tools in 2026 (Ranked & Compared)",
    );
  });

  it("unwraps a longer &amp;amp;amp; chain", () => {
    expect(decodeEntities("A &amp;amp;amp; B")).toBe("A & B");
    expect(decodeEntities("A &amp;amp;amp;amp; B")).toBe("A & B");
  });

  it("is idempotent — safe at extraction AND again on display", () => {
    const once = decodeEntities("Docs &amp;amp; Guides");
    expect(decodeEntities(once)).toBe(once);
    expect(decodeEntities("plain title")).toBe("plain title");
  });

  it("decodes the named entities titles actually use", () => {
    expect(decodeEntities("Uptime &ndash; Status &mdash; Alerts")).toBe(
      "Uptime – Status — Alerts",
    );
    expect(decodeEntities("It&rsquo;s &quot;fine&quot; &hellip;")).toBe("It’s \"fine\" …");
    expect(decodeEntities("Acme&reg; and Acme&trade;")).toBe("Acme® and Acme™");
    expect(decodeEntities("a&nbsp;b")).toBe("a b");
  });

  it("decodes decimal and hex numeric references, incl. a doubled one", () => {
    expect(decodeEntities("Tom&#39;s Guide")).toBe("Tom's Guide");
    expect(decodeEntities("Tom&#x27;s Guide")).toBe("Tom's Guide");
    expect(decodeEntities("Tom&amp;#39;s Guide")).toBe("Tom's Guide");
    expect(decodeEntities("caf&#233;")).toBe("café");
  });

  it("leaves unknown entities, bare ampersands and out-of-range points alone", () => {
    expect(decodeEntities("Rock &nosuchentity; Roll")).toBe("Rock &nosuchentity; Roll");
    expect(decodeEntities("Salt & Pepper")).toBe("Salt & Pepper");
    expect(decodeEntities("bad &#0; and &#1114112;")).toBe("bad &#0; and &#1114112;");
    expect(decodeEntities("surrogate &#55296;")).toBe("surrogate &#55296;");
  });

  it("terminates on a pathological chain instead of looping", () => {
    const deep = "&" + "amp;".repeat(40) + "x";
    expect(() => decodeEntities(deep)).not.toThrow();
    expect(decodeEntities(deep).length).toBeLessThan(deep.length);
  });

  it("handles the empty string", () => {
    expect(decodeEntities("")).toBe("");
  });
});
