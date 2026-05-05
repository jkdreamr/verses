"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { localStore } from "@/lib/storage";
import type { Song, SongVersion, YoutubeSession } from "@/lib/types";
import { useToast } from "@/components/Toast";
import { useShortcut } from "@/hooks/useShortcut";
import { RhymePanel } from "./RhymePanel";
import { Toolbar } from "./Toolbar";
import { StructurePicker } from "./StructurePicker";
import { YoutubeBar } from "./YoutubeBar";
import { OcrModal } from "./OcrModal";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { ExportModal } from "./ExportModal";
import { TagsModal } from "./TagsModal";
import { SelectionTooltip } from "./SelectionTooltip";
import { ThemeToggle } from "@/components/ThemeToggle";

const AUTOSAVE_INTERVAL_MS = 10_000;
const VERSION_INTERVAL_MS = 60_000; // create a version snapshot at most once a minute

export function Editor({ songId }: { songId: string }) {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const configured = isSupabaseConfigured();
  const [guestMode, setGuestMode] = useState(searchParams.get("guest") === "1");

  const [song, setSong] = useState<Song | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [savingFlash, setSavingFlash] = useState(false);
  const [serif, setSerif] = useState(true);

  const [rhymeOpen, setRhymeOpen] = useState(false);
  const [rhymeWord, setRhymeWord] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [structureOpen, setStructureOpen] = useState(false);

  const [youtube, setYoutube] = useState<YoutubeSession | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastVersionAt = useRef<number>(0);
  const lastSavedSnapshot = useRef<{ title: string; content: string } | null>(
    null
  );

  // Load song — only depend on songId so we don't refetch when guestMode flips
  const initialGuestParam = searchParams.get("guest") === "1";
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (configured && !initialGuestParam) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data, error } = await supabase
            .from("songs")
            .select("*")
            .eq("id", songId)
            .eq("user_id", user.id)
            .maybeSingle();
          if (!cancelled) {
            if (!error && data) {
              setSong(data as Song);
              setGuestMode(false);
              const { data: yt } = await supabase
                .from("youtube_sessions")
                .select("*")
                .eq("song_id", songId)
                .maybeSingle();
              setYoutube((yt as YoutubeSession) ?? null);
              setLoaded(true);
              setTimeout(() => textareaRef.current?.focus(), 0);
              return;
            }
          }
        }
      }
      // Guest / unauth: try local
      const local = localStore.getSong(songId);
      if (cancelled) return;
      if (local) {
        setSong(local);
      } else {
        const now = new Date().toISOString();
        const fresh: Song = {
          id: songId,
          user_id: null,
          title: "",
          content: "",
          tags: [],
          created_at: now,
          updated_at: now,
        };
        localStore.upsertSong(fresh);
        setSong(fresh);
      }
      setYoutube(localStore.getYoutubeSession(songId));
      setGuestMode(true);
      setLoaded(true);
      setTimeout(() => textareaRef.current?.focus(), 0);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  const persist = useCallback(
    async (next: Song, opts: { force?: boolean } = {}) => {
      const snapshot = { title: next.title, content: next.content };
      const last = lastSavedSnapshot.current;
      const unchanged =
        last && last.title === snapshot.title && last.content === snapshot.content;
      if (unchanged && !opts.force) return;

      setSavingFlash(true);
      const updated = { ...next, updated_at: new Date().toISOString() };

      if (configured && !guestMode) {
        try {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            const { error } = await supabase
              .from("songs")
              .update({
                title: updated.title,
                content: updated.content,
                tags: updated.tags,
                updated_at: updated.updated_at,
              })
              .eq("id", updated.id)
              .eq("user_id", user.id);
            if (error) throw error;
            // Snapshot version no more than once per VERSION_INTERVAL_MS
            const nowMs = Date.now();
            if (
              !unchanged &&
              nowMs - lastVersionAt.current > VERSION_INTERVAL_MS
            ) {
              await supabase.from("song_versions").insert({
                song_id: updated.id,
                content: updated.content,
              });
              lastVersionAt.current = nowMs;
            }
            lastSavedSnapshot.current = snapshot;
            setSavedAt(Date.now());
          } else {
            localStore.upsertSong(updated);
            lastSavedSnapshot.current = snapshot;
            setSavedAt(Date.now());
          }
        } catch {
          localStore.upsertSong(updated);
          lastSavedSnapshot.current = snapshot;
          setSavedAt(Date.now());
          toast("Cloud save failed — kept a local copy", "error");
        }
      } else {
        localStore.upsertSong(updated);
        const nowMs = Date.now();
        if (!unchanged && nowMs - lastVersionAt.current > VERSION_INTERVAL_MS) {
          localStore.addVersion({
            id: cryptoId(),
            song_id: updated.id,
            content: updated.content,
            saved_at: new Date().toISOString(),
          });
          lastVersionAt.current = nowMs;
        }
        lastSavedSnapshot.current = snapshot;
        setSavedAt(Date.now());
      }

      window.setTimeout(() => setSavingFlash(false), 600);
    },
    [configured, guestMode, toast]
  );

  // Auto-save loop
  useEffect(() => {
    if (!song) return;
    const t = window.setInterval(() => {
      void persist(song);
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [song, persist]);

  // Save on unload (page close, hide, route away). Uses pagehide for SPA route changes
  // and visibilitychange so mobile/Safari catch it. Also persists synchronously to
  // localStorage on unmount so client-side nav back to the dashboard never loses
  // a freshly-typed title.
  useEffect(() => {
    const flush = () => {
      if (!song) return;
      const updated = { ...song, updated_at: new Date().toISOString() };
      try {
        localStore.upsertSong(updated);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [song]);

  // Track text changes
  const setTitle = (title: string) => setSong((s) => (s ? { ...s, title } : s));
  const setContent = (content: string) =>
    setSong((s) => (s ? { ...s, content } : s));
  const setTags = (tags: string[]) =>
    setSong((s) => (s ? { ...s, tags } : s));

  // Insert text at cursor
  const insertAtCursor = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      if (!ta || !song) return;
      const start = ta.selectionStart ?? song.content.length;
      const end = ta.selectionEnd ?? start;
      const next = song.content.slice(0, start) + text + song.content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + text.length;
        ta.setSelectionRange(pos, pos);
      });
    },
    [song]
  );

  const replaceContent = useCallback(
    (text: string) => {
      setContent(text);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    []
  );

  // Stats
  const stats = useMemo(() => {
    const content = song?.content ?? "";
    const lines = content.length === 0 ? 0 : content.split("\n").length;
    const words = (content.match(/\b[\p{L}\p{N}']+\b/gu) ?? []).length;
    return { lines, words };
  }, [song?.content]);

  // Selection tooltip / rhyme triggering
  const onSelectionChange = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, value } = ta;
    if (selectionStart === selectionEnd) return;
    const selected = value.slice(selectionStart, selectionEnd).trim();
    if (!selected) return;
    if (rhymeOpen) {
      // Live update if panel already open
      const word = firstWord(selected);
      if (word) setRhymeWord(word);
    }
  }, [rhymeOpen]);

  const onTriggerRhymesFromSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, value } = ta;
    const selected = value.slice(selectionStart, selectionEnd).trim();
    const word = firstWord(selected) || pickWordAtCursor(value, selectionStart);
    if (!word) {
      toast("Select a word to find rhymes", "info");
      return;
    }
    setRhymeWord(word);
    setRhymeOpen(true);
  }, [toast]);

  // Highlight currently looked-up word: simple visual marker via overlay would be heavy.
  // Instead, when the panel is open, briefly select that word in the textarea on demand.
  // We'll show it in the panel header.

  // Keyboard shortcuts
  useShortcut({ key: "s", meta: true }, (e) => {
    e.preventDefault();
    if (song) void persist(song, { force: true });
    toast("Saved.", "ok");
  });
  useShortcut({ key: "r", meta: true }, (e) => {
    e.preventDefault();
    if (!rhymeOpen) {
      onTriggerRhymesFromSelection();
    } else {
      setRhymeOpen(false);
    }
  });
  useShortcut({ key: "/", meta: true }, (e) => {
    e.preventDefault();
    setStructureOpen((v) => !v);
  });
  useShortcut({ key: "h", meta: true, shift: true }, (e) => {
    e.preventDefault();
    setHistoryOpen((v) => !v);
  });
  useShortcut({ key: "Escape" }, () => {
    setRhymeOpen(false);
    setHistoryOpen(false);
    setOcrOpen(false);
    setExportOpen(false);
    setTagsOpen(false);
    setStructureOpen(false);
  });

  // Restore version
  const onRestore = useCallback(
    async (version: SongVersion) => {
      if (!song) return;
      setContent(version.content);
      toast("Restored a previous version", "ok");
      setHistoryOpen(false);
    },
    [song, toast]
  );

  // YouTube session handlers
  const onSetYoutube = useCallback(
    async (next: YoutubeSession | null) => {
      if (!song) return;
      setYoutube(next);
      if (configured && !guestMode) {
        try {
          const supabase = createClient();
          if (next) {
            await supabase.from("youtube_sessions").upsert(
              {
                song_id: song.id,
                youtube_url: next.youtube_url,
                youtube_title: next.youtube_title,
              },
              { onConflict: "song_id" }
            );
          } else {
            await supabase
              .from("youtube_sessions")
              .delete()
              .eq("song_id", song.id);
          }
        } catch {
          // fall back to local persistence below
        }
      }
      if (next) {
        localStore.upsertYoutubeSession(next);
      }
    },
    [song, configured, guestMode]
  );

  const onSignedOut = !configured;

  if (!loaded || !song) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-mute">
        <div className="text-sm">Opening your page…</div>
      </main>
    );
  }

  return (
    <main
      className="relative flex min-h-screen flex-col"
      style={{
        paddingRight: rhymeOpen || historyOpen ? "min(420px, 38vw)" : 0,
        transition: "padding-right 150ms cubic-bezier(0,0,0.2,1)",
      }}
    >
      {/* Header */}
      <header className="z-10 flex items-center justify-between px-6 pt-5 print-hide">
        <Link
          href="/app"
          onClick={() => {
            if (song) {
              localStore.upsertSong({
                ...song,
                updated_at: new Date().toISOString(),
              });
            }
          }}
          className="font-serif text-sm tracking-tight text-ink-mute transition-colors duration-150 hover:text-amber-gold"
        >
          ← Verses
        </Link>
        <div className="flex items-center gap-3 text-xs text-ink-mute">
          {savingFlash ? (
            <span className="text-amber-gold">saving…</span>
          ) : savedAt ? (
            <span className="opacity-50">
              saved {timeAgo(savedAt)}
            </span>
          ) : null}
          {guestMode && configured ? (
            <Link href="/login" className="underline hover:text-ink-text">
              guest — sign in to sync
            </Link>
          ) : null}
          {onSignedOut ? (
            <span className="opacity-50">guest mode</span>
          ) : null}
          <ThemeToggle />
        </div>
      </header>

      {/* Title */}
      <input
        value={song.title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (song) void persist(song, { force: true });
        }}
        placeholder="untitled"
        className="mx-auto mt-6 w-[min(720px,calc(100%-3rem))] bg-transparent text-center font-serif text-2xl tracking-tight text-ink-mute placeholder:text-ink-mute/50 focus:text-ink-text print:text-ink"
      />

      {/* Canvas */}
      <div className="mx-auto mt-4 flex w-[min(720px,calc(100%-3rem))] flex-1 flex-col">
        <textarea
          ref={textareaRef}
          value={song.content}
          onChange={(e) => setContent(e.target.value)}
          onSelect={onSelectionChange}
          spellCheck
          autoFocus
          placeholder="start writing…"
          className={`w-full flex-1 resize-none bg-transparent py-4 leading-[1.85] tracking-wide outline-none placeholder:text-ink-mute/40 ${
            serif ? "serif text-[18px]" : "font-mono text-[15px]"
          }`}
          style={{ minHeight: "60vh" }}
        />

        <SelectionTooltip
          textareaRef={textareaRef}
          onTriggerRhymes={onTriggerRhymesFromSelection}
        />

        {/* Counts */}
        <div className="fade-idle pointer-events-none fixed bottom-24 right-4 z-10 select-none rounded border border-ink-line bg-ink-surface/70 px-2 py-1 font-mono text-[11px] text-ink-mute backdrop-blur print:hidden">
          {stats.lines} lines · {stats.words} words
        </div>
      </div>

      {/* Floating toolbar */}
      <Toolbar
        onInsertStructure={() => setStructureOpen(true)}
        onScan={() => setOcrOpen(true)}
        onRhymes={onTriggerRhymesFromSelection}
        onHistory={() => setHistoryOpen(true)}
        onExport={() => setExportOpen(true)}
        onTags={() => setTagsOpen(true)}
        onToggleFont={() => setSerif((v) => !v)}
        serif={serif}
      />

      {/* Bottom YouTube bar */}
      <YoutubeBar
        session={youtube}
        onChange={onSetYoutube}
      />

      {/* Right panels */}
      <RhymePanel
        open={rhymeOpen}
        word={rhymeWord}
        onClose={() => setRhymeOpen(false)}
        onPickWord={(w) => setRhymeWord(w)}
      />

      <VersionHistoryPanel
        open={historyOpen}
        songId={song.id}
        guestMode={guestMode || !configured}
        onClose={() => setHistoryOpen(false)}
        onRestore={onRestore}
      />

      {/* Modals */}
      <StructurePicker
        open={structureOpen}
        onClose={() => setStructureOpen(false)}
        onPick={(tag) => {
          insertAtCursor(`\n${tag}\n`);
          setStructureOpen(false);
        }}
      />

      <OcrModal
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onInsert={(text) => {
          insertAtCursor(text);
          setOcrOpen(false);
          toast("Inserted scanned text", "ok");
        }}
        onReplace={(text) => {
          replaceContent(text);
          setOcrOpen(false);
          toast("Replaced with scanned text", "ok");
        }}
      />

      <ExportModal
        open={exportOpen}
        song={song}
        onClose={() => setExportOpen(false)}
      />

      <TagsModal
        open={tagsOpen}
        tags={song.tags ?? []}
        onChange={setTags}
        onClose={() => setTagsOpen(false)}
      />
    </main>
  );
}

function firstWord(s: string): string | null {
  const m = s.match(/[\p{L}\p{N}']+/u);
  return m ? m[0].toLowerCase() : null;
}

function pickWordAtCursor(value: string, idx: number): string | null {
  if (idx < 0) return null;
  // Walk left and right to word boundaries
  const isWordChar = (c: string) => /[\p{L}\p{N}']/u.test(c);
  let s = idx;
  let e = idx;
  while (s > 0 && isWordChar(value[s - 1])) s--;
  while (e < value.length && isWordChar(value[e])) e++;
  const w = value.slice(s, e).trim();
  return w ? w.toLowerCase() : null;
}

function timeAgo(ms: number): string {
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(ms).toLocaleTimeString();
}

function cryptoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
