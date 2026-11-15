import pg from "pg";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { runMigrations } from "@/server/db/migrate";
import { getConfig, type AppConfig } from "@/lib/config";
import { TEST_CREDENTIALS } from "../fixtures/bricklink";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/lsm_test";

/** Drops and recreates the schema in the dedicated test database. Refuses anything not named *_test. */
export async function resetDatabase(): Promise<pg.Pool> {
  if (!/\/[\w-]*test[\w-]*$/.test(TEST_DATABASE_URL))
    throw new Error("Refusing to reset a non-test database");
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query(
    "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;",
  );
  await client.query(await readFile(path.resolve("scripts/local-supabase-shim.sql"), "utf8"));
  await runMigrations(client, path.resolve("supabase/migrations"));
  await client.end();
  return new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 5 });
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return getConfig({
    NODE_ENV: "test",
    APP_MODE: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    BRICKLINK_MIN_REQUEST_SPACING_MS: "0",
    ...TEST_CREDENTIALS,
    ...overrides,
  } as NodeJS.ProcessEnv);
}

export async function createUser(pool: pg.Pool, email: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  return r.rows[0]!.id;
}

export const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
