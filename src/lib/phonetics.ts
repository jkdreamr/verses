export type PronunciationSource = "override" | "lexicon" | "g2p";

export type Pronunciation = {
  phonemes: string[];
  source: PronunciationSource;
  stressIndex?: number;
};

export type TokenPhonetics = {
  normalized: string;
  pronunciations: Pronunciation[];
  perfectKey: string;
  endingKey: string;
  assonanceKey: string;
  consonanceKey: string;
  alliterationKey: string;
  familyKey: string;
  eyeKey: string;
  syllableCount: number;
  finalVowel: string;
  finalConsonants: string;
  initialConsonants: string;
  vowelSkeleton: string;
  consonantSkeleton: string;
  phonemeKey: string;
};

const VOWELS = new Set([
  "AA", "AE", "AH", "AO", "AW", "AY",
  "EH", "ER", "EY", "IH", "IY",
  "OW", "OY", "UH", "UW",
]);

const CONSONANT_FAMILIES: Record<string, string> = {
  P: "PB", B: "PB",
  T: "TD", D: "TD",
  K: "KG", G: "KG",
  F: "FV", V: "FV",
  S: "SZ", Z: "SZ",
  SH: "SHCHJ", ZH: "SHCHJ", CH: "SHCHJ", JH: "SHCHJ",
};

const OVERRIDES: Record<string, string[]> = {
  hi: ["HH", "AY1"],
  bye: ["B", "AY1"],
  my: ["M", "AY1"],
  why: ["W", "AY1"],
  cry: ["K", "R", "AY1"],
  fly: ["F", "L", "AY1"],
  sky: ["S", "K", "AY1"],
  eye: ["AY1"],
  i: ["AY1"],

  you: ["Y", "UW1"],
  too: ["T", "UW1"],
  to: ["T", "UW1"],
  through: ["TH", "R", "UW1"],
  blue: ["B", "L", "UW1"],
  who: ["HH", "UW1"],
  do: ["D", "UW1"],

  me: ["M", "IY1"],
  see: ["S", "IY1"],
  sea: ["S", "IY1"],
  be: ["B", "IY1"],
  free: ["F", "R", "IY1"],
  we: ["W", "IY1"],
  he: ["HH", "IY1"],
  she: ["SH", "IY1"],

  no: ["N", "OW1"],
  go: ["G", "OW1"],
  show: ["SH", "OW1"],
  flow: ["F", "L", "OW1"],
  glow: ["G", "L", "OW1"],
  though: ["DH", "OW1"],
  so: ["S", "OW1"],
  whole: ["HH", "OW1", "L"],
  hole: ["HH", "OW1", "L"],

  love: ["L", "AH1", "V"],
  shove: ["SH", "AH1", "V"],
  above: ["AH0", "B", "AH1", "V"],
  enough: ["IH0", "N", "AH1", "F"],
  move: ["M", "UW1", "V"],
  prove: ["P", "R", "UW1", "V"],
  groove: ["G", "R", "UW1", "V"],
  rough: ["R", "AH1", "F"],
  tough: ["T", "AH1", "F"],
  stuff: ["S", "T", "AH1", "F"],
  blood: ["B", "L", "AH1", "D"],
  flood: ["F", "L", "AH1", "D"],
  cough: ["K", "AO1", "F"],
  off: ["AO1", "F"],

  there: ["DH", "EH1", "R"],
  their: ["DH", "EH1", "R"],
  "they're": ["DH", "EH1", "R"],
  right: ["R", "AY1", "T"],
  write: ["R", "AY1", "T"],
  night: ["N", "AY1", "T"],
  knight: ["N", "AY1", "T"],
  light: ["L", "AY1", "T"],
  line: ["L", "AY1", "N"],
  lines: ["L", "AY1", "N", "Z"],
  time: ["T", "AY1", "M"],
  mine: ["M", "AY1", "N"],
  mind: ["M", "AY1", "N", "D"],
  spine: ["S", "P", "AY1", "N"],
  one: ["W", "AH1", "N"],
  won: ["W", "AH1", "N"],
  new: ["N", "UW1"],
  knew: ["N", "UW1"],
  made: ["M", "EY1", "D"],
  maid: ["M", "EY1", "D"],
  bare: ["B", "EH1", "R"],
  bear: ["B", "EH1", "R"],

  testing: ["T", "EH1", "S", "T", "IH0", "NG"],
  resting: ["R", "EH1", "S", "T", "IH0", "NG"],
  jesting: ["JH", "EH1", "S", "T", "IH0", "NG"],
  action: ["AE1", "K", "SH", "AH0", "N"],
  traction: ["T", "R", "AE1", "K", "SH", "AH0", "N"],
  fraction: ["F", "R", "AE1", "K", "SH", "AH0", "N"],
  relaxin: ["R", "IH0", "L", "AE1", "K", "S", "IH0", "N"],
  relaxing: ["R", "IH0", "L", "AE1", "K", "S", "IH0", "NG"],
  reaction: ["R", "IY0", "AE1", "K", "SH", "AH0", "N"],
  lackin: ["L", "AE1", "K", "IH0", "N"],
  lacking: ["L", "AE1", "K", "IH0", "NG"],
  chain: ["CH", "EY1", "N"],
  brain: ["B", "R", "EY1", "N"],
  cold: ["K", "OW1", "L", "D"],
  bold: ["B", "OW1", "L", "D"],
  stare: ["S", "T", "EH1", "R"],
  prayer: ["P", "R", "EH1", "R"],
  know: ["N", "OW1"],
  poet: ["P", "OW1", "AH0", "T"],
  flowing: ["F", "L", "OW1", "IH0", "NG"],
  going: ["G", "OW1", "IH0", "NG"],
  goin: ["G", "OW1", "IH0", "N"],
  hand: ["HH", "AE1", "N", "D"],
  land: ["L", "AE1", "N", "D"],
};

