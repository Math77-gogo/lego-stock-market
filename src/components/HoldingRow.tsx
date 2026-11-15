import Link from "next/link";
import { ConditionBadge, SetImage } from "./ui";
import { money, pct, toneClass } from "@/lib/format";
import type { PositionView } from "@/server/portfolio/service";

export function HoldingRow({ p }: { p: PositionView }) {
  const status =
    p.reference.price === null
      ? "Insufficient BrickLink data"
      : p.reference.isStale
        ? "Stale price"
        : null;
  return (
    <li>
      <Link
        href={`/portfolio/${p.holdingId}`}
        className="flex items-center gap-3 rounded-2xl px-2 py-3 transition hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink sm:gap-4 sm:px-3"
      >
        <SetImage src={p.set.thumbnailUrl ?? p.set.imageUrl} alt="" size={52} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.set.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap text-xs text-muted">
            <span>{p.set.itemNumber}</span>
            <ConditionBadge condition={p.condition} />
            <span>× {p.quantity}</span>
          </div>
        </div>
        <div className="hidden w-28 text-right sm:block">
          <div className="text-sm font-semibold tabular-nums">{money(p.reference.price)}</div>
          <div className={`text-xs font-semibold tabular-nums ${toneClass(p.dayChangePct)}`}>
            {p.dayChangePct === null ? "—" : `${pct(p.dayChangePct)} today`}
          </div>
        </div>
        <div className="w-24 shrink-0 text-right sm:w-32">
          <div className="text-[15px] font-bold tabular-nums">
            {p.marketValue === null ? "—" : money(p.marketValue)}
          </div>
          {status ? (
            <div className="text-[11px] font-semibold text-warn">{status}</div>
          ) : (
            <div className={`text-xs font-semibold tabular-nums ${toneClass(p.unrealizedPct)}`}>
              {pct(p.unrealizedPct)}
            </div>
          )}
        </div>
      </Link>
    </li>
  );
}
