// The Favicon fallback tile's hash→hue mapping must be DETERMINISTIC
// (same host → same colour on server and client, every run) and well-distributed
// (hosts sharing the ".example" suffix in the /demo must not all render the same
// blue). We test the pure helpers; the component's <img>/onError swap is trivial.
import { describe, it, expect } from "vitest";
import { faviconTile, hostHue } from "./favicon";

describe("hostHue", () => {
  it("is deterministic — the same host always yields the same hue", () => {
    for (const host of ["acmecloud.example", "nimbus.example", "a", ""]) {
      expect(hostHue(host)).toBe(hostHue(host));
    }
  });

  it("pins known hues (locks the algorithm against silent drift)", () => {
    // Regenerate these ONLY on a deliberate algorithm change — they are the
    // determinism contract that keeps tile colours stable across deploys.
    expect(hostHue("acmecloud.example")).toBe(205);
    expect(hostHue("nimbus.example")).toBe(305);
    expect(hostHue("cloudreview.example")).toBe(12);
  });

  it("returns an integer hue in [0, 360) for any input, including empty", () => {
    for (const host of ["", "x", "a.b.c.example", "UPPER.EXAMPLE", "🌩️.example"]) {
      const hue = hostHue(host);
      expect(Number.isInteger(hue)).toBe(true);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("is case-insensitive", () => {
    expect(hostHue("Nimbus.Example")).toBe(hostHue("nimbus.example"));
    expect(hostHue("ACMECLOUD.EXAMPLE")).toBe(hostHue("acmecloud.example"));
  });

  it("scatters suffix-sharing hosts across the wheel (no trivial clustering)", () => {
    const hosts = [
      "acmecloud.example",
      "cloudreview.example",
      "devforum.example",
      "stackship.example",
      "saastools.example",
      "benchmarks.example",
      "uptimewatch.example",
      "nimbus.example",
    ];
    const hues = new Set(hosts.map(hostHue));
    // all 8 distinct (allow at most one incidental collision as a safety margin)
    expect(hues.size).toBeGreaterThanOrEqual(hosts.length - 1);
  });
});

describe("faviconTile", () => {
  it("derives its gradient from hostHue and uses the host's initial", () => {
    const t = faviconTile("Nimbus.example");
    expect(t.initial).toBe("N");
    expect(t.background).toContain(`hsl(${hostHue("Nimbus.example")} `);
    expect(t.background.startsWith("linear-gradient(")).toBe(true);
  });

  it("is stable for the same host", () => {
    expect(faviconTile("acmecloud.example")).toEqual(faviconTile("acmecloud.example"));
  });
});
