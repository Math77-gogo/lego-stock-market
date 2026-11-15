import { z } from "zod";
import type { Db } from "../db/context";
import {
  latestObservations,
  observationSeries,
  type StoredObservation,
} from "../market/repository";
import { mapSet, SET_COLS, type LegoSet } from "../catalog/service";
import {
  changeOverPeriod,
  computeLots,
  portfolioTotals,
  referencePrice,
  soldSeries,
  valuePosition,
  type Condition,
  type EngineOptions,
  type PortfolioTotals,
  type PositionValuation,
  type ReferencePrice,
  type TransactionInput,
  type OpenLot,
} from "../pricing/engine";

const DAY_MS = 86_400_000;

export interface TransactionView extends TransactionInput {
  holdingId: string;
  currency: string;
  notes: string | null;
}

export interface PositionView extends PositionValuation {
  holdingId: string;
  portfolioId: string;
  set: LegoSet;
  condition: Condition;
  notes: string | null;
  reference: ReferencePrice;
  dayChangePct: number | null;
  openLots: OpenLot[];
  transactions: TransactionView[];
  lotErrors: string[];
  soldCostBasis: number;
}

export interface PortfolioSummary {
  id: string;
  name: string;
  currency: string;
}

interface HoldingRow {
  holding_id: string;
  portfolio_id: string;
  condition: Condition;
  notes: string | null;
  set_id: string;
}

interface TxRow {
  id: string;
  holding_id: string;
  transaction_type: "BUY" | "SELL";
  quantity: number;
  unit_price: string;
  fees: string;
  currency: string;
  transaction_date: string;
  notes: string | null;
  created_at: Date;
}

/**
 * Loads and values positions. Works in a user context (RLS limits rows to that user) or a system
 * context (worker snapshots, `portfolioIds` given).
 */
export async function loadPositions(
  db: Db,
  opts: { portfolioIds?: string[]; mode: "production" | "test"; engine: EngineOptions; now?: Date },
): Promise<PositionView[]> {
  const now = opts.now ?? new Date();
  const holdings = await db.query<HoldingRow & Record<string, unknown>>(
    `select h.id as holding_id, h.portfolio_id, h.condition, h.notes, s.id as set_id,
            ${SET_COLS.split(",")
              .map((c) => `s.${c.trim()}`)
              .join(", ")}
       from public.holdings h join public.lego_sets s on s.id = h.lego_set_id
      where ($1::uuid[] is null or h.portfolio_id = any($1::uuid[]))
      order by h.created_at`,
    [opts.portfolioIds ?? null],
  );
  if (holdings.rows.length === 0) return [];

  const holdingIds = holdings.rows.map((h) => h.holding_id);
  const setIds = [...new Set(holdings.rows.map((h) => h.set_id))];
  const [txs, latest, recent] = await Promise.all([
    db.query<TxRow>(
      `select id, holding_id, transaction_type, quantity, unit_price, fees, currency,
              to_char(transaction_date, 'YYYY-MM-DD') as transaction_date, notes, created_at
         from public.portfolio_transactions where holding_id = any($1::uuid[])`,
      [holdingIds],
    ),
    latestObservations(db, setIds, "sold", opts.mode),
    observationSeries(db, setIds, "sold", new Date(now.getTime() - 3 * DAY_MS), opts.mode),
  ]);

  const txByHolding = new Map<string, TransactionView[]>();
  for (const r of txs.rows) {
    const list = txByHolding.get(r.holding_id) ?? [];
    list.push({
      id: r.id,
      holdingId: r.holding_id,
      type: r.transaction_type,
      quantity: r.quantity,
      unitPrice: Number(r.unit_price),
      fees: Number(r.fees),
      date: r.transaction_date,
      createdAt: r.created_at.getTime(),
      currency: r.currency,
      notes: r.notes,
    });
    txByHolding.set(r.holding_id, list);
  }

  return holdings.rows.map((h) => {
    const set = mapSet({ ...h, id: h.set_id } as unknown as Parameters<typeof mapSet>[0]);
    const key = `${h.set_id}:${h.condition}`;
    const ref = referencePrice(latest.get(key), now, opts.engine);
    const series = soldSeries(recent.get(key) ?? [], opts.engine.currency);
    const day = ref.price !== null && !ref.isStale ? changeOverPeriod(series, DAY_MS) : null;
    const transactions = txByHolding.get(h.holding_id) ?? [];
    const lots = computeLots(transactions);
    const valuation = valuePosition({
      key: h.holding_id,
      quantity: lots.quantity,
      costBasisCents: lots.costBasisCents,
      realizedPlCents: lots.realizedPlCents,
      soldCostBasisCents: lots.soldCostBasisCents,
      reference: ref,
      previousPrice: day?.from.v ?? null,
    });
    return {
      ...valuation,
      holdingId: h.holding_id,
      portfolioId: h.portfolio_id,
      set,
      condition: h.condition,
      notes: h.notes,
      reference: ref,
      dayChangePct: day?.pct ?? null,
      openLots: lots.openLots,
      transactions: transactions.sort((a, b) =>
        a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1,
      ),
      lotErrors: lots.errors,
      soldCostBasis: lots.soldCostBasisCents / 100,
    };
  });
}

