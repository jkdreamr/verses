// ───────────────────────────────────────────────────────────────────────────
// Lyric forced-alignment matcher for the Smart Lyric Reader.
//
// We already KNOW the written lyrics, so this is alignment, not open
// transcription. The Web Speech API gives a noisy, drifting transcript; we
// align its tail against a forward window of upcoming lyric tokens with fuzzy
// (Levenshtein + Soundex) tolerance, advance a monotonic-ish pointer, and never
// jump far backward. The pointer maps to a word and a line for highlight +
// auto-scroll. Pure + dependency-free so it is easy to reason about and test.
// ───────────────────────────────────────────────────────────────────────────

export type LyricToken = {
  /** Original word as written (for display). */
  raw: string;
  /** Normalised form used for matching. */
  norm: string;
  /** Soundex code (phonetic bucket). */
  soundex: string;
  /** Metaphone code (sharper phonetic bucket). */
  metaphone: string;
  /** Line index this word belongs to. */
  line: number;
  /** Global word index. */
  index: number;
};

export function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']/g, "").replace(/'/g, "");
}

/** Classic Soundex — cheap phonetic bucket for mis-hearings (e.g. night/nite). */
export function soundex(word: string): string {
  const s = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  const codes: Record<string, string> = {
    B: "1", F: "1", P: "1", V: "1",
    C: "2", G: "2", J: "2", K: "2", Q: "2", S: "2", X: "2", Z: "2",
    D: "3", T: "3",
    L: "4",
    M: "5", N: "5",
    R: "6",
  };
  const first = s[0];
  let prev = codes[first] ?? "";
  let out = first;
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = codes[s[i]] ?? "";
    if (c && c !== prev) out += c;
    // H and W don't reset the "previous code" rule; vowels do.
    if (s[i] !== "H" && s[i] !== "W") prev = c;
  }
  return (out + "000").slice(0, 4);
}

/**
 * Metaphone (Philips 1990, compact). A sharper phonetic key than Soundex —
 * catches sung mis-hearings Soundex misses (e.g. "fone"/"phone", "rite"/"right").
 */
export function metaphone(input: string): string {
  const w = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (!w) return "";
  const len = w.length;
  const vowel = (c: string) => "AEIOU".includes(c);
  let i = 0;
  let out = "";
  if (/^(AE|GN|KN|PN|WR)/.test(w)) i = 1;
  else if (w[0] === "X") { out = "S"; i = 1; }
  else if (w.startsWith("WH")) { out = "W"; i = 2; }
  while (i < len && out.length < 6) {
    const c = w[i];
    const prev = w[i - 1] || "";
    const next = w[i + 1] || "";
    const next2 = w[i + 2] || "";
    if (c === prev && c !== "C") { i++; continue; }
    switch (c) {
      case "A": case "E": case "I": case "O": case "U": if (i === 0) out += c; break;
      case "B": if (!(i === len - 1 && prev === "M")) out += "B"; break;
      case "C":
        if (next === "I" && next2 === "A") out += "X";
        else if (next === "H") { out += prev === "S" ? "K" : "X"; i++; }
        else if ("IEY".includes(next)) { if (prev !== "S") out += "S"; }
        else out += "K";
        break;
      case "D": if (next === "G" && "IEY".includes(next2)) { out += "J"; i += 2; } else out += "T"; break;
      case "F": out += "F"; break;
      case "G":
        if (next === "H") { i++; }            // gh — treat as silent
        else if (next === "N") { /* gn — silent g */ }
        else if ("IEY".includes(next)) out += "J";
        else out += "K";
        break;
      case "H": if (vowel(prev) && !vowel(next)) { /* silent */ } else if ("CSPTG".includes(prev)) { /* silent */ } else out += "H"; break;
      case "J": out += "J"; break;
      case "K": if (prev !== "C") out += "K"; break;
      case "L": out += "L"; break;
      case "M": out += "M"; break;
      case "N": out += "N"; break;
      case "P": if (next === "H") { out += "F"; i++; } else out += "P"; break;
      case "Q": out += "K"; break;
      case "R": out += "R"; break;
      case "S": if (next === "H") { out += "X"; i++; } else if (next === "I" && (next2 === "O" || next2 === "A")) out += "X"; else out += "S"; break;
      case "T": if (next === "H") { out += "0"; i++; } else if (next === "I" && (next2 === "O" || next2 === "A")) out += "X"; else out += "T"; break;
      case "V": out += "F"; break;
      case "W": case "Y": if (vowel(next)) out += c; break;
      case "X": out += "KS"; break;
      case "Z": out += "S"; break;
    }
    i++;
  }
  return out;
}

