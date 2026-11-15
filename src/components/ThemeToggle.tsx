"use client";

import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";

export function applyTheme(theme: Theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      setTheme((localStorage.getItem("lsm-theme") as Theme) || "system");
    } catch {}
  }, []);
  const choose = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem("lsm-theme", t);
    } catch {}
  };
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className="inline-flex rounded-full bg-raised p-1"
    >
      {(["system", "light", "dark"] as const).map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          onClick={() => choose(t)}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize ${theme === t ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/** Inline script that applies the saved theme before first paint (no flash). */
export const themeScript = `try{var t=localStorage.getItem('lsm-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
