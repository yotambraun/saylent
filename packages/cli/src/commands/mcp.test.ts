// `saylent mcp` argv handling. The server itself is covered by
// ../mcp/server.test.ts (a real MCP client over an in-memory transport);
// this only proves the door: --help prints the tool/cost table on stdout and
// exits 0 WITHOUT starting a server (once the stdio transport owns stdout,
// anything else printed there corrupts the JSON-RPC stream).
import { describe, expect, it, vi } from "vitest";
import { run } from "./mcp";

describe("mcp command argv handling", () => {
  it("--help exits 0, names the four tools and their costs, and starts no server", async () => {
    const chunks: string[] = [];
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    const code = await run(["--help"]);
    outSpy.mockRestore();

    expect(code).toBe(0);
    const out = chunks.join("");
    expect(out).toContain("saylent mcp");
    for (const tool of ["audit", "verify", "gate_check", "read_report"]) expect(out).toContain(tool);
    expect(out).toContain("$0");
    expect(out).toMatch(/spends your credits/);
    // and it says keys can never be tool arguments
    expect(out).toMatch(/never pass a key as a tool argument/);
  });
});