export function totalsFor(positions: PositionView[]): PortfolioTotals {
  return portfolioTotals(
    positions.map((p) => ({
      key: p.holdingId,
      setId: p.set.id,
      quantity: p.quantity,
      costBasisCents: Math.round(p.costBasis * 100),
      realizedPlCents: Math.round(p.realizedPl * 100),
      soldCostBasisCents: Math.round(p.soldCostBasis * 100),
      reference: p.reference,
      previousPrice:
        p.dayChange !== null && p.reference.price !== null && p.quantity > 0
          ? p.reference.price - p.dayChange / p.quantity
          : null,
    })),
  );
}

export async function getDefaultPortfolio(db: Db, userId: string): Promise<PortfolioSummary> {
  const res = await db.query<{ id: string; name: string; base_currency: string }>(
    "select id, name, base_currency from public.portfolios where user_id = $1 order by created_at limit 1",
    [userId],
  );
  if (res.rows[0])
    return { id: res.rows[0].id, name: res.rows[0].name, currency: res.rows[0].base_currency };
  const created = await db.query<{ id: string; name: string; base_currency: string }>(
    "insert into public.portfolios (user_id, name) values ($1, 'My LEGO Portfolio') returning id, name, base_currency",
    [userId],
  );
  return {
    id: created.rows[0]!.id,
    name: created.rows[0]!.name,
    currency: created.rows[0]!.base_currency,
  };
}

// ---------------------------------------------------------------------------
// Mutations (always called inside withUser → RLS enforced)
// ---------------------------------------------------------------------------

const money = z.coerce.number().min(0).max(10_000_000).multipleOf(0.01);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (d) => !Number.isNaN(Date.parse(d)) && d <= new Date().toISOString().slice(0, 10),
    "Date cannot be in the future",
  );

export const addPurchaseSchema = z.object({
  legoSetId: z.string().uuid(),
  condition: z.enum(["N", "U"]),
  quantity: z.coerce.number().int().min(1).max(100000),
  unitPrice: money,
  fees: money.default(0),
  date: isoDate,
  notes: z.string().max(2000).optional(),
});

export const transactionSchema = z.object({
  holdingId: z.string().uuid(),
  type: z.enum(["BUY", "SELL"]),
  quantity: z.coerce.number().int().min(1).max(100000),
  unitPrice: money,
  fees: money.default(0),
  date: isoDate,
  notes: z.string().max(2000).optional(),
});

export const updateTransactionSchema = transactionSchema
  .omit({ holdingId: true, type: true })
  .extend({
    transactionId: z.string().uuid(),
  });

export class ValidationError extends Error {
  override name = "ValidationError";
}

