"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { localStore, newSongId } from "@/lib/storage";
import { takesStore } from "@/lib/takes";
import type { Song } from "@/lib/types";
import { useToast } from "./Toast";
import { ThemeToggle } from "./ThemeToggle";
import { Modal } from "./Modal";

export function Dashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState<{ email?: string | null } | null>(null);
  const [filter, setFilter] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Song | null>(null);
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const configured = isSupabaseConfigured();

  const refresh = useCallback(async () => {
    if (configured) {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        const { data, error } = await supabase
          .from("songs")
          .select("*")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false });
        if (error) {
          toast("Couldn't load your songs", "error");
        } else {
          setSongs((data as Song[]) ?? []);
        }
        setLoaded(true);
        return;
      }
    }
    setUser(null);
    setSongs(localStore.listSongs());
    setLoaded(true);
  }, [configured, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return songs.filter((s) => {
      if (activeTag && !(s.tags ?? []).includes(activeTag)) return false;
      if (!q) return true;
      const hay = `${s.title} ${s.content} ${(s.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [songs, filter, activeTag]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of songs) for (const t of s.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [songs]);

  const onNewSong = async () => {
    const now = new Date().toISOString();
    const draft: Song = {
      id: newSongId(),
      user_id: user ? "self" : null,
      title: "",
      content: "",
      tags: [],
      created_at: now,
      updated_at: now,
    };
    if (configured && user) {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("songs")
        .insert({
          title: "",
          content: "",
          tags: [],
        })
        .select()
        .single();
      if (error || !data) {
        toast("Couldn't create song — using guest mode", "error");
        localStore.upsertSong(draft);
        router.push(`/editor/${draft.id}?guest=1`);
        return;
      }
      router.push(`/editor/${(data as Song).id}`);
      return;
    }
    localStore.upsertSong(draft);
    router.push(`/editor/${draft.id}?guest=1`);
  };

  const askDelete = (song: Song) => {
    setPendingDelete(song);
    setArmed(false);
  };

  const cancelDelete = () => {
    setPendingDelete(null);
    setArmed(false);
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setDeleting(true);
    const id = pendingDelete.id;
    const title = pendingDelete.title?.trim() || "Untitled";
    try {
      if (configured && user) {
        const supabase = createClient();
        const { error } = await supabase.from("songs").delete().eq("id", id);
        if (error) {
          toast("Couldn't delete \u2014 try again", "error");
          setDeleting(false);
          return;
        }
      }
      localStore.deleteSong(id);
      try {
        await takesStore.deleteAllForSong(id);
      } catch {
        // ignore: IndexedDB may be unavailable in some environments
      }
      setSongs((prev) => prev.filter((s) => s.id !== id));
      toast(`Deleted \u201C${title}\u201D`, "info");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
      setArmed(false);
    }
  };

  const onSignOut = async () => {
    if (!configured) return;
    const supabase = createClient();
    await supabase.auth.signOut();
    await refresh();
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 pb-32 pt-10">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="mb-16 flex items-baseline justify-between">
        <Link
          href="/app"
          className="font-serif text-4xl tracking-tight text-ink-text"
        >
          Verses
        </Link>
        <nav className="flex items-center gap-5 text-xs text-ink-mute">
          {user ? (
            <>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] sm:inline">
                {user.email}
              </span>
              <button
                onClick={onSignOut}
                className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-150 hover:text-ink-text"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-150 hover:text-ink-text"
            >
              Sign in
            </Link>
          )}
          <ThemeToggle />
        </nav>
      </header>

      {/* ── Search + New Song ─────────────────────────────────────────────── */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search lyrics, titles, tags…"
          className="flex-1 border border-ink-line bg-transparent px-3 py-2.5 text-sm text-ink-text placeholder:text-ink-mute focus:border-amber-gold/50 focus:outline-none"
        />
        <button
          onClick={onNewSong}
          className="border border-amber-gold/50 bg-amber-gold/10 px-5 py-2.5 text-sm text-amber-gold transition-colors duration-150 hover:bg-amber-gold/20"
        >
          + New Song
        </button>
      </div>

      {/* ── Tag filters ───────────────────────────────────────────────────── */}
      {allTags.length > 0 ? (
        <div className="mb-8 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag(null)}
            className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-150 ${
              activeTag === null
                ? "border-amber-gold/60 text-amber-gold"
                : "border-ink-line text-ink-mute hover:border-ink-text/40 hover:text-ink-text"
            }`}
          >
            All
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(t === activeTag ? null : t)}
              className={`border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors duration-150 ${
                t === activeTag
                  ? "border-amber-gold/60 text-amber-gold"
                  : "border-ink-line text-ink-mute hover:border-ink-text/40 hover:text-ink-text"
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Song list / empty / loading ───────────────────────────────────── */}
      {!loaded ? (
        <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-mute">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-20 flex flex-col items-start gap-6 border-l-2 border-amber-gold/30 pl-8">
          <p className="font-serif text-4xl leading-tight tracking-tight text-ink-text sm:text-5xl">
            A blank page.
          </p>
          <p className="max-w-[40ch] text-sm leading-relaxed text-ink-mute">
            Every song starts somewhere. Hit{" "}
            <button
              onClick={onNewSong}
              className="text-amber-gold underline decoration-amber-gold/40 underline-offset-2 hover:decoration-amber-gold/80"
            >
              New Song
            </button>{" "}
            and begin.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col border-t border-ink-line">
          {filtered.map((s) => (
            <li
              key={s.id}
              className="group relative border-b border-ink-line transition-colors duration-150 hover:border-l-2 hover:border-l-amber-gold/50"
            >
              <Link
                href={
                  user
                    ? `/editor/${s.id}`
                    : `/editor/${s.id}?guest=1`
                }
                className="block px-3 py-6 pr-20 transition-colors duration-150 hover:bg-ink-surface"
              >
                {/* Title */}
                <div className="font-serif text-2xl tracking-tight text-ink-text">
                  {s.title?.trim() ? s.title : "Untitled"}
                </div>

                {/* Preview line */}
                <div className="mt-2 truncate text-sm leading-relaxed text-ink-mute">
                  {firstNonEmptyLine(s.content) || "\u2014"}
                </div>

                {/* Meta row */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
                    {new Date(s.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                  {(s.tags ?? []).length > 0
                    ? s.tags.map((t) => (
                        <span
                          key={t}
                          className="border border-ink-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-mute"
                        >
                          {t}
                        </span>
                      ))
                    : null}
                </div>
              </Link>

              {/* Delete button */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  askDelete(s);
                }}
                title={`Delete \u201C${s.title?.trim() || "Untitled"}\u201D`}
                aria-label={`Delete ${s.title?.trim() || "Untitled"}`}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] uppercase tracking-[0.15em] text-ink-mute opacity-0 transition-opacity duration-150 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Delete modal ──────────────────────────────────────────────────── */}
      <Modal
        open={pendingDelete !== null}
        onClose={cancelDelete}
        title="Delete song"
      >
        {pendingDelete ? (
          <div>
            <p className="font-serif text-xl leading-snug text-ink-text">
              {"Delete \u201C"}
              <span className="text-amber-gold">
                {pendingDelete.title?.trim() || "Untitled"}
              </span>
              {"\u201D?"}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-mute">
              Lyrics, version history, and the linked YouTube session for this
              song will be removed. This cannot be undone.
            </p>
            <div className="mt-8 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={cancelDelete}
                disabled={deleting}
                className="border border-ink-line px-4 py-2 text-sm text-ink-mute transition-colors duration-150 hover:text-ink-text disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className={`border px-4 py-2 text-sm transition-colors duration-150 disabled:opacity-40 ${
                  armed
                    ? "border-red-400/70 text-red-300 hover:bg-red-500/10"
                    : "border-red-400/40 text-red-400/70 hover:border-red-400/70 hover:text-red-300"
                }`}
              >
                {deleting
                  ? "Deleting\u2026"
                  : armed
                  ? "Tap once more to confirm"
                  : "Delete this song"}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ── Guest mode nudge ──────────────────────────────────────────────── */}
      {!user && configured && loaded ? (
        <p className="mt-16 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
          Writing in guest mode.{" "}
          <Link
            href="/login"
            className="text-amber-gold/70 underline decoration-amber-gold/30 underline-offset-2 hover:text-amber-gold"
          >
            Sign in to sync to the cloud
          </Link>
          .
        </p>
      ) : null}
    </main>
  );
}

function firstNonEmptyLine(s: string): string {
  const lines = (s ?? "").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
