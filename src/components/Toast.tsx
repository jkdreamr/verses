"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type Toast = { id: number; message: string; tone: "info" | "error" | "ok" };

type ToastContextValue = {
  toast: (message: string, tone?: Toast["tone"]) => void;
};

const Ctx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), message, tone }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = window.setTimeout(() => {
      setToasts((prev) => prev.slice(1));
    }, 2600);
    return () => window.clearTimeout(t);
  }, [toasts]);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2 print:hidden"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`animate-modal-in pointer-events-auto rounded-lg border px-3.5 py-2 text-sm shadow-elevate ${
              t.tone === "error"
                ? "border-danger/40 bg-danger/10 text-danger"
                : t.tone === "ok"
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-line bg-surface text-ink-text"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
