"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, moneyCompact } from "@/lib/format";
import { RANGES, type RangeKey } from "./PriceChart";

interface Point {
  t: number;
  marketValue: number;
  costBasis: number;
  unrealizedPl: number;
}

export function HistoryChart({ points }: { points: Point[] }) {
  const [range, setRange] = useState<RangeKey>("ALL");
  const ms = RANGES.find((r) => r.key === range)!.ms;
  const end = points[points.length - 1]?.t ?? 0;
  const data = points.filter((p) => ms === Infinity || p.t >= end - ms);
  if (data.length < 2) {
    return (
      <div className="grid h-64 place-items-center rounded-2xl border border-dashed border-line text-sm text-muted">
        Not enough historical data
      </div>
    );
  }
  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgb(var(--line))" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t) =>
                new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })
              }
              tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              tickFormatter={(v) => moneyCompact(v)}
              tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={{
                background: "rgb(var(--surface))",
                border: "1px solid rgb(var(--line))",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={(t) => new Date(t as number).toLocaleString()}
              formatter={(v, name) => [
                money(v as number),
                name === "marketValue"
                  ? "Market value"
                  : name === "costBasis"
                    ? "Cost basis"
                    : "Unrealized P/L",
              ]}
            />
            <Area
              dataKey="marketValue"
              type="monotone"
              stroke="rgb(var(--ink))"
              strokeWidth={2}
              fill="rgb(var(--ink) / 0.06)"
              isAnimationActive={false}
            />
            <Line
              dataKey="costBasis"
              type="stepAfter"
              stroke="rgb(var(--muted))"
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="unrealizedPl"
              type="monotone"
              stroke="rgb(var(--gain))"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Time range" className="flex gap-1 overflow-x-auto">
          {RANGES.map((r) => (
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
        <div className="flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-4 bg-ink" />
            Market value
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-4 border-t border-dashed border-muted" />
            Cost basis
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0.5 w-4 bg-gain" />
            Unrealized P/L
          </span>
        </div>
      </div>
    </div>
  );
}