/** Levenshtein edit distance (bounded small inputs). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Fuzzy single-word match: exact, small edit distance, or same Soundex. */
export function wordsMatch(heard: string, target: LyricToken): boolean {
  if (!heard || !target.norm) return false;
  if (heard === target.norm) return true;
  const len = Math.max(heard.length, target.norm.length);
  if (len >= 4) {
    const tol = len >= 7 ? 2 : 1;
    if (levenshtein(heard, target.norm) <= tol) return true;
  }
  if (len >= 4) {
    if (soundex(heard) === target.soundex && target.soundex !== "") return true;
    const mh = metaphone(heard);
    if (mh && mh === target.metaphone) return true;
  }
  return false;
}

export function tokenizeLyrics(lyrics: string): { tokens: LyricToken[]; lines: string[] } {
  const lines = lyrics.split(/\r?\n/);
  const tokens: LyricToken[] = [];
  let index = 0;
  lines.forEach((line, lineIdx) => {
    const words = line.match(/[A-Za-z0-9']+/g) ?? [];
    for (const w of words) {
      const norm = normalizeWord(w);
      if (!norm) continue;
      tokens.push({ raw: w, norm, soundex: soundex(norm), metaphone: metaphone(norm), line: lineIdx, index: index++ });
    }
  });
  return { tokens, lines };
}

export type AlignResult = {
  /** Index of the active lyric token (the word currently being sung). */
  tokenIndex: number;
  /** Line of the active token. */
  lineIndex: number;
  /** 0..1 — how strong the latest match was (drives the fallback decision). */
  confidence: number;
  /** True if we found a usable match this round. */
  matched: boolean;
};

const LOOK_AHEAD = 9; // how far forward we search for the next words
const LOOK_BACK = 2; // tolerate small backward nudges (repeated words)
const TAIL = 4; // how many of the most-recent heard words we align

/**
 * Stateful aligner. Feed it each interim transcript; it advances a pointer.
 */
export function createLyricAligner(lyrics: string) {
  const { tokens, lines } = tokenizeLyrics(lyrics);
  let pointer = 0; // index of the NEXT expected token

  const reset = () => { pointer = 0; };

  const process = (transcript: string): AlignResult => {
    const heard = (transcript.match(/[A-Za-z0-9']+/g) ?? []).map(normalizeWord).filter(Boolean);
    if (tokens.length === 0 || heard.length === 0) {
      return { tokenIndex: Math.min(pointer, Math.max(0, tokens.length - 1)), lineIndex: tokens[pointer]?.line ?? 0, confidence: 0, matched: false };
    }
    const tail = heard.slice(-TAIL);

    const from = Math.max(0, pointer - LOOK_BACK);
    const to = Math.min(tokens.length, pointer + LOOK_AHEAD);

    // Slide the heard tail across the window; score by fuzzy word matches and
    // remember the lyric index of the LAST matched heard word.
    let bestScore = 0;
    let bestLastIdx = -1;
    for (let off = from; off < to; off++) {
      let score = 0;
      let lastIdx = -1;
      for (let k = 0; k < tail.length; k++) {
        const ti = off + k;
        if (ti >= tokens.length) break;
        if (wordsMatch(tail[k], tokens[ti])) {
          score++;
          lastIdx = ti;
        }
      }
      // Prefer higher score; tie-break on the furthest forward progress.
      if (score > bestScore || (score === bestScore && lastIdx > bestLastIdx)) {
        bestScore = score;
        bestLastIdx = lastIdx;
      }
    }

    const confidence = Math.min(1, bestScore / Math.max(1, tail.length));

    if (bestScore >= 1 && bestLastIdx >= 0) {
      // Advance to just after the last matched word, clamped so we never leap.
      const next = Math.min(bestLastIdx + 1, pointer + LOOK_AHEAD);
      if (next > pointer || bestLastIdx >= pointer - LOOK_BACK) {
        pointer = Math.max(pointer - LOOK_BACK, Math.min(next, tokens.length - 1));
      }
      const active = Math.min(bestLastIdx, tokens.length - 1);
      return { tokenIndex: active, lineIndex: tokens[active].line, confidence, matched: true };
    }

    const safe = Math.min(pointer, tokens.length - 1);
    return { tokenIndex: safe, lineIndex: tokens[safe]?.line ?? 0, confidence, matched: false };
  };

  return { tokens, lines, reset, process, get pointer() { return pointer; } };
}

// ───────────────────────────────────────────────────────────────────────────
// Strict line-by-line aligner. The active line advances by EXACTLY one (to the
// next non-empty line) when the singer reaches it, and never skips lines or jumps
// backward. This is deliberately conservative — a karaoke-style follow that stays
// readable even when recognition is patchy.
// ───────────────────────────────────────────────────────────────────────────

export type LineKey = { norm: string; sx: string; mp: string };
export type LineAlignResult = {
  lineIndex: number;
  /** Index of the furthest matched word within the active line (-1 = none). */
  wordInLine: number;
  confidence: number;
  matched: boolean;
};

function keyOf(w: string): LineKey {
  const norm = normalizeWord(w);
  return { norm, sx: soundex(norm), mp: metaphone(norm) };
}

function keyMatches(heard: LineKey[], target: LineKey): boolean {
  if (!target.norm) return false;
  for (const h of heard) {
    if (!h.norm) continue;
    if (h.norm === target.norm) return true;
    const len = Math.max(h.norm.length, target.norm.length);
    if (len >= 4) {
      if (levenshtein(h.norm, target.norm) <= (len >= 7 ? 2 : 1)) return true;
      if ((h.sx && h.sx === target.sx) || (h.mp && h.mp === target.mp)) return true;
    }
  }
  return false;
}

export function createLineAligner(lyrics: string) {
  const lines = lyrics.split(/\r?\n/);
  const lineKeys: LineKey[][] = lines.map((l) =>
    (l.match(/[A-Za-z0-9']+/g) ?? []).map(keyOf).filter((k) => k.norm),
  );
  let currentLine = 0;

  const nextNonEmpty = (from: number): number => {
    let i = Math.max(0, from);
    while (i < lineKeys.length - 1 && lineKeys[i].length === 0) i++;
    return Math.min(i, Math.max(0, lines.length - 1));
  };
  // start on the first line that actually has words
  currentLine = nextNonEmpty(0);

  const lineScore = (heard: LineKey[], li: number): number => {
    if (li < 0 || li >= lineKeys.length) return 0;
    const toks = lineKeys[li];
    if (toks.length === 0) return 0;
    let m = 0;
    for (const t of toks) if (keyMatches(heard, t)) m++;
    return m / toks.length;
  };

  const reset = () => { currentLine = nextNonEmpty(0); };
  const setLine = (n: number) => { currentLine = Math.max(0, Math.min(lines.length - 1, n)); };

  const process = (transcript: string): LineAlignResult => {
    const tail = (transcript.match(/[A-Za-z0-9']+/g) ?? []).slice(-8).map(keyOf).filter((k) => k.norm);
    if (tail.length === 0) return { lineIndex: currentLine, wordInLine: -1, confidence: 0, matched: false };

    const next = nextNonEmpty(currentLine + 1);
    const curS = lineScore(tail, currentLine);
    const nextS = lineScore(tail, next);

    // Advance exactly one (non-empty) line when the next line is clearly active.
    if (next > currentLine && nextS > 0 && nextS >= curS) {
      currentLine = next;
    }

    // furthest matched word within the active line (for word-level highlight)
    let wordInLine = -1;
    const toks = lineKeys[currentLine] ?? [];
    for (let i = 0; i < toks.length; i++) if (keyMatches(tail, toks[i])) wordInLine = i;

    return {
      lineIndex: currentLine,
      wordInLine,
      confidence: Math.max(curS, nextS),
      matched: curS > 0 || nextS > 0,
    };
  };

  return { lines, reset, setLine, process, get line() { return currentLine; } };
}
