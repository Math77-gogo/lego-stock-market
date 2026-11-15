import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { appContext } from "@/server/app";
import { loadPositions } from "@/server/portfolio/service";
import { ConditionBadge, Delta, Notice, Section, SetImage, Stat } from "@/components/ui";
import {
  DeleteHoldingButton,
  NotesForm,
  TransactionForm,
  TransactionRow,
} from "@/components/forms";
import { LocalTime } from "@/components/LocalTime";
import { conditionLabel, count, money, signedMoney, toneClass } from "@/lib/format";

export default async function HoldingPage({ params }: { params: Promise<{ holdingId: string }> }) {
  const { holdingId } = await params;
  if (!z.string().uuid().safeParse(holdingId).success) notFound();
  const ctx = await appContext();
  // RLS: another user's holding simply does not exist for this query.
  const positions = await ctx.db((db) => loadPositions(db, { mode: ctx.mode, engine: ctx.engine }));
  const p = positions.find((x) => x.holdingId === holdingId);
  if (!p) notFound();
  const assetHref = `/market/${p.set.itemType}/${encodeURIComponent(p.set.itemNumber)}?condition=${p.condition}`;

  return (
    <div className="max-w-3xl">
      <Link href="/portfolio" className="text-sm font-semibold text-muted hover:text-ink">
        ← Portfolio
      </Link>
      <div className="mt-4 flex items-center gap-4">
        <SetImage src={p.set.imageUrl} alt={p.set.name} size={72} />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight [text-wrap:balance]">{p.set.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            {p.set.itemNumber} <ConditionBadge condition={p.condition} /> {p.set.theme}
          </div>
        </div>
      </div>

      <div className="card mt-6 p-5 sm:p-6">
        <div className="label">Position value · {conditionLabel(p.condition)}</div>
        <div className="mt-1 text-hero tabular-nums">{money(p.marketValue)}</div>
        <div className="mt-2 text-sm">
          <Delta abs={p.unrealizedPl} pctValue={p.unrealizedPct} />{" "}
          <span className="text-muted">unrealized</span>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Quantity" value={count(p.quantity)} />
          <Stat label="Avg. cost" value={money(p.averageCost)} />
          <Stat label="Total cost" value={money(p.costBasis)} />
          <Stat
            label="Realized P/L"
            value={signedMoney(p.realizedPl)}
            valueClass={toneClass(p.realizedPl)}
          />
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
          <div>
            <span className="text-muted">BrickLink reference </span>
            <span className="font-semibold tabular-nums">{money(p.reference.price)}</span>
            {p.reference.observedAt && (
              <span className="text-muted">
                {" "}
                · observed <LocalTime iso={p.reference.observedAt.toISOString()} mode="relative" />
              </span>
            )}
          </div>
          <Link href={assetHref} className="chip">
            Market details →
          </Link>
        </div>
        {p.warnings.length > 0 && (
          <div className="mt-4 space-y-2">
            {p.warnings.map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
          </div>
        )}
        {p.lotErrors.length > 0 && (
          <div className="mt-2">
            <Notice tone="error">
              Your transaction history sells more units than were bought. Edit the transactions
              below.
            </Notice>
          </div>
        )}
      </div>

      <Section title="Record a transaction">
        <div className="card p-5">
          <TransactionForm holdingId={p.holdingId} maxSell={p.quantity} />
        </div>
      </Section>

      <Section title="Open acquisition lots">
        {p.openLots.length ? (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-left">
                  <th className="label px-5 py-3 font-semibold">Acquired</th>
                  <th className="label px-3 py-3 text-right font-semibold">Remaining</th>
                  <th className="label px-3 py-3 text-right font-semibold">Unit cost</th>
                  <th className="label px-5 py-3 text-right font-semibold">Value now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.openLots.map((l) => (
                  <tr key={l.transactionId}>
                    <td className="px-5 py-3">{l.date}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {l.remaining} / {l.originalQuantity}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {money(l.unitCostCents / 100)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums">
                      {p.reference.price !== null ? money(p.reference.price * l.remaining) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 pb-4 text-xs text-muted">
              Sales consume the oldest lots first (FIFO). Unit cost includes fees.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">No open lots.</p>
        )}
      </Section>

      <Section title="Transaction history">
        <ul className="card divide-y divide-line px-5">
          {p.transactions.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </ul>
      </Section>

      <Section title="Notes">
        <div className="card p-5">
          <NotesForm holdingId={p.holdingId} notes={p.notes} />
        </div>
      </Section>

      <div className="mt-10">
        <DeleteHoldingButton holdingId={p.holdingId} />
      </div>
    </div>
  );
}
