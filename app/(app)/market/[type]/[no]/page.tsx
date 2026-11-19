import Link from "next/link";
import { notFound } from "next/navigation";
import { appContext } from "@/server/app";
import { findSet } from "@/server/catalog/service";
import { lookupViaWorker } from "@/server/catalog/worker-client";
import { getSetPageData, type ObservationSummary } from "@/server/market/queries";
import { loadPositions } from "@/server/portfolio/service";
import { ITEM_TYPES, type ItemType } from "@/server/bricklink/types";
import { PriceChart } from "@/components/PriceChart";
import { AddPurchaseForm, LookupForm } from "@/components/forms";
import { LocalTime } from "@/components/LocalTime";
import { Delta, Notice, Section, SetImage, Stat } from "@/components/ui";
import { conditionLabel, count, money, signedMoney, toneClass } from "@/lib/format";

type Params = { type: string; no: string };

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { no } = await params;
  return { title: decodeURIComponent(no) };
}

function Stats({ o, kind }: { o: ObservationSummary | null; kind: "sold" | "stock" }) {
  if (!o) return <p className="text-sm text-muted">Insufficient BrickLink data</p>;
  const none = (o.unitQuantity ?? 0) === 0;
  const v = (x: number | null) =>
    none || x === null || x <= 0 ? "Insufficient BrickLink data" : money(x);
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      <Stat
        label={kind === "sold" ? "Qty-weighted avg" : "Qty-weighted ask"}
        value={<span className="text-base">{v(o.qtyAvgPrice)}</span>}
      />
      <Stat
        label={kind === "sold" ? "Average sold" : "Average ask"}
        value={<span className="text-base">{v(o.avgPrice)}</span>}
      />
      <Stat
        label={kind === "sold" ? "Minimum sold" : "Lowest ask"}
        value={<span className="text-base">{v(o.minPrice)}</span>}
      />
      <Stat
        label={kind === "sold" ? "Maximum sold" : "Highest ask"}
        value={<span className="text-base">{v(o.maxPrice)}</span>}
      />
      <Stat
        label={kind === "sold" ? "Sales (lots)" : "Listings (lots)"}
        value={<span className="text-base">{count(o.unitQuantity)}</span>}
      />
      <Stat
        label={kind === "sold" ? "Units sold" : "Units for sale"}
        value={<span className="text-base">{count(o.totalQuantity)}</span>}
      />
      <div className="col-span-full text-xs text-muted">
        Currency {o.currencyCode} · observed <LocalTime iso={o.observedAt} />
      </div>
    </div>
  );
}

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ condition?: string }>;
}) {
  const { type: rawType, no: rawNo } = await params;
  const condition = (await searchParams).condition === "U" ? "U" : "N";
  const type = rawType.toUpperCase() as ItemType;
  if (!ITEM_TYPES.includes(type)) notFound();
  const no = decodeURIComponent(rawNo);
  const ctx = await appContext();

  // A set imported from BrickLink's catalog download starts collecting prices the first time it is opened.
  const existing = await ctx.db((db) => findSet(db, type, no));
  if (existing && !existing.tracked) await lookupViaWorker(type, no);

  const data = await ctx.db(async (db) => {
    const set = await findSet(db, type, no);
    if (!set) return null;
    const [page, positions] = await Promise.all([
      getSetPageData(db, set.id, ctx.mode, ctx.engine),
      loadPositions(db, { mode: ctx.mode, engine: ctx.engine }),
    ]);
    return { page, mine: positions.filter((p) => p.set.id === set.id && p.quantity > 0) };
  });

  if (!data?.page) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-bold">{no} isn&apos;t tracked yet</h1>
        <p className="mt-2 text-sm text-muted">
          Look it up in the BrickLink catalog to start tracking its market.
        </p>
        <div className="card mt-6 p-5">
          <LookupForm />
        </div>
      </div>
    );
  }

  const { set, markets, lastSyncAt } = data.page;
  const m = markets[condition];
  const position = data.mine.find((p) => p.condition === condition);
  const href = (c: "N" | "U") =>
    `/market/${set.itemType}/${encodeURIComponent(set.itemNumber)}?condition=${c}`;

  return (
    <div className="max-w-3xl">
      <Link href="/market" className="text-sm font-semibold text-muted hover:text-ink">
        ← Market
      </Link>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
        <SetImage src={set.imageUrl} alt={set.name} size={112} />
        <div className="min-w-0">
          <div className="label">
            {set.theme ?? "BrickLink catalog"}
            {set.yearReleased ? ` · ${set.yearReleased}` : ""}
          </div>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight [text-wrap:balance]">
            {set.name}
          </h1>
          <div className="mt-1 text-sm text-muted">
            {set.itemType} {set.itemNumber}
          </div>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Condition"
        className="mt-6 inline-flex rounded-full bg-raised p-1"
      >
        {(["N", "U"] as const).map((c) => (
          <Link
            key={c}
            role="tab"
            aria-selected={condition === c}
            href={href(c)}
            className={`rounded-full px-5 py-1.5 text-sm font-semibold ${condition === c ? "bg-surface shadow-sm" : "text-muted"}`}
          >
            {conditionLabel(c)}
          </Link>
        ))}
      </div>

      <div className="card mt-4 p-5 sm:p-7">
        <PriceChart
          key={condition}
          label={`Current reference price · ${conditionLabel(condition)}`}
          headlineValue={m.reference.price}
          headlineSuffix="CAD"
          points={m.salesTrend}
          ranges={["1W", "1M", "3M", "6M"]}
          defaultRange="6M"
          emptyBody={
            m.salesCount === 0
              ? "BrickLink reports no sales for this condition in the last 6 months."
              : "Not enough BrickLink sales in this period to draw a chart. Try a longer range."
          }
          footnote={`Built from ${m.salesCount} individual BrickLink sales of the last 6 months (complete sets, like “Exclude Incomplete” on BrickLink). Each point is the average price of the sales in the 14 days up to that date. BrickLink's API doesn't provide sales older than 6 months.`}
        />
        <div className="mt-5 grid grid-cols-3 gap-4 border-t border-line pt-4">
          {(["1W", "1M", "3M"] as const).map((k) => (
            <div key={k}>
              <div className="label">
                {k === "1W" ? "7 days" : k === "1M" ? "30 days" : "3 months"}
              </div>
              <div className="mt-1 text-sm">
                {m.salesChanges[k] ? (
                  <Delta abs={m.salesChanges[k]!.abs} pctValue={m.salesChanges[k]!.pct} />
                ) : (
                  <span className="text-muted">Not enough sales</span>
                )}
              </div>
            </div>
          ))}
        </div>
        {m.reference.warnings.length > 0 && (
          <div className="mt-4 space-y-2">
            {m.reference.warnings.map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
          </div>
        )}
      </div>

      <Section
        title="BrickLink sales statistics (last 6 months, complete sets)"
        action={
          <span className="text-xs text-muted">
            Last sync <LocalTime iso={lastSyncAt} mode="relative" />
          </span>
        }
      >
        <div className="card p-5">
          <Stats o={m.sold} kind="sold" />
        </div>
      </Section>

      <Section title="Current BrickLink listings">
        <div className="card p-5">
          <p className="mb-4 text-xs text-muted">
            Asking prices of items for sale now. Shown for context only; never used to value your
            portfolio.
          </p>
          <Stats o={m.stock} kind="stock" />
        </div>
      </Section>

      {m.recentSales.length > 0 && (
        <Section title="Recent BrickLink sales">
          <ul className="card divide-y divide-line px-5">
            {m.recentSales.map((s, i) => (
              <li key={i} className="flex items-center justify-between py-3 text-sm">
                <span className="text-muted">
                  <LocalTime iso={s.dateOrdered} mode="date" /> · {s.quantity} unit
                  {s.quantity === 1 ? "" : "s"}
                </span>
                <span className="font-semibold tabular-nums">
                  {money(s.unitPrice)} {s.currency !== "CAD" ? s.currency : ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 px-1 text-xs text-muted">
            Individual sales from BrickLink&apos;s latest Price Guide response.
          </p>
        </Section>
      )}

      {position && (
        <Section
          title="Your position"
          action={
            <Link href={`/portfolio/${position.holdingId}`} className="chip">
              Manage →
            </Link>
          }
        >
          <div className="card grid grid-cols-2 gap-6 p-5 sm:grid-cols-3">
            <Stat label="Quantity" value={count(position.quantity)} />
            <Stat label="Avg. cost" value={money(position.averageCost)} />
            <Stat label="Total investment" value={money(position.costBasis)} />
            <Stat label="Current value" value={money(position.marketValue)} />
            <Stat
              label="Unrealized P/L"
              value={signedMoney(position.unrealizedPl)}
              valueClass={toneClass(position.unrealizedPl)}
            />
            <Stat label="Return" value={<Delta pctValue={position.unrealizedPct} />} />
          </div>
        </Section>
      )}

      <Section title="Add to portfolio">
        <div className="card p-5">
          <AddPurchaseForm
            legoSetId={set.id}
            defaultCondition={condition}
            references={{ N: markets.N.reference.price, U: markets.U.reference.price }}
          />
        </div>
      </Section>
    </div>
  );
}
