"use client";

import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center print:hidden">
      <div
        className="absolute inset-0 bg-black/70 transition-opacity duration-150"
        onClick={onClose}
      />
      <div className="relative z-10 w-[min(640px,calc(100vw-2rem))] rounded-md border border-ink-line bg-ink-surface p-5">
        {title ? (
          <div className="mb-3 font-sans text-sm uppercase tracking-wider text-ink-mute">
            {title}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
