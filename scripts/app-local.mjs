#!/usr/bin/env node
// The "local, one machine" run target: one command that
// starts the local Supabase stack (Docker), the Inngest dev server, and the app,
// so the first operator can sign up (migration 0040 makes them admin) with zero
// cloud accounts. Deliberately dependency-free (no `concurrently`) — plain
// child_process.
//
// Usage:
//   npm run app:local            # starts everything it can, explains what it skips
//   node scripts/app-local.mjs --dry-run   # prints the plan only, starts nothing
import { spawn, spawnSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run");
const ON_WINDOWS = process.platform === "win32";

function checkCommand(cmd, args) {
  try {
    const res = spawnSync(cmd, args, { shell: ON_WINDOWS, encoding: "utf8" });
    if (res.error || res.status !== 0) {
      return { ok: false, detail: (res.stderr || res.error?.message || "").trim().split("\n")[0] };
    }
    return { ok: true, detail: (res.stdout || "").trim().split("\n")[0] };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function heading(text) {
  console.log(`\n${text}\n${"=".repeat(text.length)}`);
}

async function main() {
  heading("Saylent — local run target");

  const supabaseCli = checkCommand("supabase", ["--version"]);
  const docker = checkCommand("docker", ["info"]);
  const runLocalStack = supabaseCli.ok && docker.ok;

  console.log(`Supabase CLI : ${supabaseCli.ok ? `found (${supabaseCli.detail})` : "NOT found"}`);
  console.log(`Docker       : ${docker.ok ? "running" : "NOT available"}`);

  const plan = [];
  if (runLocalStack) {
    plan.push("1. supabase start   — boots local Postgres + Auth + Realtime + Studio, applies supabase/migrations/*.sql");
  } else {
    plan.push("1. supabase start   — SKIPPED (see below)");
  }
  plan.push("2. npx inngest-cli dev   — job worker, http://localhost:8288");
  plan.push("3. npm run dev           — the app, http://localhost:3000");
  console.log("\nPlan:");
  for (const line of plan) console.log(`  ${line}`);

  if (!runLocalStack) {
    console.log("\nLocal Supabase stack will be skipped:");
    if (!supabaseCli.ok) {
      console.log(
        "  - Supabase CLI not found on PATH. Install it: https://supabase.com/docs/guides/local-development/cli/getting-started",
      );
    }
    if (supabaseCli.ok && !docker.ok) {
      console.log(`  - Docker is required by \`supabase start\` and is not available (${docker.detail || "no detail"}).`);
      console.log("    Install/start Docker Desktop (WSL: enable the WSL integration in Docker Desktop settings).");
    }
    console.log(
      "  The app + job worker will still start below, against whatever Supabase project is configured in .env.local (a hosted project works fine).",
    );
  }

  if (DRY_RUN) {
    console.log("\n--dry-run: not starting anything.");
    return;
  }

  if (runLocalStack) {
    heading("supabase start");
    const res = spawnSync("supabase", ["start"], { stdio: "inherit", shell: ON_WINDOWS });
    if (res.status !== 0) {
      console.warn(
        "\nsupabase start failed or exited non-zero — continuing with the app + job worker anyway (check the output above; `supabase status` shows what's running).",
      );
    }
  }

  heading("Starting the job worker + the app (Ctrl+C stops both)");
  const children = [];
  let shuttingDown = false;

  function spawnChild(name, cmd, args) {
    const child = spawn(cmd, args, { stdio: "inherit", shell: ON_WINDOWS });
    children.push({ name, child });
    child.on("exit", (code, signal) => {
      if (shuttingDown) return;
      console.log(`\n[${name}] exited (${signal ?? code}) — stopping the other process.`);
      shutdown(code ?? 1);
    });
    return child;
  }

  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const { child } of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
    process.exitCode = code ?? 0;
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  spawnChild("inngest", "npx", ["inngest-cli", "dev"]);
  spawnChild("next", "npm", ["run", "dev"]);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
