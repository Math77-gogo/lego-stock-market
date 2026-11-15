import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { createUser, resetDatabase, silentLogger, testConfig } from "./helpers";
import { createMockState, mockTransport } from "../fixtures/bricklink";
import { SyncEngine } from "@/server/sync/engine";
import { withUser } from "@/server/db/context";
import {
  addPurchase,
  deleteHolding,
  deleteTransaction,
  loadPositions,
  recordTransaction,
  totalsFor,
  updateTransaction,
} from "@/server/portfolio/service";

let pool: pg.Pool;
let user: string;
let setId: string;
const opts = {
  mode: "test" as const,
  engine: { currency: "CAD", staleAfterHours: 36, minUnitsForConfidence: 3 },
};

beforeAll(async () => {
  pool = await resetDatabase();
  const engine = new SyncEngine(pool, testConfig(), silentLogger, mockTransport(createMockState()));
  setId = (await engine.lookupCatalogItem("SET", "75192-1")).id;
  await engine.runCycle("test");
  user = await createUser(pool, "p@example.test");
});
afterAll(async () => pool.end());

const positions = () => withUser(user, (db) => loadPositions(db, opts), pool);

describe("portfolio management", () => {
  let holdingId: string;

  it("adds a set and records additional purchases as separate lots", async () => {
    holdingId = await withUser(
      user,
      (db) =>
        addPurchase(db, user, {
          legoSetId: setId,
          condition: "N",
          quantity: 1,
          unitPrice: 800,
          fees: 0,
          date: "2026-01-05",
        }),
      pool,
    );
    await withUser(
      user,
      (db) =>
        addPurchase(db, user, {
          legoSetId: setId,
          condition: "N",
          quantity: 2,
          unitPrice: 950,
          fees: 15,
          date: "2026-03-05",
        }),
      pool,
    );
    const [p] = await positions();
    expect(p!.holdingId).toBe(holdingId);
    expect(p!.quantity).toBe(3);
    expect(p!.openLots).toHaveLength(2);
    expect(p!.costBasis).toBe(800 + 1900 + 15);
  });

  it("records a sale with FIFO realized P&L", async () => {
    await withUser(
      user,
      (db) =>
        recordTransaction(db, user, {
          holdingId,
          type: "SELL",
          quantity: 1,
          unitPrice: 1100,
          fees: 10,
          date: "2026-06-01",
        }),
      pool,
    );
    const [p] = await positions();
    expect(p!.quantity).toBe(2);
    expect(p!.realizedPl).toBe(1100 - 10 - 800);
    expect(totalsFor([p!]).realizedPl).toBe(290);
  });

  it("rejects selling more than held", async () => {
    await expect(
      withUser(
        user,
        (db) =>
          recordTransaction(db, user, {
            holdingId,
            type: "SELL",
            quantity: 5,
            unitPrice: 1,
            fees: 0,
            date: "2026-07-01",
          }),
        pool,
      ),
    ).rejects.toThrow(/more units than you held/);
  });

  it("edits and deletes transactions, refusing changes that break history", async () => {
    const [p] = await positions();
    const firstBuy = p!.transactions.find((t) => t.type === "BUY" && t.date === "2026-01-05")!;
    await withUser(
      user,
      (db) =>
        updateTransaction(db, {
          transactionId: firstBuy.id,
          quantity: 1,
          unitPrice: 750,
          fees: 0,
          date: "2026-01-05",
        }),
      pool,
    );
    expect((await positions())[0]!.realizedPl).toBe(1100 - 10 - 750);
    // Deleting the earlier buys would leave the June sale uncovered.
    const later = p!.transactions.find((t) => t.type === "BUY" && t.date === "2026-03-05")!;
    await withUser(user, (db) => deleteTransaction(db, firstBuy.id), pool); // still covered by the March lot
    await expect(withUser(user, (db) => deleteTransaction(db, later.id), pool)).rejects.toThrow(
      /more units/,
    );
    expect((await positions())[0]!.quantity).toBe(1);
  });

  it("removes a holding but keeps BrickLink history", async () => {
    const before = await pool.query(
      "select count(*)::int as n from public.bricklink_price_observations",
    );
    await withUser(user, (db) => deleteHolding(db, holdingId), pool);
    expect(await positions()).toHaveLength(0);
    const after = await pool.query(
      "select count(*)::int as n from public.bricklink_price_observations",
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("validates input", async () => {
    const { addPurchaseSchema } = await import("@/server/portfolio/service");
    expect(
      addPurchaseSchema.safeParse({
        legoSetId: setId,
        condition: "X",
        quantity: 1,
        unitPrice: 1,
        date: "2026-01-01",
      }).success,
    ).toBe(false);
    expect(
      addPurchaseSchema.safeParse({
        legoSetId: setId,
        condition: "N",
        quantity: 0,
        unitPrice: 1,
        date: "2026-01-01",
      }).success,
    ).toBe(false);
    expect(
      addPurchaseSchema.safeParse({
        legoSetId: setId,
        condition: "N",
        quantity: 1,
        unitPrice: 1,
        date: "2999-01-01",
      }).success,
    ).toBe(false);
    expect(
      addPurchaseSchema.safeParse({
        legoSetId: setId,
        condition: "N",
        quantity: 1,
        unitPrice: 1.234,
        date: "2026-01-01",
      }).success,
    ).toBe(false);
  });
});
