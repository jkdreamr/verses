"use client";

import { useEffect, useId, useRef } from "react";

export function Modal({
  open,
  onClose,
  children,
  title,
  width,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  /** Optional max-width override (default 640px). Use e.g. "900px". */
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog for keyboard + screen-reader users; restore on close.
    const prevFocus = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:hidden">
      <div
        className="animate-backdrop-in absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="animate-modal-in surface-card relative z-10 max-h-[calc(100vh-2rem)] overflow-y-auto p-5 shadow-elevate-lg outline-none scrollbar-thin"
        style={{ width: `min(${width ?? "640px"}, calc(100vw - 2rem))` }}
      >
        {title ? (
          <div id={titleId} className="mb-3 font-sans text-sm uppercase tracking-wider text-ink-mute">
            {title}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
