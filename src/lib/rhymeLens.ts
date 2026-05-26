/**
 * rhymeLens.ts
 * Professional-grade rhyme analysis engine for Verses.
 *
 * Detects: end rhyme, internal rhyme, multisyllabic chains, compound/mosaic
 * rhyme, slant/near rhyme, assonance, consonance, alliteration, repetition,
 * cross-line echoes, rhyme chains, dense pockets, and weak lines.
 *
 * All analysis is local/offline — no external API required.
 * Optional Datamuse enhancement can be layered on top externally.
 *
 * Synthetic test verses (original, not copyrighted):
 *
 * Draft A:
 *   paper sparks a chain reaction
 *   late night brain relaxin
 *   crooked little habit turns to action
 *   half the room is lackin traction
 *
 * Draft B:
 *   cold city, quick step, kick snare
 *   thin air, big stare, slick glare
 *   I bend the line till the light leaks
 *   then climb through the rhyme in my white sneaks
 *
 * Draft C:
 *   silver syllables sit in the center
 *   little brittle rhythms hit in winter
 *   I trace the bass with a patient hand
 *   then place each phrase where the cadence lands
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RhymeType =
  | "end"
  | "internal"
  | "multi"
  | "compound"
  | "mosaic"
  | "slant"
  | "assonance"
  | "consonance"
  | "alliteration"
  | "repetition"
  | "cross"
  | "chain"
  | "dense"
  | "weak";

export type DensityMode = "clean" | "detailed" | "max";

export type RhymeLensOptions = {
  density: DensityMode;
  enabledTypes: Set<RhymeType>;
  strongOnly: boolean;
  maxFamilies?: number;
};

export type PhoneticShape = {
  normalized: string;
  syllableCount: number;
  syllables: string[];
  vowelSkeleton: string;
  consonantSkeleton: string;
  initialConsonantCluster: string;
  finalConsonantCluster: string;
  finalVowelGroup: string;
  finalRhymeNucleus: string;
  endingShape: string;
};

export type RhymeToken = {
  id: string;
  lineIndex: number;
  wordIndex: number;       // index within line
  globalWordIndex: number;
  start: number;           // char offset in full lyric string
  end: number;
  text: string;            // original display text
  normalized: string;
  phonetic: PhoneticShape;
  isLineStart: boolean;
  isLineEnd: boolean;
};

export type RhymeSpan = {
  id: string;
  lineIndex: number;
  startWordIndex: number;
  endWordIndex: number;
  globalStartWordIndex: number;
  globalEndWordIndex: number;
  start: number;
  end: number;
  text: string;
  normalized: string;
  phonetic: PhoneticShape;
  isLineStart: boolean;
  isLineEnd: boolean;
  spanLength: number;       // number of words
};

export type RhymeFamily = {
  id: string;
  type: RhymeType;
  confidence: number;       // 0–1
  colorIndex: number;       // 0–15, stable per family
  label: string;
  explanation: string;
  spans: RhymeSpan[];
  strength: "light" | "medium" | "strong";
  /** Debug info — only populated when RHYME_LENS_DEBUG is true */
  debugInfo?: {
    matchedSpanTexts: string[];
    reason: string;
    anchorSound: string;
  };
};

export type RhymeLensMetrics = {
  rhymeDensity: number;
  endRhymeGroups: number;
  internalRhymeGroups: number;
  multisyllabicChains: number;
  slantGroups: number;
  assonanceGroups: number;
  consonanceGroups: number;
  alliterationGroups: number;
  repetitionCount: number;
  averageRhymesPerLine: number;
  strongestFamilyLength: number;
  weakLineCount: number;
};

export type RhymeLensResult = {
  lines: string[];
  tokens: RhymeToken[];
  spans: RhymeSpan[];
  families: RhymeFamily[];
  weakLines: number[];
  metrics: RhymeLensMetrics;
  capped: boolean;
};

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

export const DEFAULT_OPTIONS: RhymeLensOptions = {
  density: "detailed",
  enabledTypes: new Set<RhymeType>([
    "end", "internal", "multi", "compound", "mosaic",
    "slant", "assonance", "consonance", "alliteration",
    "repetition", "cross", "chain",
  ]),
  strongOnly: false,
  maxFamilies: 60,
};

export const CLEAN_OPTIONS: RhymeLensOptions = {
  density: "clean",
  enabledTypes: new Set<RhymeType>(["end", "internal", "multi", "repetition", "chain"]),
  strongOnly: true,
  maxFamilies: 30,
};

export const MAX_OPTIONS: RhymeLensOptions = {
  density: "max",
  enabledTypes: new Set<RhymeType>([
    "end", "internal", "multi", "compound", "mosaic",
    "slant", "assonance", "consonance", "alliteration",
    "repetition", "cross", "chain", "dense",
  ]),
  strongOnly: false,
  maxFamilies: 120,
};

// ---------------------------------------------------------------------------
// Stop words
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of",
  "with", "by", "from", "up", "about", "into", "through", "after", "is", "are",
  "was", "were", "be", "been", "have", "has", "had", "do", "did", "will",
  "would", "could", "should", "may", "might", "shall", "can", "need", "i",
  "me", "my", "we", "our", "you", "your", "he", "she", "it", "they", "his",
  "her", "its", "their", "this", "that", "these", "those", "not", "no", "so",
  "as", "if", "then", "than", "just", "all", "each", "some", "any",
  "now", "here", "there", "when", "where", "how", "what", "who",
  "very", "too", "also", "only", "still", "even", "ever", "never",
  "out", "off", "over", "under", "again", "once", "much", "more",
  "most", "such", "own", "other", "another", "both", "few", "many",
  "get", "got", "go", "went", "come", "came", "let", "keep", "put",
]);

// ---------------------------------------------------------------------------
// Meaningful span filtering — prevents false positives from filler phrases
// ---------------------------------------------------------------------------

/** Debug mode flag — set to true to attach reason metadata to families */
export const RHYME_LENS_DEBUG = false;

/** Common filler phrases that should never form rhyme families on their own */
const FILLER_PHRASES = new Set([
  "this is", "and now", "i am", "i'm the", "to the", "of the",
  "in the", "and i", "but i", "it is", "that is", "for the",
  "on the", "at the", "with the", "from the", "by the",
  "and the", "or the", "is the", "was the", "are the",
  "i'm a", "it's a", "is a", "was a", "and a",
  "i was", "i will", "i can", "we are", "you are",
  "do you", "did you", "will you", "can you",
  "now i", "now i'm", "so i", "then i",
  "and now i'm", "and now i", "but now i",
]);

export function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word.toLowerCase());
}

/** Contractions and short forms that should be treated as stop words */
const CONTRACTION_STOPS = new Set([
  "i'm", "i'll", "i've", "i'd", "it's", "he's", "she's", "we're",
  "they're", "you're", "we've", "they've", "you've", "won't",
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't",
  "weren't", "can't", "couldn't", "wouldn't", "shouldn't",
  "that's", "there's", "here's", "what's", "who's",
]);

export function isContentWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z']/g, "");
  if (!w || w.length <= 1) return false;
  if (STOP_WORDS.has(w)) return false;
  if (CONTRACTION_STOPS.has(w)) return false;
  return true;
}

export function contentWordCount(span: RhymeSpan): number {
  const words = span.normalized.split(" ");
  return words.filter((w) => isContentWord(w)).length;
}

export function contentRatio(span: RhymeSpan): number {
  const words = span.normalized.split(" ");
  if (words.length === 0) return 0;
  return contentWordCount(span) / words.length;
}

