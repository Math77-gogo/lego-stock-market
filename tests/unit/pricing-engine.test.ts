import { describe, expect, it } from "vitest";
import {
  changeOverPeriod,
  computeLots,
  portfolioTotals,
  referencePrice,
  soldSeries,
  valuePosition,
  type PriceObservation,
  type ReferencePrice,
} from "@/server/pricing/engine";

const now = new Date("2026-11-15T12:00:00Z");
const obs = (o: Partial<PriceObservation> = {}): PriceObservation => ({
  observedAt: new Date("2026-11-15T11:00:00Z"),
  condition: "N",
  guideType: "sold",
  avgPrice: 460,
  qtyAvgPrice: 450,
  minPrice: 400,
  maxPrice: 520,
  unitQuantity: 12,
  totalQuantity: 13,
  currencyCode: "CAD",
  ...o,
});
const ref = (price: number | null): ReferencePrice => ({
  price,
  status: price === null ? "no_data" : "ok",
  observedAt: now,
  ageHours: 0,
  isStale: false,
  unitsSold: 10,
  currencyCode: "CAD",
  warnings: [],
});

describe("referencePrice", () => {
  it("uses the quantity-weighted average sold price", () => {
    const r = referencePrice(obs(), now);
    expect(r.price).toBe(450);
    expect(r.status).toBe("ok");
  });
  it("returns Insufficient BrickLink data when there is no observation", () => {
    const r = referencePrice(undefined, now);
    expect(r.price).toBeNull();
    expect(r.warnings[0]).toBe("Insufficient BrickLink data");
  });
  it("never prices from zero sales", () => {
    expect(referencePrice(obs({ unitQuantity: 0, qtyAvgPrice: 0 }), now).status).toBe("no_sales");
    expect(referencePrice(obs({ qtyAvgPrice: null }), now).price).toBeNull();
  });
  it("refuses non-CAD values instead of converting", () => {
    const r = referencePrice(obs({ currencyCode: "USD" }), now);
    expect(r.price).toBeNull();
    expect(r.status).toBe("currency_mismatch");
  });
  it("never values from asking prices", () => {
    expect(referencePrice(obs({ guideType: "stock" }), now).price).toBeNull();
  });
  it("flags stale and low-volume data", () => {
    const stale = referencePrice(obs({ observedAt: new Date("2026-11-10T00:00:00Z") }), now);
    expect(stale.isStale).toBe(true);
    expect(stale.status).toBe("stale");
    expect(stale.price).toBe(450);
    expect(referencePrice(obs({ unitQuantity: 1 }), now).status).toBe("low_volume");
  });
});

describe("historical changes", () => {
  const H = 3600_000;
  it("does not invent a baseline that was never observed", () => {
    const series = [
      { t: now.getTime() - 3 * 24 * H, v: 100 },
      { t: now.getTime(), v: 110 },
    ];
    expect(changeOverPeriod(series, 30 * 24 * H)).toBeNull(); // 3 days of data, 1 month asked
    expect(changeOverPeriod([{ t: now.getTime(), v: 110 }], 24 * H)).toBeNull();
  });
  it("computes the change from the nearest observation at or before the period start", () => {
    const series = [
      { t: now.getTime() - 26 * H, v: 100 },
      { t: now.getTime() - 12 * H, v: 105 },
      { t: now.getTime(), v: 110 },
    ];
    const c = changeOverPeriod(series, 24 * H)!;
    expect(c.from.v).toBe(100);
    expect(c.abs).toBe(10);
    expect(c.pct).toBeCloseTo(10);
  });
  it("builds series only from valid CAD sold observations", () => {
    const s = soldSeries([
      obs(),
      obs({ guideType: "stock", qtyAvgPrice: 999 }),
      obs({ currencyCode: "USD" }),
      obs({ unitQuantity: 0 }),
    ]);
    expect(s).toHaveLength(1);
  });
});