/** Adds a purchase, creating the (set, condition) holding if needed. */
export async function addPurchase(
  db: Db,
  userId: string,
  input: z.infer<typeof addPurchaseSchema>,
): Promise<string> {
  const portfolio = await getDefaultPortfolio(db, userId);
  const holding = await db.query<{ id: string }>(
    `insert into public.holdings (portfolio_id, lego_set_id, condition)
     values ($1, $2, $3)
     on conflict (portfolio_id, lego_set_id, condition) do update set condition = excluded.condition
     returning id`,
    [portfolio.id, input.legoSetId, input.condition],
  );
  const holdingId = holding.rows[0]!.id;
  await insertTx(db, userId, { holdingId, type: "BUY", ...input });
  if (input.notes) {
    await db.query("update public.holdings set notes = $2 where id = $1 and notes is null", [
      holdingId,
      input.notes,
    ]);
  }
  return holdingId;
}

export async function recordTransaction(
  db: Db,
  userId: string,
  input: z.infer<typeof transactionSchema>,
): Promise<void> {
  const owns = await db.query("select 1 from public.holdings where id = $1", [input.holdingId]);
  if (owns.rowCount === 0) throw new ValidationError("Holding not found");
  if (input.type === "SELL") {
    await assertValidAfterChange(db, input.holdingId, (txs) => [
      ...txs,
      {
        id: "new",
        type: "SELL",
        quantity: input.quantity,
        unitPrice: input.unitPrice,
        fees: input.fees,
        date: input.date,
        createdAt: Date.now(),
      },
    ]);
  }
  await insertTx(db, userId, input);
}

export async function updateTransaction(
  db: Db,
  input: z.infer<typeof updateTransactionSchema>,
): Promise<void> {
  const existing = await db.query<{ holding_id: string }>(
    "select holding_id from public.portfolio_transactions where id = $1",
    [input.transactionId],
  );
  const holdingId = existing.rows[0]?.holding_id;
  if (!holdingId) throw new ValidationError("Transaction not found");
  await assertValidAfterChange(db, holdingId, (txs) =>
    txs.map((t) =>
      t.id === input.transactionId
        ? {
            ...t,
            quantity: input.quantity,
            unitPrice: input.unitPrice,
            fees: input.fees,
            date: input.date,
          }
        : t,
    ),
  );
  await db.query(
    `update public.portfolio_transactions set quantity = $2, unit_price = $3, fees = $4, transaction_date = $5, notes = $6
      where id = $1`,
    [
      input.transactionId,
      input.quantity,
      input.unitPrice,
      input.fees,
      input.date,
      input.notes ?? null,
    ],
  );
}

export async function deleteTransaction(db: Db, transactionId: string): Promise<void> {
  const existing = await db.query<{ holding_id: string }>(
    "select holding_id from public.portfolio_transactions where id = $1",
    [transactionId],
  );
  const holdingId = existing.rows[0]?.holding_id;
  if (!holdingId) throw new ValidationError("Transaction not found");
  await assertValidAfterChange(db, holdingId, (txs) => txs.filter((t) => t.id !== transactionId));
  await db.query("delete from public.portfolio_transactions where id = $1", [transactionId]);
}

/** Removes a position and its transactions. BrickLink observations for the set are kept. */
export async function deleteHolding(db: Db, holdingId: string): Promise<void> {
  const res = await db.query("delete from public.holdings where id = $1", [holdingId]);
  if (res.rowCount === 0) throw new ValidationError("Holding not found");
}

export async function updateHoldingNotes(
  db: Db,
  holdingId: string,
  notes: string | null,
): Promise<void> {
  if (notes && notes.length > 2000) throw new ValidationError("Notes are too long");
  const res = await db.query("update public.holdings set notes = $2 where id = $1", [
    holdingId,
    notes,
  ]);
  if (res.rowCount === 0) throw new ValidationError("Holding not found");
}

