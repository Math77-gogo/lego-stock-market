"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { t, type MessageKey } from "@/lib/i18n";

const ITEMS: { href: string; key: MessageKey; icon: string }[] = [
  {
    href: "/",
    key: "nav.dashboard",
    icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  },
  { href: "/portfolio", key: "nav.portfolio", icon: "M4 7h16v12H4zM9 7V5h6v2" },
  { href: "/market", key: "nav.market", icon: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4" },
  { href: "/analytics", key: "nav.analytics", icon: "M5 20V10m7 10V4m7 16v-7" },
  {
    href: "/leaderboard",
    key: "nav.leaderboard",
    icon: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 3m10-3h3a3 3 0 0 1-3 3",
  },
  {
    href: "/settings",
    key: "nav.settings",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  },
];

function Icon({ d }: { d: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" : path.startsWith(href);

export function Sidebar() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {ITEMS.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={isActive(path, i.href) ? "page" : undefined}
          className={clsx(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink",
            isActive(path, i.href) ? "bg-raised text-ink" : "text-muted hover:text-ink",
          )}
        >
          <Icon d={i.icon} />
          {t(i.key)}
        </Link>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  const items = ITEMS.filter((i) => i.href !== "/leaderboard");
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden"
      style={{
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={isActive(path, i.href) ? "page" : undefined}
              className={clsx(
                "flex flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold",
                isActive(path, i.href) ? "text-ink" : "text-faint",
              )}
            >
              <Icon d={i.icon} />
              {t(i.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
