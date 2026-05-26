"use client";

import { useMemo, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";

// ---------------------------------------------------------------------------
// Stop words – excluded from rhyme detection
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "up", "about", "into", "through", "after", "is", "are",
  "was", "were", "be", "been", "have", "has", "had", "do", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need", "i",
  "me", "my", "we", "our", "you", "your", "he", "she", "it", "they", "his",
  "her", "its", "their", "this", "that", "these", "those", "not", "no", "so",
  "as", "if", "then", "than",
]);

// ---------------------------------------------------------------------------
// Phonetic suffix groups for end-rhyme matching
// ---------------------------------------------------------------------------
const PHONETIC_GROUPS: Record<string, string[]> = {
  ay_sound: ["day", "say", "way", "play", "stay", "pray", "pay", "lay", "ray", "bay", "may", "gray", "sway", "away", "okay"],
  ight_sound: ["night", "light", "right", "fight", "might", "sight", "bright", "tight", "flight", "white", "write", "bite", "kite", "life", "knife"],
  ove_sound: ["love", "above", "shove", "dove", "of"],
  ain_sound: ["rain", "pain", "gain", "brain", "chain", "plain", "vain", "train", "again", "remain", "lane", "cane", "same", "name", "game", "flame", "came"],
  ine_sound: ["mine", "fine", "line", "time", "rhyme", "climb", "mind", "find", "blind", "kind"],
  ong_sound: ["song", "long", "strong", "wrong", "along", "belong"],
  own_sound: ["town", "down", "brown", "crown", "found", "ground", "sound", "around", "bound"],
  ake_sound: ["make", "take", "shake", "break", "wake", "fake", "lake", "cake"],
  ead_sound: ["dead", "head", "bed", "said", "red", "led", "fed", "dread", "spread", "instead", "ahead"],
  eel_sound: ["feel", "real", "deal", "heal", "steal", "reveal", "appeal", "kneel"],
  ee_sound: ["free", "see", "be", "tree", "me", "we", "key", "need", "deep", "sleep", "keep"],
};

