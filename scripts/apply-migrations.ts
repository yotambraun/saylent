// Operator use: applies supabase/migrations/*.sql in filename order over
// DIRECT_DATABASE_URL (session semantics). Records applied files in
// public._migrations so re-runs are idempotent. Run:
//   npx tsx --env-file=.env.local scripts/apply-migrations.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

async function main() {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL missing");

  const dir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(
    "create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set(
    (await client.query("select name from public._migrations")).rows.map((r) => r.name),
  );

  for (const f of files) {
    if (done.has(f)) {
      console.log(`skip   ${f} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, f), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public._migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`apply  ${f} ✅`);
    } catch (e) {
      await client.query("rollback");
      console.error(`FAIL   ${f}: ${(e as Error).message}`);
      await client.end();
      process.exit(1);
    }
  }
  const t = await client.query(
    "select table_name from information_schema.tables where table_schema='public' order by 1",
  );
  console.log("tables:", t.rows.map((r) => r.table_name).join(", "));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
