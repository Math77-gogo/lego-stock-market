import type pg from "pg";
import { getPool } from "./pool";

export type Db = pg.PoolClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction as the Postgres `authenticated` role with the user's id in
 * `request.jwt.claims`, exactly like Supabase's PostgREST. Row Level Security therefore applies
 * to every query, so one user can never read or change another user's portfolio, even if the
 * application code had a bug.
 */
export async function withUser<T>(
  userId: string,
  fn: (db: Db) => Promise<T>,
  pool = getPool(),
): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("Invalid user id");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Trusted server/worker operations (catalog writes, BrickLink observations, sync state). */
export async function withSystem<T>(fn: (db: Db) => Promise<T>, pool = getPool()): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
