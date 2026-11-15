import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createUser, resetDatabase } from "./helpers";
import { withSystem, withUser } from "@/server/db/context";
import { upsertCatalogItem } from "@/server/catalog/service";
import { insertObservation } from "@/server/market/repository";
import { addPurchase, loadPositions } from "@/server/portfolio/service";

let pool: pg.Pool;
let alice: string;
let bob: string;
let setId: string;

const guide = {
  item: { no: "75192-1", type: "SET" },
  new_or_used: "N" as const,
  currency_code: "CAD",
  qty_avg_price: 1000,
  avg_price: 1010,
  min_price: 900,
  max_price: 1200,
  unit_quantity: 5,
  total_quantity: 5,
  price_detail: [],
};

beforeAll(async () => {
  pool = await resetDatabase();
  alice = await createUser(pool, "alice@example.test");
  bob = await createUser(pool, "bob@example.test");
  const set = await withSystem(
    (db) => upsertCatalogItem(db, { no: "75192-1", name: "Millennium Falcon", type: "SET", category_id: 65 }, "Star Wars"),
    pool,
  );
  setId = set.id;
});
afterAll(async () => pool.end());

describe("schema guarantees", () => {
  it("creates a default portfolio for every new user", async () => {
    const r = await pool.query("select count(*)::int as n from public.portfolios");
    expect(r.rows[0].n).toBe(2);
  });

  it("rejects non-BrickLink observations in production", async () => {
    await expect(
      withSystem((db) => insertObservation(db, { legoSetId: setId, guide, guideType: "sold", requestParams: {}, syncRunId: null, source: "test_fixture" }), pool),
    ).rejects.toThrow(/Only official BrickLink/);
    await expect(
      pool.query(`insert into public.bricklink_price_observations (lego_set_id, condition, guide_type, currency_code, source) values ($1,'N','sold','CAD','ebay')`, [setId]),
    ).rejects.toThrow();
  });

  it("stores BrickLink observations immutably, with source and timestamp", async () => {
    const id = await withSystem((db) => insertObservation(db, { legoSetId: setId, guide, guideType: "sold", requestParams: { currency_code: "CAD" }, syncRunId: null }), pool);
    const r = await pool.query("select source, observed_at, raw_response from public.bricklink_price_observations where id = $1", [id]);
    expect(r.rows[0].source).toBe("bricklink_api_v1");
    expect(r.rows[0].observed_at).toBeInstanceOf(Date);
    expect(r.rows[0].raw_response.qty_avg_price).toBe(1000);
    await expect(pool.query("update public.bricklink_price_observations set qty_avg_price = 1 where id = $1", [id])).rejects.toThrow(/immutable/);
  });
});

describe("row level security", () => {
  it("prevents a user from reading or changing another user's portfolio", async () => {
    const holdingId = await withUser(alice, (db) => addPurchase(db, alice, { legoSetId: setId, condition: "N", quantity: 2, unitPrice: 800, fees: 0, date: "2026-01-10" }), pool);

    const bobView = await withUser(bob, (db) => loadPositions(db, { mode: "production", engine: { currency: "CAD", staleAfterHours: 36, minUnitsForConfidence: 3 } }), pool);
    expect(bobView).toHaveLength(0);

    const bobSees = await withUser(bob, async (db) => ({
      portfolios: (await db.query("select * from public.portfolios")).rowCount,
      holdings: (await db.query("select * from public.holdings")).rowCount,
      txs: (await db.query("select * from public.portfolio_transactions")).rowCount,
    }), pool);
    expect(bobSees).toEqual({ portfolios: 1, holdings: 0, txs: 0 });

    // Bob cannot write into Alice's holding, even by guessing its id.
    await expect(
      withUser(bob, (db) => db.query(
        "insert into public.portfolio_transactions (holding_id, user_id, transaction_type, quantity, unit_price, transaction_date) values ($1,$2,'SELL',1,1,'2026-02-01')",
        [holdingId, bob],
      ), pool),
    ).rejects.toThrow(/row-level security/);
    const del = await withUser(bob, (db) => db.query("delete from public.holdings where id = $1", [holdingId]), pool);
    expect(del.rowCount).toBe(0);

    const aliceView = await withUser(alice, (db) => loadPositions(db, { mode: "production", engine: { currency: "CAD", staleAfterHours: 36, minUnitsForConfidence: 3 } }), pool);
    expect(aliceView).toHaveLength(1);
    expect(aliceView[0]!.quantity).toBe(2);
  });

  it("does not let signed-in users write market data", async () => {
    await expect(
      withUser(alice, (db) => db.query("insert into public.bricklink_price_observations (lego_set_id, condition, guide_type, currency_code, source) values ($1,'N','sold','CAD','bricklink_api_v1')", [setId]), pool),
    ).rejects.toThrow(/permission denied|row-level security/);
    await expect(withUser(alice, (db) => db.query("update public.lego_sets set name = 'x'"), pool)).rejects.toThrow(/permission denied/);
  });
});
