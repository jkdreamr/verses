// ───────────────────────────────────────────────────────────────────────────
// Voice → Score pipeline helpers.
//
//   audio → note detection (basic-pitch neural OR YIN fallback)
//         → segmentation/quantization → key + chord inference → notation/export
//
// Heavy deps (TensorFlow.js, basic-pitch, Tonal) are lazy-imported so the editor
// bundle stays light. The neural model is vendored at /models/basic-pitch.
// ───────────────────────────────────────────────────────────────────────────

import { midiToNoteName, detectPitchYIN } from "@/lib/pitchDetection";

export interface NoteEvent {
  midi: number;
  name: string;
  startTime: number;
  duration: number;
  confidence: number;
  id: string;
}

let idCounter = 0;
export const nextNoteId = (): string => `vn_${++idCounter}_${Date.now().toString(36)}`;

const PITCH_CLASSES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PITCH_CLASSES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// ── Neural transcription (basic-pitch) ──────────────────────────────────────

/** Resample/flatten an AudioBuffer to 22.05 kHz mono — what basic-pitch expects. */
async function toMonoResampled(buffer: AudioBuffer, targetRate = 22050): Promise<AudioBuffer> {
  const length = Math.ceil((buffer.duration) * targetRate);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const OfflineCtx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const offline: OfflineAudioContext = new OfflineCtx(1, length, targetRate);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  return offline.startRendering();
}

export type NeuralOptions = { onsetThresh?: number; frameThresh?: number; minNoteLen?: number };

/**
 * Primary engine: Spotify's basic-pitch neural transcription. Returns note
 * events (with onsets). Throws if the model can't load so the caller can fall
 * back to the YIN path.
 */
export async function transcribeNeural(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void,
  opts: NeuralOptions = {},
): Promise<NoteEvent[]> {
  const tf = await import("@tensorflow/tfjs");
  await tf.ready();
  const { BasicPitch, noteFramesToTime, addPitchBendsToNoteEvents, outputToNotesPoly } =
    await import("@spotify/basic-pitch");

  const resampled = await toMonoResampled(buffer, 22050);
  const bp = new BasicPitch("/models/basic-pitch/model.json");

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await bp.evaluateModel(
    resampled,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    (p) => onProgress?.(p),
  );

  const poly = outputToNotesPoly(
    frames, onsets,
    opts.onsetThresh ?? 0.5,   // onsetThreshold
    opts.frameThresh ?? 0.3,   // frameThreshold
    opts.minNoteLen ?? 11,     // minNoteLength ≈ 120ms
    true,                      // inferOnsets
    1100,                      // maxFreq — top of the sung range
    80,                        // minFreq
    true,                      // melodiaTrick
  );
  const timed = noteFramesToTime(addPitchBendsToNoteEvents(contours, poly));

  let notes: NoteEvent[] = timed
    .filter((n) => n.pitchMidi >= 36 && n.pitchMidi <= 96)
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
    .map((n) => ({
      midi: n.pitchMidi,
      name: midiToNoteName(n.pitchMidi),
      startTime: Math.round(n.startTimeSeconds * 1000) / 1000,
      duration: Math.round(n.durationSeconds * 1000) / 1000,
      confidence: Math.max(0.2, Math.min(1, n.amplitude)),
      id: nextNoteId(),
    }));

  // Cross-check pitch against a YIN track to repair octave flips (basic-pitch can
  // octave-err on voice). Conservative — only snaps when YIN strongly agrees.
  notes = correctOctaves(notes, yinPitchTrack(resampled));
  // Absorb tiny same-pitch fragments into their neighbour (vibrato/articulation).
  notes = mergeShortFragments(notes, 0.1);
  return notes;
}

/** Merge sub-threshold fragments into a same-pitch neighbour. */
export function mergeShortFragments(notes: NoteEvent[], minSec = 0.1): NoteEvent[] {
  if (notes.length < 2) return notes;
  const out: NoteEvent[] = [];
  for (const n of notes) {
    const prev = out[out.length - 1];
    if (prev && n.duration < minSec && Math.abs(n.midi - prev.midi) <= 1 &&
        n.startTime - (prev.startTime + prev.duration) < 0.08) {
      prev.duration = Math.round((n.startTime + n.duration - prev.startTime) * 1000) / 1000;
      continue;
    }
    out.push({ ...n });
  }
  return out;
}

const medianOf = (a: number[]): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

