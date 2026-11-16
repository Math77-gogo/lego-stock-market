"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { appContext } from "@/server/app";
import {
  addPurchase,
  addPurchaseSchema,
  deleteHolding,
  deleteTransaction,
  recordTransaction,
  transactionSchema,
  updateHoldingNotes,
  updateTransaction,
  updateTransactionSchema,
  ValidationError,
} from "@/server/portfolio/service";
import { lookupViaWorker, requestSyncViaWorker } from "@/server/catalog/worker-client";
import { ITEM_TYPES } from "@/server/bricklink/types";
import { supabaseServer } from "@/lib/supabase/server";

export type ActionState = {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
} | null;

const fields = (fd: FormData) =>
  Object.fromEntries(
    Array.from(fd.entries()).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]),
  );

function zodErrors(err: z.ZodError): Record<string, string> {
  return Object.fromEntries(err.issues.map((i) => [String(i.path[0]), i.message]));
}

async function run(fn: () => Promise<string>): Promise<ActionState> {
  try {
    return { ok: true, message: await fn() };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, message: err.message };
    console.error(
      JSON.stringify({ level: "error", msg: "Action failed", error: (err as Error).message }),
    );
    return { ok: false, message: "Something went wrong while saving. Please try again." };
  }
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function addPurchaseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = addPurchaseSchema.safeParse({
    ...fields(fd),
    notes: fd.get("notes") || undefined,
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: zodErrors(parsed.error),
    };
  const ctx = await appContext();
  const state = await run(async () => {
    await ctx.db((db) => addPurchase(db, ctx.user.id, parsed.data));
    return "Purchase added to your portfolio";
  });
  if (state?.ok) refresh();
  return state;
}

export async function recordTransactionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = transactionSchema.safeParse({
    ...fields(fd),
    notes: fd.get("notes") || undefined,
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: zodErrors(parsed.error),
    };
  const ctx = await appContext();
  const state = await run(async () => {
    await ctx.db((db) => recordTransaction(db, ctx.user.id, parsed.data));
    return parsed.data.type === "SELL" ? "Sale recorded" : "Purchase recorded";
  });
  if (state?.ok) refresh();
  return state;
}

export async function updateTransactionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = updateTransactionSchema.safeParse({
    ...fields(fd),
    notes: fd.get("notes") || undefined,
  });
  if (!parsed.success)
    return {
      ok: false,
      message: "Check the highlighted fields.",
      fieldErrors: zodErrors(parsed.error),
    };
  const ctx = await appContext();
  const state = await run(async () => {
    await ctx.db((db) => updateTransaction(db, parsed.data));
    return "Transaction updated";
  });
  if (state?.ok) refresh();
  return state;
}

export async function deleteTransactionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = z.string().uuid().safeParse(fd.get("transactionId"));
  if (!id.success) return { ok: false, message: "Unknown transaction" };
  const ctx = await appContext();
  const state = await run(async () => {
    await ctx.db((db) => deleteTransaction(db, id.data));
    return "Transaction deleted";
  });
  if (state?.ok) refresh();
  return state;
}

export async function deleteHoldingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = z.string().uuid().safeParse(fd.get("holdingId"));
  if (!id.success) return { ok: false, message: "Unknown holding" };
  const ctx = await appContext();
  const state = await run(async () => {
    await ctx.db((db) => deleteHolding(db, id.data));
    return "Holding removed";
  });
  if (state?.ok) {
    refresh();
    redirect("/portfolio");
  }
  return state;
}

export async function updateNotesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = z.string().uuid().safeParse(fd.get("holdingId"));
  if (!id.success) return { ok: false, message: "Unknown holding" };
  const notes = String(fd.get("notes") ?? "").trim() || null;
  const ctx = await appContext();
  const state = await run(async () => {
    await ctx.db((db) => updateHoldingNotes(db, id.data, notes));
    return "Notes saved";
  });
  if (state?.ok) refresh();
  return state;
}

const lookupSchema = z.object({
  type: z.enum(ITEM_TYPES).default("SET"),
  no: z.string().trim().min(1, "Enter a BrickLink item number").max(64),
});

/** Finds an item in BrickLink's catalog by its exact number (via the worker) and opens its page. */
export async function lookupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await appContext();
  const parsed = lookupSchema.safeParse(fields(fd));
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid number" };
  const result = await lookupViaWorker(parsed.data.type, parsed.data.no);
  if (!result.ok) {
    const messages = {
      not_found: `BrickLink has no ${parsed.data.type.toLowerCase()} numbered "${parsed.data.no}". Set numbers look like 75192-1.`,
      worker_unavailable:
        "The sync worker is not reachable right now, so BrickLink can't be queried. Try again in a minute.",
      bricklink_error: `BrickLink did not answer this lookup (${result.detail ?? "unknown error"}). Check the sync status in Settings.`,
      secret_mismatch:
        "The app and the sync worker don't share the same WORKER_API_SECRET. Copy it again from the server into Vercel.",
      not_configured:
        "The sync worker isn't configured yet (WORKER_INTERNAL_URL / WORKER_API_SECRET).",
    };
    return { ok: false, message: messages[result.reason] };
  }
  revalidatePath("/market");
  redirect(`/market/${result.set.itemType}/${encodeURIComponent(result.set.itemNumber)}`);
}

export async function requestSyncAction(): Promise<ActionState> {
  await appContext();
  const ok = await requestSyncViaWorker();
  return ok
    ? { ok: true, message: "Sync requested. Due sets will update within the API budget." }
    : { ok: false, message: "The sync worker is not reachable." };
}

export async function signOutAction() {
  const supabase = await supabaseServer();
  await supabase?.auth.signOut();
  redirect("/login");
}
