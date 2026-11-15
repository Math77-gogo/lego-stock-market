import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Current signed-in user, verified with Supabase Auth (getUser validates the JWT server-side). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const devUser = process.env.LOCAL_DEV_AUTH_USER_ID;
  if (devUser && process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return { id: devUser, email: "local-dev@localhost" };
  }
  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
