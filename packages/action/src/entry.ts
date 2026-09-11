#!/usr/bin/env node
// The real action.yml `runs.main` target (root action.yml -> packages/action/dist/index.js,
// built by scripts/build.mjs from THIS file). Kept to two lines on purpose: all logic
// lives in main.ts, which stays free of top-level side effects so it can be imported
// from tests without running anything.
import * as core from "@actions/core";
import { runAction } from "./main";

runAction().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
