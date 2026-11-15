/**
 * Pure scheduling math. The interval adapts to: number of tracked targets, the daily API quota,
 * the observed API response time, the remaining budget in the last 24 h, and portfolio priority.
 *
 * Target classes (interval multiplier relative to the base interval):
 *   held_sold   ×1  sets in at least one portfolio, sold price guide (drives valuations)
 *   held_stock  ×3  sets in portfolios, current listings
 *   other_sold  ×3  tracked sets nobody holds yet
 *   other_stock ×6
 */
export type TargetClass = "held_sold" | "held_stock" | "other_sold" | "other_stock";
export const CLASS_MULTIPLIER: Record<TargetClass, number> = {
  held_sold: 1,
  held_stock: 3,
  other_sold: 3,
  other_stock: 6,
};

export interface PlanInput {
  counts: Record<TargetClass, number>;
  dailyLimit: number;
  reserveRatio: number;
  usedLast24h: number;
  minIntervalMinutes: number;
  maxIntervalHours: number;
  minSpacingMs: number;
  avgResponseMs: number | null;
}

export interface SyncPlan {
  baseIntervalSeconds: number;
  intervals: Record<TargetClass, number>; // seconds
  usableDailyBudget: number;
  remainingBudget: number;
  projectedDailyRequests: number;
  throughputPerDay: number;
  budgetLimited: boolean;
}

export function computeSyncPlan(input: PlanInput): SyncPlan {
  const usable = Math.floor(input.dailyLimit * (1 - input.reserveRatio));
  const perRequestMs = Math.max(input.minSpacingMs, input.avgResponseMs ?? 0, 1);
  const throughputPerDay = Math.floor(86_400_000 / perRequestMs);
  const capacity = Math.max(1, Math.min(usable, throughputPerDay));

  const weighted = (Object.keys(input.counts) as TargetClass[]).reduce(
    (s, k) => s + input.counts[k] / CLASS_MULTIPLIER[k],
    0,
  );
  const minSec = input.minIntervalMinutes * 60;
  const maxSec = input.maxIntervalHours * 3600;
  const ideal = weighted > 0 ? (86_400 * weighted) / capacity : minSec;
  const base = Math.round(Math.min(Math.max(ideal, minSec), maxSec));

  const intervals = Object.fromEntries(
    (Object.keys(CLASS_MULTIPLIER) as TargetClass[]).map((k) => [
      k,
      Math.round(base * CLASS_MULTIPLIER[k]),
    ]),
  ) as Record<TargetClass, number>;

  const projected = (Object.keys(input.counts) as TargetClass[]).reduce(
    (s, k) => s + (input.counts[k] * 86_400) / intervals[k],
    0,
  );
  return {
    baseIntervalSeconds: Math.round(base),
    intervals,
    usableDailyBudget: usable,
    remainingBudget: Math.max(0, usable - input.usedLast24h),
    projectedDailyRequests: Math.round(projected),
    throughputPerDay,
    budgetLimited: ideal > minSec,
  };
}

/** Exponential backoff after consecutive failures: 5 min, 10, 20 … capped at 6 h. */
export function backoffSeconds(consecutiveFailures: number, kind?: string): number {
  if (kind === "not_found") return 24 * 3600;
  const n = Math.max(1, consecutiveFailures);
  return Math.min(6 * 3600, 300 * 2 ** (n - 1));
}
