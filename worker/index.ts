/**
 * LEGO STOCK MARKET — cloud sync worker.
 *
 * Runs independently of the web app (separate process / container). It is the ONLY component that
 * talks to BrickLink, so there is a single outbound IP to register with BrickLink and a single
 * place where the daily request quota is accounted for.
 *
 *   npm run worker          continuous mode (scheduler loop + internal HTTP API)
 *   npm run worker:once     one sync cycle, then exit (for cron-style platforms)
 */
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { getPool, closePool } from "@/server/db/pool";
import { SyncEngine, jsonLogger as log } from "@/server/sync/engine";
import { BrickLinkError } from "@/server/bricklink/errors";
import { ITEM_TYPES } from "@/server/bricklink/types";

const cfg = getConfig();
const pool = getPool(cfg.DATABASE_URL);
const engine = new SyncEngine(pool, cfg, log);
let running = false;
let stopping = false;

async function tick(trigger: string) {
  if (running) return;
  running = true;
  try {
    await engine.setStatus({ heartbeat_at: new Date() });
    const result = await engine.runCycle(trigger);
    const next = await engine.nextDueAt();
    const tickAt = new Date(Date.now() + cfg.SYNC_TICK_SECONDS * 1000);
    await engine.setStatus({
      heartbeat_at: new Date(),
      next_sync_at: next && next > tickAt ? next : tickAt,
      interval_seconds: result.plan?.baseIntervalSeconds ?? cfg.SYNC_TICK_SECONDS,
      details: result.plan ? { plan: result.plan } : {},
    });
  } catch (err) {
    log.error("Sync tick crashed", { error: (err as Error).message });
  } finally {
    running = false;
  }
}

function authorized(req: http.IncomingMessage): boolean {
  const secret = cfg.WORKER_API_SECRET;
  if (!secret) return false;
  const given = Buffer.from(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error("Body too large");
  }
  return body ? JSON.parse(body) : {};
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const lookupSchema = z.object({ type: z.enum(ITEM_TYPES).default("SET"), no: z.string().trim().min(1).max(64) });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true, running, mode: cfg.APP_MODE });
    }
    if (!authorized(req)) return send(res, 401, { error: "unauthorized" });

    if (req.method === "POST" && req.url === "/internal/catalog/lookup") {
      const parsed = lookupSchema.safeParse(await readJson(req));
      if (!parsed.success) return send(res, 400, { error: "invalid_request" });
      try {
        const set = await engine.lookupCatalogItem(parsed.data.type, parsed.data.no);
        void tick("new_set"); // fetch its first price observations right away
        return send(res, 200, { set });
      } catch (err) {
        if (err instanceof BrickLinkError) return send(res, err.kind === "not_found" ? 404 : 502, { error: err.kind });
        throw err;
      }
    }
    if (req.method === "POST" && req.url === "/internal/sync") {
      void tick("manual");
      return send(res, 202, { accepted: true });
    }
    return send(res, 404, { error: "not_found" });
  } catch (err) {
    log.error("Worker HTTP error", { error: (err as Error).message });
    return send(res, 500, { error: "internal_error" });
  }
});

async function main() {
  log.info("Worker starting", { mode: cfg.APP_MODE, tickSeconds: cfg.SYNC_TICK_SECONDS });
  if (process.argv.includes("--once")) {
    await tick("once");
    await closePool();
    return;
  }
  server.listen(cfg.WORKER_PORT, () => log.info("Worker API listening", { port: cfg.WORKER_PORT }));
  await tick("startup");
  const loop = setInterval(() => void tick("schedule"), cfg.SYNC_TICK_SECONDS * 1000);
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("Worker stopping", { signal });
    clearInterval(loop);
    server.close();
    while (running) await new Promise((r) => setTimeout(r, 200));
    await closePool();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("Worker failed to start", { error: (err as Error).message });
  process.exit(1);
});
