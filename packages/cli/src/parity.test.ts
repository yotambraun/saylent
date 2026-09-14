// The CLI parser (commands/audit.ts,
// commands/verify.ts) and the MCP tool input (mcp/server.ts) are both built
// from options.ts's ONE shared AuditOptions/VerifyOptions zod schema. This
// file is the guarantee: every field the MCP schema exposes also has a real
// CLI flag (or is a documented exception — the positional <domain>/
// <run.json>), every field carries a description, and mcp.mdx's MCP
// argument table stays in sync with the same field list.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_FLAG_OPTIONS } from "./model-flags";
import {
  AuditOptionsSchema,
  CLI_FIELD_META,
  cliParseOptions,
  describeOptions,
  OPTION_DESCRIPTIONS,
  VERIFY_FIELD_KEYS,
  VerifyOptionsSchema,
} from "./options";

const here = path.dirname(fileURLToPath(import.meta.url));
const MCP_MDX = path.resolve(here, "../../../website/content/docs/mcp.mdx");

type AuditKey = keyof typeof AuditOptionsSchema.shape;
type VerifyKey = keyof typeof VerifyOptionsSchema.shape;

/** The flags `saylent audit`'s parser ACTUALLY registers: the generated
 *  fields (cliParseOptions, same call commands/audit.ts makes) plus the two
 *  hand-added groups audit.ts spreads in itself — `--yes` (no MCP
 *  equivalent; a tool call has no interactive confirmation to skip) and
 *  model-flags.ts's MODEL_FLAG_OPTIONS (`--judge`/`--judge-family`/
 *  `--model`, which the shared schema's `judge`/`judge_family`/`models`
 *  fields map onto — see CLI_FIELD_META's `generatesCliOption: false`). */
function auditCliFlags(): Set<string> {
  const generated = cliParseOptions(Object.keys(AuditOptionsSchema.shape) as AuditKey[]);
  return new Set([...Object.keys(generated), "yes", ...Object.keys(MODEL_FLAG_OPTIONS)]);
}

function verifyCliFlags(): Set<string> {
  const generated = cliParseOptions(VERIFY_FIELD_KEYS);
  return new Set([...Object.keys(generated), "yes", ...Object.keys(MODEL_FLAG_OPTIONS)]);
}

describe("CLI/MCP option parity", () => {
  it("`saylent audit`'s flags ⊇ the MCP `audit` tool's input keys, modulo the documented naming map", () => {
    const cliFlags = auditCliFlags();
    for (const field of describeOptions()) {
      if (field.cliFlag === null) {
        // the one documented exception: `domain` is the CLI's positional
        // <domain>, never a flag.
        expect(field.key).toBe("domain");
        continue;
      }
      expect(
        cliFlags.has(field.cliFlag),
        `MCP key "${field.key}" maps to --${field.cliFlag}, but \`saylent audit\` does not accept that flag`,
      ).toBe(true);
    }
  });

  it("`saylent verify`'s flags ⊇ the MCP `verify` tool's input keys, modulo the documented naming map", () => {
    const cliFlags = verifyCliFlags();
    for (const key of Object.keys(VerifyOptionsSchema.shape) as VerifyKey[]) {
      if (key === "bundle_path") continue; // the CLI's positional <run.json>
      const cliFlag = CLI_FIELD_META[key].cliFlag;
      expect(cliFlag, `"${key}" has no CLI_FIELD_META naming-map entry`).not.toBeNull();
      expect(
        cliFlags.has(cliFlag as string),
        `MCP key "${key}" maps to --${cliFlag}, but \`saylent verify\` does not accept that flag`,
      ).toBe(true);
    }
  });

  it("every VerifyOptions field is also an AuditOptions field (plus bundle_path, the positional equivalent of `audit`'s <domain>)", () => {
    const auditKeys = new Set(Object.keys(AuditOptionsSchema.shape));
    for (const key of Object.keys(VerifyOptionsSchema.shape)) {
      if (key === "bundle_path") continue;
      expect(auditKeys.has(key), `VerifyOptions.${key} is not a field of AuditOptions`).toBe(true);
    }
  });

  it("every AuditOptions field has a non-trivial description", () => {
    for (const field of describeOptions()) {
      expect(field.description, `${field.key} has no description`).toBeTruthy();
      expect(field.description.length).toBeGreaterThan(5);
      expect(OPTION_DESCRIPTIONS[field.key as AuditKey]).toBe(field.description);
    }
  });

  it("every VerifyOptions field has a non-trivial description (bundle_path included)", () => {
    for (const key of Object.keys(VerifyOptionsSchema.shape) as VerifyKey[]) {
      const desc = VerifyOptionsSchema.shape[key].description;
      expect(desc, `${key} has no description`).toBeTruthy();
      expect((desc as string).length).toBeGreaterThan(5);
    }
  });

  it("the zod inputSchema field count is non-trivial and every generated CLI option is a real parseArgs shape", () => {
    const generated = cliParseOptions(Object.keys(AuditOptionsSchema.shape) as AuditKey[]);
    expect(Object.keys(generated).length).toBeGreaterThan(10);
    for (const opt of Object.values(generated)) {
      expect(["string", "boolean"]).toContain(opt.type);
    }
  });

  it("mcp.mdx documents every MCP `audit` argument", () => {
    const mdx = readFileSync(MCP_MDX, "utf8");
    for (const field of describeOptions()) {
      expect(mdx, `mcp.mdx's MCP table is missing "${field.key}"`).toContain(`\`${field.key}\``);
    }
  });

  it("mcp.mdx documents every MCP `verify`-only argument (bundle_path)", () => {
    const mdx = readFileSync(MCP_MDX, "utf8");
    expect(mdx).toContain("`bundle_path`");
  });
});
