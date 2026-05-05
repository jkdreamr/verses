import type { DatamuseWord } from "./types";

const cache = new Map<string, DatamuseWord[]>();

export type RhymeKind = "perfect" | "near" | "soundsLike";

const param = (kind: RhymeKind) =>
  kind === "perfect" ? "rel_rhy" : kind === "near" ? "rel_nry" : "sl";

export async function fetchRhymes(
  word: string,
  kind: RhymeKind,
  signal?: AbortSignal
): Promise<DatamuseWord[]> {
  const w = word.trim().toLowerCase();
  if (!w) return [];
  const key = `${kind}:${w}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const max = kind === "soundsLike" ? 20 : 30;
  const url = `https://api.datamuse.com/words?${param(kind)}=${encodeURIComponent(w)}&max=${max}&md=s`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Datamuse error: ${res.status}`);
  const data = (await res.json()) as DatamuseWord[];
  // Filter out very low score entries to keep results high quality
  const filtered = data.filter((d) => (d.score ?? 0) >= 100);
  // Sort descending by score
  filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  cache.set(key, filtered);
  return filtered;
}

export function groupBySyllables(
  words: DatamuseWord[]
): { syllables: number; words: DatamuseWord[] }[] {
  const buckets = new Map<number, DatamuseWord[]>();
  for (const w of words) {
    const n = w.numSyllables ?? 0;
    if (!buckets.has(n)) buckets.set(n, []);
    buckets.get(n)!.push(w);
  }
  return Array.from(buckets.entries())
    .map(([syllables, words]) => ({ syllables, words }))
    .sort((a, b) => a.syllables - b.syllables);
}
