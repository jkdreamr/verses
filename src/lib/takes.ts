"use client";

import type { Take, TakeMeta } from "./types";

const DB_NAME = "verses-takes";
const DB_VERSION = 1;
const STORE = "takes";

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
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("song_id", "song_id", { unique: false });
        os.createIndex("created_at", "created_at", { unique: false });
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

export const newTakeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `take-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

export const takesStore = {
  async listForSong(songId: string): Promise<Take[]> {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.index("song_id").getAll(songId);
      req.onsuccess = () => {
        const all = (req.result as Take[]) ?? [];
        all.sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  },
  async get(id: string): Promise<Take | null> {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as Take) ?? null);
      req.onerror = () => reject(req.error);
    });
  },
  async put(take: Take): Promise<void> {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put(take);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async updateMeta(id: string, patch: Partial<TakeMeta>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    await this.put({ ...existing, ...patch });
  },
  async delete(id: string): Promise<void> {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async deleteAllForSong(songId: string): Promise<void> {
    const all = await this.listForSong(songId);
    await Promise.all(all.map((t) => this.delete(t.id)));
  },
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const v = bytes / Math.pow(1024, i);
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};