/** Continuous YIN pitch track (float MIDI) over a mono buffer. */
function yinPitchTrack(buffer: AudioBuffer): { t: number; midi: number }[] {
  const data = buffer.getChannelData(0) as Float32Array<ArrayBuffer>;
  const sr = buffer.sampleRate;
  const win = 2048, hop = 1024;
  const out: { t: number; midi: number }[] = [];
  const w = new Float32Array(win) as Float32Array<ArrayBuffer>;
  for (let i = 0; i + win <= data.length; i += hop) {
    w.set(data.subarray(i, i + win));
    const r = detectPitchYIN(w, sr, { yinThreshold: 0.15, silenceRms: 0.01, noisyFallback: 0.5 });
    if (r && r.freq > 0) out.push({ t: i / sr, midi: 69 + 12 * Math.log2(r.freq / 440) });
  }
  return out;
}

/** Snap a note to the octave nearest the YIN reference when it's an octave off. */
function correctOctaves(notes: NoteEvent[], track: { t: number; midi: number }[]): NoteEvent[] {
  if (track.length === 0) return notes;
  return notes.map((n) => {
    const span = track.filter((p) => p.t >= n.startTime - 0.03 && p.t <= n.startTime + n.duration + 0.03);
    if (span.length < 2) return n;
    const ref = medianOf(span.map((p) => p.midi));
    let m = n.midi;
    while (m - ref > 6) m -= 12;
    while (ref - m > 6) m += 12;
    // accept only a genuine octave fix that lands very close to the YIN reference
    return Math.abs(m - n.midi) >= 12 && Math.abs(m - ref) <= 1.5
      ? { ...n, midi: m, name: midiToNoteName(m) }
      : n;
  });
}

/** Reduce a (possibly polyphonic) transcription to a single melodic line. */
export function monophonicReduce(notes: NoteEvent[]): NoteEvent[] {
  if (notes.length === 0) return notes;
  const sorted = [...notes].sort((a, b) => a.startTime - b.startTime || b.midi - a.midi);
  const out: NoteEvent[] = [];
  for (const n of sorted) {
    const prev = out[out.length - 1];
    if (prev && n.startTime < prev.startTime + prev.duration - 0.02) {
      // overlapping — keep the higher (melody) note, trim the previous
      if (n.midi > prev.midi) {
        prev.duration = Math.max(0.05, n.startTime - prev.startTime);
        out.push(n);
      }
      // else drop n (it's under the melody)
    } else {
      out.push(n);
    }
  }
  return out;
}

// ── Quantization ────────────────────────────────────────────────────────────

export type QuantGrid = "none" | "16" | "8" | "4";

export function quantizeNotes(notes: NoteEvent[], grid: QuantGrid, bpm: number): NoteEvent[] {
  if (grid === "none" || notes.length === 0) return notes;
  const beat = 60 / bpm;
  const div = grid === "16" ? beat / 4 : grid === "8" ? beat / 2 : beat;
  return notes.map((n) => {
    const start = Math.round(n.startTime / div) * div;
    const dur = Math.max(div, Math.round(n.duration / div) * div);
    return { ...n, startTime: Math.round(start * 1000) / 1000, duration: Math.round(dur * 1000) / 1000 };
  });
}

// ── Key inference (Krumhansl-Schmuckler profiles) ───────────────────────────

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export type KeyInfo = {
  tonicPc: number;
  mode: "major" | "minor";
  name: string;        // e.g. "G", "E minor"
  vexKey: string;      // VexFlow key spec, e.g. "G", "Em"
  accidental: "sharp" | "flat";
};

export function inferKey(notes: NoteEvent[]): KeyInfo {
  const hist = new Array(12).fill(0);
  for (const n of notes) hist[((n.midi % 12) + 12) % 12] += n.duration;
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  const norm = hist.map((h) => h / total);

  const corr = (profile: number[], shift: number) => {
    let s = 0;
    for (let i = 0; i < 12; i++) s += norm[(i + shift) % 12] * profile[i];
    return s;
  };

  let best = { score: -Infinity, tonicPc: 0, mode: "major" as "major" | "minor" };
  for (let pc = 0; pc < 12; pc++) {
    const maj = corr(MAJOR_PROFILE, pc);
    const min = corr(MINOR_PROFILE, pc);
    if (maj > best.score) best = { score: maj, tonicPc: pc, mode: "major" };
    if (min > best.score) best = { score: min, tonicPc: pc, mode: "minor" };
  }

  // Sharp keys vs flat keys (purely for spelling the tonic nicely).
  const FLAT_KEYS = new Set([1, 3, 5, 6, 8, 10]); // tend to be flat-spelled
  const useFlat = best.mode === "major" ? FLAT_KEYS.has(best.tonicPc) : FLAT_KEYS.has((best.tonicPc + 3) % 12);
  const names = useFlat ? PITCH_CLASSES_FLAT : PITCH_CLASSES_SHARP;
  const tonic = names[best.tonicPc];
  return {
    tonicPc: best.tonicPc,
    mode: best.mode,
    name: best.mode === "major" ? tonic : `${tonic} minor`,
    vexKey: best.mode === "major" ? tonic : `${tonic}m`,
    accidental: useFlat ? "flat" : "sharp",
  };
}

