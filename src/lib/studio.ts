"use client";

import type { StudioSession, StudioTrack } from "./types";

const DB_NAME = "verses-studio";
const DB_VERSION = 1;
const STORE = "sessions";

let dbPromise: Promise<IDBDatabase> | null = null;

const openDB = (): Promise<IDBDatabase> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by song_id so each song has at most one studio session.
        db.createObjectStore(STORE, { keyPath: "song_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
};

const tx = async (
  mode: IDBTransactionMode
): Promise<IDBObjectStore> => {
  const db = await openDB();
  return db.transaction(STORE, mode).objectStore(STORE);
};

export const newTrackId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `track-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

export const newSessionId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

export const studioStore = {
  async getForSong(songId: string): Promise<StudioSession | null> {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(songId);
      req.onsuccess = () =>
        resolve((req.result as StudioSession | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  },
  async put(session: StudioSession): Promise<void> {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put(session);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async deleteForSong(songId: string): Promise<void> {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(songId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};

export const emptySession = (songId: string): StudioSession => ({
  id: newSessionId(),
  song_id: songId,
  master_volume: 1,
  tracks: [],
  updated_at: new Date().toISOString(),
});

export const totalSessionBytes = (s: StudioSession): number =>
  s.tracks.reduce((acc, t) => acc + (t.blob?.size ?? 0), 0);

/**
 * Decode a track's blob into an AudioBuffer using the supplied AudioContext.
 * Caller is responsible for closing/discarding the context.
 */
export const decodeTrack = async (
  ctx: BaseAudioContext,
  track: StudioTrack
): Promise<AudioBuffer> => {
  const buf = await track.blob.arrayBuffer();
  return await new Promise<AudioBuffer>((resolve, reject) => {
    // Some Safari versions only expose the callback API.
    try {
      const p = ctx.decodeAudioData(buf, resolve, reject);
      if (p && typeof (p as Promise<AudioBuffer>).then === "function") {
        (p as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
};

/**
 * Determines which tracks should sound during playback / export.
 * If any track is solo'd, only solos play. Otherwise all non-muted play.
 */
export const audibleTracks = (tracks: StudioTrack[]): StudioTrack[] => {
  const anySolo = tracks.some((t) => t.solo);
  return tracks.filter((t) =>
    anySolo ? t.solo && !t.muted : !t.muted
  );
};
