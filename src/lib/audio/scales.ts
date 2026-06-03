// ───────────────────────────────────────────────────────────────────────────
// Scale-lock: map a continuous 0..1 position to an in-key MIDI note so the
// theremin XY pad and the multi-touch pad are always musical. Pure, no deps.
// ───────────────────────────────────────────────────────────────────────────

export const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

export type ScaleId =
  | "major"
  | "minor"
  | "majorPentatonic"
  | "minorPentatonic"
  | "dorian"
  | "mixolydian"
  | "blues"
  | "chromatic";

export const SCALES: { id: ScaleId; name: string; intervals: number[] }[] = [
  { id: "majorPentatonic", name: "Major Pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "minorPentatonic", name: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Natural Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "blues", name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "chromatic", name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export function scaleIntervals(id: ScaleId): number[] {
  return (SCALES.find((s) => s.id === id) ?? SCALES[0]).intervals;
}

/** Pitch class (0–11) for a key name. */
export function keyToPc(key: string): number {
  const idx = KEY_NAMES.indexOf(key as (typeof KEY_NAMES)[number]);
  return idx === -1 ? 0 : idx;
}

/**
 * Build the ascending ladder of in-scale MIDI notes between `midiLow` and
 * `midiHigh` (inclusive) for a given root pitch class + scale.
 */
export function buildScaleLadder(
  rootPc: number,
  scaleId: ScaleId,
  midiLow: number,
  midiHigh: number,
): number[] {
  const ivs = scaleIntervals(scaleId);
  const ladder: number[] = [];
  for (let m = midiLow; m <= midiHigh; m++) {
    const degree = ((m - rootPc) % 12 + 12) % 12;
    if (ivs.includes(degree)) ladder.push(m);
  }
  return ladder.length > 0 ? ladder : [midiLow];
}

/**
 * Map x∈[0,1] to a MIDI note on the ladder. Quantised so dragging across the
 * pad steps cleanly through in-key notes (left = low, right = high).
 */
export function xToScaleMidi(
  x01: number,
  rootPc: number,
  scaleId: ScaleId,
  midiLow = 48,
  midiHigh = 84,
): number {
  const ladder = buildScaleLadder(rootPc, scaleId, midiLow, midiHigh);
  const idx = Math.max(0, Math.min(ladder.length - 1, Math.floor(x01 * ladder.length)));
  return ladder[idx];
}

/** Snap an arbitrary MIDI value to the nearest in-key note. */
export function snapToScale(midi: number, rootPc: number, scaleId: ScaleId): number {
  const ivs = scaleIntervals(scaleId);
  let best = midi;
  let bestDist = Infinity;
  for (let d = -6; d <= 6; d++) {
    const m = midi + d;
    const degree = ((m - rootPc) % 12 + 12) % 12;
    if (ivs.includes(degree) && Math.abs(d) < bestDist) {
      best = m;
      bestDist = Math.abs(d);
    }
  }
  return best;
}

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function midiToLabel(m: number): string {
  return `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