const phoneticCache = new Map<string, TokenPhonetics>();

export function normalizePhoneticWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/^[^a-z']+/, "")
    .replace(/[^a-z']+$/, "")
    .replace(/^'+|'+$/g, "");
}

function stripStress(phoneme: string): string {
  return phoneme.replace(/[0-2]/g, "");
}

function isVowelPhoneme(phoneme: string): boolean {
  return VOWELS.has(stripStress(phoneme));
}

function hasPrimaryStress(phoneme: string): boolean {
  return /1$/.test(phoneme);
}

function phonemeFamily(phoneme: string): string {
  const p = stripStress(phoneme);
  return CONSONANT_FAMILIES[p] ?? p;
}

function stressIndexFor(phonemes: string[]): number | undefined {
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowelPhoneme(phonemes[i]) && hasPrimaryStress(phonemes[i])) return i;
  }
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowelPhoneme(phonemes[i])) return i;
  }
  return undefined;
}

function keyFromTail(phonemes: string[], startIndex: number | undefined): string {
  if (startIndex === undefined) return phonemes.map(stripStress).join("-");
  return phonemes.slice(startIndex).map(stripStress).join("-");
}

function finalVowelIndex(phonemes: string[]): number {
  for (let i = phonemes.length - 1; i >= 0; i--) {
    if (isVowelPhoneme(phonemes[i])) return i;
  }
  return -1;
}

function eyeKeyFor(word: string): string {
  const compact = word.replace(/[^a-z]/g, "");
  if (compact.length <= 3) return compact;
  if (compact.endsWith("e") && compact.length >= 4) return compact.slice(-3);
  const suffix = compact.match(/[aeiouy][a-z]{1,4}$/)?.[0];
  return suffix ?? compact.slice(-4);
}

function g2p(raw: string): string[] {
  let word = raw.replace(/[^a-z]/g, "");
  if (!word) return [];

  if (word.endsWith("in") && word.length >= 5 && !word.endsWith("ain")) {
    const stem = word.slice(0, -2);
    if (/[bcdfghjklmnpqrstvwxyz]$/.test(stem)) word = `${stem}ing`;
  }

  const silentFinalE = word.length > 3 && /[^aeiou]e$/.test(word) && !/[aeiou]{2}e$/.test(word);
  const scan = silentFinalE ? word.slice(0, -1) : word;
  const out: string[] = [];

  for (let i = 0; i < scan.length;) {
    const rest = scan.slice(i);
    const next = scan[i + 1] ?? "";
    const after = scan[i + 2] ?? "";

    if (rest.startsWith("tion")) { out.push("SH", "AH0", "N"); i += 4; continue; }
    if (rest.startsWith("sion")) { out.push("ZH", "AH0", "N"); i += 4; continue; }
    if (rest.startsWith("igh")) { out.push("AY1"); i += 3; continue; }
    if (rest.startsWith("eigh")) { out.push("EY1"); i += 4; continue; }
    if (rest.startsWith("ing")) { out.push("IH0", "NG"); i += 3; continue; }
    if (rest.startsWith("ch")) { out.push("CH"); i += 2; continue; }
    if (rest.startsWith("sh")) { out.push("SH"); i += 2; continue; }
    if (rest.startsWith("th")) { out.push("TH"); i += 2; continue; }
    if (rest.startsWith("ph")) { out.push("F"); i += 2; continue; }
    if (rest.startsWith("wh")) { out.push("W"); i += 2; continue; }
    if (rest.startsWith("ck")) { out.push("K"); i += 2; continue; }
    if (rest.startsWith("ng")) { out.push("NG"); i += 2; continue; }
    if (rest.startsWith("qu")) { out.push("K", "W"); i += 2; continue; }
    if (rest.startsWith("ee") || rest.startsWith("ea") || rest.startsWith("ie")) { out.push("IY1"); i += 2; continue; }
    if (rest.startsWith("oo") || rest.startsWith("ue") || rest.startsWith("ew")) { out.push("UW1"); i += 2; continue; }
    if (rest.startsWith("ai") || rest.startsWith("ay")) { out.push("EY1"); i += 2; continue; }
    if (rest.startsWith("oa") || rest.startsWith("oe")) { out.push("OW1"); i += 2; continue; }
    if (rest.startsWith("oi") || rest.startsWith("oy")) { out.push("OY1"); i += 2; continue; }
    if (rest.startsWith("ou") || rest.startsWith("ow")) { out.push("AW1"); i += 2; continue; }

    if (silentFinalE && after === "" && next && /[bcdfghjklmnpqrstvwxyz]/.test(next)) {
      if (scan[i] === "a") { out.push("EY1"); i++; continue; }
      if (scan[i] === "i") { out.push("AY1"); i++; continue; }
      if (scan[i] === "o") { out.push("OW1"); i++; continue; }
      if (scan[i] === "u") { out.push("UW1"); i++; continue; }
      if (scan[i] === "e") { out.push("IY1"); i++; continue; }
    }

    const ch = scan[i];
    switch (ch) {
      case "a": out.push("AE1"); break;
      case "e": out.push("EH1"); break;
      case "i": out.push("IH1"); break;
      case "o": out.push(i === scan.length - 1 ? "OW1" : "AA1"); break;
      case "u": out.push("AH1"); break;
      case "y": out.push(i === scan.length - 1 ? "AY1" : "Y"); break;
      case "c": out.push(/[eiy]/.test(next) ? "S" : "K"); break;
      case "g": out.push(/[eiy]/.test(next) ? "JH" : "G"); break;
      case "j": out.push("JH"); break;
      case "x": out.push("K", "S"); break;
      case "q": out.push("K"); break;
      default:
        if (/[bcdfhklmnprstvzw]/.test(ch)) out.push(ch.toUpperCase());
    }
    i++;
  }

  return out.filter((p, idx, arr) => !(idx > 0 && p === arr[idx - 1] && !isVowelPhoneme(p)));
}

