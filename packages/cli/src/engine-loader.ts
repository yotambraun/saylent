// Single choke point for reaching @saylent/engine and @saylent/report at
// runtime. packages/cli/scripts/build.mjs bundles both packages' SOURCE
// directly into dist/saylent.js (they are NOT externals there — only real
// node_modules dependencies are), so every import() below uses a LITERAL
// specifier esbuild can resolve and inline at build time. That is the fix
// for the bug this file used to have: a dynamic `import()` whose specifier
// is a runtime STRING VARIABLE (the old importTs(specifier) helper) is
// invisible to esbuild's bundler — it gets left as a real runtime
// import(specifier) call, and plain `node` then tries to resolve
// "@saylent/engine/domainChecks" itself, which points (via that package's
// own package.json "exports") at a raw .ts source file node cannot load.
// Every specifier below is a plain string literal instead, so esbuild finds
// it, bundles the target module's compiled JS into dist/saylent.js, and
// wraps it in a lazy-init function — the import() call still doesn't RUN
// that module's top-level code until it actually executes at runtime, which
// is what keeps this file's split behavior working: `gate-check` only ever
// calls loadGateCheckEngine(), so it never evaluates llm.ts's openai/
// @anthropic-ai/sdk imports or adapters/index.ts's @google/genai import, and
// no command pays for @saylent/report's renderers unless it actually calls
// loadReportRender()/loadReportFromBundle(). Under `tsx` (dev mode, `npm run
// cli`) this needs no extra registration either: tsx's loader hook is
// already active process-wide, so a literal import() of a bare workspace
// specifier or a relative .ts path both resolve exactly the way they always
// did.
//
// "@saylent/engine/<file>" is a safe import specifier — the root
// tsconfig.json paths alias for it does not crash this TypeScript version.
// "@saylent/report/render/<subpath>" does: ANY import of it, static or
// dynamic, crashes this TypeScript version with an internal "Debug Failure"
// in the import checker (verified against both "/from-bundle" and "/html").
// The exact, non-wildcard "@saylent/report/render" barrel entry is a
// DIFFERENT tsconfig paths entry and is unaffected, so only from-bundle.ts
// (which has no barrel re-export) needs the relative-path workaround below.
// tsconfig.json is out of scope here, so this is the fix on this
// side.

export type EngineModule = typeof import("@saylent/engine");
export type EngineConfigModule = typeof import("@saylent/engine/config");
export type ReportRenderModule = typeof import("@saylent/report/render");
export type ReportFromBundleModule = typeof import("@saylent/report/render/from-bundle");
export type EngineAdapters = Pick<EngineModule, "ADAPTERS" | "ENGINES">;
export type GateCheckEngine = Pick<
  EngineModule,
  "crawlSite" | "runDomainChecks" | "MemoryDbWriter" | "BOT_REGISTRY" | "safeFetch"
>;

let enginePromise: Promise<EngineModule> | null = null;
let adaptersPromise: Promise<EngineAdapters> | null = null;
let gateCheckPromise: Promise<GateCheckEngine> | null = null;
let engineConfigPromise: Promise<EngineConfigModule> | null = null;
let reportRenderPromise: Promise<ReportRenderModule> | null = null;
let reportFromBundlePromise: Promise<ReportFromBundleModule> | null = null;

// loadEngine() assembles from INDIVIDUAL submodules rather than importing the
// "@saylent/engine" barrel — the barrel re-exports adapters/index.ts (pulls
// in @google/genai) via `export { ADAPTERS, ENGINES } from "./adapters"`, and
// none of what loadEngine()'s callers actually use (MemoryDbWriter, runAudit,
// toBundle/writeBundle/readBundle, safeFetch, crawlSite, runDomainChecks, the
// LLM callers, the cost/model registries) touches adapters. The one thing
// that DOES need adapters — building the real per-engine Ask function — goes
// through loadAdapters() below, which is only ever called on an actual paid
// run (never for `gate-check`, `history`, `keys`, or a `--dry-run`).
export async function loadEngine(): Promise<EngineModule> {
  if (!enginePromise) {
    enginePromise = Promise.all([
      import("@saylent/engine/memory-writer"),
      import("@saylent/engine/run-audit"),
      import("@saylent/engine/bundle"),
      import("@saylent/engine/util"),
      import("@saylent/engine/llm"),
      import("@saylent/engine/models"),
      import("@saylent/engine/profiles"),
      import("@saylent/engine/answer-cost"),
      import("@saylent/engine/domainChecks"),
      import("@saylent/engine/crawl"),
      import("@saylent/engine/questions"),
      import("@saylent/engine/brandModel"),
    ]).then(
      (mods) =>
        Object.assign({}, ...mods) as EngineModule,
    );
  }
  return enginePromise;
}

/** ADAPTERS + ENGINES only — the one thing loadEngine() deliberately leaves
 *  out (see the comment above). Only called on a real (non-dry-run,
 *  non-gate-check) audit/verify when no fake `deps.ask` was injected. */
export function loadAdapters(): Promise<EngineAdapters> {
  if (!adaptersPromise) adaptersPromise = import("@saylent/engine/adapters");
  return adaptersPromise;
}

/** `gate-check` needs no LLM, no adapters, no answer-cost/profiles/models —
 *  just the crawl + domain-check machinery. A dedicated, leaner loader than
 *  loadEngine() so it never evaluates llm.ts's openai/@anthropic-ai/sdk
 *  imports either. */
export function loadGateCheckEngine(): Promise<GateCheckEngine> {
  if (!gateCheckPromise) {
    gateCheckPromise = Promise.all([
      import("@saylent/engine/crawl"),
      import("@saylent/engine/domainChecks"),
      import("@saylent/engine/memory-writer"),
      import("@saylent/engine/util"),
    ]).then((mods) => Object.assign({}, ...mods) as GateCheckEngine);
  }
  return gateCheckPromise;
}

export function loadEngineConfig(): Promise<EngineConfigModule> {
  if (!engineConfigPromise) engineConfigPromise = import("@saylent/engine/config");
  return engineConfigPromise;
}

export function loadReportRender(): Promise<ReportRenderModule> {
  if (!reportRenderPromise) reportRenderPromise = import("@saylent/report/render");
  return reportRenderPromise;
}

export function loadReportFromBundle(): Promise<ReportFromBundleModule> {
  if (!reportFromBundlePromise) {
    reportFromBundlePromise = import("../../report/src/render/from-bundle");
  }
  return reportFromBundlePromise;
}
