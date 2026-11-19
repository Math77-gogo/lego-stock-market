import { describe, expect, it } from "vitest";
import { marketOnlySeries } from "@/server/pricing/engine";

const H = 3600_000;

describe("market-only portfolio series", () => {
  it("follows price moves and ends at today's market value", () => {
    const s = marketOnlySeries(
      [
        {
          quantity: 2,
          series: [
            { t: 0, v: 100 },
            { t: H, v: 110 },
          ],
        },
      ],
      220,
    );
    expect(s).toEqual([
      { t: 0, v: 200 },
      { t: H, v: 220 },
    ]);
  });

  it("does not jump when a newly tracked set joins later", () => {
    const s = marketOnlySeries(
      [
        {
          quantity: 1,
          series: [
            { t: 0, v: 100 },
            { t: H, v: 100 },
            { t: 2 * H, v: 100 },
          ],
        },
        { quantity: 1, series: [{ t: 2 * H, v: 500 }] }, // tracked only from the 3rd hour
      ],
      600,
    );
    // Prices of the first set never moved and the new set has no history: the line is flat.
    expect(s.map((p) => p.v)).toEqual([600, 600, 600]);
  });

  it("measures the market move, not what was paid", () => {
    const s = marketOnlySeries(
      [
        {
          quantity: 1,
          series: [
            { t: 0, v: 100 },
            { t: H, v: 90 },
          ],
        },
        {
          quantity: 1,
          series: [
            { t: 0, v: 200 },
            { t: H, v: 220 },
          ],
        },
      ],
      310,
    );
    expect(s[0]!.v).toBe(300);
    expect(s[1]!.v).toBe(310); // +10 on 300 = +3.33 %
  });

  it("returns nothing without prices", () => {
    expect(marketOnlySeries([], 0)).toEqual([]);
    expect(marketOnlySeries([{ quantity: 1, series: [] }], 100)).toEqual([]);
  });
});