// ── Chord inference (Tonal Chord.detect over beat windows) ──────────────────

export type ChordHit = { startTime: number; symbol: string };

// Root-relative chord templates, ordered so simpler chords win on a tie.
const CHORD_TEMPLATES: { suffix: string; ivs: number[] }[] = [
  { suffix: "", ivs: [0, 4, 7] },       // major
  { suffix: "m", ivs: [0, 3, 7] },      // minor
  { suffix: "7", ivs: [0, 4, 7, 10] },
  { suffix: "maj7", ivs: [0, 4, 7, 11] },
  { suffix: "m7", ivs: [0, 3, 7, 10] },
  { suffix: "dim", ivs: [0, 3, 6] },
  { suffix: "sus4", ivs: [0, 5, 7] },
];

// Below this best-template score a window is too ambiguous to name a chord; we
// hold the previous one instead of emitting a flickery guess.
const MIN_CHORD_SCORE = 0.15;

/**
 * Per-window chord inference by chroma template matching: build a duration- and
 * confidence-weighted 12-bin chroma for each beat window and pick the
 * (root, quality) whose template best correlates (rewards in-chord energy,
 * penalises out-of-chord energy). More robust than set-based detection when a
 * 5th is missing or a passing tone sneaks in.
 */
export async function inferChords(
  notes: NoteEvent[],
  bpm: number,
  beatsPerChord = 2,
  accidental: "sharp" | "flat" = "sharp",
): Promise<ChordHit[]> {
  if (notes.length === 0) return [];
  const beat = 60 / bpm;
  const win = beat * beatsPerChord;
  const end = Math.max(...notes.map((n) => n.startTime + n.duration));
  const names = accidental === "flat" ? PITCH_CLASSES_FLAT : PITCH_CLASSES_SHARP;

  const hits: ChordHit[] = [];
  let last = "";
  for (let t = 0; t < end; t += win) {
    const chroma = new Array(12).fill(0);
    let energy = 0;
    for (const n of notes) {
      const overlap = Math.min(n.startTime + n.duration, t + win) - Math.max(n.startTime, t);
      if (overlap <= 0) continue;
      const w = overlap * Math.max(0.2, n.confidence);
      chroma[((n.midi % 12) + 12) % 12] += w;
      energy += w;
    }
    if (energy <= 0) continue;
    for (let i = 0; i < 12; i++) chroma[i] /= energy;

    let bestScore = -Infinity, bestRoot = 0, bestSuffix = "";
    for (let root = 0; root < 12; root++) {
      for (const tpl of CHORD_TEMPLATES) {
        let inSum = 0;
        for (const iv of tpl.ivs) inSum += chroma[(root + iv) % 12];
        let outSum = 0;
        for (let pc = 0; pc < 12; pc++) {
          if (!tpl.ivs.includes(((pc - root) % 12 + 12) % 12)) outSum += chroma[pc];
        }
        const score = inSum - 0.55 * outSum - 0.03 * tpl.ivs.length;
        if (score > bestScore) { bestScore = score; bestRoot = root; bestSuffix = tpl.suffix; }
      }
    }
    // Hold the previous chord through ambiguous windows (passing tones, diffuse
    // chroma) rather than emitting a low-confidence guess that flickers the sheet.
    if (bestScore < MIN_CHORD_SCORE) continue;
    const symbol = names[bestRoot] + bestSuffix;
    if (symbol !== last) {
      hits.push({ startTime: Math.round(t * 1000) / 1000, symbol });
      last = symbol;
    }
  }
  return hits;
}

/**
 * Estimate tempo by phase-aligning a comb of candidate beat grids to the note
 * onsets (a cos-weighted autocorrelation). The fundamental tempo wins because
 * off-beat onsets score negatively, avoiding the usual 2×/½× errors.
 */
export function estimateBpm(notes: NoteEvent[]): number {
  if (notes.length < 4) return 100;
  const onsets = notes.map((n) => n.startTime);
  let best = 100, bestScore = -Infinity;
  for (let bpm = 70; bpm <= 170; bpm++) {
    const beat = 60 / bpm;
    let score = 0;
    for (const t of onsets) score += Math.cos(2 * Math.PI * ((t % beat) / beat));
    if (score > bestScore) { bestScore = score; best = bpm; }
  }
  return best;
}

