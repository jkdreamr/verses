"use client";

import type { Song, SongVersion, YoutubeSession } from "./types";

const SONGS_KEY = "verses:songs";
const VERSIONS_KEY = "verses:versions";
const YT_KEY = "verses:youtube";

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const localStore = {
  listSongs(): Song[] {
    if (typeof window === "undefined") return [];
    return safeParse<Song[]>(window.localStorage.getItem(SONGS_KEY), []).sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  },
  getSong(id: string): Song | null {
    return this.listSongs().find((s) => s.id === id) ?? null;
  },
  upsertSong(song: Song) {
    const all = this.listSongs();
    const idx = all.findIndex((s) => s.id === song.id);
    if (idx === -1) all.push(song);
    else all[idx] = song;
    window.localStorage.setItem(SONGS_KEY, JSON.stringify(all));
  },
  deleteSong(id: string) {
    const all = this.listSongs().filter((s) => s.id !== id);
    window.localStorage.setItem(SONGS_KEY, JSON.stringify(all));
    const versions = this.listVersions().filter((v) => v.song_id !== id);
    window.localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
    const yts = this.listYoutubeSessions().filter((y) => y.song_id !== id);
    window.localStorage.setItem(YT_KEY, JSON.stringify(yts));
  },
  listVersions(): SongVersion[] {
    if (typeof window === "undefined") return [];
    return safeParse<SongVersion[]>(
      window.localStorage.getItem(VERSIONS_KEY),
      []
    );
  },
  listVersionsFor(songId: string): SongVersion[] {
    return this.listVersions()
      .filter((v) => v.song_id === songId)
      .sort(
        (a, b) =>
          new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()
      );
  },
  addVersion(version: SongVersion) {
    const all = this.listVersions();
    all.push(version);
    // keep last 50 per song
    const bySong: Record<string, SongVersion[]> = {};
    for (const v of all) {
      bySong[v.song_id] = bySong[v.song_id] || [];
      bySong[v.song_id].push(v);
    }
    const trimmed: SongVersion[] = [];
    for (const sid of Object.keys(bySong)) {
      const sorted = bySong[sid].sort(
        (a, b) =>
          new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()
      );
      trimmed.push(...sorted.slice(0, 50));
    }
    window.localStorage.setItem(VERSIONS_KEY, JSON.stringify(trimmed));
  },
  listYoutubeSessions(): YoutubeSession[] {
    if (typeof window === "undefined") return [];
    return safeParse<YoutubeSession[]>(
      window.localStorage.getItem(YT_KEY),
      []
    );
  },
  getYoutubeSession(songId: string): YoutubeSession | null {
    return this.listYoutubeSessions().find((y) => y.song_id === songId) ?? null;
  },
  upsertYoutubeSession(session: YoutubeSession) {
    const all = this.listYoutubeSessions();
    const idx = all.findIndex((y) => y.song_id === session.song_id);
    if (idx === -1) all.push(session);
    else all[idx] = session;
    window.localStorage.setItem(YT_KEY, JSON.stringify(all));
  },
};

export const newSongId = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));
