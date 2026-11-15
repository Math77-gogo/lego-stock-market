import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-[max(16px,env(safe-area-inset-left,0px))] py-10">
      <div className="mb-8">
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-bg">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M4 18h3.5v-6H4zm6.25 0h3.5V8h-3.5zM16.5 18H20V5h-3.5z" />
          </svg>
        </span>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">LEGO Stock Market</h1>
        <p className="mt-2 text-sm text-muted">
          Your LEGO collection, valued in CAD from BrickLink&apos;s secondary market.
        </p>
      </div>
      {configured ? (
        <LoginForm />
      ) : (
        <p className="text-sm text-loss">
          Authentication is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </p>
      )}
    </main>
  );
}
