"use client";

import { useEffect } from "react";

type ShortcutSpec = {
  key: string; // single char, "/" etc. (lowercase)
  meta?: boolean; // Cmd or Ctrl
  shift?: boolean;
  alt?: boolean;
};

export function useShortcut(spec: ShortcutSpec, handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (Boolean(spec.meta) !== isMeta) return;
      if (Boolean(spec.shift) !== e.shiftKey) return;
      if (Boolean(spec.alt) !== e.altKey) return;
      if (e.key.toLowerCase() !== spec.key.toLowerCase()) return;
      handler(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spec.key, spec.meta, spec.shift, spec.alt, handler]);
}
