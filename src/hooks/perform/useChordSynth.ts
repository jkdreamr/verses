import { useCallback, useRef, useState } from "react";

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

export type InstrumentPreset = {
  name: string;
  oscillatorTypes: OscillatorType[];
  detuneSpread: number;
  filterFreq: number;
  reverbWet: number;
  attackTime: number;
  releaseTime: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export const INSTRUMENT_PRESETS: InstrumentPreset[] = [
  {
    name: "Warm Keys",
    oscillatorTypes: ["sine", "triangle"],
    detuneSpread: 5,
    filterFreq: 3000,
    reverbWet: 0.2,
    attackTime: 0.04,
    releaseTime: 0.5,
  },
  {
    name: "Soft Pad",
    oscillatorTypes: ["sine", "sine"],
    detuneSpread: 10,
    filterFreq: 1500,
    reverbWet: 0.5,
    attackTime: 0.15,
    releaseTime: 1.0,
  },
  {
    name: "Glass Synth",
    oscillatorTypes: ["sine", "triangle", "sawtooth"],
    detuneSpread: 3,
    filterFreq: 5000,
    reverbWet: 0.3,
    attackTime: 0.01,
    releaseTime: 0.4,
  },
  {
    name: "Bass",
    oscillatorTypes: ["sawtooth", "square"],
    detuneSpread: 0,
    filterFreq: 800,
    reverbWet: 0,
    attackTime: 0.02,
    releaseTime: 0.2,
  },
  {
    name: "Brass-ish",
    oscillatorTypes: ["sawtooth", "triangle"],
    detuneSpread: 8,
    filterFreq: 2500,
    reverbWet: 0.1,
    attackTime: 0.06,
    releaseTime: 0.3,
  },
];

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

// ─── Music utilities ──────────────────────────────────────────────────────────

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

export function chordFrequencies(
  root: string,
  octave: number,
  quality: ChordQuality,
  inversion: "root" | "first" | "second"
): number[] {
  const baseMidi  = noteNameToMidi(root, octave);
  const intervals = chordIntervals(quality);
  let notes       = intervals.map((i) => baseMidi + i);

  if (inversion === "first" && notes.length > 1) {
    notes = [...notes.slice(1), notes[0] + 12];
  } else if (inversion === "second" && notes.length > 2) {
    notes = [...notes.slice(2), notes[0] + 12, notes[1] + 12];
  }

  return notes.map(midiToFreq);
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

// ─── Reverb helper ────────────────────────────────────────────────────────────

export function createReverb(ctx: AudioContext, wet: number): { input: GainNode; output: GainNode } {
  const input    = ctx.createGain();
  const dryGain  = ctx.createGain();
  const wetGain  = ctx.createGain();
  const output   = ctx.createGain();

  dryGain.gain.value = 1 - wet;
  wetGain.gain.value = wet;

  // Simple impulse response: white noise with exponential decay (~2.5s)
  const sampleRate = ctx.sampleRate;
  const length     = sampleRate * 2.5;
  const impulse    = ctx.createBuffer(2, length, sampleRate);
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
 * Chord synthesiser hook.
 *
 * @param destNode     AudioNode for recording capture (optional).
 * @param getSharedCtx Getter for a shared AudioContext (e.g. from drum engine).
 *                     When provided, the chord synth piggy-backs on that context
 *                     so drums + chords share a single AudioContext.
 *                     When omitted, creates its own context on first use.
 */
export function useChordSynth(
  destNode: AudioNode | null,
  getSharedCtx?: () => AudioContext | null,
) {
  const ctxRef             = useRef<AudioContext | null>(null);
  const activeNotesRef     = useRef<number[]>([]);
  const currentChordRef    = useRef<string | null>(null);
  const presetIndexRef     = useRef<number>(0);
  const chordGainRef       = useRef<GainNode | null>(null);
  const activeVoicesRef    = useRef<{ osc: OscillatorNode; env: GainNode }[]>([]);

  const [activeNotes, setActiveNotes]       = useState<number[]>([]);
  const [instrumentName, setInstrumentName] = useState<string>(INSTRUMENT_PRESETS[0].name);

  const ensureCtx = useCallback((): AudioContext => {
    // Prefer shared context when available
    if (getSharedCtx) {
      const shared = getSharedCtx();
      if (shared) {
        if (shared.state === "suspended") shared.resume();
        return shared;
      }
    }
    // Fallback: own context
    if (ctxRef.current) return ctxRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx() as AudioContext;
    ctxRef.current = ctx;
    return ctx;
  }, [getSharedCtx]);

  const ensureChordGain = useCallback((ctx: AudioContext): GainNode => {
    if (chordGainRef.current) return chordGainRef.current;
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    gain.connect(ctx.destination);
    if (destNode) {
      try { gain.connect(destNode); } catch { /* already connected */ }
    }
    chordGainRef.current = gain;
    return gain;
  }, [destNode]);

  const releaseChord = useCallback(() => {
    // Fade out and stop all active voices
    const voices = activeVoicesRef.current;
    if (voices.length > 0) {
      const ctx = getSharedCtx ? getSharedCtx() : ctxRef.current;
      const now = ctx?.currentTime ?? 0;
      for (const v of voices) {
        try {
          v.env.gain.cancelScheduledValues(now);
          v.env.gain.setValueAtTime(v.env.gain.value, now);
          v.env.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          v.osc.stop(now + 0.1);
        } catch { /* already stopped */ }
      }
      activeVoicesRef.current = [];
    }
    activeNotesRef.current  = [];
    currentChordRef.current = null;
    setActiveNotes([]);
  }, [getSharedCtx]);

  const playChord = useCallback(
    (chord: {
      root: string;
      quality: ChordQuality;
      octave: number;
      inversion: "root" | "first" | "second";
    }) => {
      const ctx               = ensureCtx();
      const chordGain         = ensureChordGain(ctx);
      const { root, quality, octave, inversion } = chord;
      const chordName         = chordLabel(root, quality);

      // Release previous chord cleanly
      releaseChord();

      const freqs  = chordFrequencies(root, octave, quality, inversion);
      activeNotesRef.current = chordMidiNotes(root, octave, quality);
      setActiveNotes([...activeNotesRef.current]);
      currentChordRef.current = chordName;

      const preset = INSTRUMENT_PRESETS[presetIndexRef.current];
      const reverb = createReverb(ctx, preset.reverbWet);
      reverb.output.connect(chordGain);

      const newVoices: { osc: OscillatorNode; env: GainNode }[] = [];

      freqs.forEach((freq, i) => {
        const osc     = ctx.createOscillator();
        const oscType = preset.oscillatorTypes[i % preset.oscillatorTypes.length];
        osc.type            = oscType;
        osc.frequency.value = freq;
        if (preset.detuneSpread && i > 0) {
          osc.detune.value = (Math.random() - 0.5) * preset.detuneSpread * 2;
        }

        const env = ctx.createGain();
        env.gain.setValueAtTime(0, ctx.currentTime);
        env.gain.linearRampToValueAtTime(0.28, ctx.currentTime + preset.attackTime);
        env.connect(reverb.input);

        osc.connect(env);
        osc.start(ctx.currentTime);
        // Don't auto-stop; we control release explicitly via releaseChord()
        newVoices.push({ osc, env });
      });

      activeVoicesRef.current = newVoices;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureCtx, ensureChordGain, releaseChord]
  );

  const setInstrumentPreset = useCallback((nameOrIndex: string | number) => {
    if (typeof nameOrIndex === "number") {
      const clamped = Math.max(0, Math.min(INSTRUMENT_PRESETS.length - 1, nameOrIndex));
      presetIndexRef.current = clamped;
      setInstrumentName(INSTRUMENT_PRESETS[clamped].name);
    } else {
      const idx = INSTRUMENT_PRESETS.findIndex((p) => p.name === nameOrIndex);
      if (idx !== -1) {
        presetIndexRef.current = idx;
        setInstrumentName(nameOrIndex);
      }
    }
  }, []);

  return {
    // State
    activeNotes,
    currentChord: currentChordRef.current,
    instrumentName,
    // Actions
    playChord,
    releaseChord,
    setInstrumentPreset,
  };
}
