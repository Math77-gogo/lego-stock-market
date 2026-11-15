import Link from "next/link";
import { BottomNav, Sidebar } from "@/components/Nav";
import { requireUser } from "@/server/auth/session";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const testMode = getConfig().APP_MODE === "test";
  return (
    <div className="min-h-dvh">
      {testMode && (
        <div
          role="alert"
          className="sticky top-0 z-40 bg-warn px-4 py-1.5 text-center text-xs font-bold text-white"
        >
          TEST MODE · prices on this screen are test fixtures, not BrickLink market data
        </div>
      )}
      <div className="mx-auto flex max-w-[1240px] gap-10 px-[max(16px,env(safe-area-inset-left,0px))] lg:px-8">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col py-8 lg:flex">
          <Link href="/" className="mb-8 flex items-center gap-2.5 px-3">
            <span aria-hidden className="grid h-8 w-8 place-items-center rounded-lg bg-ink text-bg">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                <path d="M4 18h3.5v-6H4zm6.25 0h3.5V8h-3.5zM16.5 18H20V5h-3.5z" />
              </svg>
            </span>
            <span className="text-[15px] font-extrabold leading-tight tracking-tight">
              LEGO
              <br />
              Stock Market
            </span>
          </Link>
          <Sidebar />
          <div className="mt-auto truncate px-3 text-xs text-muted">{user.email}</div>
        </aside>
        <main
          className="min-w-0 flex-1 pb-28 pt-6 sm:pt-8 lg:pb-16"
          style={{ paddingRight: "max(0px, env(safe-area-inset-right, 0px))" }}
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
