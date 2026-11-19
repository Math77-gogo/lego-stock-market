/**
 * Price calculation engine. Pure functions only: no database, no network.
 *
 * Money is computed in integer cents to avoid floating point drift.
 * The reference market price is BrickLink's quantity-weighted average SOLD price (qty_avg_price)
 * for the position's own condition. Asking prices (guide_type 'stock') are never used for valuation.
 */

export type Condition = "N" | "U";

export interface PriceObservation {
  observedAt: Date;
  condition: Condition;
  guideType: "sold" | "stock";
  avgPrice: number | null;
  qtyAvgPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  unitQuantity: number | null;
  totalQuantity: number | null;
  currencyCode: string;
}

export type PriceStatus =
  | "ok"
  | "low_volume"
  | "stale"
  | "no_sales"
  | "no_data"
  | "currency_mismatch"
  | "wrong_guide";

export interface ReferencePrice {
  /** CAD price per unit, or null when it cannot be determined honestly. */
  price: number | null;
  status: PriceStatus;
  observedAt: Date | null;
  ageHours: number | null;
  isStale: boolean;
  unitsSold: number | null;
  currencyCode: string | null;
  warnings: string[];
}

export interface EngineOptions {
  currency: string; // CAD
  staleAfterHours: number;
  minUnitsForConfidence: number;
}

export const DEFAULT_ENGINE_OPTIONS: EngineOptions = {
  currency: "CAD",
  staleAfterHours: 36,
  minUnitsForConfidence: 3,
};

export const toCents = (v: number): number => Math.round(v * 100);
export const fromCents = (c: number): number => c / 100;

