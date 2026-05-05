"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { localStore } from "@/lib/storage";
import type { SongVersion } from "@/lib/types";
import { useToast } from "@/components/Toast";

export function VersionHistoryPanel({
  open,
  songId,
  guestMode,
  onClose,
  onRestore,
}: {
  open: boolean;
  songId: string;
  guestMode: boolean;
  onClose: () => void;
  onRestore: (v: SongVersion) => void;
}) {
  const { toast } = useToast();
  const [versions, setVersions] = useState<SongVersion[]>([]);
  const [selected, setSelected] = useState<SongVersion | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!guestMode && isSupabaseConfigured()) {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("song_versions")
            .select("*")
            .eq("song_id", songId)
            .order("saved_at", { ascending: false });
          if (cancelled) return;
          if (error) {
            toast("Couldn't load version history", "error");
            setVersions([]);
          } else {
            setVersions((data as SongVersion[]) ?? []);
          }
        } else {
          if (cancelled) return;
          setVersions(localStore.listVersionsFor(songId));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, songId, guestMode, toast]);

  return (
    <aside
      aria-hidden={!open}
      className={`fixed bottom-0 right-0 top-0 z-30 flex w-[min(420px,90vw)] flex-col border-l border-ink-line bg-ink-surface transition-transform duration-150 print:hidden ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <header className="flex items-center justify-between border-b border-ink-line px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute">
            Version history
          </div>
          <div className="font-serif text-lg text-ink-text">snapshots</div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-ink-mute transition-colors duration-150 hover:bg-ink-line hover:text-ink-text"
          aria-label="Close history panel"
        >
          ✕
        </button>
      </header>
      <div className="scrollbar-thin flex-1 overflow-auto">
        {loading ? (
          <div className="px-4 py-3 text-sm text-ink-mute">loading…</div>
        ) : versions.length === 0 ? (
          <div className="px-4 py-3 text-sm text-ink-mute">
            No saved versions yet — they&apos;ll appear here as you write.
          </div>
        ) : (
          <ul className="divide-y divide-ink-line">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setSelected(v)}
                  className={`block w-full px-4 py-3 text-left transition-colors duration-150 hover:bg-ink-line ${
                    selected?.id === v.id ? "bg-ink-line" : ""
                  }`}
                >
                  <div className="text-sm text-ink-text">
                    {new Date(v.saved_at).toLocaleString()}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-ink-mute">
                    {firstNonEmptyLine(v.content) || "—"}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected ? (
        <div className="border-t border-ink-line">
          <pre className="scrollbar-thin serif max-h-48 overflow-auto whitespace-pre-wrap break-words border-b border-ink-line px-4 py-3 text-xs leading-relaxed text-ink-text">
            {selected.content || "—"}
          </pre>
          <div className="flex justify-end gap-2 px-4 py-3">
            <button
              onClick={() => setSelected(null)}
              className="rounded border border-ink-line px-3 py-1.5 text-xs text-ink-mute hover:text-ink-text"
            >
              dismiss
            </button>
            <button
              onClick={() => onRestore(selected)}
              className="rounded border border-amber-gold/50 bg-amber-gold/10 px-3 py-1.5 text-xs text-amber-gold hover:bg-amber-gold/20"
            >
              restore this version
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function firstNonEmptyLine(s: string): string {
  for (const line of (s ?? "").split("\n")) {
    const t = line.trim();
    if (t) return t;
  }
  return "";
}
