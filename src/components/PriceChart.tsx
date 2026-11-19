"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis, XAxis } from "recharts";
import { money, pct, signedMoney } from "@/lib/format";

export interface ChartPoint {
  t: number;
  v: number;
}

const DAY = 86_400_000;
export const RANGES = [
  { key: "1D", ms: DAY },
  { key: "1W", ms: 7 * DAY },
  { key: "1M", ms: 30 * DAY },
  { key: "3M", ms: 90 * DAY },
  { key: "6M", ms: 180 * DAY },
  { key: "1Y", ms: 365 * DAY },
  { key: "ALL", ms: Infinity },
] as const;
export type RangeKey = (typeof RANGES)[number]["key"];

/** Keeps at most `max` points (always the first and last) so long histories stay smooth. */
function decimate(points: ChartPoint[], max = 500): ChartPoint[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

function formatStamp(t: number, rangeMs: number): string {
  const d = new Date(t);
  return rangeMs <= 7 * DAY
    ? d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

interface Props {
  points: ChartPoint[];
  /** Headline label above the value, e.g. "Reference price" */
  label: string;
  /** Explains what one point is (shown under the chart) */
  footnote: string;
  defaultRange?: RangeKey;
  emptyTitle?: string;
  emptyBody?: string;
  headlineValue?: number | null;
  headlineSuffix?: string;
  /** Range buttons to offer (default: all). */
  ranges?: RangeKey[];
}

export function PriceChart({
  points,
  label,
  footnote,
  defaultRange = "1M",
  emptyTitle,
  emptyBody,
  headlineValue,
  headlineSuffix,
  ranges,
}: Props) {
  const rangeOptions = ranges ? RANGES.filter((r) => ranges.includes(r.key)) : RANGES;
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [hover, setHover] = useState<ChartPoint | null>(null);
  const rangeMs = RANGES.find((r) => r.key === range)!.ms;

  const visible = useMemo(() => {
    if (points.length === 0) return [];
    const end = points[points.length - 1]!.t;
    const start = rangeMs === Infinity ? -Infinity : end - rangeMs;
    return decimate(points.filter((p) => p.t >= start));
  }, [points, rangeMs]);

  const first = visible[0];
  const last = visible[visible.length - 1];
  const coversRange =
    first && last && (rangeMs === Infinity || last.t - points[0]!.t >= rangeMs * 0.9);
  const enough = visible.length >= 2;
  const shown = hover ?? last;
  const change =
    enough && first && shown && first.v > 0
      ? { abs: shown.v - first.v, pct: ((shown.v - first.v) / first.v) * 100 }
      : null;
  const up = (change?.abs ?? 0) >= 0;
  const color = up ? "rgb(var(--gain))" : "rgb(var(--loss))";

  const values = visible.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || max * 0.02 || 1) * 0.15;

  return (
    <section aria-label={`${label} chart`}>
      <div className="min-h-[92px]">
        <div className="label">{label}</div>
        <div className="mt-1 text-hero tabular-nums">
          {money(hover ? hover.v : headlineValue !== undefined ? headlineValue : (last?.v ?? null))}
          {headlineSuffix && (
            <span className="ml-2 align-middle text-base font-semibold text-muted">
              {headlineSuffix}
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 text-sm font-semibold tabular-nums">
          {change ? (
            <span className={up ? "text-gain" : "text-loss"}>
              {signedMoney(change.abs)} ({pct(change.pct)})
            </span>
          ) : (
            <span className="text-muted">No change data for this range</span>
          )}
          <span className="font-medium text-muted">
            {hover
              ? formatStamp(hover.t, rangeMs)
              : enough && coversRange
                ? `Past ${range === "ALL" ? "all observations" : range}`
                : enough
                  ? "Since first observation in range"
                  : ""}
          </span>
        </div>
      </div>

      <div
        className="relative mt-4 h-56 select-none sm:h-64"
        onMouseLeave={() => setHover(null)}
        onTouchEnd={() => setHover(null)}
      >
        {enough ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={visible}
              margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
              onMouseMove={(s) => {
                const i = s?.activeTooltipIndex;
                setHover(typeof i === "number" ? (visible[i] ?? null) : null);
              }}
            >
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} hide />
              <YAxis domain={[min - pad, max + pad]} hide />
              <Tooltip
                content={() => null}
                cursor={{ stroke: "rgb(var(--faint))", strokeWidth: 1, strokeDasharray: "3 3" }}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={2}
                fill="url(#fill)"
                isAnimationActive
                animationDuration={450}
                activeDot={{ r: 5, fill: color, stroke: "rgb(var(--surface))", strokeWidth: 2 }}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 text-center">
            <div className="font-semibold">{emptyTitle ?? "Not enough historical data"}</div>
            <p className="mt-1 max-w-sm text-sm text-muted">
              {emptyBody ??
                (points.length > 0
                  ? `Only ${points.length} observation${points.length === 1 ? "" : "s"} collected so far. The chart appears once BrickLink has been sampled at least twice in this range.`
                  : "No BrickLink observations have been collected yet.")}
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Time range" className="flex gap-1 overflow-x-auto">
          {rangeOptions.map((r) => (
            <button
              key={r.key}
              role="tab"
              aria-selected={range === r.key}
              className="chip"
              onClick={() => setRange(r.key)}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">{footnote}</p>
    </section>
  );
}
