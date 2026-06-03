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
import { RhymeLens, buildCharHighlights, FAMILY_COLORS, FAMILY_BORDER_COLORS, type CharHighlight } from "./RhymeLens";
import type { RhymeLensResult } from "@/lib/rhymeLens";
import { Toolbar } from "./Toolbar";
import { StructurePicker } from "./StructurePicker";
import { YoutubeBar } from "./YoutubeBar";
import { OcrModal } from "./OcrModal";
import { VersionHistoryPanel } from "./VersionHistoryPanel";
import { ExportModal } from "./ExportModal";
import { TagsModal } from "./TagsModal";
import { SelectionTooltip } from "./SelectionTooltip";
import { RecorderModal } from "./RecorderModal";
import { TakesPanel } from "./TakesPanel";
import { PerformModal } from "./PerformModal";
import { VoiceToScoreModal } from "./VoiceToScoreModal";
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

  // ── Exclusive panel / modal state ──────────────────────────────────────
  // Only one right-side rail can be open at a time.
  // Only one modal can be open at a time.
  const [activeRail, setActiveRail] = useState<"none" | "rhymes" | "history" | "takes" | "rhymeLens">("none");
  const [activeModal, setActiveModal] = useState<"none" | "ocr" | "export" | "tags" | "recorder" | "perform" | "voiceScore" | "structure">("none");
  const [rhymeWord, setRhymeWord] = useState<string | null>(null);
  const [takesReloadKey, setTakesReloadKey] = useState(0);

  // Derived booleans for child components (keeps props interface stable)
  const rhymeOpen = activeRail === "rhymes";
  const rhymeLensOpen = activeRail === "rhymeLens";
  const historyOpen = activeRail === "history";
  const takesOpen = activeRail === "takes";
  const ocrOpen = activeModal === "ocr";
  const exportOpen = activeModal === "export";
  const tagsOpen = activeModal === "tags";
  const structureOpen = activeModal === "structure";
  const recorderOpen = activeModal === "recorder";
  const performOpen = activeModal === "perform";
  const voiceToScoreOpen = activeModal === "voiceScore";

  // Helpers
  const openRail = useCallback((id: typeof activeRail) => setActiveRail(id), []);
  const closeRail = useCallback(() => setActiveRail("none"), []);
  const openModal = useCallback((id: typeof activeModal) => setActiveModal(id), []);
  const closeModal = useCallback(() => setActiveModal("none"), []);

  const [youtube, setYoutube] = useState<YoutubeSession | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const lastVersionAt = useRef<number>(0);
  const lastSavedSnapshot = useRef<{ title: string; content: string } | null>(
    null
  );

  // RhymeLens inline highlight data
  const [rhymeLensAnalysis, setRhymeLensAnalysis] = useState<RhymeLensResult | null>(null);
  const [rhymeLensFocus, setRhymeLensFocus] = useState<string | null>(null);
  const charHighlights = useMemo(
    () => buildCharHighlights(rhymeLensAnalysis, rhymeLensFocus),
    [rhymeLensAnalysis, rhymeLensFocus]
  );
  const onRhymeLensAnalysis = useCallback((result: RhymeLensResult | null, focusId?: string | null) => {
    setRhymeLensAnalysis(result);
    setRhymeLensFocus(focusId ?? null);
  }, []);

  // Sync scroll between textarea and highlight mirror
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const hl = highlightRef.current;
    if (ta && hl) {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
    }
  }, []);

  // Re-sync scroll when highlights change (e.g. analysis updated, focus toggled)
  useEffect(() => { syncScroll(); }, [charHighlights, syncScroll]);

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
    openRail("rhymes");
  }, [toast, openRail]);

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
      closeRail();
    }
  });
  useShortcut({ key: "/", meta: true }, (e) => {
    e.preventDefault();
    if (structureOpen) closeModal(); else openModal("structure");
  });
  useShortcut({ key: "h", meta: true, shift: true }, (e) => {
    e.preventDefault();
    if (historyOpen) closeRail(); else openRail("history");
  });
  useShortcut({ key: "Escape" }, () => {
    if (activeModal !== "none") { closeModal(); return; }
    if (activeRail !== "none") { closeRail(); return; }
  });

  // Restore version
  const onRestore = useCallback(
    async (version: SongVersion) => {
      if (!song) return;
      setContent(version.content);
      toast("Restored a previous version", "ok");
      closeRail();
    },
    [song, toast, closeRail]
  );

  // YouTube session handlers
  const onSetYoutube = useCallback(
    async (incoming: YoutubeSession | null) => {
      if (!song) return;
      const next = incoming ? { ...incoming, song_id: song.id } : null;
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
                markers: next.markers ?? [],
                loop_start: next.loop_start ?? null,
                loop_end: next.loop_end ?? null,
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
        paddingRight:
          rhymeOpen || historyOpen || takesOpen
            ? "min(420px, 38vw)"
            : rhymeLensOpen
            ? "min(380px, 42vw)"
            : 0,
        transition: "padding-right 150ms cubic-bezier(0,0,0.2,1)",
      }}
    >
      {/* Header */}
      <header className="z-10 flex items-center justify-between px-8 pt-6 print-hide">
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
          className="font-serif text-sm tracking-tight text-ink-mute/60 transition-colors duration-200 hover:text-amber-gold"
        >
          Verses
        </Link>
        <div className="flex items-center gap-4 text-xs text-ink-mute/50">
          {savingFlash ? (
            <span className="font-mono text-[9px] text-amber-gold/70">saving</span>
          ) : savedAt ? (
            <span className="font-mono text-[9px] opacity-40">
              saved {timeAgo(savedAt)}
            </span>
          ) : null}
          {guestMode && configured ? (
            <Link href="/login" className="font-mono text-[9px] text-ink-mute/40 transition-colors hover:text-ink-text/60">
              guest
            </Link>
          ) : null}
          {onSignedOut ? (
            <span className="font-mono text-[9px] opacity-30">guest</span>
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
        className="mx-auto mt-8 w-[min(720px,calc(100%-3rem))] bg-transparent text-center font-serif text-2xl tracking-tight text-ink-mute/70 placeholder:text-ink-mute/25 focus:text-ink-text transition-colors duration-200 print:text-ink"
      />

      {/* Canvas */}
      <div className="mx-auto mt-4 flex w-[min(720px,calc(100%-3rem))] flex-1 flex-col">
        {/* Layered editor: highlight mirror behind transparent textarea */}
        <div className="relative flex-1" style={{ minHeight: "60vh" }}>
          {/* Highlight mirror layer */}
          <div
            ref={highlightRef}
            aria-hidden
            className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words py-4 leading-[1.85] tracking-wide ${
              serif ? "serif text-[18px]" : "font-mono text-[15px]"
            }`}
            style={{ color: "transparent", wordBreak: "break-word" }}
          >
            {charHighlights.size > 0
              ? renderHighlightedText(song.content, charHighlights)
              : song.content + "\n"}
          </div>
          {/* Actual textarea */}
          <textarea
            ref={textareaRef}
            value={song.content}
            onChange={(e) => setContent(e.target.value)}
            onSelect={onSelectionChange}
            onScroll={syncScroll}
            spellCheck
            autoFocus
            placeholder="start writing…"
            className={`relative z-[1] w-full resize-none bg-transparent py-4 leading-[1.85] tracking-wide outline-none placeholder:text-ink-mute/40 ${
              serif ? "serif text-[18px]" : "font-mono text-[15px]"
            }`}
            style={{
              minHeight: "60vh",
              height: "100%",
              caretColor: "var(--ink-text, #e5e5e5)",
            }}
          />
        </div>

        <SelectionTooltip
          textareaRef={textareaRef}
          onTriggerRhymes={onTriggerRhymesFromSelection}
        />

        {/* Counts */}
        <div className="pointer-events-none fixed bottom-[7rem] left-8 z-10 select-none rounded-sm bg-ink-surface/60 px-2.5 py-1 font-mono text-[10px] tracking-wide text-ink-mute/70 backdrop-blur-sm print:hidden">
          {stats.lines} lines · {stats.words} words
        </div>
      </div>

      {/* Floating toolbar */}
      <Toolbar
        onInsertStructure={() => openModal("structure")}
        onScan={() => openModal("ocr")}
        onRhymes={onTriggerRhymesFromSelection}
        onHistory={() => openRail("history")}
        onTakes={() => openRail("takes")}
        onExport={() => openModal("export")}
        onTags={() => openModal("tags")}
        onToggleFont={() => setSerif((v) => !v)}
        serif={serif}
        onPerform={() => openModal("perform")}
        onVoiceScore={() => openModal("voiceScore")}
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
        onClose={closeRail}
        onPickWord={(w) => setRhymeWord(w)}
      />

      <VersionHistoryPanel
        open={historyOpen}
        songId={song.id}
        guestMode={guestMode || !configured}
        onClose={closeRail}
        onRestore={onRestore}
      />

      {/* Modals */}
      <StructurePicker
        open={structureOpen}
        onClose={closeModal}
        onPick={(tag) => {
          insertAtCursor(`\n${tag}\n`);
          closeModal();
        }}
      />

      <OcrModal
        open={ocrOpen}
        onClose={closeModal}
        onInsert={(text) => {
          insertAtCursor(text);
          closeModal();
          toast("Inserted scanned text", "ok");
        }}
        onReplace={(text) => {
          replaceContent(text);
          closeModal();
          toast("Replaced with scanned text", "ok");
        }}
      />

      <ExportModal
        open={exportOpen}
        song={song}
        onClose={closeModal}
      />

      <TagsModal
        open={tagsOpen}
        tags={song.tags ?? []}
        onChange={setTags}
        onClose={closeModal}
      />

      <TakesPanel
        open={takesOpen}
        songId={song.id}
        reloadKey={takesReloadKey}
        onClose={closeRail}
        onNewTake={() => openModal("recorder")}
      />

      <RecorderModal
        open={recorderOpen}
        songId={song.id}
        hasYoutube={!!youtube}
        markers={youtube?.markers ?? []}
        loopStart={youtube?.loop_start ?? null}
        lyrics={song.content}
        youtubeSession={youtube ?? null}
        onClose={closeModal}
        onSaved={() => {
          setTakesReloadKey((k) => k + 1);
          openRail("takes");
        }}
      />

      {performOpen && (
        <PerformModal
          open={performOpen}
          onClose={closeModal}
          songId={song.id}
          onTakeSaved={() => setTakesReloadKey((k) => k + 1)}
          youtubeSession={youtube}
        />
      )}

      <VoiceToScoreModal
        open={voiceToScoreOpen}
        onClose={closeModal}
        songId={song.id}
      />

      <RhymeLens
        lyrics={song.content}
        open={rhymeLensOpen}
        onToggle={() => activeRail === "rhymeLens" ? closeRail() : openRail("rhymeLens")}
        onAnalysis={onRhymeLensAnalysis}
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

// ---------------------------------------------------------------------------
// Render highlighted text as React elements for the mirror layer
// Groups consecutive same-family chars into <mark> spans for efficiency
// ---------------------------------------------------------------------------

import { createElement, Fragment } from "react";

function renderHighlightedText(
  text: string,
  highlights: Map<number, CharHighlight>
): React.ReactNode {
  if (!text) return "\n";

  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < text.length) {
    const h = highlights.get(i);

    if (!h) {
      // Gather consecutive unhighlighted chars
      let j = i + 1;
      while (j < text.length && !highlights.has(j)) j++;
      nodes.push(text.slice(i, j));
      i = j;
    } else {
      // Gather consecutive chars with the same highlight layer stack
      const layerKey = highlightLayerKey(h);
      let j = i + 1;
      while (j < text.length) {
        const hj = highlights.get(j);
        if (!hj || highlightLayerKey(hj) !== layerKey) break;
        j++;
      }
      const primary = primaryHighlightLayer(h);
      const repetition = h.find((layer) => layer.type === "repetition");
      const secondary = h.find((layer) => layer.familyId !== primary?.familyId && layer.type !== "repetition");
      const color = primary && primary.type !== "repetition"
        ? FAMILY_COLORS[primary.colorIndex % FAMILY_COLORS.length]
        : "transparent";
      const borderColor = repetition
        ? FAMILY_BORDER_COLORS[repetition.colorIndex % FAMILY_BORDER_COLORS.length]
        : secondary
          ? FAMILY_BORDER_COLORS[secondary.colorIndex % FAMILY_BORDER_COLORS.length]
          : primary
            ? FAMILY_BORDER_COLORS[primary.colorIndex % FAMILY_BORDER_COLORS.length]
            : "transparent";
      nodes.push(
        createElement(
          "mark",
          {
            key: `${i}-${layerKey}`,
            style: {
              backgroundColor: color,
              color: "transparent",
              borderRadius: primary?.type === "repetition" ? "0" : "2px",
              borderBottom: repetition
                ? `1.5px dashed ${borderColor}`
                : secondary
                  ? `1.5px solid ${borderColor}`
                  : undefined,
              boxShadow: repetition && primary?.type !== "repetition"
                ? `inset 0 0 0 1px ${borderColor}`
                : undefined,
            },
          },
          text.slice(i, j)
        )
      );
      i = j;
    }
  }

  // Always end with a newline so the mirror sizing matches the textarea
  nodes.push("\n");
  return createElement(Fragment, null, ...nodes);
}

function primaryHighlightLayer(layers: CharHighlight) {
  const rank = (type: string) => {
    switch (type) {
      case "end": case "chain": return 10;
      case "multi": case "compound": case "mosaic": return 9;
      case "perfect": case "rich": return 8;
      case "internal": return 7;
      case "cross": return 6;
      case "slant": case "family": return 5;
      case "assonance": case "consonance": return 4;
      case "alliteration": return 3;
      case "eye": return 2;
      case "repetition": return 1;
      default: return 0;
    }
  };
  return [...layers].sort((a, b) => rank(b.type) - rank(a.type))[0];
}

function highlightLayerKey(layers: CharHighlight): string {
  return layers
    .map((layer) => `${layer.familyId}:${layer.type}:${layer.colorIndex}`)
    .sort()
    .join("|");
}
