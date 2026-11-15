import pg from "pg";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { runMigrations } from "../src/server/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  if (process.argv.includes("--local-shim")) {
    await client.query(await readFile(path.resolve("scripts/local-supabase-shim.sql"), "utf8"));
    console.log("Applied local Supabase shim (local/CI only).");
  }
  const applied = await runMigrations(client, path.resolve("supabase/migrations"));
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} finally {
  await client.end();
}
