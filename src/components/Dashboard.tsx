"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { localStore, newSongId } from "@/lib/storage";
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
      <header className="mb-10 flex items-baseline justify-between">
        <Link
          href="/app"
          className="font-serif text-3xl tracking-tight text-amber-gold"
        >
          Verses
        </Link>
        <nav className="flex items-center gap-4 text-xs text-ink-mute">
          {user ? (
            <>
              <span className="hidden sm:inline">{user.email}</span>
              <button
                onClick={onSignOut}
                className="hover:text-ink-text"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="hover:text-ink-text">
              Sign in
            </Link>
          )}
          <ThemeToggle />
        </nav>
      </header>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search lyrics, titles, tags…"
          className="flex-1 rounded border border-ink-line bg-ink-surface px-3 py-2 text-sm focus:border-amber-gold/60"
        />
        <button
          onClick={onNewSong}
          className="rounded border border-amber-gold/50 bg-amber-gold/10 px-4 py-2 text-sm text-amber-gold transition-colors duration-150 hover:bg-amber-gold/20"
        >
          + New Song
        </button>
      </div>

      {allTags.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTag(null)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
              activeTag === null
                ? "border-amber-gold/60 text-amber-gold"
                : "border-ink-line text-ink-mute hover:text-ink-text"
            }`}
          >
            all
          </button>
          {allTags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(t === activeTag ? null : t)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors duration-150 ${
                t === activeTag
                  ? "border-amber-gold/60 text-amber-gold"
                  : "border-ink-line text-ink-mute hover:text-ink-text"
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      ) : null}

      {!loaded ? (
        <div className="text-sm text-ink-mute">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-12 rounded border border-dashed border-ink-line p-12 text-center">
          <div className="font-serif text-xl text-ink-text">A blank page.</div>
          <p className="mt-2 text-sm text-ink-mute">
            Click <span className="text-amber-gold">New Song</span> to start
            writing.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-ink-line border-y border-ink-line">
          {filtered.map((s) => (
            <li key={s.id} className="group relative">
              <Link
                href={
                  user
                    ? `/editor/${s.id}`
                    : `/editor/${s.id}?guest=1`
                }
                className="block px-1 py-4 pr-16 transition-colors duration-150 hover:bg-ink-surface"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="font-serif text-lg text-ink-text">
                    {s.title?.trim() ? s.title : "Untitled"}
                  </div>
                  <div className="shrink-0 text-xs text-ink-mute">
                    {new Date(s.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </div>
                <div className="mt-1 truncate text-sm text-ink-mute">
                  {firstNonEmptyLine(s.content) || "\u2014"}
                </div>
                {(s.tags ?? []).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-ink-line px-2 py-0.5 text-[11px] text-ink-mute"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  askDelete(s);
                }}
                title={`Delete \u201C${s.title?.trim() || "Untitled"}\u201D`}
                aria-label={`Delete ${s.title?.trim() || "Untitled"}`}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded border border-ink-line px-2 py-1 text-[11px] text-ink-mute opacity-0 transition-opacity duration-150 hover:border-red-400/60 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={cancelDelete}
        title="Delete song"
      >
        {pendingDelete ? (
          <div>
            <p className="font-serif text-lg text-ink-text">
              {"Delete \u201C"}
              <span className="text-amber-gold">
                {pendingDelete.title?.trim() || "Untitled"}
              </span>
              {"\u201D?"}
            </p>
            <p className="mt-2 text-sm text-ink-mute">
              Lyrics, version history, and the linked YouTube session for this
              song will be removed. This cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelDelete}
                disabled={deleting}
                className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className={`rounded border px-3 py-1.5 text-sm transition-colors duration-150 ${
                  armed
                    ? "border-red-400/80 bg-red-500/15 text-red-200 hover:bg-red-500/25"
                    : "border-red-400/40 text-red-300 hover:border-red-400/70 hover:bg-red-500/10"
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

      {!user && configured && loaded ? (
        <p className="mt-12 text-center text-xs text-ink-mute">
          You&apos;re writing in guest mode. {" "}
          <Link href="/login" className="underline hover:text-ink-text">
            Sign in to sync songs to the cloud
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
