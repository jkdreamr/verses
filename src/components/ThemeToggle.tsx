"use client";

import { useEffect, useState } from "react";

const KEY = "verses:theme";
type Theme = "dark" | "light";

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const v = window.localStorage.getItem(KEY);
  return v === "light" ? "light" : "dark";
}

function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", t === "light");
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const t = readTheme();
    setTheme(t);
    applyTheme(t);
  }, []);
  const toggle = () => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(KEY, next);
      applyTheme(next);
      return next;
    });
  };
  return { theme, toggle };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
      className={`rounded border border-ink-line px-2 py-1 text-xs text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold ${className}`}
    >
      {theme === "dark" ? "☾" : "☼"}
    </button>
  );
}