// Build a reverse lookup: word -> phonetic group key
const WORD_TO_PHONETIC: Record<string, string> = {};
for (const [key, words] of Object.entries(PHONETIC_GROUPS)) {
  for (const w of words) {
    WORD_TO_PHONETIC[w] = key;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type RhymeKind = "exact" | "near" | "slant" | "phonetic";

export interface RhymeGroup {
  id: string;
  kind: RhymeKind;
  label: string;      // shared suffix / sound label
  lineIndices: number[];
  words: string[];
}

export interface InternalEcho {
  lineIndex: number;
  wordA: string;
  wordB: string;
  kind: RhymeKind;
  adjacentLineIndex?: number; // if cross-line
}

export interface StartRhymeGroup {
  prefix: string;
  lineIndices: number[];
  words: string[];
}

export interface RepeatedPhrase {
  phrase: string;
  count: number;
  lineIndices: number[];
}

export interface LensAnalysis {
  lines: string[];
  endRhymeGroups: RhymeGroup[];
  internalEchoes: InternalEcho[];
  startRhymeGroups: StartRhymeGroup[];
  repeatedPhrases: RepeatedPhrase[];
  unrhymedLineIndices: number[];
  // Per-line summary flags (for the mirror view)
  lineFlags: LineFlag[];
  summaryEndRhymes: number;
  summaryInternalEchoes: number;
  summaryRepeatedPhrases: number;
  summaryUnrhymed: number;
}

export type LineFlag = {
  endRhyme: RhymeKind | null;
  internalRhyme: boolean;
  startRhyme: boolean;
  repeated: boolean;
};

// ---------------------------------------------------------------------------
// Normalise a raw word: strip punctuation, lowercase
// ---------------------------------------------------------------------------
function normalise(raw: string): string {
  return raw.replace(/[^a-z']/g, "").toLowerCase().replace(/'+$/, "").replace(/^'+/, "");
}

// ---------------------------------------------------------------------------
// Tokenise a line into clean words
// ---------------------------------------------------------------------------
function tokenise(line: string): string[] {
  return line
    .split(/\s+/)
    .map(normalise)
    .filter((w) => w.length > 0);
}

// ---------------------------------------------------------------------------
// Get last meaningful (non-stop) word from a list of tokens
// ---------------------------------------------------------------------------
function lastMeaningful(tokens: string[]): string | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const w = tokens[i];
    if (w.length > 1 && !STOP_WORDS.has(w)) return w;
  }
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

// ---------------------------------------------------------------------------
// Get first meaningful (non-stop) word
// ---------------------------------------------------------------------------
function firstMeaningful(tokens: string[]): string | null {
  for (const w of tokens) {
    if (w.length > 1 && !STOP_WORDS.has(w)) return w;
  }
  return tokens.length > 0 ? tokens[0] : null;
}

// ---------------------------------------------------------------------------
// Compare two normalised words and return the rhyme kind (or null)
// ---------------------------------------------------------------------------
function rhymeKind(a: string, b: string): RhymeKind | null {
  if (!a || !b || a === b) return null; // same word is not a rhyme

  // 1. Phonetic group match
  const pgA = WORD_TO_PHONETIC[a];
  const pgB = WORD_TO_PHONETIC[b];
  if (pgA && pgB && pgA === pgB) return "phonetic";

  const lenA = a.length;
  const lenB = b.length;
  if (lenA < 2 || lenB < 2) return null;

  // 2. Exact suffix match – last 4+ chars
  if (lenA >= 4 && lenB >= 4) {
    const sufA4 = a.slice(-4);
    const sufB4 = b.slice(-4);
    if (sufA4 === sufB4) return "near";
  }

  // 3. Last 3 chars match → slant/weak near-rhyme
  if (lenA >= 3 && lenB >= 3) {
    const sufA3 = a.slice(-3);
    const sufB3 = b.slice(-3);
    if (sufA3 === sufB3) return "slant";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Check exact word match (two different words with same spelling)
// Exact end-rhyme = identical spelling on last meaningful word of different lines
// ---------------------------------------------------------------------------
function isExactMatch(a: string, b: string): boolean {
  return a === b && a.length > 0;
}

// ---------------------------------------------------------------------------
// Core analysis function – synchronous, no side effects
// ---------------------------------------------------------------------------
export function analyseLyrics(lyrics: string): LensAnalysis {
  const rawLines = lyrics.split("\n");
  const lines = rawLines; // keep original for display

  // Tokenise each line
  const tokenised = rawLines.map((l) => tokenise(l));

  // Per-line last/first meaningful words
  const endWords = tokenised.map(lastMeaningful);
  const startWords = tokenised.map(firstMeaningful);

  const n = rawLines.length;

  // -------------------------------------------------------------------------
  // 1. End rhyme groups
  // -------------------------------------------------------------------------
  // We build a union-find style grouping: each line index maps to a group id
  const endGroupMap = new Map<number, string>(); // lineIdx -> groupId
  const endGroupLines = new Map<string, number[]>(); // groupId -> lineIndices
  const endGroupKind = new Map<string, RhymeKind>();
  const endGroupLabel = new Map<string, string>();
  let gCounter = 0;

  // Helper to merge two lines into the same group
  function mergeLines(iA: number, iB: number, kind: RhymeKind, label: string) {
    const gA = endGroupMap.get(iA);
    const gB = endGroupMap.get(iB);

    if (gA && gB && gA === gB) return; // already same group

    if (!gA && !gB) {
      const id = `g${gCounter++}`;
      endGroupMap.set(iA, id);
      endGroupMap.set(iB, id);
      endGroupLines.set(id, [iA, iB]);
      endGroupKind.set(id, kind);
      endGroupLabel.set(id, label);
    } else if (gA && !gB) {
      endGroupMap.set(iB, gA);
      endGroupLines.get(gA)!.push(iB);
      // Upgrade kind if stronger
      const cur = endGroupKind.get(gA)!;
      if (kindStrength(kind) > kindStrength(cur)) {
        endGroupKind.set(gA, kind);
        endGroupLabel.set(gA, label);
      }
    } else if (!gA && gB) {
      endGroupMap.set(iA, gB);
      endGroupLines.get(gB)!.push(iA);
      const cur = endGroupKind.get(gB)!;
      if (kindStrength(kind) > kindStrength(cur)) {
        endGroupKind.set(gB, kind);
        endGroupLabel.set(gB, label);
      }
    } else if (gA && gB) {
      // Merge gB into gA
      const linesB = endGroupLines.get(gB)!;
      for (const li of linesB) {
        endGroupMap.set(li, gA);
      }
      const combined = [...endGroupLines.get(gA)!, ...linesB];
      endGroupLines.set(gA, combined);
      endGroupLines.delete(gB);
      const curA = endGroupKind.get(gA)!;
      const curB = endGroupKind.get(gB)!;
      if (kindStrength(curB) > kindStrength(curA)) {
        endGroupKind.set(gA, curB);
        endGroupLabel.set(gA, endGroupLabel.get(gB)!);
      }
      endGroupKind.delete(gB);
      endGroupLabel.delete(gB);
    }
  }

  function kindStrength(k: RhymeKind): number {
    return k === "exact" ? 4 : k === "phonetic" ? 3 : k === "near" ? 2 : 1;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const wA = endWords[i];
      const wB = endWords[j];
      if (!wA || !wB) continue;

      // Skip blank lines
      if (!rawLines[i].trim() || !rawLines[j].trim()) continue;

      if (isExactMatch(wA, wB)) {
        mergeLines(i, j, "exact", wA);
      } else {
        const k = rhymeKind(wA, wB);
        if (k) {
          const label =
            k === "phonetic"
              ? (WORD_TO_PHONETIC[wA] ?? wA).replace("_sound", "")
              : `‑${longestCommonSuffix(wA, wB)}`;
          mergeLines(i, j, k, label);
        }
      }
    }
  }

  // Collect end rhyme groups
  const endRhymeGroups: RhymeGroup[] = [];
  const seenGroups = new Set<string>();
  for (const [, gid] of endGroupMap) {
    if (seenGroups.has(gid)) continue;
    seenGroups.add(gid);
    const lineIndices = endGroupLines.get(gid)!;
    const words = lineIndices.map((li) => endWords[li] ?? "").filter(Boolean);
    endRhymeGroups.push({
      id: gid,
      kind: endGroupKind.get(gid)!,
      label: endGroupLabel.get(gid)!,
      lineIndices: [...lineIndices].sort((a, b) => a - b),
      words,
    });
  }
  // Sort groups by first line index
  endRhymeGroups.sort((a, b) => a.lineIndices[0] - b.lineIndices[0]);

  // -------------------------------------------------------------------------
  // 2. Start rhyme groups
  // -------------------------------------------------------------------------
  const startGroupsByExact = new Map<string, number[]>();
  const startGroupsByPrefix = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const w = startWords[i];
    if (!w || !rawLines[i].trim()) continue;

    // Exact start repeat
    const ex = startGroupsByExact.get(w) ?? [];
    ex.push(i);
    startGroupsByExact.set(w, ex);

    // First 3-char prefix match
    if (w.length >= 3) {
      const prefix = w.slice(0, 3);
      const pf = startGroupsByPrefix.get(prefix) ?? [];
      pf.push(i);
      startGroupsByPrefix.set(prefix, pf);
    }
  }

  const startRhymeGroups: StartRhymeGroup[] = [];
  const usedStartLines = new Set<number>();

  // Exact starts first
  for (const [word, indices] of startGroupsByExact) {
    if (indices.length < 2) continue;
    startRhymeGroups.push({
      prefix: word,
      lineIndices: [...indices],
      words: indices.map((li) => startWords[li] ?? ""),
    });
    indices.forEach((li) => usedStartLines.add(li));
  }

  // Similar prefix starts (only lines not already in exact group)
  for (const [prefix, indices] of startGroupsByPrefix) {
    const fresh = indices.filter((li) => !usedStartLines.has(li));
    if (fresh.length < 2) continue;
    // Make sure no two words are the same (that's handled above)
    const uniqueWords = new Set(fresh.map((li) => startWords[li] ?? ""));
    if (uniqueWords.size < 2) continue;
    startRhymeGroups.push({
      prefix: `~${prefix}`,
      lineIndices: [...fresh],
      words: fresh.map((li) => startWords[li] ?? ""),
    });
    fresh.forEach((li) => usedStartLines.add(li));
  }

  // -------------------------------------------------------------------------
  // 3. Internal echoes
  // -------------------------------------------------------------------------
  const internalEchoes: InternalEcho[] = [];
  const WINDOW = 2; // check ±2 adjacent lines

  for (let i = 0; i < n; i++) {
    if (!rawLines[i].trim()) continue;
    const tokens = tokenised[i].filter((w) => w.length > 1 && !STOP_WORDS.has(w));
    const uniqueTokens = [...new Set(tokens)];

    // a) Within the same line: pairs
    for (let a = 0; a < uniqueTokens.length; a++) {
      for (let b = a + 1; b < uniqueTokens.length; b++) {
        const wA = uniqueTokens[a];
        const wB = uniqueTokens[b];
        if (isExactMatch(wA, wB)) continue; // same word appears twice – skip
        const k = rhymeKind(wA, wB);
        if (k) {
          internalEchoes.push({ lineIndex: i, wordA: wA, wordB: wB, kind: k });
        }
      }
    }

    // b) Internal words vs end word of adjacent lines
    const endW = endWords[i];
    if (endW) {
      for (let d = 1; d <= WINDOW; d++) {
        const adj = i + d;
        if (adj >= n) break;
        if (!rawLines[adj].trim()) continue;
        const adjTokens = tokenised[adj].filter(
          (w) => w.length > 1 && !STOP_WORDS.has(w)
        );
        for (const w of adjTokens) {
          if (w === endW) continue;
          const k = rhymeKind(endW, w);
          if (k) {
            internalEchoes.push({
              lineIndex: i,
              wordA: endW,
              wordB: w,
              kind: k,
              adjacentLineIndex: adj,
            });
          }
        }
      }
    }
  }

  // Deduplicate echoes (same pair same line)
  const echoSet = new Set<string>();
  const dedupedEchoes: InternalEcho[] = [];
  for (const e of internalEchoes) {
    const key = [e.lineIndex, [e.wordA, e.wordB].sort().join(":"), e.adjacentLineIndex ?? ""].join("|");
    if (!echoSet.has(key)) {
      echoSet.add(key);
      dedupedEchoes.push(e);
    }
  }

  // -------------------------------------------------------------------------
  // 4. Repeated phrases
  // -------------------------------------------------------------------------
  const allWords: string[] = tokenised.flatMap((t) => t.filter((w) => w.length > 1));
  const wordCounts = new Map<string, number>();
  for (const w of allWords) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);

  // Single words repeated 3+
  const repeatedWords: RepeatedPhrase[] = [];
  for (const [w, cnt] of wordCounts) {
    if (cnt >= 3 && !STOP_WORDS.has(w)) {
      const lineIndices: number[] = [];
      for (let i = 0; i < n; i++) {
        if (tokenised[i].includes(w)) lineIndices.push(i);
      }
      repeatedWords.push({ phrase: w, count: cnt, lineIndices });
    }
  }

  // 2-4 word phrases repeated 2+
  const phraseCounts = new Map<string, { count: number; lineIndices: Set<number> }>();
  for (let i = 0; i < n; i++) {
    const tokens = tokenised[i];
    for (let start = 0; start < tokens.length; start++) {
      for (let len = 2; len <= 4; len++) {
        if (start + len > tokens.length) break;
        const phrase = tokens.slice(start, start + len).join(" ");
        // Skip if all stop words
        const meaningfulWords = tokens.slice(start, start + len).filter((w) => !STOP_WORDS.has(w));
        if (meaningfulWords.length === 0) continue;
        const entry = phraseCounts.get(phrase) ?? { count: 0, lineIndices: new Set() };
        entry.count += 1;
        entry.lineIndices.add(i);
        phraseCounts.set(phrase, entry);
      }
    }
  }

  const repeatedPhrases: RepeatedPhrase[] = [...repeatedWords];
  for (const [phrase, { count, lineIndices }] of phraseCounts) {
    if (count >= 2 && phrase.includes(" ")) {
      // Avoid subset phrases if a longer phrase already covers the same text
      repeatedPhrases.push({ phrase, count, lineIndices: [...lineIndices] });
    }
  }

  // Sort by count desc, then phrase length desc to prefer longer / more-repeated
  repeatedPhrases.sort((a, b) => b.count - a.count || b.phrase.length - a.phrase.length);

  // -------------------------------------------------------------------------
  // 5. Unrhymed lines
  // -------------------------------------------------------------------------
  const rhymedLineIndices = new Set<number>([
    ...endGroupMap.keys(),
    ...dedupedEchoes.map((e) => e.lineIndex),
    ...startRhymeGroups.flatMap((g) => g.lineIndices),
  ]);

  const unrhymedLineIndices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!rawLines[i].trim()) continue; // skip blank lines
    if (!rhymedLineIndices.has(i)) unrhymedLineIndices.push(i);
  }

  // -------------------------------------------------------------------------
  // 6. Per-line flags
  // -------------------------------------------------------------------------
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const endRhymedLines = new Set(endGroupMap.keys());
  const internalRhymedLines = new Set(dedupedEchoes.map((e) => e.lineIndex));
  const startRhymedLines = new Set(startRhymeGroups.flatMap((g) => g.lineIndices));
  const repeatedLines = new Set(repeatedPhrases.flatMap((p) => p.lineIndices));

  // Find the kind for each end-rhymed line
  const lineEndKind = new Map<number, RhymeKind>();
  for (const [lineIdx, gid] of endGroupMap) {
    lineEndKind.set(lineIdx, endGroupKind.get(gid)!);
  }

  const lineFlags: LineFlag[] = rawLines.map((_, i) => ({
    endRhyme: lineEndKind.get(i) ?? null,
    internalRhyme: internalRhymedLines.has(i),
    startRhyme: startRhymedLines.has(i),
    repeated: repeatedLines.has(i),
  }));

  return {
    lines,
    endRhymeGroups,
    internalEchoes: dedupedEchoes,
    startRhymeGroups,
    repeatedPhrases,
    unrhymedLineIndices,
    lineFlags,
    summaryEndRhymes: endRhymeGroups.length,
    summaryInternalEchoes: dedupedEchoes.length,
    summaryRepeatedPhrases: repeatedPhrases.filter((p) => p.count >= 2).length,
    summaryUnrhymed: unrhymedLineIndices.length,
  };
}