/**
 * Determines if a span is meaningful enough to participate in a rhyme family.
 * Filters out weak/filler spans that cause false positives.
 */
export function isMeaningfulRhymeSpan(span: RhymeSpan, purpose: RhymeType): boolean {
  const words = span.normalized.split(" ");

  // Single-word spans: must be a content word unless exact repetition
  if (span.spanLength === 1) {
    if (purpose === "repetition") return true; // repetition can include any repeated word
    return isContentWord(span.normalized);
  }

  // Multi-word spans: check filler phrases
  const norm = span.normalized.toLowerCase();
  if (FILLER_PHRASES.has(norm)) {
    // Filler phrases only allowed as part of exact repeated phrase (3+ words)
    return purpose === "repetition" && span.spanLength >= 3;
  }

  // Multi-word spans must have at least one content word
  const cCount = words.filter((w) => isContentWord(w)).length;
  if (cCount === 0) return false;

  // For multisyllabic/compound/mosaic: final word should be a content word
  if (purpose === "multi" || purpose === "compound" || purpose === "mosaic") {
    const lastWord = words[words.length - 1];
    if (!isContentWord(lastWord)) return false;
  }

  // Content ratio check for 2+ word spans
  const ratio = cCount / words.length;
  if (ratio < 0.5) {
    // Low content ratio: only allow if:
    // - exact repeated phrase of 3+ words
    // - multisyllabic with content final word (already checked above)
    if (purpose === "repetition" && span.spanLength >= 3) return true;
    if (purpose === "multi" || purpose === "compound" || purpose === "mosaic") return true;
    return false;
  }

  // For slant/assonance/consonance: avoid stop-word-heavy multi-word spans
  if (purpose === "slant" || purpose === "assonance" || purpose === "consonance") {
    if (span.spanLength >= 2 && ratio < 0.6) return false;
  }

  return true;
}

/**
 * Check if a span's final word is a content word (for anchor-based rhyme detection)
 */
function hasContentFinalWord(span: RhymeSpan): boolean {
  const words = span.normalized.split(" ");
  const lastWord = words[words.length - 1];
  return isContentWord(lastWord);
}

// ---------------------------------------------------------------------------
// Normalization + dropped-g / contraction mapping
// ---------------------------------------------------------------------------

const NORM_MAP: Record<string, string> = {
  // dropped-g endings
  relaxin: "relaxing", actin: "acting", rhymin: "rhyming",
  climbin: "climbing", chillin: "chilling", runnin: "running",
  goin: "going", comin: "coming", talkin: "talking",
  walkin: "walking", wakin: "waking", breakin: "breaking",
  shakin: "shaking", makin: "making", takin: "taking",
  lackin: "lacking", crackin: "cracking", stackin: "stacking",
  packin: "packing", trackin: "tracking", atackin: "attacking",
  // contractions / slang
  em: "them", ya: "you", gon: "going",
  wanna: "want", gonna: "going", tryna: "trying",
  // common shortened
  cause: "because", cuz: "because",
};

