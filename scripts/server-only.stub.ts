// Operator/dev use: scripts-scoped `server-only` shim. `server-only` is a Next
// build-time alias, not a real npm module, so a bare `tsx` process throws
// MODULE_NOT_FOUND when it hits
// `import "server-only"` in the createRun / dev-run import chain (dev-run.ts →
// runs.ts → supabase/admin.ts). This no-op module is mapped to the `server-only`
// specifier ONLY under the tsx rig via scripts/tsconfig.json (selected by
// `tsx --tsconfig scripts/tsconfig.json`). It is never on `next build`'s resolve path, so
// the real Next client-bundle guard stays fully in force in app builds.
export {};
