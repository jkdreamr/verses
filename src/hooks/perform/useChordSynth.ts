import { useCallback, useEffect, useRef, useState } from "react";
import { ensureEngine } from "@/lib/audio/engine";
import {
  CHORD_INSTRUMENTS,
  createChordInstrument,
  type ChordInstrumentId,
  type SampledInstrument,
} from "@/lib/audio/samplers";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChordQuality =
  | "major"
  | "minor"
  | "maj7"
  | "min7"
  | "dom7"
  | "sus2"
  | "sus4"
  | "dim"
  | "aug"
  | "add9"
  | "6"
  | "min6";

export type ChordSlot = {
  slot: number; // 1-8
  root: string;
  quality: ChordQuality;
  octave: number;
  inversion: "root" | "first" | "second";
};

/** A selectable chord timbre — now backed by a real sampled instrument. */
export type InstrumentPreset = {
  id: ChordInstrumentId;
  name: string;
  blurb: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** The three sampled chord timbres (piano / warm strings / felt EP). */
export const INSTRUMENT_PRESETS: InstrumentPreset[] = CHORD_INSTRUMENTS.map((d) => ({
  id: d.id,
  name: d.name,
  blurb: d.blurb,
}));

export const SLOT_PRESETS: Record<string, ChordSlot[]> = {
  Pop: [
    { slot: 1, root: "C",  quality: "major", octave: 4, inversion: "root" },
    { slot: 2, root: "G",  quality: "major", octave: 4, inversion: "root" },
    { slot: 3, root: "A",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 4, root: "F",  quality: "major", octave: 4, inversion: "root" },
    { slot: 5, root: "E",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 6, root: "D",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 7, root: "F",  quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 8, root: "G",  quality: "sus4",  octave: 4, inversion: "root" },
  ],
  "R&B": [
    { slot: 1, root: "F",  quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 2, root: "G",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 3, root: "A",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 4, root: "C",  quality: "dom7",  octave: 4, inversion: "root" },
    { slot: 5, root: "D",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 6, root: "E",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 7, root: "Bb", quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 8, root: "C",  quality: "dom7",  octave: 5, inversion: "root" },
  ],
  Sad: [
    { slot: 1, root: "A",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 2, root: "F",  quality: "major", octave: 4, inversion: "root" },
    { slot: 3, root: "C",  quality: "major", octave: 4, inversion: "root" },
    { slot: 4, root: "G",  quality: "major", octave: 4, inversion: "root" },
    { slot: 5, root: "D",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 6, root: "E",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 7, root: "F",  quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 8, root: "G",  quality: "sus4",  octave: 4, inversion: "root" },
  ],
  Jazz: [
    { slot: 1, root: "D",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 2, root: "G",  quality: "dom7",  octave: 4, inversion: "root" },
    { slot: 3, root: "C",  quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 4, root: "A",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 5, root: "F",  quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 6, root: "B",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 7, root: "E",  quality: "dom7",  octave: 4, inversion: "root" },
    { slot: 8, root: "A",  quality: "min7",  octave: 5, inversion: "root" },
  ],
  "Trap Dark": [
    { slot: 1, root: "C",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 2, root: "Ab", quality: "major", octave: 4, inversion: "root" },
    { slot: 3, root: "Eb", quality: "major", octave: 4, inversion: "root" },
    { slot: 4, root: "Bb", quality: "minor", octave: 4, inversion: "root" },
    { slot: 5, root: "F",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 6, root: "G",  quality: "minor", octave: 4, inversion: "root" },
    { slot: 7, root: "Db", quality: "major", octave: 4, inversion: "root" },
    { slot: 8, root: "G",  quality: "dom7",  octave: 4, inversion: "root" },
  ],
  Gospel: [
    { slot: 1, root: "C",  quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 2, root: "D",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 3, root: "E",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 4, root: "F",  quality: "maj7",  octave: 4, inversion: "root" },
    { slot: 5, root: "G",  quality: "dom7",  octave: 4, inversion: "root" },
    { slot: 6, root: "A",  quality: "min7",  octave: 4, inversion: "root" },
    { slot: 7, root: "D",  quality: "dom7",  octave: 4, inversion: "root" },
    { slot: 8, root: "G",  quality: "sus4",  octave: 4, inversion: "root" },
  ],
};

// ─── Music utilities (pure — unchanged public API) ──────────────────────────────

function noteNameToMidi(name: string, octave: number): number {
  const idx = NOTE_NAMES.indexOf(name);
  if (idx === -1) return 60;
  return 12 * (octave + 1) + idx;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function chordIntervals(quality: ChordQuality): number[] {
  switch (quality) {
    case "major": return [0, 4, 7];
    case "minor": return [0, 3, 7];
    case "maj7":  return [0, 4, 7, 11];
    case "min7":  return [0, 3, 7, 10];
    case "dom7":  return [0, 4, 7, 10];
    case "sus2":  return [0, 2, 7];
    case "sus4":  return [0, 5, 7];
    case "dim":   return [0, 3, 6];
    case "aug":   return [0, 4, 8];
    case "add9":  return [0, 4, 7, 14];
    case "6":     return [0, 4, 7, 9];
    case "min6":  return [0, 3, 7, 9];
  }
}

function voicedMidiNotes(
  root: string,
  octave: number,
  quality: ChordQuality,
  inversion: "root" | "first" | "second",
): number[] {
  const baseMidi = noteNameToMidi(root, octave);
  const intervals = chordIntervals(quality);
  let notes = intervals.map((i) => baseMidi + i);
  if (inversion === "first" && notes.length > 1) {
    notes = [...notes.slice(1), notes[0] + 12];
  } else if (inversion === "second" && notes.length > 2) {
    notes = [...notes.slice(2), notes[0] + 12, notes[1] + 12];
  }
  return notes;
}

export function chordFrequencies(
  root: string,
  octave: number,
  quality: ChordQuality,
  inversion: "root" | "first" | "second"
): number[] {
  return voicedMidiNotes(root, octave, quality, inversion).map(midiToFreq);
}

export function chordMidiNotes(
  root: string,
  octave: number,
  quality: ChordQuality
): number[] {
  const baseMidi = noteNameToMidi(root, octave);
  return chordIntervals(quality).map((i) => baseMidi + i);
}

export function chordLabel(root: string, quality: ChordQuality): string {
  const suffixes: Record<ChordQuality, string> = {
    major: "",
    minor: "m",
    maj7:  "maj7",
    min7:  "m7",
    dom7:  "7",
    sus2:  "sus2",
    sus4:  "sus4",
    dim:   "°",
    aug:   "aug",
    add9:  "add9",
    "6":   "6",
    min6:  "m6",
  };
  return root + suffixes[quality];
}

/**
 * Legacy convolver-reverb helper. Kept for API stability (re-exported from the
 * hooks barrel); the sampled-instrument path uses Tone.Reverb instead.
 */
export function createReverb(ctx: AudioContext, wet: number): { input: GainNode; output: GainNode } {
  const input = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const output = ctx.createGain();
  dryGain.gain.value = 1 - wet;
  wetGain.gain.value = wet;
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * 2.5;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
    }
  }
  const convolver = ctx.createConvolver();
  convolver.buffer = impulse;
  input.connect(dryGain);
  input.connect(convolver);
  convolver.connect(wetGain);
  dryGain.connect(output);
  wetGain.connect(output);
  return { input, output };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Sampled chord synthesiser. Replaces the old raw-oscillator voices with a
 * `Tone.Sampler` (real piano / strings / felt recordings) routed through the
 * shared engine's chord bus + reverb. Chords are *held* (attack on play, full
 * release on change/stop) so they ring like a real instrument.
 *
 * Routing is internal (connects to the shared engine's chord bus), so the hook
 * takes no arguments.
 */
export function useChordSynth() {
  const instrumentRef = useRef<SampledInstrument | null>(null);
  const instrumentIdRef = useRef<ChordInstrumentId>("grandPiano");
  const heldRef = useRef<number[]>([]);
  const buildTokenRef = useRef(0);

  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [currentChord, setCurrentChord] = useState<string | null>(null);
  const [instrumentName, setInstrumentName] = useState<string>(INSTRUMENT_PRESETS[0].name);
  const [chordVolume, setChordVolumeState] = useState(0.85);
  const [loading, setLoading] = useState(false);

  const buildInstrument = useCallback(async (id: ChordInstrumentId) => {
    const def = CHORD_INSTRUMENTS.find((d) => d.id === id) ?? CHORD_INSTRUMENTS[0];
    const token = ++buildTokenRef.current;
    setLoading(true);
    const engine = ensureEngine();
    try {
      const inst = await createChordInstrument(engine, def, () => {
        if (token === buildTokenRef.current) setLoading(false);
      });
      if (token !== buildTokenRef.current) {
        inst.dispose();
        return;
      }
      instrumentRef.current?.dispose();
      instrumentRef.current = inst;
      inst.setVolumeDb(def.volumeDb);
    } catch {
      if (token === buildTokenRef.current) setLoading(false);
    }
  }, []);

  // Lazily build the default instrument on first mount.
  const ensureInstrument = useCallback(async (): Promise<SampledInstrument | null> => {
    if (!instrumentRef.current) {
      await buildInstrument(instrumentIdRef.current);
    }
    return instrumentRef.current;
  }, [buildInstrument]);

  const releaseChord = useCallback(() => {
    instrumentRef.current?.releaseAll();
    heldRef.current = [];
    setActiveNotes([]);
    setCurrentChord(null);
  }, []);

  const playChord = useCallback(
    (chord: { root: string; quality: ChordQuality; octave: number; inversion: "root" | "first" | "second" }) => {
      const { root, quality, octave, inversion } = chord;
      const voiced = voicedMidiNotes(root, octave, quality, inversion);
      const display = chordMidiNotes(root, octave, quality);
      setActiveNotes(display);
      setCurrentChord(chordLabel(root, quality));

      const inst = instrumentRef.current;
      if (inst) {
        inst.releaseAll();
        inst.attack(voiced, 0.85);
        heldRef.current = voiced;
      } else {
        // Build on demand, then play once ready.
        void ensureInstrument().then((built) => {
          built?.releaseAll();
          built?.attack(voiced, 0.85);
          heldRef.current = voiced;
        });
      }
    },
    [ensureInstrument],
  );

  const setInstrumentPreset = useCallback((nameOrId: string) => {
    const def =
      CHORD_INSTRUMENTS.find((d) => d.name === nameOrId) ??
      CHORD_INSTRUMENTS.find((d) => d.id === nameOrId);
    if (!def) return;
    instrumentIdRef.current = def.id;
    setInstrumentName(def.name);
    void buildInstrument(def.id);
  }, [buildInstrument]);

  const setChordVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    setChordVolumeState(clamped);
    // 0..1 → dB, applied to the instrument's own trim.
    const db = clamped <= 0.001 ? -60 : 20 * Math.log10(clamped);
    instrumentRef.current?.setVolumeDb(db);
  }, []);

  // Build the default instrument once.
  useEffect(() => {
    void ensureInstrument();
    const tokenRef = buildTokenRef;
    const instRef = instrumentRef;
    return () => {
      tokenRef.current++;
      instRef.current?.dispose();
      instRef.current = null;
    };
  }, [ensureInstrument]);

  return {
    // State
    activeNotes,
    currentChord,
    instrumentName,
    chordVolume,
    loading,
    // Actions
    playChord,
    releaseChord,
    setInstrumentPreset,
    setChordVolume,
  };
}