// ---------------------------------------------------------------------------
// Longest common suffix helper
// ---------------------------------------------------------------------------
function longestCommonSuffix(a: string, b: string): string {
  let i = 1;
  while (i <= a.length && i <= b.length && a[a.length - i] === b[b.length - i]) i++;
  return a.slice(a.length - (i - 1));
}

// ---------------------------------------------------------------------------
// Section Accordion
// ---------------------------------------------------------------------------
function Section({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-ink-line">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors duration-150 hover:bg-ink-line/40"
      >
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
          {title}
        </span>
        <div className="flex items-center gap-2">
          {count !== undefined && (
            <span className="rounded bg-ink-line px-1.5 py-0.5 font-mono text-[10px] text-ink-mute">
              {count}
            </span>
          )}
          <span className="text-[10px] text-ink-mute">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && <div className="px-4 pb-3 pt-1">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kind label & color helpers
// ---------------------------------------------------------------------------
function kindChipClass(kind: RhymeKind): string {
  switch (kind) {
    case "exact":
      return "border-amber-gold/70 text-amber-gold bg-amber-gold/10";
    case "phonetic":
      return "border-amber-gold/50 text-amber-gold/80 bg-amber-gold/5";
    case "near":
      return "border-amber-gold/40 text-amber-gold/70 bg-amber-gold/5";
    case "slant":
      return "border-ink-mute/50 text-ink-mute bg-transparent";
  }
}

function kindLabel(kind: RhymeKind): string {
  switch (kind) {
    case "exact": return "exact";
    case "phonetic": return "phonetic";
    case "near": return "near";
    case "slant": return "slant";
  }
}

// ---------------------------------------------------------------------------
// Mirror line component (annotated lyric line in the panel)
// ---------------------------------------------------------------------------
function MirrorLine({
  line,
  lineIndex,
  flag,
}: {
  line: string;
  lineIndex: number;
  flag: LineFlag;
}) {
  const isEmpty = !line.trim();
  if (isEmpty) {
    return <div className="h-3" />;
  }

  // Left border color based on flag priority
  let borderClass = "border-l-2 border-transparent";
  if (flag.endRhyme) {
    if (flag.endRhyme === "exact" || flag.endRhyme === "phonetic") {
      borderClass = "border-l-2 border-amber-gold";
    } else if (flag.endRhyme === "near") {
      borderClass = "border-l-2 border-amber-gold/50";
    } else {
      borderClass = "border-l-2 border-amber-gold/25";
    }
  } else if (flag.internalRhyme) {
    borderClass = "border-l-2 border-indigo-400/60";
  } else if (flag.startRhyme) {
    borderClass = "border-l-2 border-ink-mute/60";
  }

  // Right-side indicators
  const dots: { title: string; colorClass: string }[] = [];
  if (flag.endRhyme) {
    dots.push({
      title: `End rhyme (${flag.endRhyme})`,
      colorClass:
        flag.endRhyme === "exact" || flag.endRhyme === "phonetic"
          ? "bg-amber-gold"
          : flag.endRhyme === "near"
          ? "bg-amber-gold/50"
          : "bg-amber-gold/25",
    });
  }
  if (flag.internalRhyme) {
    dots.push({ title: "Internal echo", colorClass: "bg-indigo-400/70" });
  }
  if (flag.startRhyme) {
    dots.push({ title: "Start rhyme", colorClass: "bg-ink-mute/60" });
  }
  if (flag.repeated) {
    dots.push({ title: "Repeated phrase", colorClass: "bg-amber-gold/30" });
  }

  return (
    <div
      className={`group flex items-baseline gap-2 py-0.5 pl-2 pr-1 ${borderClass}`}
    >
      <span className="min-w-0 flex-1 font-mono text-[11px] leading-relaxed text-ink-text/80">
        {lineIndex + 1}.{" "}
        <span className="font-sans text-[12px] leading-relaxed">
          {line}
        </span>
      </span>
      {dots.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 opacity-80 group-hover:opacity-100">
          {dots.map((d, idx) => (
            <span
              key={idx}
              title={d.title}
              className={`h-1.5 w-1.5 rounded-full ${d.colorClass}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RhymeLens component
// ---------------------------------------------------------------------------
export function RhymeLens({
  lyrics,
  open,
  onToggle,
}: {
  lyrics: string;
  open: boolean;
  onToggle: () => void;
}) {
  const debouncedLyrics = useDebounce(lyrics, 800);

  const analysis = useMemo<LensAnalysis | null>(() => {
    if (!debouncedLyrics.trim()) return null;
    return analyseLyrics(debouncedLyrics);
  }, [debouncedLyrics]);


  return (
    <>
      {/* Toggle button — bottom-left, above YouTube bar */}
      <button
        onClick={onToggle}
        aria-pressed={open}
        aria-label="Toggle Rhyme Lens"
        className={`fixed bottom-24 left-4 z-10 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors duration-150 print:hidden ${
          open
            ? "border-amber-gold text-amber-gold"
            : "border-transparent text-ink-mute hover:text-ink-text"
        }`}
      >
        Rhyme Lens
      </button>

      {/* Analysis panel — slides in from the right */}
      <aside
        aria-hidden={!open}
        className={`fixed bottom-0 right-0 top-0 z-30 flex w-[min(380px,42vw)] flex-col border-l border-ink-line bg-ink-surface transition-transform duration-150 print:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Panel header */}
        <header className="flex shrink-0 items-center justify-between border-b border-ink-line px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              Rhyme Lens
            </div>
            <div className="mt-0.5 font-serif text-base text-ink-text">
              analysis
            </div>
          </div>
          <button
            onClick={onToggle}
            className="rounded p-1 text-ink-mute transition-colors duration-150 hover:bg-ink-line hover:text-ink-text"
            aria-label="Close Rhyme Lens"
          >
            ✕
          </button>
        </header>

        {/* Panel body — scrollable */}
        <div className="scrollbar-thin flex-1 overflow-auto">
          {!analysis ? (
            <div className="px-4 py-6 text-sm text-ink-mute">
              Start writing to see rhyme analysis.
            </div>
          ) : (
            <>
              {/* ── Summary ─────────────────────────────────────────── */}
              <div className="border-b border-ink-line px-4 py-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "End rhyme groups", value: analysis.summaryEndRhymes },
                    { label: "Internal echoes", value: analysis.summaryInternalEchoes },
                    { label: "Repeated phrases", value: analysis.summaryRepeatedPhrases },
                    { label: "Unrhymed lines", value: analysis.summaryUnrhymed },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="rounded border border-ink-line bg-ink/30 px-2.5 py-2"
                    >
                      <div className="font-mono text-[9px] uppercase tracking-widest text-ink-mute">
                        {label}
                      </div>
                      <div className="mt-0.5 font-mono text-lg text-ink-text">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Legend chips */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[
                    { label: "End", colorClass: "bg-amber-gold/80" },
                    { label: "Internal", colorClass: "bg-indigo-400/70" },
                    { label: "Start", colorClass: "bg-ink-mute/60" },
                    { label: "Near", colorClass: "bg-amber-gold/35" },
                    { label: "Repeat", colorClass: "bg-amber-gold/30" },
                  ].map(({ label, colorClass }) => (
                    <span
                      key={label}
                      className="flex items-center gap-1 rounded border border-ink-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-ink-mute"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${colorClass}`} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              {/* ── Annotated mirror ────────────────────────────────── */}
              <Section title="Lyric Map" defaultOpen={true}>
                <div className="space-y-0">
                  {analysis.lines.map((line, i) => (
                    <MirrorLine
                      key={i}
                      line={line}
                      lineIndex={i}
                      flag={analysis.lineFlags[i]}
                    />
                  ))}
                </div>
              </Section>

              {/* ── End rhyme groups ─────────────────────────────────── */}
              <Section
                title="End Rhymes"
                count={analysis.endRhymeGroups.length}
                defaultOpen={analysis.endRhymeGroups.length > 0}
              >
                {analysis.endRhymeGroups.length === 0 ? (
                  <p className="text-xs text-ink-mute">No end rhymes detected.</p>
                ) : (
                  <div className="space-y-3">
                    {analysis.endRhymeGroups.map((g) => (
                      <div key={g.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${kindChipClass(g.kind)}`}
                          >
                            {kindLabel(g.kind)}
                          </span>
                          <span className="font-mono text-[10px] text-ink-mute">
                            {g.label}
                          </span>
                        </div>
                        <div className="space-y-0.5">
                          {g.lineIndices.map((li) => {
                            const endWord = analysis.lines[li]
                              .split(/\s+/)
                              .reverse()
                              .find((w) => normalise(w).length > 1);
                            const lineText = analysis.lines[li];
                            const trimmed = lineText.trimEnd();
                            // Bold the end word
                            const endWordNorm = endWord ? normalise(endWord) : null;
                            const lastIdx = endWordNorm
                              ? trimmed.toLowerCase().lastIndexOf(endWordNorm)
                              : -1;
                            return (
                              <div
                                key={li}
                                className="flex items-baseline gap-1.5"
                              >
                                <span className="w-5 shrink-0 font-mono text-[10px] text-ink-mute">
                                  {li + 1}
                                </span>
                                <span className="text-[12px] text-ink-text/80">
                                  {lastIdx >= 0 ? (
                                    <>
                                      {trimmed.slice(0, lastIdx)}
                                      <span
                                        className={
                                          g.kind === "exact" || g.kind === "phonetic"
                                            ? "underline decoration-amber-gold decoration-[1.5px]"
                                            : "underline decoration-amber-gold/40 decoration-dotted decoration-[1.5px]"
                                        }
                                      >
                                        {trimmed.slice(lastIdx, lastIdx + endWordNorm!.length)}
                                      </span>
                                      {trimmed.slice(lastIdx + endWordNorm!.length)}
                                    </>
                                  ) : (
                                    trimmed
                                  )}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Internal echoes ──────────────────────────────────── */}
              <Section
                title="Internal Echoes"
                count={analysis.internalEchoes.length}
              >
                {analysis.internalEchoes.length === 0 ? (
                  <p className="text-xs text-ink-mute">No internal echoes detected.</p>
                ) : (
                  <div className="space-y-1.5">
                    {analysis.internalEchoes.slice(0, 40).map((e, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 text-[11px]"
                      >
                        <span className="w-5 shrink-0 font-mono text-[10px] text-ink-mute">
                          {e.lineIndex + 1}
                          {e.adjacentLineIndex !== undefined
                            ? `→${e.adjacentLineIndex + 1}`
                            : ""}
                        </span>
                        <span className="text-indigo-400/80">{e.wordA}</span>
                        <span className="text-ink-mute/50">·</span>
                        <span className="text-indigo-400/80">{e.wordB}</span>
                        <span
                          className={`ml-auto rounded border px-1 py-0.5 font-mono text-[8px] uppercase tracking-widest ${kindChipClass(e.kind)}`}
                        >
                          {kindLabel(e.kind)}
                        </span>
                      </div>
                    ))}
                    {analysis.internalEchoes.length > 40 && (
                      <p className="text-[10px] text-ink-mute">
                        + {analysis.internalEchoes.length - 40} more
                      </p>
                    )}
                  </div>
                )}
              </Section>

              {/* ── Start rhymes ─────────────────────────────────────── */}
              <Section
                title="Start Rhymes"
                count={analysis.startRhymeGroups.length}
              >
                {analysis.startRhymeGroups.length === 0 ? (
                  <p className="text-xs text-ink-mute">No start rhymes detected.</p>
                ) : (
                  <div className="space-y-3">
                    {analysis.startRhymeGroups.map((g, idx) => (
                      <div key={idx} className="space-y-0.5">
                        <div className="font-mono text-[10px] text-ink-mute">
                          {g.prefix}
                        </div>
                        {g.lineIndices.map((li) => (
                          <div
                            key={li}
                            className="flex items-baseline gap-1.5"
                          >
                            <span className="w-5 shrink-0 font-mono text-[10px] text-ink-mute">
                              {li + 1}
                            </span>
                            <span className="text-[12px] text-ink-text/80">
                              {analysis.lines[li]}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Repeated phrases ─────────────────────────────────── */}
              <Section
                title="Repeated Phrases"
                count={analysis.repeatedPhrases.length}
              >
                {analysis.repeatedPhrases.length === 0 ? (
                  <p className="text-xs text-ink-mute">No repeated phrases detected.</p>
                ) : (
                  <div className="space-y-2">
                    {analysis.repeatedPhrases.slice(0, 30).map((p, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2"
                      >
                        <span className="flex-1 truncate text-[12px] text-ink-text/80">
                          {p.phrase}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {p.count >= 3 && (
                            <span className="rounded border border-amber-gold/40 bg-amber-gold/5 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-widest text-amber-gold/70">
                              hook?
                            </span>
                          )}
                          <span className="font-mono text-[10px] text-ink-mute">
                            ×{p.count}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* ── Unrhymed lines ───────────────────────────────────── */}
              <Section
                title="Unrhymed Lines"
                count={analysis.unrhymedLineIndices.length}
              >
                {analysis.unrhymedLineIndices.length === 0 ? (
                  <p className="text-xs text-ink-mute">All lines have a rhyme relationship.</p>
                ) : (
                  <div className="space-y-0.5">
                    {analysis.unrhymedLineIndices.map((li) => (
                      <div key={li} className="flex items-baseline gap-1.5">
                        <span className="w-5 shrink-0 font-mono text-[10px] text-ink-mute">
                          {li + 1}
                        </span>
                        <span className="text-[12px] text-ink-mute/70">
                          {analysis.lines[li]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