export function referencePrice(
  latestSold: PriceObservation | undefined | null,
  now: Date,
  opts: EngineOptions = DEFAULT_ENGINE_OPTIONS,
): ReferencePrice {
  const empty = (status: PriceStatus, warning: string, obs?: PriceObservation): ReferencePrice => ({
    price: null,
    status,
    observedAt: obs?.observedAt ?? null,
    ageHours: obs ? hoursBetween(obs.observedAt, now) : null,
    isStale: obs ? hoursBetween(obs.observedAt, now) > opts.staleAfterHours : false,
    unitsSold: obs?.unitQuantity ?? null,
    currencyCode: obs?.currencyCode ?? null,
    warnings: [warning],
  });

  if (!latestSold) return empty("no_data", "Insufficient BrickLink data");
  if (latestSold.guideType !== "sold")
    return empty("wrong_guide", "Asking prices are not used for valuation", latestSold);
  if (latestSold.currencyCode !== opts.currency) {
    return empty(
      "currency_mismatch",
      `BrickLink returned ${latestSold.currencyCode}; ${opts.currency} valuation unavailable`,
      latestSold,
    );
  }
  const units = latestSold.unitQuantity ?? 0;
  const price = latestSold.qtyAvgPrice;
  if (units <= 0 || price === null || !(price > 0)) {
    return empty(
      "no_sales",
      "Insufficient BrickLink data: no completed sales in BrickLink's 6-month window",
      latestSold,
    );
  }

  const ageHours = hoursBetween(latestSold.observedAt, now);
  const isStale = ageHours > opts.staleAfterHours;
  const warnings: string[] = [];
  let status: PriceStatus = "ok";
  if (units < opts.minUnitsForConfidence) {
    status = "low_volume";
    warnings.push(
      `Low BrickLink sales volume (${units} unit${units === 1 ? "" : "s"} sold in 6 months)`,
    );
  }
  if (isStale) {
    status = "stale";
    warnings.push(`Last BrickLink observation is ${formatAge(ageHours)} old`);
  }
  return {
    price: fromCents(toCents(price)),
    status,
    observedAt: latestSold.observedAt,
    ageHours,
    isStale,
    unitsSold: units,
    currencyCode: latestSold.currencyCode,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Historical changes (built only from observations the app actually collected)
// ---------------------------------------------------------------------------

export interface SeriesPoint {
  t: number; // epoch ms
  v: number;
}

export interface Change {
  abs: number;
  pct: number;
  from: SeriesPoint;
  to: SeriesPoint;
}

/**
 * Change over `periodMs` ending at the latest point. The baseline is the latest point at or before
 * (latest.t - periodMs), and it must lie within a tolerance window of that target time. If the app has
 * not collected data far enough back, the result is null: we never extrapolate.
 */
export function changeOverPeriod(series: SeriesPoint[], periodMs: number): Change | null {
  if (series.length < 2) return null;
  const to = series[series.length - 1]!;
  const target = to.t - periodMs;
  const tolerance = Math.max(periodMs * 0.5, 6 * 3600_000);
  let from: SeriesPoint | undefined;
  for (let i = series.length - 2; i >= 0; i--) {
    const p = series[i]!;
    if (p.t <= target) {
      from = p;
      break;
    }
  }
  if (!from || target - from.t > tolerance || !(from.v > 0)) return null;
  const abs = fromCents(toCents(to.v) - toCents(from.v));
  return { abs, pct: ((to.v - from.v) / from.v) * 100, from, to };
}

/** Change between the first and last points of a series (used for chart ranges). */
export function changeAcross(series: SeriesPoint[]): Change | null {
  if (series.length < 2) return null;
  const from = series[0]!;
  const to = series[series.length - 1]!;
  if (!(from.v > 0)) return null;
  return {
    abs: fromCents(toCents(to.v) - toCents(from.v)),
    pct: ((to.v - from.v) / from.v) * 100,
    from,
    to,
  };
}

/** Converts sold observations into a CAD price series, skipping anything unusable. */
export function soldSeries(observations: PriceObservation[], currency = "CAD"): SeriesPoint[] {
  return observations
    .filter(
      (o) =>
        o.guideType === "sold" &&
        o.currencyCode === currency &&
        (o.unitQuantity ?? 0) > 0 &&
        o.qtyAvgPrice !== null &&
        o.qtyAvgPrice > 0,
    )
    .map((o) => ({ t: o.observedAt.getTime(), v: o.qtyAvgPrice as number }))
    .sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------------------
// Lots, cost basis, realized P&L (FIFO)
// ---------------------------------------------------------------------------

export interface TransactionInput {
  id: string;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  fees: number;
  date: string; // YYYY-MM-DD
  createdAt: number; // epoch ms, tie-breaker
}

export interface OpenLot {
  transactionId: string;
  date: string;
  originalQuantity: number;
  remaining: number;
  unitCostCents: number; // purchase price + fees per unit
}

export interface LotResult {
  quantity: number;
  costBasisCents: number;
  realizedPlCents: number;
  soldCostBasisCents: number;
  proceedsCents: number;
  openLots: OpenLot[];
  errors: string[];
}

export function sortTransactions<T extends { date: string; createdAt: number }>(txs: T[]): T[] {
  return [...txs].sort((a, b) =>
    a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1,
  );
}

export function computeLots(transactions: TransactionInput[]): LotResult {
  const lots: OpenLot[] = [];
  const errors: string[] = [];
  let realized = 0;
  let soldCost = 0;
  let proceeds = 0;

  for (const tx of sortTransactions(transactions)) {
    if (tx.type === "BUY") {
      const totalCents = toCents(tx.unitPrice) * tx.quantity + toCents(tx.fees);
      lots.push({
        transactionId: tx.id,
        date: tx.date,
        originalQuantity: tx.quantity,
        remaining: tx.quantity,
        unitCostCents: totalCents / tx.quantity,
      });
      continue;
    }
    let toSell = tx.quantity;
    let cost = 0;
    for (const lot of lots) {
      if (toSell === 0) break;
      const take = Math.min(lot.remaining, toSell);
      cost += take * lot.unitCostCents;
      lot.remaining -= take;
      toSell -= take;
    }
    if (toSell > 0) errors.push(`Sale ${tx.id} sells ${toSell} more unit(s) than were held`);
    const sold = tx.quantity - toSell;
    const txProceeds = toCents(tx.unitPrice) * sold - toCents(tx.fees);
    proceeds += txProceeds;
    soldCost += cost;
    realized += txProceeds - cost;
  }

  const open = lots.filter((l) => l.remaining > 0);
  const quantity = open.reduce((s, l) => s + l.remaining, 0);
  const costBasis = open.reduce((s, l) => s + l.remaining * l.unitCostCents, 0);
  return {
    quantity,
    costBasisCents: Math.round(costBasis),
    realizedPlCents: Math.round(realized),
    soldCostBasisCents: Math.round(soldCost),
    proceedsCents: Math.round(proceeds),
    openLots: open,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Position and portfolio valuation
// ---------------------------------------------------------------------------

export interface PositionInput {
  key: string;
  quantity: number;
  costBasisCents: number;
  realizedPlCents: number;
  soldCostBasisCents: number;
  reference: ReferencePrice;
  /** Reference price ~24h earlier, from collected observations (for "today"). */
  previousPrice: number | null;
}

export interface PositionValuation {
  key: string;
  quantity: number;
  costBasis: number;
  averageCost: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPct: number | null;
  realizedPl: number;
  dayChange: number | null;
  priced: boolean;
  warnings: string[];
}

export function valuePosition(p: PositionInput): PositionValuation {
  const priced = p.reference.price !== null && p.quantity > 0;
  const mvCents = priced ? toCents(p.reference.price as number) * p.quantity : null;
  const upl = mvCents !== null ? mvCents - p.costBasisCents : null;
  const dayChange =
    priced && p.previousPrice !== null && p.previousPrice > 0
      ? fromCents((toCents(p.reference.price as number) - toCents(p.previousPrice)) * p.quantity)
      : null;
  return {
    key: p.key,
    quantity: p.quantity,
    costBasis: fromCents(p.costBasisCents),
    averageCost: p.quantity > 0 ? fromCents(Math.round(p.costBasisCents / p.quantity)) : null,
    marketValue: mvCents !== null ? fromCents(mvCents) : null,
    unrealizedPl: upl !== null ? fromCents(upl) : null,
    unrealizedPct: upl !== null && p.costBasisCents > 0 ? (upl / p.costBasisCents) * 100 : null,
    realizedPl: fromCents(p.realizedPlCents),
    dayChange,
    priced,
    warnings: p.quantity > 0 ? p.reference.warnings : [],
  };
}

export interface PortfolioTotals {
  marketValue: number; // priced positions only
  costBasis: number; // all open positions
  pricedCostBasis: number;
  unrealizedPl: number; // priced positions only
  realizedPl: number;
  totalReturn: number;
  totalReturnPct: number | null;
  dayChange: number | null;
  dayChangePct: number | null;
  distinctSets: number;
  units: number;
  pricedPositions: number;
  unpricedPositions: number;
  complete: boolean;
}

export function portfolioTotals(positions: (PositionInput & { setId: string })[]): PortfolioTotals {
  let mv = 0;
  let cost = 0;
  let pricedCost = 0;
  let upl = 0;
  let realized = 0;
  let soldCost = 0;
  let dayChange = 0;
  let dayBase = 0;
  let dayCount = 0;
  let units = 0;
  let priced = 0;
  let unpriced = 0;
  const sets = new Set<string>();

  for (const p of positions) {
    realized += p.realizedPlCents;
    soldCost += p.soldCostBasisCents;
    if (p.quantity <= 0) continue;
    sets.add(p.setId);
    units += p.quantity;
    cost += p.costBasisCents;
    if (p.reference.price === null) {
      unpriced++;
      continue;
    }
    priced++;
    const posMv = toCents(p.reference.price) * p.quantity;
    mv += posMv;
    pricedCost += p.costBasisCents;
    upl += posMv - p.costBasisCents;
    if (p.previousPrice !== null && p.previousPrice > 0) {
      dayChange += (toCents(p.reference.price) - toCents(p.previousPrice)) * p.quantity;
      dayBase += toCents(p.previousPrice) * p.quantity;
      dayCount++;
    }
  }
  const totalReturn = upl + realized;
  const returnBase = pricedCost + soldCost;
  return {
    marketValue: fromCents(mv),
    costBasis: fromCents(cost),
    pricedCostBasis: fromCents(pricedCost),
    unrealizedPl: fromCents(upl),
    realizedPl: fromCents(realized),
    totalReturn: fromCents(totalReturn),
    totalReturnPct: returnBase > 0 ? (totalReturn / returnBase) * 100 : null,
    dayChange: dayCount > 0 ? fromCents(dayChange) : null,
    dayChangePct: dayCount > 0 && dayBase > 0 ? (dayChange / dayBase) * 100 : null,
    distinctSets: sets.size,
    units,
    pricedPositions: priced,
    unpricedPositions: unpriced,
    complete: unpriced === 0,
  };
}

// ---------------------------------------------------------------------------
function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3600_000;
}

export function formatAge(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// Market-only portfolio series (like a brokerage "performance" chart)
// ---------------------------------------------------------------------------

export interface HoldingSeries {
  quantity: number;
  series: SeriesPoint[]; // sorted sold-price observations for this set + condition
}

/**
 * Value of the CURRENT holdings over time, moved only by BrickLink prices.
 * Buying or selling never creates a jump, and what was paid plays no role.
 *
 * Chain-linked index: between two consecutive time buckets, the return is computed only over
 * holdings priced in both buckets, so a set whose tracking started later doesn't create a jump.
 * The index is then scaled so the last point equals `endValue` (today's market value).
 */
export function marketOnlySeries(
  holdings: HoldingSeries[],
  endValue: number,
  bucketMs = 3600_000,
): SeriesPoint[] {
  const priced = holdings.filter((h) => h.quantity > 0 && h.series.length > 0);
  if (priced.length === 0 || !(endValue > 0)) return [];

  // Last price per bucket for each holding.
  const perHolding = priced.map((h) => {
    const m = new Map<number, number>();
    for (const p of h.series) m.set(Math.floor(p.t / bucketMs) * bucketMs, p.v);
    return m;
  });
  const buckets = [...new Set(perHolding.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  if (buckets.length === 0) return [];

  const last: (number | undefined)[] = priced.map(() => undefined);
  const index: SeriesPoint[] = [];
  let level = 1;
  for (const b of buckets) {
    let prev = 0;
    let cur = 0;
    priced.forEach((h, i) => {
      const before = last[i];
      const now = perHolding[i]!.get(b) ?? before;
      if (before !== undefined && now !== undefined) {
        prev += h.quantity * before;
        cur += h.quantity * now;
      }
      last[i] = now;
    });
    if (index.length > 0 && prev > 0) level *= cur / prev;
    index.push({ t: b, v: level });
  }
  const scale = endValue / level;
  return index.map((p) => ({ t: p.t, v: Math.round(p.v * scale * 100) / 100 }));
}

// ---------------------------------------------------------------------------
// Sales trend from BrickLink's individual sales (price_detail, last 6 months)
// ---------------------------------------------------------------------------

export interface SaleRecord {
  quantity: number;
  unitPrice: number;
  dateOrdered: string; // ISO timestamp from BrickLink
}

const DAY_MS = 86_400_000;

/**
 * One point per day that had sales: the quantity-weighted average price of all sales in the
 * `windowDays` days up to and including that day. Smooths single odd sales while staying
 * entirely made of real BrickLink transactions.
 */
export function salesTrendSeries(sales: SaleRecord[], windowDays = 14): SeriesPoint[] {
  const valid = sales
    .map((s) => ({ q: s.quantity, p: s.unitPrice, t: Date.parse(s.dateOrdered) }))
    .filter((s) => s.q > 0 && s.p > 0 && Number.isFinite(s.t))
    .sort((a, b) => a.t - b.t);
  const days = [...new Set(valid.map((s) => Math.floor(s.t / DAY_MS)))];
  return days.map((day) => {
    const end = (day + 1) * DAY_MS;
    const start = end - windowDays * DAY_MS;
    let qty = 0;
    let total = 0;
    for (const s of valid) {
      if (s.t >= start && s.t < end) {
        qty += s.q;
        total += s.q * s.p;
      }
    }
    return { t: day * DAY_MS + DAY_MS / 2, v: Math.round((total / qty) * 100) / 100 };
  });
}
