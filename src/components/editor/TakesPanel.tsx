"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { takesStore, formatBytes, formatDuration } from "@/lib/takes";
import type { Take } from "@/lib/types";

// ── Linked beat playback helper ──────────────────────────────────────────────
// When a take has linked_beat metadata, we play the YouTube beat in sync with
// the vocal blob. YouTube iframe audio can't be baked into MediaRecorder blobs
// due to browser cross-origin audio restrictions — so takes store metadata and
// recreate the vocal+beat mix at playback time.
function LinkedBeatPlayer({
  take,
  vocalUrl,
}: {
  take: Take;
  vocalUrl: string;
}) {
  const lb = take.linked_beat;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [beatError] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const handlePlay = useCallback(() => {
    if (!lb) return;
    setSyncing(true);
    // Seek YouTube to beat_start_time and play in sync with vocal
    window.dispatchEvent(new CustomEvent("verses:beat-play", {
      detail: { startAt: lb.beat_start_time }
    }));
    setSyncing(false);
  }, [lb]);

  const handlePause = useCallback(() => {
    window.dispatchEvent(new CustomEvent("verses:beat-pause"));
  }, []);

  if (!lb) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Vocal blob player */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src={vocalUrl}
        controls
        className="w-full"
        onPlay={handlePlay}
        onPause={handlePause}
      />

      {/* Beat metadata */}
      <div className="rounded-md border border-accent/20 bg-surface-2/30 px-2.5 py-2">
        <div className="flex items-center gap-2">
          <svg className="h-3 w-3 flex-shrink-0 text-red-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0C.488 3.45.029 5.804 0 12c.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0C23.512 20.55 23.971 18.196 24 12c-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
          </svg>
          <span className="flex-1 truncate text-[11px] font-medium text-ink-text">
            {lb.youtube_title ?? "YouTube Beat"}
          </span>
          <span className="font-mono text-[10px] text-ink-mute/60">
            starts at {fmt(lb.beat_start_time)}
          </span>
        </div>
        {beatError ? (
          <p className="mt-1 text-[10px] text-amber-400">
            Beat unavailable. Playing vocal only.
          </p>
        ) : (
          <p className="mt-1 text-[10px] text-ink-mute/60">
            Beat is linked from YouTube and plays in sync with your vocal.
            {syncing && " Syncing…"}
          </p>
        )}
        <p className="mt-0.5 text-[9px] text-ink-mute/40">
          source: {lb.source} · {take.record_mode === "raw" ? "raw vocal" : "processed vocal"}
        </p>
      </div>
    </div>
  );
}

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
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-mute">
                    <span>{new Date(t.created_at).toLocaleString()}</span>
                    <span>·</span>
                    <span>{formatBytes(t.size)}</span>
                    <span>·</span>
                    <span>{t.has_video ? "video" : "audio"}</span>
                    {t.linked_beat && (
                      <>
                        <span>·</span>
                        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                          Vocal + Beat
                        </span>
                      </>
                    )}
                    {t.take_kind === "photobooth" && (
                      <>
                        <span>·</span>
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]">photobooth</span>
                      </>
                    )}
                  </div>
                  {t.linked_beat && (
                    <div className="mt-1 text-[10px] text-ink-mute/60">
                      Beat: {t.linked_beat.youtube_title ?? t.linked_beat.youtube_url.slice(0, 40)}
                      {" · "}starts at {Math.floor(t.linked_beat.beat_start_time / 60)}:{String(Math.floor(t.linked_beat.beat_start_time % 60)).padStart(2, "0")}
                    </div>
                  )}

                  {isActive ? (
                    <div className="mt-2">
                      {t.has_video ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video
                          src={blobUrlFor(t)}
                          controls
                          className="aspect-video w-full rounded border border-ink-line bg-black"
                        />
                      ) : t.linked_beat ? (
                        // Linked beat take: synced vocal+YouTube playback
                        <LinkedBeatPlayer take={t} vocalUrl={blobUrlFor(t)} />
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