// ── MusicXML lead-sheet export ──────────────────────────────────────────────

const STEP_ALTER: Record<string, [string, number]> = {
  C: ["C", 0], "C#": ["C", 1], Db: ["D", -1], D: ["D", 0], "D#": ["D", 1], Eb: ["E", -1],
  E: ["E", 0], F: ["F", 0], "F#": ["F", 1], Gb: ["G", -1], G: ["G", 0], "G#": ["G", 1],
  Ab: ["A", -1], A: ["A", 0], "A#": ["A", 1], Bb: ["B", -1], B: ["B", 0],
};

function midiToStep(midi: number, accidental: "sharp" | "flat"): { step: string; alter: number; octave: number } {
  const names = accidental === "flat" ? PITCH_CLASSES_FLAT : PITCH_CLASSES_SHARP;
  const pc = ((midi % 12) + 12) % 12;
  const [step, alter] = STEP_ALTER[names[pc]];
  return { step, alter, octave: Math.floor(midi / 12) - 1 };
}

const FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6,
};

export function buildMusicXML(
  notes: NoteEvent[],
  key: KeyInfo,
  chords: ChordHit[],
  bpm: number,
  lyrics?: string,
): string {
  const divisions = 4; // per quarter note
  const beat = 60 / bpm;
  const tonicName = key.mode === "major" ? key.name : key.name.replace(" minor", "");
  const fifths = FIFTHS[tonicName] ?? 0;
  const lyricWords = (lyrics ?? "").split(/\s+/).filter(Boolean);

  const noteXml = notes
    .map((n, i) => {
      const { step, alter, octave } = midiToStep(n.midi, key.accidental);
      const durDivs = Math.max(1, Math.round((n.duration / beat) * divisions));
      const chordHere = chords.find((c) => Math.abs(c.startTime - n.startTime) < beat / 2);
      const harmony = chordHere ? harmonyXml(chordHere.symbol, key.accidental) : "";
      const lyricXml = lyricWords[i]
        ? `<lyric><syllabic>single</syllabic><text>${escapeXml(lyricWords[i])}</text></lyric>`
        : "";
      return `${harmony}<note><pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch><duration>${durDivs}</duration><type>${durTypeFromDivisions(durDivs, divisions)}</type>${lyricXml}</note>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>${fifths}</fifths><mode>${key.mode}</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type></direction>
${noteXml}
    </measure>
  </part>
</score-partwise>`;
}

function harmonyXml(symbol: string, accidental: "sharp" | "flat"): string {
  // crude root + kind parse from a Tonal chord symbol like "Cmaj7", "Am", "G7"
  const m = symbol.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return "";
  const root = m[1];
  const quality = m[2];
  const [step, alter] = STEP_ALTER[normalizeRoot(root, accidental)] ?? ["C", 0];
  const kind = chordKind(quality);
  return `<harmony><root><root-step>${step}</root-step>${alter ? `<root-alter>${alter}</root-alter>` : ""}</root><kind text="${escapeXml(quality)}">${kind}</kind></harmony>\n`;
}

function normalizeRoot(root: string, accidental: "sharp" | "flat"): string {
  const idx = PITCH_CLASSES_SHARP.indexOf(root) >= 0 ? PITCH_CLASSES_SHARP.indexOf(root) : PITCH_CLASSES_FLAT.indexOf(root);
  if (idx < 0) return root;
  return (accidental === "flat" ? PITCH_CLASSES_FLAT : PITCH_CLASSES_SHARP)[idx];
}

function chordKind(q: string): string {
  if (/maj7/.test(q)) return "major-seventh";
  if (/m7b5|ø/.test(q)) return "half-diminished";
  if (/dim7|°7/.test(q)) return "diminished-seventh";
  if (/dim|°/.test(q)) return "diminished";
  if (/m7|min7/.test(q)) return "minor-seventh";
  if (/7/.test(q)) return "dominant";
  if (/m|min/.test(q)) return "minor";
  if (/sus4/.test(q)) return "suspended-fourth";
  if (/sus2/.test(q)) return "suspended-second";
  if (/aug|\+/.test(q)) return "augmented";
  if (/6/.test(q)) return "major-sixth";
  return "major";
}

function durTypeFromDivisions(durDivs: number, divisions: number): string {
  const quarters = durDivs / divisions;
  if (quarters >= 3.5) return "whole";
  if (quarters >= 1.5) return "half";
  if (quarters >= 0.75) return "quarter";
  if (quarters >= 0.375) return "eighth";
  return "16th";
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}