describe("lots and P&L (FIFO)", () => {
  it("tracks multiple lots and realized profit", () => {
    const r = computeLots([
      {
        id: "b1",
        type: "BUY",
        quantity: 2,
        unitPrice: 400,
        fees: 10,
        date: "2026-01-01",
        createdAt: 1,
      },
      {
        id: "b2",
        type: "BUY",
        quantity: 1,
        unitPrice: 500,
        fees: 0,
        date: "2026-02-01",
        createdAt: 2,
      },
      {
        id: "s1",
        type: "SELL",
        quantity: 2,
        unitPrice: 600,
        fees: 20,
        date: "2026-03-01",
        createdAt: 3,
      },
    ]);
    expect(r.quantity).toBe(1);
    expect(r.costBasisCents).toBe(50000); // remaining unit is the 500 lot
    expect(r.soldCostBasisCents).toBe(81000);
    expect(r.realizedPlCents).toBe(120000 - 2000 - 81000);
    expect(r.errors).toEqual([]);
  });
  it("detects overselling", () => {
    const r = computeLots([
      {
        id: "b1",
        type: "BUY",
        quantity: 1,
        unitPrice: 10,
        fees: 0,
        date: "2026-01-02",
        createdAt: 1,
      },
      {
        id: "s1",
        type: "SELL",
        quantity: 1,
        unitPrice: 10,
        fees: 0,
        date: "2026-01-01",
        createdAt: 2,
      },
    ]);
    expect(r.errors).toHaveLength(1);
  });
});

describe("portfolio valuation", () => {
  it("computes the spec example: 2 × 450 + 1 × 300 = 1,200 CAD", () => {
    const t = portfolioTotals([
      {
        key: "a",
        setId: "A",
        quantity: 2,
        costBasisCents: 80000,
        realizedPlCents: 0,
        soldCostBasisCents: 0,
        reference: ref(450),
        previousPrice: 440,
      },
      {
        key: "b",
        setId: "B",
        quantity: 1,
        costBasisCents: 25000,
        realizedPlCents: 0,
        soldCostBasisCents: 0,
        reference: ref(300),
        previousPrice: null,
      },
    ]);
    expect(t.marketValue).toBe(1200);
    expect(t.costBasis).toBe(1050);
    expect(t.unrealizedPl).toBe(150);
    expect(t.totalReturnPct).toBeCloseTo((150 / 1050) * 100);
    expect(t.dayChange).toBe(20); // only the position with a real 24h baseline
    expect(t.distinctSets).toBe(2);
    expect(t.units).toBe(3);
    expect(t.complete).toBe(true);
  });
  it("keeps new and used as separate positions with separate prices", () => {
    const t = portfolioTotals([
      {
        key: "n",
        setId: "75192",
        quantity: 2,
        costBasisCents: 200000,
        realizedPlCents: 0,
        soldCostBasisCents: 0,
        reference: ref(1123.46),
        previousPrice: null,
      },
      {
        key: "u",
        setId: "75192",
        quantity: 1,
        costBasisCents: 70000,
        realizedPlCents: 0,
        soldCostBasisCents: 0,
        reference: ref(850.1),
        previousPrice: null,
      },
    ]);
    expect(t.marketValue).toBeCloseTo(2 * 1123.46 + 850.1);
    expect(t.distinctSets).toBe(1);
    expect(t.units).toBe(3);
  });
  it("excludes unpriced positions from market value and flags the portfolio incomplete", () => {
    const t = portfolioTotals([
      {
        key: "a",
        setId: "A",
        quantity: 1,
        costBasisCents: 10000,
        realizedPlCents: 0,
        soldCostBasisCents: 0,
        reference: ref(null),
        previousPrice: null,
      },
    ]);
    expect(t.marketValue).toBe(0);
    expect(t.complete).toBe(false);
    expect(t.totalReturnPct).toBeNull();
    expect(t.dayChange).toBeNull();
  });
  it("does not compute a percentage from a zero cost basis", () => {
    const v = valuePosition({
      key: "x",
      quantity: 1,
      costBasisCents: 0,
      realizedPlCents: 0,
      soldCostBasisCents: 0,
      reference: ref(100),
      previousPrice: null,
    });
    expect(v.marketValue).toBe(100);
    expect(v.unrealizedPct).toBeNull();
  });
});
