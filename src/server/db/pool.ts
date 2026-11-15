import pg from "pg";

// numeric -> string is pg's default; we parse explicitly where needed.
// int8 (bigint counts) -> number
pg.types.setTypeParser(20, (v) => Number(v));

const globalForPool = globalThis as unknown as { __lsmPool?: pg.Pool };

export function getPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  if (!globalForPool.__lsmPool) {
    globalForPool.__lsmPool = new pg.Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
    });
  }
  return globalForPool.__lsmPool;
}

export async function closePool(): Promise<void> {
  if (globalForPool.__lsmPool) {
    await globalForPool.__lsmPool.end();
    globalForPool.__lsmPool = undefined;
  }
}