function normalizeWord(raw: string): string {
  // lowercase, remove leading/trailing punctuation, normalize apostrophes
  const w = raw
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // curly apostrophes → straight
    .replace(/^[^a-z']+/, "")
    .replace(/[^a-z']+$/, "")
    .replace(/'+$/, "")
    .replace(/^'+/, "");

  // Dropped-g shorthand: word ending in in' (no apostrophe) → check map
  const mapped = NORM_MAP[w];
  if (mapped) return mapped;

  // in' suffix → ing (only for obvious dropped-g: endin', killin', etc.)
  if (w.endsWith("in'")) {
    const stem = w.slice(0, -3);
    if (stem.length >= 2) {
      const candidate = stem + "ing";
      if (!STOP_WORDS.has(candidate)) return candidate;
    }
  }
  // Bare "in" ending only if the stem ends in a consonant (avoids "cabin", "satin", etc.)
  if (w.endsWith("in") && !w.endsWith("ain") && !w.endsWith("tion") && w.length >= 5) {
    const stem = w.slice(0, -2);
    const lastChar = stem[stem.length - 1];
    // Only expand if stem ends in a doubled consonant or common pattern
    if (lastChar && !/[aeiou]/.test(lastChar) && NORM_MAP[w] === undefined) {
      // Check if it looks like a dropped-g word (e.g., "relaxin", "lackin")
      const beforeLast = stem[stem.length - 2];
      if (beforeLast && /[aeiou]/.test(beforeLast)) {
        const candidate = stem + "ing";
        return candidate;
      }
    }
  }

  return w;
}

// ---------------------------------------------------------------------------
// Phonetic approximation engine
// ---------------------------------------------------------------------------

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

function isVowel(ch: string): boolean {
  return VOWELS.has(ch);
}

// Map common spelling patterns to normalized phonetic form
function applyPhoneticMappings(s: string): string {
  let r = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kw")
    .replace(/x/g, "ks")
    .replace(/gh(?=[aeiou])/g, "g")     // gh before vowel = g
    .replace(/gh/g, "")                  // silent gh at end
    .replace(/ea(?=[dklmnprst]|$)/g, "ee") // ea → ee before common consonants or word-end (sea, beat, clean, read)
    .replace(/tion/g, "shun")
    .replace(/sion/g, "zhun")
    .replace(/tch/g, "ch")
    .replace(/dge/g, "j");

  // Silent final e — only strip when there's still a vowel left in the stem
  // Don't strip from double-vowel endings (free, see, tree) or when it
  // would leave zero vowels (cycle → keep the e as the syllable nucleus)
  if (r.length >= 3 && r.endsWith("e")) {
    const beforeE = r.slice(0, -1);
    const hasVowelInStem = /[aeiou]/.test(beforeE);
    // Keep the e if: (1) stem has no other vowel, or (2) preceding char is also a vowel (ee, oe, etc.)
    if (hasVowelInStem && !/[aeiou]$/.test(beforeE)) {
      r = beforeE; // true silent e: name→nam, place→plac, cycle→cycl... but check below
    }
    // For words like "cycle", "brittle" — the le/re ending carries a vowel sound
    // Re-check: if stripping e left no vowel in the final syllable, restore it
    if (r === beforeE) {
      const finalCluster = r.match(/[^aeiou]+$/)?.[0] ?? "";
      if (finalCluster.length >= 2 && /l$/.test(finalCluster)) {
        // -cle, -tle, -ble, -ple, -dle, -gle → restore e (syllabic l)
        r = r + "e";
      }
    }
  }

  r = r
    .replace(/er$/g, "r")               // final er → r-colored
    .replace(/ur$/g, "r")
    .replace(/ir$/g, "r")
    .replace(/ing$/g, "ing")
    .replace(/([a-z])\1+/g, "$1");      // collapse doubled letters

  return r;
}

function extractVowelSkeleton(s: string): string {
  return s.split("").filter(isVowel).join("");
}

function extractConsonantSkeleton(s: string): string {
  return s.split("").filter((c) => /[a-z]/.test(c) && !isVowel(c)).join("");
}

function getInitialCluster(s: string): string {
  let i = 0;
  while (i < s.length && !isVowel(s[i])) i++;
  return s.slice(0, i);
}

function getFinalCluster(s: string): string {
  let i = s.length - 1;
  while (i >= 0 && !isVowel(s[i])) i--;
  return s.slice(i + 1);
}

function getFinalVowelGroup(s: string): string {
  // Find the last vowel cluster + trailing consonants
  const match = s.match(/[aeiou]+[^aeiou]*$/);
  return match ? match[0] : "";
}

function estimateSyllableCount(normalized: string): number {
  // Count vowel groups as syllable nuclei
  const groups = normalized.match(/[aeiou]+/g);
  const count = groups ? groups.length : 1;
  return Math.max(1, count);
}

function splitIntoSyllables(normalized: string): string[] {
  // Rough syllable splitting: split at consonant clusters between vowel groups
  const chunks: string[] = [];
  let current = "";
  let inVowel = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const v = isVowel(ch);
    if (v !== inVowel && current.length > 0) {
      if (!v && inVowel) {
        // Just entered consonant zone — keep going, split before next vowel
        current += ch;
        inVowel = false;
        continue;
      }
      if (v && !inVowel && current.length > 1) {
        // Split: push all but last consonant, start new syllable
        chunks.push(current);
        current = ch;
        inVowel = true;
        continue;
      }
    }
    current += ch;
    inVowel = v;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [normalized];
}

// Cache phonetic shapes for performance
const phoneticCache = new Map<string, PhoneticShape>();

export function computePhoneticShape(normalized: string): PhoneticShape {
  const cached = phoneticCache.get(normalized);
  if (cached) return cached;

  const phonetic = applyPhoneticMappings(normalized);
  const vowelSkeleton = extractVowelSkeleton(phonetic);
  const consonantSkeleton = extractConsonantSkeleton(phonetic);
  const initialConsonantCluster = getInitialCluster(phonetic);
  const finalConsonantCluster = getFinalCluster(phonetic);
  const finalVowelGroup = getFinalVowelGroup(phonetic);
  // Count syllables from the original word — phonetic mapping (er→r etc.)
  // can collapse vowels and undercount (e.g. "center" → "centr" = 1 vowel)
  const syllableCount = Math.max(estimateSyllableCount(phonetic), estimateSyllableCount(normalized));
  const syllables = splitIntoSyllables(phonetic);

  // Final rhyme nucleus = final vowel group + any trailing consonants
  const finalRhymeNucleus = finalVowelGroup || phonetic.slice(-2);

  // Ending shape: last 3–5 chars of phonetic form (for slant matching)
  const endingShape = phonetic.length >= 4 ? phonetic.slice(-4) : phonetic;

  const shape: PhoneticShape = {
    normalized,
    syllableCount,
    syllables,
    vowelSkeleton,
    consonantSkeleton,
    initialConsonantCluster,
    finalConsonantCluster,
    finalVowelGroup,
    finalRhymeNucleus,
    endingShape,
  };
  phoneticCache.set(normalized, shape);
  return shape;
}

// ---------------------------------------------------------------------------
// Span phonetic shape (multi-word)
// ---------------------------------------------------------------------------

function computeSpanPhoneticShape(words: string[]): PhoneticShape {
  // For phrase spans, compute phonetic based on the last word primarily
  // but also include multi-word vowel skeleton for assonance
  const lastWord = words[words.length - 1];
  const lastShape = computePhoneticShape(lastWord);
  const allNorm = words.join(" ");
  const combined = words.map(applyPhoneticMappings).join(" ");
  const vowelSkeleton = extractVowelSkeleton(combined.replace(/ /g, ""));
  const syllableCount = words.reduce(
    (acc, w) => acc + computePhoneticShape(w).syllableCount,
    0
  );
  return {
    normalized: allNorm,
    syllableCount,
    syllables: lastShape.syllables,
    vowelSkeleton,
    consonantSkeleton: extractConsonantSkeleton(combined.replace(/ /g, "")),
    initialConsonantCluster: computePhoneticShape(words[0]).initialConsonantCluster,
    finalConsonantCluster: lastShape.finalConsonantCluster,
    finalVowelGroup: lastShape.finalVowelGroup,
    finalRhymeNucleus: lastShape.finalRhymeNucleus,
    endingShape: lastShape.endingShape,
  };
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _ScoreResult = {
  score: number;
  type: RhymeType;
  label: string;
};

function scoreEndRhyme(a: PhoneticShape, b: PhoneticShape): number {
  if (a.normalized === b.normalized) return 0; // repetition, handled elsewhere
  let score = 0;

  // Perfect nucleus match
  if (a.finalRhymeNucleus && b.finalRhymeNucleus && a.finalRhymeNucleus === b.finalRhymeNucleus) {
    score += 0.7;
  }
  // Ending shape match (last 4 phonetic chars)
  if (a.endingShape === b.endingShape && a.endingShape.length >= 3) {
    score += 0.3;
  }
  // Final vowel group match
  if (a.finalVowelGroup && b.finalVowelGroup && a.finalVowelGroup === b.finalVowelGroup) {
    score += 0.2;
  }
  // Final consonant cluster match
  if (a.finalConsonantCluster && b.finalConsonantCluster && a.finalConsonantCluster === b.finalConsonantCluster) {
    score += 0.15;
  }
  // Near-rhyme bonus: endings differ only in vowel (center/winter, ember/timber)
  // Same final consonant cluster + similar ending shape length + both multisyllabic
  if (score < 0.4 && a.finalConsonantCluster && b.finalConsonantCluster &&
      a.finalConsonantCluster === b.finalConsonantCluster &&
      a.finalConsonantCluster.length >= 2 &&
      a.syllableCount >= 2 && b.syllableCount >= 2) {
    // Check if ending shapes match after stripping the vowel portion
    const stripVowel = (s: string) => s.replace(/^[aeiou]+/, "");
    if (stripVowel(a.endingShape) === stripVowel(b.endingShape) && stripVowel(a.endingShape).length >= 2) {
      score += 0.55; // strong near-rhyme
    }
  }
  // Multi-syllabic bonus — ONLY when there's a meaningful phonetic match
  // (requires at least a vowel match, not just a consonant cluster)
  if (score >= 0.4) {
    const minSyl = Math.min(a.syllableCount, b.syllableCount);
    if (minSyl >= 2) score += 0.15 * Math.min(minSyl - 1, 2);
  }

  return Math.min(score, 1);
}

function scoreSlantRhyme(a: PhoneticShape, b: PhoneticShape): number {
  if (a.normalized === b.normalized) return 0;
  let score = 0;

  // Partial vowel skeleton overlap
  const vA = a.vowelSkeleton;
  const vB = b.vowelSkeleton;
  if (vA && vB) {
    const shorter = vA.length < vB.length ? vA : vB;
    const longer = vA.length < vB.length ? vB : vA;
    const lastN = Math.min(shorter.length, 2);
    if (longer.slice(-lastN) === shorter.slice(-lastN) && lastN >= 1) {
      score += 0.3;
    }
  }
  // Similar final consonant
  if (a.finalConsonantCluster && b.finalConsonantCluster) {
    if (a.finalConsonantCluster[0] === b.finalConsonantCluster[0]) score += 0.2;
  }
  // Ending shape partial match (last 2-3 chars)
  const endA3 = a.endingShape.slice(-3);
  const endB3 = b.endingShape.slice(-3);
  if (endA3 === endB3 && endA3.length >= 2) score += 0.25;
  // Different from perfect rhyme (these should have lower score)
  if (scoreEndRhyme(a, b) > 0.6) return 0; // strong rhyme, not slant

  return Math.min(score, 0.7);
}

function scoreAssonance(a: PhoneticShape, b: PhoneticShape): number {
  if (a.normalized === b.normalized) return 0;
  const vA = a.vowelSkeleton;
  const vB = b.vowelSkeleton;
  if (!vA || !vB || vA.length < 1 || vB.length < 1) return 0;
  // Match last 2 vowels or vowel group
  const vAe = vA.slice(-2);
  const vBe = vB.slice(-2);
  if (vAe === vBe && vAe.length >= 1) {
    return 0.4 + (vAe.length >= 2 ? 0.2 : 0);
  }
  // Single final vowel match
  if (vA[vA.length - 1] === vB[vB.length - 1]) return 0.25;
  return 0;
}

function scoreConsonance(a: PhoneticShape, b: PhoneticShape): number {
  if (a.normalized === b.normalized) return 0;
  const cA = a.consonantSkeleton;
  const cB = b.consonantSkeleton;
  if (!cA || !cB || cA.length < 1 || cB.length < 1) return 0;
  // Final consonant cluster match
  if (a.finalConsonantCluster && b.finalConsonantCluster &&
      a.finalConsonantCluster === b.finalConsonantCluster &&
      a.finalConsonantCluster.length >= 1) {
    return 0.5 + (a.finalConsonantCluster.length >= 2 ? 0.2 : 0);
  }
  // Partial final consonant match
  if (cA[cA.length - 1] === cB[cB.length - 1]) return 0.25;
  return 0;
}

function scoreAlliteration(a: PhoneticShape, b: PhoneticShape): number {
  if (!a.initialConsonantCluster || !b.initialConsonantCluster) return 0;
  if (a.initialConsonantCluster === b.initialConsonantCluster && a.initialConsonantCluster.length >= 1) {
    return 0.7 + (a.initialConsonantCluster.length >= 2 ? 0.2 : 0);
  }
  if (a.initialConsonantCluster[0] === b.initialConsonantCluster[0]) return 0.4;
  return 0;
}

function scoreMultisyllabic(a: PhoneticShape, b: PhoneticShape, spanLengthA: number, spanLengthB: number): number {
  if (a.normalized === b.normalized) return 0;
  const minSpan = Math.min(spanLengthA, spanLengthB);
  if (minSpan < 2) return 0;
  const minSyl = Math.min(a.syllableCount, b.syllableCount);
  if (minSyl < 2) return 0;

  // Base: end rhyme score
  const endScore = scoreEndRhyme(a, b);
  if (endScore < 0.3) return 0;

  // Multi bonus: more syllables = stronger
  const multiBonus = 0.15 * Math.min(minSyl - 1, 3);
  // Span bonus
  const spanBonus = 0.1 * Math.min(minSpan - 1, 2);

  return Math.min(endScore + multiBonus + spanBonus, 1);
}

// ---------------------------------------------------------------------------
// Tokenizer — preserves char offsets
// ---------------------------------------------------------------------------

const wordRegex = /[a-zA-Z\u2018\u2019'']+(?:'[a-zA-Z]+)*/g;

function tokenizeLyrics(lyrics: string): RhymeToken[] {
  const lines = lyrics.split("\n");
  const tokens: RhymeToken[] = [];
  let globalWordIndex = 0;
  let charOffset = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineWords: { text: string; start: number; end: number }[] = [];

    let match: RegExpExecArray | null;
    wordRegex.lastIndex = 0;
    while ((match = wordRegex.exec(line)) !== null) {
      lineWords.push({
        text: match[0],
        start: charOffset + match.index,
        end: charOffset + match.index + match[0].length,
      });
    }

    for (let wordIndex = 0; wordIndex < lineWords.length; wordIndex++) {
      const { text, start, end } = lineWords[wordIndex];
      const normalized = normalizeWord(text);
      if (!normalized) { globalWordIndex++; continue; }
      const phonetic = computePhoneticShape(normalized);
      tokens.push({
        id: `t_${lineIndex}_${wordIndex}`,
        lineIndex,
        wordIndex,
        globalWordIndex,
        start,
        end,
        text,
        normalized,
        phonetic,
        isLineStart: wordIndex === 0,
        isLineEnd: wordIndex === lineWords.length - 1,
      });
      globalWordIndex++;
    }

    charOffset += line.length + 1; // +1 for the \n
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Build spans: 1-word, 2-word, 3-word windows per line
// ---------------------------------------------------------------------------

function buildSpans(tokens: RhymeToken[], maxSpan: number): RhymeSpan[] {
  const byLine = new Map<number, RhymeToken[]>();
  for (const t of tokens) {
    if (!byLine.has(t.lineIndex)) byLine.set(t.lineIndex, []);
    byLine.get(t.lineIndex)!.push(t);
  }

  const spans: RhymeSpan[] = [];
  let spanIdx = 0;

  for (const [lineIndex, lineTokens] of byLine) {
    for (let i = 0; i < lineTokens.length; i++) {
      for (let len = 1; len <= Math.min(maxSpan, lineTokens.length - i); len++) {
        const slice = lineTokens.slice(i, i + len);
        const words = slice.map((t) => t.normalized);
        const texts = slice.map((t) => t.text);
        const phonetic = len === 1
          ? slice[0].phonetic
          : computeSpanPhoneticShape(words);

        spans.push({
          id: `s_${spanIdx++}`,
          lineIndex,
          startWordIndex: slice[0].wordIndex,
          endWordIndex: slice[slice.length - 1].wordIndex,
          globalStartWordIndex: slice[0].globalWordIndex,
          globalEndWordIndex: slice[slice.length - 1].globalWordIndex,
          start: slice[0].start,
          end: slice[slice.length - 1].end,
          text: texts.join(" "),
          normalized: words.join(" "),
          phonetic,
          isLineStart: slice[0].isLineStart,
          isLineEnd: slice[slice.length - 1].isLineEnd,
          spanLength: len,
        });
      }
    }
  }

  return spans;
}

// ---------------------------------------------------------------------------
// Span overlap check — used to prevent sub-word double-highlighting
// ---------------------------------------------------------------------------

function spansOverlap(a: RhymeSpan, b: RhymeSpan): boolean {
  if (a.lineIndex !== b.lineIndex) return false;
  return a.startWordIndex <= b.endWordIndex && b.startWordIndex <= a.endWordIndex;
}

// ---------------------------------------------------------------------------
// Family ID generator
// ---------------------------------------------------------------------------

let familyCounter = 0;
function nextFamilyId(): string {
  return `fam_${familyCounter++}`;
}

// ---------------------------------------------------------------------------
// Color assignment — stable hash
// ---------------------------------------------------------------------------

const COLOR_COUNT = 16;

function stableColorIndex(_label: string, existingIndices: Set<number>): number {
  // Sequential assignment: pick the first unused color index
  // This guarantees maximum color diversity across families
  for (let idx = 0; idx < COLOR_COUNT; idx++) {
    if (!existingIndices.has(idx)) return idx;
  }
  // All 16 used — wrap around, pick least-recently-used
  const offset = existingIndices.size % COLOR_COUNT;
  return offset;
}

// ---------------------------------------------------------------------------
// Label generators
// ---------------------------------------------------------------------------

function endRhymeLabel(spans: RhymeSpan[]): string {
  const endings = spans.map((s) => {
    const ph = s.phonetic;
    return ph.finalRhymeNucleus || ph.endingShape;
  });
  const common = mostCommon(endings);
  return common ? `-${common} ending` : "end rhyme";
}

function assonanceLabel(spans: RhymeSpan[]): string {
  const vowels = spans.map((s) => s.phonetic.vowelSkeleton.slice(-2));
  const common = mostCommon(vowels);
  return common ? `${common.toUpperCase()} vowel chain` : "assonance";
}

function consonanceLabel(spans: RhymeSpan[]): string {
  const cons = spans.map((s) => s.phonetic.finalConsonantCluster || s.phonetic.consonantSkeleton.slice(-1));
  const common = mostCommon(cons);
  return common ? `${common.toUpperCase()} consonance` : "consonance";
}

function alliterationLabel(spans: RhymeSpan[]): string {
  const initials = spans.map((s) => s.phonetic.initialConsonantCluster);
  const common = mostCommon(initials);
  return common ? `${common.toUpperCase()} alliteration` : "alliteration";
}

function mostCommon(arr: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of arr) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best || null;
}

function multiLabel(spans: RhymeSpan[]): string {
  const maxLen = Math.max(...spans.map((s) => s.spanLength));
  const ending = spans[0].phonetic.finalRhymeNucleus || spans[0].phonetic.endingShape;
  return maxLen >= 3 ? `${maxLen}-word multi (${ending})` : `multi (${ending})`;
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

export function analyzeRhymeLens(
  lyrics: string,
  options: RhymeLensOptions = DEFAULT_OPTIONS
): RhymeLensResult {
  familyCounter = 0;
  phoneticCache.clear();

  const rawLines = lyrics.split("\n");
  const nonEmpty = rawLines.filter((l) => l.trim()).length;

  // Performance cap: limit span comparisons for very long drafts
  const WORD_CAP = 400;
  const MAX_SPAN = options.density === "max" ? 3 : options.density === "detailed" ? 3 : 2;
  let capped = false;

  const tokens = tokenizeLyrics(lyrics);
  if (tokens.length > WORD_CAP) capped = true;
  const cappedTokens = capped ? tokens.slice(0, WORD_CAP) : tokens;

  const allSpans = buildSpans(cappedTokens, MAX_SPAN);

  // Threshold by density
  const thresholds = {
    endRhyme:     options.density === "clean" ? 0.65 : options.density === "detailed" ? 0.50 : 0.40,
    multi:        options.density === "clean" ? 0.65 : options.density === "detailed" ? 0.55 : 0.45,
    slant:        options.density === "clean" ? 0.55 : options.density === "detailed" ? 0.40 : 0.28,
    assonance:    options.density === "clean" ? 0.60 : options.density === "detailed" ? 0.45 : 0.30,
    consonance:   options.density === "clean" ? 0.60 : options.density === "detailed" ? 0.45 : 0.30,
    alliteration: options.density === "clean" ? 0.65 : options.density === "detailed" ? 0.50 : 0.40,
  };

  const maxDistanceLines = options.density === "clean" ? 6 : options.density === "detailed" ? 12 : 20;

  // ── Step 1: Repetition detection ─────────────────────────────────────────
  // Prefer longest repeated phrases; suppress smaller overlapping subphrases.
  // First detect full-line repetition, then span-based repetition.
  const families: RhymeFamily[] = [];
  const usedColorIndices = new Set<number>();

  // Track which lines+word ranges are covered by a repetition family
  const coveredRepRanges = new Set<string>();

  if (options.enabledTypes.has("repetition")) {
    // --- Phase 1a: Full-line repetition ---
    // Detect lines that repeat exactly (normalized). These take priority.
    const lineNormMap = new Map<string, { lineIndex: number; tokens: RhymeToken[] }[]>();
    const byLine = new Map<number, RhymeToken[]>();
    for (const t of cappedTokens) {
      if (!byLine.has(t.lineIndex)) byLine.set(t.lineIndex, []);
      byLine.get(t.lineIndex)!.push(t);
    }
    for (const [lineIdx, lineTokens] of byLine) {
      if (lineTokens.length < 2) continue; // skip single-word lines for full-line rep
      const norm = lineTokens.map((t) => t.normalized).join(" ");
      // Only count lines with at least one content word
      if (!lineTokens.some((t) => isContentWord(t.normalized))) continue;
      if (!lineNormMap.has(norm)) lineNormMap.set(norm, []);
      lineNormMap.get(norm)!.push({ lineIndex: lineIdx, tokens: lineTokens });
    }

    for (const [norm, occurrences] of lineNormMap) {
      if (occurrences.length < 2) continue;
      // Build a span for each full-line occurrence
      const lineSpans: RhymeSpan[] = occurrences.map((occ) => {
        const first = occ.tokens[0];
        const last = occ.tokens[occ.tokens.length - 1];
        return {
          id: `rep_line_${occ.lineIndex}`,
          lineIndex: occ.lineIndex,
          startWordIndex: first.wordIndex,
          endWordIndex: last.wordIndex,
          globalStartWordIndex: first.globalWordIndex,
          globalEndWordIndex: last.globalWordIndex,
          start: first.start,
          end: last.end,
          text: occ.tokens.map((t) => t.text).join(" "),
          normalized: norm,
          phonetic: computeSpanPhoneticShape(occ.tokens.map((t) => t.normalized)),
          isLineStart: true,
          isLineEnd: true,
          spanLength: occ.tokens.length,
        };
      });

      // Mark covered ranges
      for (const s of lineSpans) {
        coveredRepRanges.add(`${s.lineIndex}:${s.startWordIndex}-${s.endWordIndex}`);
      }

      const colorIdx = stableColorIndex("rep_" + norm, usedColorIndices);
      usedColorIndices.add(colorIdx);
      families.push({
        id: nextFamilyId(),
        type: "repetition",
        confidence: 1.0,
        colorIndex: colorIdx,
        label: `repeated line: "${norm.length > 30 ? norm.slice(0, 30) + "..." : norm}"`,
        explanation: `Full line "${norm}" repeats ${occurrences.length} times`,
        spans: lineSpans,
        strength: occurrences.length >= 3 ? "strong" : "medium",
      });
    }

    // --- Phase 1b: Span-based repetition (1–3 word phrases) ---
    const phraseMap = new Map<string, RhymeSpan[]>();
    for (const span of allSpans) {
      if (span.spanLength > 3) continue;
      const norm = span.normalized;
      if (!norm) continue;
      // Filter: must pass meaningful check for repetition
      if (!isMeaningfulRhymeSpan(span, "repetition")) continue;
      if (!phraseMap.has(norm)) phraseMap.set(norm, []);
      phraseMap.get(norm)!.push(span);
    }

    // Sort by phrase length descending — longer phrases take priority
    const sortedPhrases = Array.from(phraseMap.entries())
      .filter(([, spans]) => spans.length >= 2)
      .sort((a, b) => {
        const lenA = a[0].split(" ").length;
        const lenB = b[0].split(" ").length;
        return lenB - lenA; // prefer longer phrases
      });

    for (const [norm, spans] of sortedPhrases) {
      // Only keep one representative span per line — prefer longer span
      const byLineRep = new Map<number, RhymeSpan>();
      for (const s of spans) {
        // Check if this span's range is already covered by a longer phrase
        let alreadyCovered = false;
        for (const existing of coveredRepRanges) {
          if (existing.startsWith(`${s.lineIndex}:`)) {
            const [, range] = existing.split(":");
            const [es, ee] = range.split("-").map(Number);
            if (s.startWordIndex >= es && s.endWordIndex <= ee) {
              alreadyCovered = true;
              break;
            }
          }
        }
        if (alreadyCovered) continue;

        if (!byLineRep.has(s.lineIndex) || s.spanLength > byLineRep.get(s.lineIndex)!.spanLength) {
          byLineRep.set(s.lineIndex, s);
        }
      }
      const deduped = Array.from(byLineRep.values());
      if (deduped.length < 2) continue;

      // For single-word repetition: only highlight if it's a content word or appears 3+ times
      if (norm.split(" ").length === 1) {
        if (!isContentWord(norm) && deduped.length < 3) continue;
      }

      // Skip filler phrases that are already covered by full-line repetition
      const normWords = norm.split(" ");
      if (normWords.length <= 3 && normWords.every((w) => !isContentWord(w))) continue;

      // Mark these ranges as covered
      for (const s of deduped) {
        coveredRepRanges.add(`${s.lineIndex}:${s.startWordIndex}-${s.endWordIndex}`);
      }

      const colorIdx = stableColorIndex("rep_" + norm, usedColorIndices);
      usedColorIndices.add(colorIdx);
      families.push({
        id: nextFamilyId(),
        type: "repetition",
        confidence: 1.0,
        colorIndex: colorIdx,
        label: `repeated: "${norm}"`,
        explanation: `"${norm}" appears ${deduped.length} times — possible hook or motif`,
        spans: deduped,
        strength: deduped.length >= 3 ? "strong" : "medium",
      });
    }
  }

  // Track which spans are already in a strong family to prevent redundant highlighting
  const spanInStrongFamily = new Set<string>();

  // ── Step 2: Multisyllabic families ───────────────────────────────────────
  if (options.enabledTypes.has("multi") || options.enabledTypes.has("compound")) {
    // FILTER: Only allow multi-word spans with meaningful content words.
    // Require at least 2 content words to prevent single-content-word spans
    // from being treated as multi-syllabic phrases.
    const multiCandidates = allSpans.filter((s) => {
      if (s.spanLength < 2) return false;
      if (s.phonetic.syllableCount < 3) return false; // need real multi-syllabic content
      if (!isMeaningfulRhymeSpan(s, "multi")) return false;
      if (!hasContentFinalWord(s)) return false;
      // At least 2 content words in the span
      const words = s.normalized.split(" ");
      const cCount = words.filter((w) => isContentWord(w)).length;
      if (cCount < 2) return false;
      return true;
    });

    // Group by phonetic similarity
    const processed = new Set<string>();
    for (let i = 0; i < multiCandidates.length; i++) {
      const a = multiCandidates[i];
      if (processed.has(a.id)) continue;
      const group: RhymeSpan[] = [a];

      for (let j = i + 1; j < multiCandidates.length; j++) {
        const b = multiCandidates[j];
        if (processed.has(b.id)) continue;
        if (a.lineIndex === b.lineIndex && spansOverlap(a, b)) continue;
        const lineDist = Math.abs(a.lineIndex - b.lineIndex);
        if (lineDist > maxDistanceLines) continue;
        if (a.normalized === b.normalized) continue; // repetition

        const score = scoreMultisyllabic(a.phonetic, b.phonetic, a.spanLength, b.spanLength);
        if (score >= thresholds.multi) {
          group.push(b);
          processed.add(b.id);
        }
      }

      if (group.length >= 2) {
        processed.add(a.id);
        // Deduplicate by line — prefer longer span
        const byLine = new Map<number, RhymeSpan>();
        for (const s of group) {
          if (!byLine.has(s.lineIndex) || s.spanLength > byLine.get(s.lineIndex)!.spanLength) {
            byLine.set(s.lineIndex, s);
          }
        }
        const deduped = Array.from(byLine.values());
        if (deduped.length < 2) continue;
        const maxSyl = Math.max(...deduped.map((s) => s.phonetic.syllableCount));
        const label = multiLabel(deduped);
        const colorIdx = stableColorIndex("multi_" + label, usedColorIndices);
        usedColorIndices.add(colorIdx);
        const avgScore = deduped.reduce((acc) => acc + 0.8, 0) / deduped.length;
        families.push({
          id: nextFamilyId(),
          type: "multi",
          confidence: Math.min(avgScore, 1),
          colorIndex: colorIdx,
          label,
          explanation: `Multisyllabic rhyme chain — ${deduped.length} spans, ${maxSyl} syllables`,
          spans: deduped,
          strength: maxSyl >= 3 ? "strong" : "medium",
        });
        for (const s of deduped) spanInStrongFamily.add(s.id);
      }
    }
  }

  // ── Step 3: End rhyme families ────────────────────────────────────────────
  if (options.enabledTypes.has("end")) {
    // Only line-ending single words
    const endSpans = allSpans.filter((s) => s.isLineEnd && s.spanLength === 1 && !STOP_WORDS.has(s.normalized));
    const processed = new Set<string>();

    for (let i = 0; i < endSpans.length; i++) {
      const a = endSpans[i];
      if (processed.has(a.id)) continue;
      const group: RhymeSpan[] = [a];

      for (let j = i + 1; j < endSpans.length; j++) {
        const b = endSpans[j];
        if (processed.has(b.id)) continue;
        if (a.normalized === b.normalized) continue; // covered by repetition
        const lineDist = Math.abs(a.lineIndex - b.lineIndex);
        if (lineDist > maxDistanceLines) continue;

        const score = scoreEndRhyme(a.phonetic, b.phonetic);
        if (score >= thresholds.endRhyme) {
          group.push(b);
          processed.add(b.id);
        }
      }

      if (group.length >= 2) {
        processed.add(a.id);
        const label = endRhymeLabel(group);
        const colorIdx = stableColorIndex("end_" + label, usedColorIndices);
        usedColorIndices.add(colorIdx);
        const avgScore = group.reduce((acc, s) => {
          const partner = group.find((x) => x.id !== s.id);
          return acc + (partner ? scoreEndRhyme(s.phonetic, partner.phonetic) : 0.7);
        }, 0) / group.length;
        const isChain = group.length >= 3;
        families.push({
          id: nextFamilyId(),
          type: isChain ? "chain" : "end",
          confidence: Math.min(avgScore + 0.1, 1),
          colorIndex: colorIdx,
          label,
          explanation: isChain
            ? `Rhyme chain — ${group.length} lines share the same ending sound`
            : `End rhyme — lines ${group.map((s) => s.lineIndex + 1).join(" & ")} share ending sound`,
          spans: group,
          strength: avgScore >= 0.7 ? "strong" : avgScore >= 0.5 ? "medium" : "light",
        });
        for (const s of group) spanInStrongFamily.add(s.id);
      }
    }
  }

  // ── Step 4: Internal rhyme families ──────────────────────────────────────
  if (options.enabledTypes.has("internal")) {
    // Words that are NOT line-ending (internal), single words, non-stop
    const internalSpans = allSpans.filter(
      (s) => s.spanLength === 1 && !s.isLineEnd && !STOP_WORDS.has(s.normalized) && s.normalized.length > 2
    );
    // Also allow internal vs end-word cross-matching
    const endSpansSingle = allSpans.filter((s) => s.isLineEnd && s.spanLength === 1 && !STOP_WORDS.has(s.normalized));
    const allIntCandidates = [...internalSpans, ...endSpansSingle];

    const processed = new Set<string>();

    for (let i = 0; i < allIntCandidates.length; i++) {
      const a = allIntCandidates[i];
      if (processed.has(a.id)) continue;
      const group: RhymeSpan[] = [];

      for (let j = 0; j < allIntCandidates.length; j++) {
        if (i === j) continue;
        const b = allIntCandidates[j];
        if (processed.has(b.id) && b.id !== a.id) continue;
        if (a.lineIndex === b.lineIndex && spansOverlap(a, b)) continue;
        if (a.normalized === b.normalized) continue; // repetition
        const lineDist = Math.abs(a.lineIndex - b.lineIndex);
        if (lineDist > Math.min(maxDistanceLines, 4)) continue; // internal rhymes are local

        const score = scoreEndRhyme(a.phonetic, b.phonetic);
        if (score >= thresholds.endRhyme) {
          if (!group.find((x) => x.id === a.id)) group.push(a);
          if (!group.find((x) => x.id === b.id)) group.push(b);
        }
      }

      if (group.length >= 2) {
        for (const s of group) processed.add(s.id);
        // Classify as cross-line if spans come from different lines
        const lineSet = new Set(group.map((s) => s.lineIndex));
        const type: RhymeType = lineSet.size > 1
          ? (group.some((s) => s.isLineEnd) && group.some((s) => !s.isLineEnd) ? "cross" : "internal")
          : "internal";
        if (type === "cross" && !options.enabledTypes.has("cross")) continue;
        if (type === "internal" && !options.enabledTypes.has("internal")) continue;

        const label = endRhymeLabel(group);
        const colorIdx = stableColorIndex("int_" + label, usedColorIndices);
        usedColorIndices.add(colorIdx);
        families.push({
          id: nextFamilyId(),
          type,
          confidence: 0.75,
          colorIndex: colorIdx,
          label: type === "cross" ? `cross-line echo (${label})` : `internal (${label})`,
          explanation: type === "cross"
            ? "Internal word echoes a line ending from a nearby line"
            : "Internal rhyme — matching sounds within or across nearby lines",
          spans: group,
          strength: "medium",
        });
        for (const s of group) spanInStrongFamily.add(s.id);
      }
    }
  }

  // ── Step 5: Slant rhyme ───────────────────────────────────────────────────
  if (options.enabledTypes.has("slant") && options.density !== "clean") {
    const candidates = allSpans.filter(
      (s) => s.spanLength === 1 && !STOP_WORDS.has(s.normalized) &&
             s.normalized.length > 2 && !spanInStrongFamily.has(s.id)
    );
    const processed = new Set<string>();

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (processed.has(a.id)) continue;
      const group: RhymeSpan[] = [];

      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (processed.has(b.id)) continue;
        if (a.lineIndex === b.lineIndex && spansOverlap(a, b)) continue;
        if (a.normalized === b.normalized) continue;
        const lineDist = Math.abs(a.lineIndex - b.lineIndex);
        if (lineDist > maxDistanceLines) continue;

        const score = scoreSlantRhyme(a.phonetic, b.phonetic);
        if (score >= thresholds.slant) {
          if (!group.find((x) => x.id === a.id)) group.push(a);
          if (!group.find((x) => x.id === b.id)) group.push(b);
        }
      }

      if (group.length >= 2) {
        for (const s of group) processed.add(s.id);
        const label = endRhymeLabel(group);
        const colorIdx = stableColorIndex("slant_" + label, usedColorIndices);
        usedColorIndices.add(colorIdx);
        families.push({
          id: nextFamilyId(),
          type: "slant",
          confidence: 0.55,
          colorIndex: colorIdx,
          label: `slant (${label})`,
          explanation: "Near rhyme — similar sounds but not a perfect match",
          spans: group,
          strength: "light",
        });
      }
    }
  }

  // ── Step 6: Assonance ─────────────────────────────────────────────────────
  if (options.enabledTypes.has("assonance") && options.density !== "clean") {
    const candidates = allSpans.filter(
      (s) => s.spanLength === 1 && !STOP_WORDS.has(s.normalized) &&
             s.normalized.length > 2 && s.phonetic.vowelSkeleton.length >= 1
             && !spanInStrongFamily.has(s.id)
    );
    const processed = new Set<string>();

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (processed.has(a.id)) continue;
      const group: RhymeSpan[] = [];

      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (processed.has(b.id)) continue;
        if (a.lineIndex === b.lineIndex && spansOverlap(a, b)) continue;
        if (a.normalized === b.normalized) continue;
        const lineDist = Math.abs(a.lineIndex - b.lineIndex);
        if (lineDist > 4) continue; // keep local

        const score = scoreAssonance(a.phonetic, b.phonetic);
        if (score >= thresholds.assonance) {
          if (!group.find((x) => x.id === a.id)) group.push(a);
          if (!group.find((x) => x.id === b.id)) group.push(b);
        }
      }

      if (group.length >= 2) {
        for (const s of group) processed.add(s.id);
        const label = assonanceLabel(group);
        const colorIdx = stableColorIndex("assn_" + label, usedColorIndices);
        usedColorIndices.add(colorIdx);
        families.push({
          id: nextFamilyId(),
          type: "assonance",
          confidence: 0.5,
          colorIndex: colorIdx,
          label,
          explanation: "Shared vowel sound — assonance across nearby words",
          spans: group,
          strength: "light",
        });
      }
    }
  }

  // ── Step 7: Consonance ────────────────────────────────────────────────────
  if (options.enabledTypes.has("consonance") && options.density !== "clean") {
    const candidates = allSpans.filter(
      (s) => s.spanLength === 1 && !STOP_WORDS.has(s.normalized) &&
             s.normalized.length > 2 && s.phonetic.finalConsonantCluster.length >= 1
             && !spanInStrongFamily.has(s.id)
    );
    const processed = new Set<string>();

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (processed.has(a.id)) continue;
      const group: RhymeSpan[] = [];

      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (processed.has(b.id)) continue;
        if (a.lineIndex === b.lineIndex && spansOverlap(a, b)) continue;
        if (a.normalized === b.normalized) continue;
        const lineDist = Math.abs(a.lineIndex - b.lineIndex);
        if (lineDist > 4) continue;

        const score = scoreConsonance(a.phonetic, b.phonetic);
        if (score >= thresholds.consonance) {
          if (!group.find((x) => x.id === a.id)) group.push(a);
          if (!group.find((x) => x.id === b.id)) group.push(b);
        }
      }

      if (group.length >= 2) {
        for (const s of group) processed.add(s.id);
        const label = consonanceLabel(group);
        const colorIdx = stableColorIndex("cons_" + label, usedColorIndices);
        usedColorIndices.add(colorIdx);
        families.push({
          id: nextFamilyId(),
          type: "consonance",
          confidence: 0.5,
          colorIndex: colorIdx,
          label,
          explanation: "Shared consonant sound — consonance in nearby words",
          spans: group,
          strength: "light",
        });
      }
    }
  }

  // ── Step 8: Alliteration ──────────────────────────────────────────────────
  if (options.enabledTypes.has("alliteration")) {
    // Only content words for alliteration; require meaningful spans
    const candidates = allSpans.filter(
      (s) => s.spanLength === 1 && isContentWord(s.normalized) &&
             s.normalized.length > 2 && s.phonetic.initialConsonantCluster.length >= 1
    );
    const processed = new Set<string>();

    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      if (processed.has(a.id)) continue;
      const group: RhymeSpan[] = [];

      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (processed.has(b.id)) continue;
        if (a.normalized === b.normalized) continue;
        const lineDist = Math.abs(a.lineIndex - b.lineIndex);
        if (lineDist > 3) continue; // alliteration should be very local

        const score = scoreAlliteration(a.phonetic, b.phonetic);
        if (score >= thresholds.alliteration) {
          if (!group.find((x) => x.id === a.id)) group.push(a);
          if (!group.find((x) => x.id === b.id)) group.push(b);
        }
      }

      // Require at least 3 content words for alliteration to be meaningful
      if (group.length >= 3) {
        for (const s of group) processed.add(s.id);
        const label = alliterationLabel(group);
        const colorIdx = stableColorIndex("allit_" + label, usedColorIndices);
        usedColorIndices.add(colorIdx);
        families.push({
          id: nextFamilyId(),
          type: "alliteration",
          confidence: 0.65,
          colorIndex: colorIdx,
          label,
          explanation: "Alliteration — repeated initial consonant sound",
          spans: group,
          strength: group.length >= 4 ? "strong" : "medium",
        });
      }
    }
  }

  // ── Step 8.5: Merge compatible families that share the same rhyme nucleus ─
  // e.g. end rhyme {snare, glare} + internal/cross {air, stare} → one family
  const MERGEABLE_TYPES = new Set<RhymeType>(["end", "chain", "internal", "cross"]);
  for (let i = 0; i < families.length; i++) {
    const fi = families[i];
    if (!MERGEABLE_TYPES.has(fi.type)) continue;
    const nucleusI = fi.spans[0]?.phonetic.finalRhymeNucleus;
    if (!nucleusI) continue;

    for (let j = families.length - 1; j > i; j--) {
      const fj = families[j];
      if (!MERGEABLE_TYPES.has(fj.type)) continue;
      const nucleusJ = fj.spans[0]?.phonetic.finalRhymeNucleus;
      if (!nucleusJ || nucleusI !== nucleusJ) continue;

      // Merge fj into fi — absorb unique spans
      const existingIds = new Set(fi.spans.map((s) => s.id));
      for (const s of fj.spans) {
        if (!existingIds.has(s.id)) {
          fi.spans.push(s);
          existingIds.add(s.id);
        }
      }
      // Promote type: if either is end/chain, the merged family is end/chain
      if ((fj.type === "end" || fj.type === "chain") && fi.type !== "end" && fi.type !== "chain") {
        fi.type = fj.type;
      }
      fi.confidence = Math.max(fi.confidence, fj.confidence);
      if (fi.spans.length >= 3 && (fi.type === "end" || fi.type === "internal" || fi.type === "cross")) {
        fi.type = "chain";
      }
      fi.label = endRhymeLabel(fi.spans);
      fi.explanation = fi.spans.length >= 3
        ? `Rhyme chain — ${fi.spans.length} words share the same ending sound`
        : `End rhyme — matching ending sounds`;
      fi.strength = fi.confidence >= 0.7 ? "strong" : fi.confidence >= 0.5 ? "medium" : "light";
      families.splice(j, 1);
    }
  }

  // ── Step 9: Overlap resolution ────────────────────────────────────────────
  // When spans overlap, prefer stronger families over weaker ones.
  // Priority: end rhyme > multi > repetition phrase > internal > slant > assonance
  const typeStrength = (t: RhymeType): number => {
    switch (t) {
      case "end": case "chain": return 10;
      case "multi": case "compound": case "mosaic": return 9;
      case "internal": return 7;
      case "cross": return 6;
      case "repetition": return 5;
      case "slant": return 4;
      case "consonance": case "assonance": return 3;
      case "alliteration": return 2;
      default: return 1;
    }
  };

  // Remove spans from weaker families when they overlap with stronger ones
  // (Only remove if both families highlight the same word range)
  const resolvedFamilies: RhymeFamily[] = [];
  const claimedRanges = new Map<string, { familyIdx: number; strength: number }>();

  // Sort families by strength for overlap resolution
  const familiesByStrength = [...families].sort((a, b) => {
    const sa = typeStrength(a.type) + (a.confidence * 2);
    const sb = typeStrength(b.type) + (b.confidence * 2);
    return sb - sa;
  });

  for (const fam of familiesByStrength) {
    const keptSpans: RhymeSpan[] = [];
    for (const span of fam.spans) {
      const rangeKey = `${span.lineIndex}:${span.startWordIndex}-${span.endWordIndex}`;
      const existing = claimedRanges.get(rangeKey);
      const myStrength = typeStrength(fam.type) + (fam.confidence * 2);

      if (!existing || myStrength > existing.strength) {
        keptSpans.push(span);
        claimedRanges.set(rangeKey, { familyIdx: resolvedFamilies.length, strength: myStrength });
      } else if (fam.type === "repetition" && existing) {
        // Repetition can coexist with rhyme — allow both if they're different types
        keptSpans.push(span);
      }
    }
    if (keptSpans.length >= 2) {
      resolvedFamilies.push({ ...fam, spans: keptSpans });
    }
  }

  // ── Step 10: Apply maxFamilies cap ────────────────────────────────────────
  const sortedFamilies = resolvedFamilies
    .sort((a, b) => {
      // Priority: multi > end/chain > internal > cross > slant > assn/cons > allit > rep
      const rankDiff = typeStrength(b.type) - typeStrength(a.type);
      if (rankDiff !== 0) return rankDiff;
      return b.spans.length - a.spans.length;
    })
    .filter((f) => options.enabledTypes.has(f.type))
    .filter((f) => !options.strongOnly || f.strength !== "light")
    .slice(0, options.maxFamilies ?? 60);

  // ── Step 11: Weak lines ───────────────────────────────────────────────────
  const linesWithRhyme = new Set<number>();
  for (const fam of sortedFamilies) {
    for (const span of fam.spans) linesWithRhyme.add(span.lineIndex);
  }
  const weakLines = rawLines
    .map((line, i) => ({ line, i }))
    .filter(({ line, i }) => line.trim().length > 0 && !linesWithRhyme.has(i))
    .map(({ i }) => i);

  // ── Step 12: Metrics ──────────────────────────────────────────────────────
  const endFamilies = sortedFamilies.filter((f) => f.type === "end" || f.type === "chain");
  const intFamilies = sortedFamilies.filter((f) => f.type === "internal" || f.type === "cross");
  const multiFamilies = sortedFamilies.filter((f) => f.type === "multi" || f.type === "compound");
  const slantFamilies = sortedFamilies.filter((f) => f.type === "slant");
  const assnFamilies = sortedFamilies.filter((f) => f.type === "assonance");
  const consFamilies = sortedFamilies.filter((f) => f.type === "consonance");
  const allitFamilies = sortedFamilies.filter((f) => f.type === "alliteration");
  const repFamilies = sortedFamilies.filter((f) => f.type === "repetition");

  const totalSpansHighlighted = linesWithRhyme.size;
  const rhymeDensity = nonEmpty > 0 ? Math.round((totalSpansHighlighted / nonEmpty) * 100) : 0;
  const linesWithCount = rawLines.filter((l) => l.trim()).map((_, i) => {
    const realIdx = rawLines.findIndex((line, ri) => {
      let count = 0;
      for (let j = 0; j <= ri; j++) if (rawLines[j].trim()) count++;
      return count === i + 1;
    });
    return sortedFamilies.filter((f) => f.spans.some((s) => s.lineIndex === realIdx)).length;
  });
  const avgRhymesPerLine = linesWithCount.length > 0
    ? Math.round((linesWithCount.reduce((a, b) => a + b, 0) / linesWithCount.length) * 10) / 10
    : 0;

  const metrics: RhymeLensMetrics = {
    rhymeDensity,
    endRhymeGroups: endFamilies.length,
    internalRhymeGroups: intFamilies.length,
    multisyllabicChains: multiFamilies.length,
    slantGroups: slantFamilies.length,
    assonanceGroups: assnFamilies.length,
    consonanceGroups: consFamilies.length,
    alliterationGroups: allitFamilies.length,
    repetitionCount: repFamilies.length,
    averageRhymesPerLine: avgRhymesPerLine,
    strongestFamilyLength: Math.max(0, ...sortedFamilies.map((f) => f.spans.length)),
    weakLineCount: weakLines.length,
  };

  return {
    lines: rawLines,
    tokens: cappedTokens,
    spans: allSpans,
    families: sortedFamilies,
    weakLines,
    metrics,
    capped,
  };
}
