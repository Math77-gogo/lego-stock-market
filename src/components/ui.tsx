import clsx from "clsx";
import type { ReactNode } from "react";
import { conditionShort, pct, signedMoney, toneClass } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold tracking-tight [text-wrap:balance]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Delta({
  abs,
  pctValue,
  className,
}: {
  abs?: number | null;
  pctValue: number | null | undefined;
  className?: string;
}) {
  if (pctValue === null || pctValue === undefined)
    return <span className={clsx("text-muted", className)}>—</span>;
  return (
    <span className={clsx("font-semibold tabular-nums", toneClass(pctValue), className)}>
      {abs !== undefined && abs !== null ? `${signedMoney(abs)} (${pct(pctValue)})` : pct(pctValue)}
    </span>
  );
}

export function ConditionBadge({ condition }: { condition: "N" | "U" }) {
  return (
    <span
      className={clsx(
        "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        condition === "N" ? "bg-ink text-bg" : "bg-raised text-muted",
      )}
    >
      {conditionShort(condition)}
    </span>
  );
}

/** BrickLink catalog image, hot-linked from BrickLink's own image host (not re-hosted). */
export function SetImage({
  src,
  alt,
  size = 48,
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-contain p-1"
        />
      ) : (
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-1/2 w-1/2 text-neutral-300"
          fill="currentColor"
        >
          <rect x="3" y="9" width="18" height="10" rx="1.5" />
          <rect x="6" y="6" width="4" height="3" rx="0.8" />
          <rect x="14" y="6" width="4" height="3" rx="0.8" />
        </svg>
      )}
    </div>
  );
}

export function Notice({
  tone = "warn",
  children,
}: {
  tone?: "warn" | "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "flex gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-medium",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "error" && "bg-loss/10 text-loss",
        tone === "info" && "bg-raised text-muted",
      )}
    >
      <span aria-hidden>{tone === "info" ? "ⓘ" : "!"}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className={clsx("mt-1 truncate text-lg font-bold tabular-nums", valueClass)}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-raised">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-6 w-6 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <rect x="3" y="9" width="18" height="10" rx="1.5" />
          <rect x="6" y="5.5" width="4" height="3.5" rx="0.8" />
          <rect x="14" y="5.5" width="4" height="3.5" rx="0.8" />
        </svg>
      </div>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("mt-10", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
