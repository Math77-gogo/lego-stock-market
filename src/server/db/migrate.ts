import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

/** Applies every supabase/migrations/*.sql file once, in filename order. */
export async function runMigrations(client: pg.Client | pg.PoolClient, dir: string): Promise<string[]> {
  await client.query(
    `create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const done = new Set(
    (await client.query<{ name: string }>("select name from public.schema_migrations")).rows.map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return applied;
}
