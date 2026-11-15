import Link from "next/link";
import { appContext } from "@/server/app";
import {
  getDefaultPortfolio,
  loadPositions,
  portfolioSnapshots,
  totalsFor,
  type PositionView,
} from "@/server/portfolio/service";
import { HistoryChart } from "@/components/HistoryChart";
import { EmptyState, Notice, PageHeader, Section, Stat } from "@/components/ui";
import { conditionLabel, money, pct, signedMoney, toneClass } from "@/lib/format";

export const metadata = { title: "Analytics" };

const SHADES = [
  "rgb(var(--ink))",
  "rgb(var(--ink) / 0.72)",
  "rgb(var(--ink) / 0.5)",
  "rgb(var(--ink) / 0.32)",
  "rgb(var(--ink) / 0.18)",
  "rgb(var(--ink) / 0.1)",
];

function Allocation({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: number }[];
}) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  return (
    <div className="card min-w-0 p-5">
      <div className="label">{title}</div>
      {total <= 0 ? (
        <p className="mt-3 text-sm text-muted">Insufficient BrickLink data</p>
      ) : (
        <>
          <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-raised" aria-hidden>
            {sorted.map((i, idx) => (
              <div
                key={i.label}
                style={{
                  width: `${(i.value / total) * 100}%`,
                  background: SHADES[Math.min(idx, SHADES.length - 1)],
                }}
              />
            ))}
          </div>
          <ul className="mt-4 space-y-2.5">
            {sorted.slice(0, 8).map((i, idx) => (
              <li key={i.label} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: SHADES[Math.min(idx, SHADES.length - 1)] }}
                />
                <span className="min-w-0 flex-1 truncate">{i.label}</span>
                <span className="tabular-nums text-muted">{money(i.value)}</span>
                <span className="w-14 text-right font-semibold tabular-nums">
                  {((i.value / total) * 100).toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function group(positions: PositionView[], key: (p: PositionView) => string) {
  const m = new Map<string, number>();
  for (const p of positions)
    if (p.marketValue !== null) m.set(key(p), (m.get(key(p)) ?? 0) + p.marketValue);
  return [...m].map(([label, value]) => ({ label, value }));
}

export default async function AnalyticsPage() {
  const ctx = await appContext();
  const { positions, snapshots } = await ctx.db(async (db) => {
    const portfolio = await getDefaultPortfolio(db, ctx.user.id);
    return {
      positions: await loadPositions(db, {
        portfolioIds: [portfolio.id],
        mode: ctx.mode,
        engine: ctx.engine,
      }),
      snapshots: await portfolioSnapshots(db, portfolio.id),
    };
  });
  if (positions.length === 0) {
    return (
      <div className="max-w-4xl">
        <PageHeader title="Analytics" />
        <EmptyState
          title="Nothing to analyze yet"
          body="Add sets to your portfolio to see allocation and performance."
          action={
            <Link href="/market" className="btn-primary">
              Browse the market
            </Link>
          }
        />
      </div>
    );
  }
  const open = positions.filter((p) => p.quantity > 0);
  const totals = totalsFor(positions);
  const ranked = open
    .filter((p) => p.unrealizedPct !== null)
    .sort((a, b) => b.unrealizedPct! - a.unrealizedPct!);
  const bySetValue = [...open]
    .filter((p) => p.marketValue !== null)
    .sort((a, b) => b.marketValue! - a.marketValue!);
  const buckets = [
    { label: "Under $100", test: (v: number) => v < 100 },
    { label: "$100 – $500", test: (v: number) => v >= 100 && v < 500 },
    { label: "$500 – $1,000", test: (v: number) => v >= 500 && v < 1000 },
    { label: "$1,000 and up", test: (v: number) => v >= 1000 },
  ]
    .map((b) => ({
      label: b.label,
      value: open
        .filter((p) => p.reference.price !== null && b.test(p.reference.price))
        .reduce((s, p) => s + (p.marketValue ?? 0), 0),
    }))
    .filter((b) => b.value > 0);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Analytics"
        subtitle="Derived from your transactions and the BrickLink observations stored by the sync worker."
      />
      {!totals.complete && (
        <div className="mb-4">
          <Notice>
            Positions without BrickLink pricing are excluded from allocation and return figures.
          </Notice>
        </div>
      )}

      <div className="card grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
        <Stat
          label="Total return"
          value={signedMoney(totals.totalReturn)}
          valueClass={toneClass(totals.totalReturn)}
          sub={pct(totals.totalReturnPct)}
        />
        <Stat
          label="Unrealized"
          value={signedMoney(totals.unrealizedPl)}
          valueClass={toneClass(totals.unrealizedPl)}
        />
        <Stat
          label="Realized"
          value={signedMoney(totals.realizedPl)}
          valueClass={toneClass(totals.realizedPl)}
        />
        <Stat label="Market value" value={money(totals.marketValue)} />
      </div>

      <Section title="Value, cost and unrealized P/L over time">
        <div className="card p-5">
          <HistoryChart points={snapshots} />
          <p className="mt-3 text-xs text-muted">
            Valuations recorded by the sync worker after each BrickLink update.
          </p>
        </div>
      </Section>

      <Section title="Allocation">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Allocation title="By theme" items={group(open, (p) => p.set.theme ?? "Unknown theme")} />
          <Allocation
            title="By condition"
            items={group(open, (p) => conditionLabel(p.condition))}
          />
          <Allocation
            title="By set"
            items={group(open, (p) => `${p.set.name} (${p.condition === "N" ? "New" : "Used"})`)}
          />
          <Allocation title="By unit market value" items={buckets} />
        </div>
      </Section>

      <Section title="Performance by position">
        {ranked.length === 0 ? (
          <p className="text-sm text-muted">Insufficient BrickLink data</p>
        ) : (
          <ul className="card divide-y divide-line px-5">
            {ranked.map((p, i) => (
              <li key={p.holdingId} className="flex items-center gap-3 py-3 text-sm">
                <span className="w-5 text-xs font-semibold text-muted">{i + 1}</span>
                <Link
                  href={`/portfolio/${p.holdingId}`}
                  className="min-w-0 flex-1 truncate font-semibold"
                >
                  {p.set.name}{" "}
                  <span className="font-medium text-muted">
                    · {p.condition === "N" ? "New" : "Used"}
                  </span>
                </Link>
                <span className={`w-24 text-right tabular-nums ${toneClass(p.unrealizedPl)}`}>
                  {signedMoney(p.unrealizedPl)}
                </span>
                <span
                  className={`w-20 text-right font-bold tabular-nums ${toneClass(p.unrealizedPct)}`}
                >
                  {pct(p.unrealizedPct)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {bySetValue[0] && (
          <p className="mt-3 px-1 text-xs text-muted">
            Largest position: {bySetValue[0].set.name} at {money(bySetValue[0].marketValue)}.
          </p>
        )}
      </Section>
    </div>
  );
}