function buildPhonetics(normalized: string, pronunciation: Pronunciation): TokenPhonetics {
  const phonemes = pronunciation.phonemes;
  const stripped = phonemes.map(stripStress);
  const vIdx = finalVowelIndex(phonemes);
  const finalVowel = vIdx >= 0 ? stripStress(phonemes[vIdx]) : "";
  const finalConsonants = vIdx >= 0
    ? phonemes.slice(vIdx + 1).filter((p) => !isVowelPhoneme(p)).map(stripStress).join("-")
    : stripped.filter((p) => !VOWELS.has(p)).join("-");
  const firstVowel = phonemes.findIndex(isVowelPhoneme);
  const initialConsonants = stripped.slice(0, firstVowel < 0 ? stripped.length : firstVowel)
    .filter((p) => !VOWELS.has(p))
    .join("-");
  const vowels = phonemes.filter(isVowelPhoneme).map(stripStress);
  const consonants = phonemes.filter((p) => !isVowelPhoneme(p)).map(stripStress);
  const stressIndex = pronunciation.stressIndex ?? stressIndexFor(phonemes);
  const perfectKey = keyFromTail(phonemes, stressIndex);
  const endingKey = [finalVowel, finalConsonants].filter(Boolean).join("-");
  const familyConsonants = finalConsonants
    .split("-")
    .filter(Boolean)
    .map(phonemeFamily)
    .join("-");

  return {
    normalized,
    pronunciations: [{ ...pronunciation, stressIndex }],
    perfectKey,
    endingKey,
    assonanceKey: vowels.slice(-3).join("-"),
    consonanceKey: finalConsonants || consonants.slice(-2).join("-"),
    alliterationKey: initialConsonants.split("-").filter(Boolean).map(phonemeFamily).slice(0, 2).join("-"),
    familyKey: [finalVowel, familyConsonants].filter(Boolean).join("-"),
    eyeKey: eyeKeyFor(normalized),
    syllableCount: Math.max(1, vowels.length),
    finalVowel,
    finalConsonants,
    initialConsonants,
    vowelSkeleton: vowels.join("-"),
    consonantSkeleton: consonants.join("-"),
    phonemeKey: stripped.join("-"),
  };
}

export function getTokenPhonetics(raw: string): TokenPhonetics {
  const normalized = normalizePhoneticWord(raw);
  const cached = phoneticCache.get(normalized);
  if (cached) return cached;

  const override = OVERRIDES[normalized];
  const pronunciation: Pronunciation = override
    ? { phonemes: override, source: "override" }
    : { phonemes: g2p(normalized), source: "g2p" };
  const result = buildPhonetics(normalized, pronunciation);
  phoneticCache.set(normalized, result);
  return result;
}

export function getPhrasePhonetics(words: string[]): TokenPhonetics {
  const normalizedWords = words.map(normalizePhoneticWord).filter(Boolean);
  const normalized = normalizedWords.join(" ");
  const phonemes: string[] = [];
  for (const word of normalizedWords) {
    phonemes.push(...getTokenPhonetics(word).pronunciations[0].phonemes);
  }
  const source: PronunciationSource = normalizedWords.some((w) => OVERRIDES[w]) ? "override" : "g2p";
  return buildPhonetics(normalized, { phonemes, source });
}

export function areHomophones(a: string, b: string): boolean {
  const pa = getTokenPhonetics(a);
  const pb = getTokenPhonetics(b);
  return pa.normalized !== pb.normalized && pa.phonemeKey === pb.phonemeKey;
}