async function insertTx(
  db: Db,
  userId: string,
  t: {
    holdingId: string;
    type: "BUY" | "SELL";
    quantity: number;
    unitPrice: number;
    fees: number;
    date: string;
    notes?: string;
  },
) {
  await db.query(
    `insert into public.portfolio_transactions
       (holding_id, user_id, transaction_type, quantity, unit_price, fees, currency, transaction_date, notes)
     values ($1,$2,$3,$4,$5,$6,'CAD',$7,$8)`,
    [t.holdingId, userId, t.type, t.quantity, t.unitPrice, t.fees, t.date, t.notes ?? null],
  );
}

async function assertValidAfterChange(
  db: Db,
  holdingId: string,
  change: (txs: TransactionInput[]) => TransactionInput[],
): Promise<void> {
  const res = await db.query<TxRow>(
    `select id, holding_id, transaction_type, quantity, unit_price, fees, currency,
            to_char(transaction_date, 'YYYY-MM-DD') as transaction_date, notes, created_at
       from public.portfolio_transactions where holding_id = $1`,
    [holdingId],
  );
  const txs: TransactionInput[] = res.rows.map((r) => ({
    id: r.id,
    type: r.transaction_type,
    quantity: r.quantity,
    unitPrice: Number(r.unit_price),
    fees: Number(r.fees),
    date: r.transaction_date,
    createdAt: r.created_at.getTime(),
  }));
  const result = computeLots(change(txs));
  if (result.errors.length > 0) {
    throw new ValidationError("This change would sell more units than you held at that date");
  }
}

// ---------------------------------------------------------------------------
// Portfolio value snapshots (worker, system context)
// ---------------------------------------------------------------------------

export async function writePortfolioSnapshots(
  db: Db,
  opts: { mode: "production" | "test"; engine: EngineOptions; now?: Date },
): Promise<number> {
  const now = opts.now ?? new Date();
  const portfolios = await db.query<{ id: string }>(
    "select distinct portfolio_id as id from public.holdings",
  );
  let written = 0;
  for (const { id } of portfolios.rows) {
    const positions = await loadPositions(db, {
      portfolioIds: [id],
      mode: opts.mode,
      engine: opts.engine,
      now,
    });
    const t = totalsFor(positions);
    const last = await db.query<{ market_value: string; cost_basis: string; captured_at: Date }>(
      `select market_value, cost_basis, captured_at from public.portfolio_value_snapshots
        where portfolio_id = $1 order by captured_at desc limit 1`,
      [id],
    );
    const prev = last.rows[0];
    const unchanged =
      prev &&
      Number(prev.market_value) === t.marketValue &&
      Number(prev.cost_basis) === t.costBasis;
    // Keep one point per hour even when flat, so the chart reflects that time passed.
    if (unchanged && now.getTime() - prev.captured_at.getTime() < 3600_000) continue;
    await db.query(
      `insert into public.portfolio_value_snapshots
        (portfolio_id, captured_at, market_value, cost_basis, unrealized_pl, realized_pl, priced_positions, unpriced_positions)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        now,
        t.marketValue,
        t.costBasis,
        t.unrealizedPl,
        t.realizedPl,
        t.pricedPositions,
        t.unpricedPositions,
      ],
    );
    written++;
  }
  return written;
}

export async function portfolioSnapshots(
  db: Db,
  portfolioId: string,
): Promise<
  { t: number; marketValue: number; costBasis: number; unrealizedPl: number; unpriced: number }[]
> {
  const res = await db.query<{
    captured_at: Date;
    market_value: string;
    cost_basis: string;
    unrealized_pl: string;
    unpriced_positions: number;
  }>(
    `select captured_at, market_value, cost_basis, unrealized_pl, unpriced_positions
       from public.portfolio_value_snapshots where portfolio_id = $1 order by captured_at asc`,
    [portfolioId],
  );
  return res.rows.map((r) => ({
    t: r.captured_at.getTime(),
    marketValue: Number(r.market_value),
    costBasis: Number(r.cost_basis),
    unrealizedPl: Number(r.unrealized_pl),
    unpriced: r.unpriced_positions,
  }));
}

export type { StoredObservation };
