import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { createUser, resetDatabase, silentLogger, testConfig } from "./helpers";
import { createMockState, mockTransport, type MockState } from "../fixtures/bricklink";
import { SyncEngine } from "@/server/sync/engine";
import { withUser } from "@/server/db/context";
import { addPurchase, loadPositions, totalsFor } from "@/server/portfolio/service";

let pool: pg.Pool;
let state: MockState;
let engine: SyncEngine;
const cfg = testConfig();
const engineOpts = { currency: "CAD", staleAfterHours: 36, minUnitsForConfidence: 3 };

beforeEach(async () => {
  if (pool) await pool.end();
  pool = await resetDatabase();
  state = createMockState();
  engine = new SyncEngine(pool, cfg, silentLogger, mockTransport(state));
});
afterAll(async () => pool.end());

describe("cloud sync worker (runs with no frontend at all)", () => {
  it("looks up a catalog item from BrickLink and caches it", async () => {
    const set = await engine.lookupCatalogItem("SET", "75192");
    expect(set.itemNumber).toBe("75192-1");
    expect(set.theme).toBe("Star Wars");
    expect(set.imageUrl).toBe("https://img.bricklink.com/ItemImage/SN/0/75192-1.png");
    const calls = state.calls.length;
    await engine.lookupCatalogItem("SET", "75192-1");
    expect(state.calls.length).toBe(calls); // served from cache, no extra API request
    const targets = await pool.query("select count(*)::int as n from public.sync_targets");
    expect(targets.rows[0].n).toBe(4); // N/U × sold/stock
  });

  it("syncs new and used prices separately, values portfolios and logs the run", async () => {
    const set = await engine.lookupCatalogItem("SET", "75192-1");
    const user = await createUser(pool, "u@example.test");
    await withUser(
      user,
      async (db) => {
        await addPurchase(db, user, {
          legoSetId: set.id,
          condition: "N",
          quantity: 2,
          unitPrice: 900,
          fees: 0,
          date: "2026-01-01",
        });
        await addPurchase(db, user, {
          legoSetId: set.id,
          condition: "U",
          quantity: 1,
          unitPrice: 700,
          fees: 0,
          date: "2026-01-01",
        });
      },
      pool,
    );

    const result = await engine.runCycle("test");
    expect(result.status).toBe("success");
    expect(result.updated).toBe(4);

    const obs = await pool.query(
      "select condition, guide_type, qty_avg_price, currency_code, source from public.bricklink_price_observations order by condition, guide_type",
    );
    expect(
      obs.rows.map(
        (r) =>
          `${r.condition}:${r.guide_type}:${Number(r.qty_avg_price)}:${r.currency_code}:${r.source}`,
      ),
    ).toEqual([
      "N:sold:1123.4567:CAD:bricklink_api_v1",
      "N:stock:1299:CAD:bricklink_api_v1",
      "U:sold:850.1:CAD:bricklink_api_v1",
      "U:stock:999:CAD:bricklink_api_v1",
    ]);

    const positions = await withUser(
      user,
      (db) => loadPositions(db, { mode: "test", engine: engineOpts }),
      pool,
    );
    const n = positions.find((p) => p.condition === "N")!;
    const u = positions.find((p) => p.condition === "U")!;
    expect(n.reference.price).toBe(1123.46); // sold price, never the asking price
    expect(u.reference.price).toBe(850.1);
    const totals = totalsFor(positions);
    expect(totals.marketValue).toBeCloseTo(2 * 1123.46 + 850.1, 2);
    expect(totals.costBasis).toBe(2500);
    expect(totals.dayChange).toBeNull(); // no 24h history yet: nothing invented

    const run = await pool.query(
      "select status, requests_used, sets_updated from public.sync_runs",
    );
    expect(run.rows[0]).toMatchObject({ status: "success", requests_used: 4, sets_updated: 4 });
    const snaps = await pool.query("select market_value from public.portfolio_value_snapshots");
    expect(Number(snaps.rows[0].market_value)).toBeCloseTo(3097.02, 2);
    const ws = await pool.query(
      "select connection_status, last_success_at from public.worker_status",
    );
    expect(ws.rows[0].connection_status).toBe("connected");

    // Nothing is due again until the interval passes: no duplicate requests.
    const again = await engine.runCycle("test");
    expect(again.note).toBe("nothing_due");
  });

  it("marks sets with zero sales as insufficient data", async () => {
    const set = await engine.lookupCatalogItem("SET", "10497");
    const user = await createUser(pool, "z@example.test");
    await withUser(
      user,
      (db) =>
        addPurchase(db, user, {
          legoSetId: set.id,
          condition: "U",
          quantity: 1,
          unitPrice: 100,
          fees: 0,
          date: "2026-01-01",
        }),
      pool,
    );
    await engine.runCycle("test");
    const [p] = await withUser(
      user,
      (db) => loadPositions(db, { mode: "test", engine: engineOpts }),
      pool,
    );
    expect(p!.reference.price).toBeNull();
    expect(p!.reference.status).toBe("no_sales");
    expect(p!.reference.warnings[0]).toMatch(/Insufficient BrickLink data/);
  });

  it("refuses to value a non-CAD response instead of converting it", async () => {
    state.prices["75192-1:N:sold"]!.currency = "USD";
    const set = await engine.lookupCatalogItem("SET", "75192-1");
    const user = await createUser(pool, "c@example.test");
    await withUser(
      user,
      (db) =>
        addPurchase(db, user, {
          legoSetId: set.id,
          condition: "N",
          quantity: 1,
          unitPrice: 100,
          fees: 0,
          date: "2026-01-01",
        }),
      pool,
    );
    await engine.runCycle("test");
    const [p] = await withUser(
      user,
      (db) => loadPositions(db, { mode: "test", engine: engineOpts }),
      pool,
    );
    expect(p!.reference.status).toBe("currency_mismatch");
    expect(p!.marketValue).toBeNull();
  });

  it("backs off on server errors and keeps the last valid observation", async () => {
    await engine.lookupCatalogItem("SET", "75192-1");
    await engine.runCycle("test");
    await pool.query("update public.sync_targets set next_due_at = now() - interval '1 minute'");
    state.failNext.push({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
    const r = await engine.runCycle("test");
    expect(r.status).toBe("failed");
    expect(r.failed).toBe(4);
    const t = await pool.query(
      "select consecutive_failures, next_due_at > now() + interval '4 minutes' as backed_off from public.sync_targets",
    );
    expect(t.rows.every((x) => x.consecutive_failures === 1 && x.backed_off)).toBe(true);
    const obs = await pool.query(
      "select count(*)::int as n from public.bricklink_price_observations",
    );
    expect(obs.rows[0].n).toBe(4); // earlier observations are untouched
    const ws = await pool.query("select connection_status from public.worker_status");
    expect(ws.rows[0].connection_status).toBe("unavailable");
  });

  it("pauses on rate limiting and on invalid credentials", async () => {
    await engine.lookupCatalogItem("SET", "75192-1");
    state.failNext.push({ status: 429 });
    const r = await engine.runCycle("test");
    expect(r.status).toBe("failed");
    const ws = await pool.query(
      "select connection_status, paused_until > now() as paused from public.worker_status",
    );
    expect(ws.rows[0]).toMatchObject({ connection_status: "rate_limited", paused: true });
    expect((await engine.runCycle("test")).note).toBe("paused");

    await pool.query("update public.worker_status set paused_until = null");
    state.failNext.push({ metaCode: 401 });
    await engine.runCycle("test");
    const ws2 = await pool.query("select connection_status from public.worker_status");
    expect(ws2.rows[0].connection_status).toBe("unauthorized");
  });

  it("stops at the daily request budget", async () => {
    const small = new SyncEngine(
      pool,
      testConfig({ BRICKLINK_DAILY_REQUEST_LIMIT: "3", BRICKLINK_BUDGET_RESERVE_RATIO: "0" }),
      silentLogger,
      mockTransport(state),
    );
    await small.lookupCatalogItem("SET", "75192-1"); // 2 requests (categories + item)
    const r = await small.runCycle("test");
    expect(r.requestsUsed).toBe(1);
    const used = await pool.query("select count(*)::int as n from public.bricklink_api_requests");
    expect(used.rows[0].n).toBe(3);
  });

  it("does nothing when BrickLink credentials are missing", async () => {
    const unconfigured = new SyncEngine(
      pool,
      testConfig({ BRICKLINK_CONSUMER_KEY: "" }),
      silentLogger,
      mockTransport(state),
    );
    expect((await unconfigured.runCycle("test")).note).toBe("not_configured");
    expect(state.calls).toHaveLength(0);
  });
});
