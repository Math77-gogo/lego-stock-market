"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import clsx from "clsx";
import {
  addPurchaseAction,
  deleteHoldingAction,
  deleteTransactionAction,
  lookupAction,
  recordTransactionAction,
  requestSyncAction,
  updateNotesAction,
  updateTransactionAction,
  type ActionState,
} from "@/app/actions";
import { money } from "@/lib/format";

const today = () => new Date().toLocaleDateString("en-CA");

function Submit({
  children,
  className = "btn-primary",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}

function Message({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={clsx("text-sm font-medium", state.ok ? "text-gain" : "text-loss")}
    >
      {state.message}
    </p>
  );
}

function Field({
  label,
  id,
  error,
  children,
  hint,
}: {
  label: string;
  id: string;
  error?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      {error && <span className="text-xs font-medium text-loss">{error}</span>}
    </div>
  );
}

/** Adds a purchase lot for a set in one condition (creates the position if needed). */
export function AddPurchaseForm({
  legoSetId,
  defaultCondition = "N",
  references,
}: {
  legoSetId: string;
  defaultCondition?: "N" | "U";
  references: Record<"N" | "U", number | null>;
}) {
  const [state, action] = useActionState(addPurchaseAction, null);
  const [condition, setCondition] = useState<"N" | "U">(defaultCondition);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  const e = state?.fieldErrors ?? {};
  return (
    <form ref={form} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="legoSetId" value={legoSetId} />
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-semibold">Condition</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["N", "U"] as const).map((c) => (
            <label
              key={c}
              className={clsx(
                "cursor-pointer rounded-xl border px-3 py-2.5 text-sm",
                condition === c ? "border-ink bg-raised font-semibold" : "border-line",
              )}
            >
              <input
                type="radio"
                name="condition"
                value={c}
                checked={condition === c}
                onChange={() => setCondition(c)}
                className="sr-only"
              />
              {c === "N" ? "New / Sealed" : "Used"}
              <span className="block text-xs font-medium text-muted">
                {references[c] !== null
                  ? `BrickLink ${money(references[c])}`
                  : "Insufficient BrickLink data"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantity" id="add-quantity" error={e.quantity}>
          <input
            id="add-quantity"
            name="quantity"
            type="number"
            min={1}
            step={1}
            defaultValue={1}
            required
            className="input"
            inputMode="numeric"
          />
        </Field>
        <Field label="Price per unit (CAD)" id="add-price" error={e.unitPrice}>
          <input
            id="add-price"
            name="unitPrice"
            type="number"
            min={0}
            step="0.01"
            required
            className="input"
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
        <Field label="Acquisition date" id="add-date" error={e.date}>
          <input
            id="add-date"
            name="date"
            type="date"
            max={today()}
            defaultValue={today()}
            required
            className="input"
          />
        </Field>
        <Field label="Fees (CAD)" id="add-fees" error={e.fees} hint="Shipping, tax">
          <input
            id="add-fees"
            name="fees"
            type="number"
            min={0}
            step="0.01"
            defaultValue="0"
            className="input"
            inputMode="decimal"
          />
        </Field>
      </div>
      <Field label="Notes (optional)" id="add-notes" error={e.notes}>
        <textarea id="add-notes" name="notes" rows={2} maxLength={2000} className="input" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Submit>Add to portfolio</Submit>
        <Message state={state} />
      </div>
    </form>
  );
}

/** Records an additional purchase or a sale for an existing position. */
export function TransactionForm({ holdingId, maxSell }: { holdingId: string; maxSell: number }) {
  const [state, action] = useActionState(recordTransactionAction, null);
  const [type, setType] = useState<"BUY" | "SELL">("BUY");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  const e = state?.fieldErrors ?? {};
  return (
    <form ref={form} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="holdingId" value={holdingId} />
      <input type="hidden" name="type" value={type} />
      <div
        role="tablist"
        aria-label="Transaction type"
        className="inline-flex w-fit rounded-full bg-raised p-1"
      >
        {(["BUY", "SELL"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            onClick={() => setType(t)}
            className={clsx(
              "rounded-full px-5 py-1.5 text-sm font-semibold",
              type === t ? "bg-surface shadow-sm" : "text-muted",
            )}
            disabled={t === "SELL" && maxSell === 0}
          >
            {t === "BUY" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Quantity"
          id="tx-quantity"
          error={e.quantity}
          hint={type === "SELL" ? `You hold ${maxSell}` : undefined}
        >
          <input
            id="tx-quantity"
            name="quantity"
            type="number"
            min={1}
            max={type === "SELL" ? maxSell : undefined}
            step={1}
            defaultValue={1}
            required
            className="input"
            inputMode="numeric"
          />
        </Field>
        <Field
          label={type === "SELL" ? "Sale price per unit" : "Price per unit"}
          id="tx-price"
          error={e.unitPrice}
        >
          <input
            id="tx-price"
            name="unitPrice"
            type="number"
            min={0}
            step="0.01"
            required
            className="input"
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
        <Field label="Date" id="tx-date" error={e.date}>
          <input
            id="tx-date"
            name="date"
            type="date"
            max={today()}
            defaultValue={today()}
            required
            className="input"
          />
        </Field>
        <Field label="Fees (CAD)" id="tx-fees" error={e.fees}>
          <input
            id="tx-fees"
            name="fees"
            type="number"
            min={0}
            step="0.01"
            defaultValue="0"
            className="input"
            inputMode="decimal"
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Submit>{type === "SELL" ? "Record sale" : "Record purchase"}</Submit>
        <Message state={state} />
      </div>
    </form>
  );
}

export function TransactionRow({
  tx,
}: {
  tx: {
    id: string;
    type: "BUY" | "SELL";
    quantity: number;
    unitPrice: number;
    fees: number;
    date: string;
    notes: string | null;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [updState, update] = useActionState(updateTransactionAction, null);
  const [delState, del] = useActionState(deleteTransactionAction, null);
  useEffect(() => {
    if (updState?.ok) setEditing(false);
  }, [updState]);

  if (editing) {
    return (
      <li className="py-3">
        <form action={update} className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:items-end">
          <input type="hidden" name="transactionId" value={tx.id} />
          <Field label="Qty" id={`q-${tx.id}`}>
            <input
              id={`q-${tx.id}`}
              name="quantity"
              type="number"
              min={1}
              defaultValue={tx.quantity}
              className="input"
              required
            />
          </Field>
          <Field label="Unit price" id={`p-${tx.id}`}>
            <input
              id={`p-${tx.id}`}
              name="unitPrice"
              type="number"
              step="0.01"
              min={0}
              defaultValue={tx.unitPrice}
              className="input"
              required
            />
          </Field>
          <Field label="Fees" id={`f-${tx.id}`}>
            <input
              id={`f-${tx.id}`}
              name="fees"
              type="number"
              step="0.01"
              min={0}
              defaultValue={tx.fees}
              className="input"
            />
          </Field>
          <Field label="Date" id={`d-${tx.id}`}>
            <input
              id={`d-${tx.id}`}
              name="date"
              type="date"
              max={today()}
              defaultValue={tx.date}
              className="input"
              required
            />
          </Field>
          <div className="col-span-2 flex gap-2 sm:col-span-1">
            <Submit className="btn-primary px-4">Save</Submit>
            <button type="button" className="btn-secondary px-4" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
          <div className="col-span-full">
            <Message state={updState} />
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">
          <span className={tx.type === "BUY" ? "text-ink" : "text-loss"}>
            {tx.type === "BUY" ? "Bought" : "Sold"}
          </span>{" "}
          {tx.quantity} × {money(tx.unitPrice)}
          {tx.fees > 0 && <span className="font-medium text-muted"> + {money(tx.fees)} fees</span>}
        </div>
        <div className="text-xs text-muted">{tx.date}</div>
      </div>
      <div className="flex items-center gap-1">
        {confirming ? (
          <form action={del} className="flex items-center gap-2">
            <input type="hidden" name="transactionId" value={tx.id} />
            <span className="text-xs font-medium text-muted">Delete this transaction?</span>
            <Submit className="btn-danger px-3 py-1.5 text-xs">Delete</Submit>
            <button type="button" className="chip" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </form>
        ) : (
          <>
            <button className="chip" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="chip hover:text-loss" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </>
        )}
      </div>
      {delState && !delState.ok && (
        <div className="w-full">
          <Message state={delState} />
        </div>
      )}
    </li>
  );
}

export function DeleteHoldingButton({ holdingId }: { holdingId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(deleteHoldingAction, null);
  if (!confirming) {
    return (
      <button className="btn-danger" onClick={() => setConfirming(true)}>
        Remove from portfolio
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-3 rounded-2xl bg-loss/5 p-4">
      <input type="hidden" name="holdingId" value={holdingId} />
      <p className="text-sm">
        This deletes the position and its transactions. BrickLink price history for the set is kept.
      </p>
      <Submit className="btn-danger">Remove position</Submit>
      <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <Message state={state} />
    </form>
  );
}

export function NotesForm({ holdingId, notes }: { holdingId: string; notes: string | null }) {
  const [state, action] = useActionState(updateNotesAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="holdingId" value={holdingId} />
      <label htmlFor="holding-notes" className="sr-only">
        Notes
      </label>
      <textarea
        id="holding-notes"
        name="notes"
        rows={3}
        maxLength={2000}
        defaultValue={notes ?? ""}
        className="input"
        placeholder="Box condition, where you bought it…"
      />
      <div className="flex items-center gap-3">
        <Submit className="btn-secondary">Save notes</Submit>
        <Message state={state} />
      </div>
    </form>
  );
}

export function LookupForm({ compact = false }: { compact?: boolean }) {
  const [state, action] = useActionState(lookupAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className={clsx("flex gap-2", compact ? "" : "flex-col sm:flex-row")}>
        <label htmlFor="lookup-type" className="sr-only">
          Item type
        </label>
        <select id="lookup-type" name="type" defaultValue="SET" className="input sm:w-36">
          <option value="SET">Set</option>
          <option value="MINIFIG">Minifigure</option>
          <option value="GEAR">Gear</option>
          <option value="BOOK">Book</option>
        </select>
        <label htmlFor="lookup-no" className="sr-only">
          BrickLink item number
        </label>
        <input
          id="lookup-no"
          name="no"
          placeholder="BrickLink number, e.g. 75192-1"
          className="input"
          autoComplete="off"
          required
        />
        <Submit className="btn-primary shrink-0">Find on BrickLink</Submit>
      </div>
      <Message state={state} />
    </form>
  );
}

export function SyncNowButton() {
  const [state, action] = useActionState(requestSyncAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Submit className="btn-secondary">Run due updates now</Submit>
      <Message state={state} />
    </form>
  );
}
