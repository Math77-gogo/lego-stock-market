import { describe, expect, it } from "vitest";
import { salesTrendSeries } from "@/server/pricing/engine";

describe("sales trend from individual BrickLink sales", () => {
  it("averages sales in the trailing window, weighted by quantity", () => {
    const s = salesTrendSeries(
      [
        { quantity: 1, unitPrice: 100, dateOrdered: "2026-06-01T10:00:00Z" },
        { quantity: 3, unitPrice: 200, dateOrdered: "2026-06-05T10:00:00Z" },
        { quantity: 1, unitPrice: 400, dateOrdered: "2026-07-30T10:00:00Z" },
      ],
      14,
    );
    expect(s.map((p) => p.v)).toEqual([100, 175, 400]);
    expect(new Date(s[0]!.t).toISOString().slice(0, 10)).toBe("2026-06-01");
  });
  it("ignores unusable records", () => {
    expect(
      salesTrendSeries([
        { quantity: 0, unitPrice: 10, dateOrdered: "2026-06-01T00:00:00Z" },
        { quantity: 1, unitPrice: 10, dateOrdered: "not a date" },
      ]),
    ).toEqual([]);
  });
});
