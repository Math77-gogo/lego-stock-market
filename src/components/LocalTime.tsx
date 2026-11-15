"use client";

import { useEffect, useState } from "react";
import { relativeAge } from "@/lib/format";

/** Renders a UTC timestamp in the viewer's own timezone (after hydration). */
export function LocalTime({
  iso,
  mode = "datetime",
}: {
  iso: string | null;
  mode?: "datetime" | "date" | "relative";
}) {
  const [text, setText] = useState<string>(() =>
    iso ? (mode === "relative" ? relativeAge(iso) : iso.slice(0, 10)) : "never",
  );
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    const update = () =>
      setText(
        mode === "relative"
          ? relativeAge(iso)
          : mode === "date"
            ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
            : d.toLocaleString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }),
      );
    update();
    if (mode !== "relative") return;
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [iso, mode]);
  return (
    <time dateTime={iso ?? undefined} title={iso ?? undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}
