import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Works from both `src/` (tsx dev mode) and `dist/` (the esbuild bundle):
 *  packages/cli/package.json is always one directory up from either. */
function readPkg(): { version?: string; description?: string } {
  try {
    return JSON.parse(readFileSync(path.join(HERE, "../package.json"), "utf8")) as {
      version?: string;
      description?: string;
    };
  } catch {
    return {};
  }
}

export function cliVersion(): string {
  return readPkg().version ?? "0.0.0";
}

/** The one-line "what is this" — the same sentence npm shows on the package
 *  page, so the help screen and the registry can never say two different
 *  things about what the tool does. */
export function cliDescription(): string {
  return readPkg().description ?? "Audit what AI assistants say about your brand, with the receipts.";
}
