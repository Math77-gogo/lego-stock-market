import { describe, expect, it } from "vitest";
import { backoffSeconds, computeSyncPlan } from "@/server/sync/scheduler";

const base = { dailyLimit: 5000, reserveRatio: 0.15, usedLast24h: 0, minIntervalMinutes: 30, maxIntervalHours: 24, minSpacingMs: 1500, avgResponseMs: null };

describe("sync plan", () => {
  it("uses the minimum interval when the budget allows", () => {
    const p = computeSyncPlan({ ...base, counts: { held_sold: 10, held_stock: 10, other_sold: 0, other_stock: 0 } });
    expect(p.baseIntervalSeconds).toBe(1800);
    expect(p.projectedDailyRequests).toBeLessThanOrEqual(p.usableDailyBudget);
  });
  it("stretches the interval as tracked sets grow, staying inside the quota", () => {
    const p = computeSyncPlan({ ...base, counts: { held_sold: 1000, held_stock: 1000, other_sold: 2000, other_stock: 2000 } });
    expect(p.baseIntervalSeconds).toBeGreaterThan(1800);
    expect(p.budgetLimited).toBe(true);
    expect(p.projectedDailyRequests).toBeLessThanOrEqual(p.usableDailyBudget + 1);
    expect(p.intervals.other_stock).toBe(p.intervals.held_sold * 6);
  });
  it("accounts for slow responses and used budget", () => {
    const slow = computeSyncPlan({ ...base, avgResponseMs: 60_000, counts: { held_sold: 100, held_stock: 0, other_sold: 0, other_stock: 0 } });
    expect(slow.throughputPerDay).toBe(1440);
    expect(slow.baseIntervalSeconds).toBe(6000);
    expect(computeSyncPlan({ ...base, usedLast24h: 5000, counts: { held_sold: 1, held_stock: 0, other_sold: 0, other_stock: 0 } }).remainingBudget).toBe(0);
  });
  it("backs off exponentially", () => {
    expect([1, 2, 3, 10].map((n) => backoffSeconds(n))).toEqual([300, 600, 1200, 21600]);
    expect(backoffSeconds(1, "not_found")).toBe(86400);
  });
});
