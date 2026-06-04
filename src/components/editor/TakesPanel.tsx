"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { takesStore, formatBytes, formatDuration } from "@/lib/takes";
import type { Take } from "@/lib/types";

export function TakesPanel({
  open,
  songId,
  reloadKey,
  onClose,
  onOpenPerform,
}: {
  open: boolean;
  songId: string;
  reloadKey: number;
  onClose: () => void;
  onOpenPerform: () => void;
}) {
  const { toast } = useToast();
  const [takes, setTakes] = useState<Take[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  const refresh = useCallback(async () => {
    if (!songId) return;
    setLoading(true);
    try {
      const list = await takesStore.listForSong(songId);
      setTakes(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Couldn't load takes — ${message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [songId, toast]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, reloadKey, refresh]);

  const blobUrlFor = useCallback((take: Take) => {
    const cached = blobUrlsRef.current.get(take.id);
    if (cached) return cached;
    const url = URL.createObjectURL(take.blob);
    blobUrlsRef.current.set(take.id, url);
    return url;
  }, []);

  useEffect(() => {
    const cache = blobUrlsRef.current;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);

  // Revoke any blob URLs for takes that no longer exist
  useEffect(() => {
    const ids = new Set(takes.map((t) => t.id));
    blobUrlsRef.current.forEach((url, id) => {
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        blobUrlsRef.current.delete(id);
      }
    });
  }, [takes]);

  const totalSize = useMemo(
    () => takes.reduce((sum, t) => sum + (t.size || 0), 0),
    [takes]
  );

  const startRename = (t: Take) => {
    setRenamingId(t.id);
    setRenameDraft(t.label);
  };

  const commitRename = async (t: Take) => {
    const trimmed = renameDraft.trim() || t.label;
    setRenamingId(null);
    if (trimmed === t.label) return;
    try {
      await takesStore.updateMeta(t.id, { label: trimmed });
      setTakes((prev) =>
        prev.map((x) => (x.id === t.id ? { ...x, label: trimmed } : x))
      );
    } catch {
      toast("Couldn't rename take", "error");
    }
  };

  const downloadTake = (t: Take) => {
    const url = blobUrlFor(t);
    const ext = mimeToExt(t.mime);
    const safeTitle = (t.label || "take").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 64);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const askDelete = (id: string) => {
    setPendingDeleteId(id);
    setDeleteArmed(false);
  };

  const cancelDelete = () => {
    setPendingDeleteId(null);
    setDeleteArmed(false);
  };

  const confirmDelete = async (id: string) => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      await takesStore.delete(id);
      const url = blobUrlsRef.current.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        blobUrlsRef.current.delete(id);
      }
      setTakes((prev) => prev.filter((t) => t.id !== id));
      if (activeId === id) setActiveId(null);
      toast("Take deleted", "info");
    } catch {
      toast("Couldn't delete take", "error");
    } finally {
      setPendingDeleteId(null);
      setDeleteArmed(false);
    }
  };

  return (
    <aside
      aria-hidden={!open}
      className={`fixed bottom-0 right-0 top-0 z-30 flex w-[min(440px,92vw)] flex-col border-l border-ink-line bg-ink-surface transition-transform duration-150 print:hidden ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <header className="flex items-center justify-between border-b border-ink-line px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute">
            Takes
          </div>
          <div className="font-serif text-lg text-ink-text">
            recorded vocals
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenPerform}
            title="Recording lives in Perform — open it to capture a new take"
            className="btn-primary text-[12px]"
          >
            ↗ Perform
          </button>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-mute transition-colors duration-150 hover:bg-surface-2 hover:text-ink-text"
            aria-label="Close takes panel"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="scrollbar-thin flex-1 overflow-auto">
        {loading ? (
          <div className="px-4 py-3 text-sm text-ink-mute">loading…</div>
        ) : takes.length === 0 ? (
          <div className="px-4 py-6 text-sm text-ink-mute">
            No takes yet. Recording lives in{" "}
            <button onClick={onOpenPerform} className="text-amber-gold underline-offset-2 hover:underline">Perform</button>{" "}
            — sing with the beat, chords, lyrics and trumpet, and your takes show up here.
          </div>
        ) : (
          <ul className="divide-y divide-ink-line">
            {takes.map((t) => {
              const isActive = activeId === t.id;
              const isRenaming = renamingId === t.id;
              const isPendingDelete = pendingDeleteId === t.id;
              return (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => void commitRename(t)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void commitRename(t);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setRenamingId(null);
                          }
                        }}
                        className="flex-1 rounded border border-amber-gold/40 bg-ink/60 px-2 py-1 text-sm text-ink-text outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRename(t)}
                        title="Rename"
                        className="truncate text-left font-serif text-base text-ink-text hover:text-amber-gold"
                      >
                        {t.label}
                      </button>
                    )}
                    <div className="shrink-0 font-mono text-[11px] text-ink-mute">
                      {formatDuration(t.duration)}
                    </div>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-mute">
                    <span>{new Date(t.created_at).toLocaleString()}</span>
                    <span>·</span>
                    <span>{formatBytes(t.size)}</span>
                    <span>·</span>
                    <span>{t.has_video ? "video" : "audio"}</span>
                  </div>

                  {isActive ? (
                    <div className="mt-2">
                      {t.has_video ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video
                          src={blobUrlFor(t)}
                          controls
                          className="aspect-video w-full rounded border border-ink-line bg-black"
                        />
                      ) : (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <audio
                          src={blobUrlFor(t)}
                          controls
                          className="w-full"
                        />
                      )}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() =>
                        setActiveId(isActive ? null : t.id)
                      }
                      className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-mute hover:border-amber-gold/40 hover:text-amber-gold"
                    >
                      {isActive ? "hide" : "▶ play"}
                    </button>
                    <button
                      onClick={() => startRename(t)}
                      className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink-text"
                    >
                      rename
                    </button>
                    <button
                      onClick={() => downloadTake(t)}
                      className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink-text"
                    >
                      ⬇ download
                    </button>

                    {isPendingDelete ? (
                      <span className="ml-auto flex items-center gap-1">
                        <span className="text-[11px] text-ink-mute">
                          {deleteArmed ? "tap once more" : "delete?"}
                        </span>
                        <button
                          onClick={() => void confirmDelete(t.id)}
                          className={`rounded border px-2 py-0.5 text-[11px] ${
                            deleteArmed
                              ? "border-red-400/80 bg-red-500/15 text-red-200"
                              : "border-red-400/40 text-red-300 hover:bg-red-500/10"
                          }`}
                        >
                          yes, delete
                        </button>
                        <button
                          onClick={cancelDelete}
                          className="rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-mute hover:text-ink-text"
                        >
                          cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => askDelete(t.id)}
                        className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] text-ink-mute hover:border-red-400/60 hover:text-red-300"
                      >
                        delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {takes.length > 0 ? (
        <div className="border-t border-ink-line px-4 py-2 text-[11px] text-ink-mute">
          {takes.length} take{takes.length === 1 ? "" : "s"} · {formatBytes(totalSize)} on disk
        </div>
      ) : null}
    </aside>
  );
}

function mimeToExt(mime: string): string {
  if (mime.startsWith("video/mp4")) return "mp4";
  if (mime.startsWith("video/")) return "webm";
  if (mime.startsWith("audio/mp4")) return "m4a";
  if (mime.startsWith("audio/ogg")) return "ogg";
  if (mime.startsWith("audio/")) return "webm";
  return "bin";
}
