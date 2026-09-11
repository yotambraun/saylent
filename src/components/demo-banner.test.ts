// The demo strip renders ONLY on a demo deployment, and
// carries the three things a visitor needs: whose data this is, that it is read-only,
// and the one command that runs it on their own brand. (No DOM in this repo's test
// rig — we walk the returned React element, which is what the renderer would emit.)
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_BRAND_NAME } from "@/lib/demo-mode";
import { DemoBanner } from "./demo-banner";

type Node = { props?: { children?: unknown; href?: string } } | string | number | null | undefined;

function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const el = node as Exclude<Node, string | number | null | undefined>;
  return text(el?.props?.children);
}

function hrefs(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const c of node) hrefs(c, out);
    return out;
  }
  const el = node as { props?: { href?: string; children?: unknown } };
  if (el.props?.href) out.push(el.props.href);
  hrefs(el.props?.children, out);
  return out;
}

afterEach(() => vi.unstubAllEnvs());

describe("DemoBanner", () => {
  it("renders nothing on a normal deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_READONLY", "");
    expect(DemoBanner()).toBeNull();
  });

  it("renders the read-only notice, the brand and the CLI command in demo mode", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_READONLY", "1");
    const copy = text(DemoBanner());
    expect(copy).toContain("Read-only demo");
    expect(copy).toContain(DEMO_BRAND_NAME);
    expect(copy).toContain("npx saylent audit");
  });

  it("links out to the docs so the visitor can run it themselves", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_READONLY", "1");
    const links = hrefs(DemoBanner());
    expect(links.length).toBe(1);
    expect(links[0]).toMatch(/^https?:\/\//);
  });
});
