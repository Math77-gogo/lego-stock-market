import Link from "next/link";
import { appContext } from "@/server/app";
import { getDefaultPortfolio, loadPositions, totalsFor } from "@/server/portfolio/service";
import { HoldingRow } from "@/components/HoldingRow";
import { ConditionBadge, EmptyState, PageHeader, Section, SetImage, Stat } from "@/components/ui";
import { count, money, signedMoney, toneClass } from "@/lib/format";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const ctx = await appContext();
  const { portfolio, positions } = await ctx.db(async (db) => {
    const portfolio = await getDefaultPortfolio(db, ctx.user.id);
    return {
      portfolio,
      positions: await loadPositions(db, {
        portfolioIds: [portfolio.id],
        mode: ctx.mode,
        engine: ctx.engine,
      }),
    };
  });
  const open = positions
    .filter((p) => p.quantity > 0)
    .sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));
  const closed = positions.filter((p) => p.quantity === 0);
  const totals = totalsFor(positions);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={portfolio.name}
        subtitle="Each set is tracked separately per condition. New and used never share a price."
        action={
          <Link href="/market" className="btn-primary">
            Add a set
          </Link>
        }
      />
      {positions.length === 0 ? (
        <EmptyState
          title="No holdings yet"
          body="Search the BrickLink catalog to add your first set."
          action={
            <Link href="/market" className="btn-primary">
              Browse the market
            </Link>
          }
        />
      ) : (
        <>
          <div className="card grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
            <Stat label="Market value" value={money(totals.marketValue)} />
            <Stat label="Cost" value={money(totals.costBasis)} />
            <Stat
              label="Unrealized"
              value={signedMoney(totals.unrealizedPl)}
              valueClass={toneClass(totals.unrealizedPl)}
            />
            <Stat
              label="Positions"
              value={count(open.length)}
              sub={`${count(totals.units)} units`}
            />
          </div>
          <Section title="Open positions">
            {open.length ? (
              <ul className="card divide-y divide-line px-1 py-1 sm:px-2">
                {open.map((p) => (
                  <HoldingRow key={p.holdingId} p={p} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">All positions are sold.</p>
            )}
          </Section>
          {closed.length > 0 && (
            <Section title="Closed positions">
              <ul className="card divide-y divide-line px-3 py-1">
                {closed.map((p) => (
                  <li key={p.holdingId}>
                    <Link
                      href={`/portfolio/${p.holdingId}`}
                      className="flex items-center gap-3 py-3"
                    >
                      <SetImage src={p.set.thumbnailUrl ?? p.set.imageUrl} alt="" size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{p.set.name}</div>
                        <div className="flex items-center gap-2 text-xs text-muted">
                          {p.set.itemNumber} <ConditionBadge condition={p.condition} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-sm font-bold tabular-nums ${toneClass(p.realizedPl)}`}
                        >
                          {signedMoney(p.realizedPl)}
                        </div>
                        <div className="text-xs text-muted">realized</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
