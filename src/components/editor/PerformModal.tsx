"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { takesStore, newTakeId } from "@/lib/takes";
import type { Take } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

type GestureId = "open" | "pinch" | "two" | "fist" | "point";

type DrumPreset = {
  name: string;
  bpm: number;
  swing: number;
  pattern: { kick: number[]; snare: number[]; hihat: number[]; perc: number[] };
  levels: { kick: number; snare: number; hihat: number; perc: number };
  description: string;
};

type InstrumentPreset = {
  name: string;
  oscillatorTypes: OscillatorType[];
  detuneSpread: number;
  filterFreq: number;
  reverbWet: number;
  attackTime: number;
  releaseTime: number;
};

type ChordQuality =
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

type ChordSlot = {
  slot: number; // 1-8
  root: string;
  quality: ChordQuality;
  octave: number;
  inversion: 'root' | 'first' | 'second';
};

type HandState = {
  gesture: GestureId | null;
  wristX: number;
  wristY: number;
  present: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const DRUM_PRESETS: DrumPreset[] = [
  {
    name: "Boom Bap",
    bpm: 88,
    swing: 0.55,
    pattern: {
      kick:  [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
      perc:  [0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0],
    },
    levels: { kick: 0.9, snare: 0.75, hihat: 0.5, perc: 0.45 },
    description: "Hip-hop groove w/ swing",
  },
  {
    name: "Trap",
    bpm: 140,
    swing: 0.1,
    pattern: {
      kick:  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      snare: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      hihat: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      perc:  [0,0,1,0,0,0,0,1,0,0,1,0,0,0,1,0],
    },
    levels: { kick: 0.95, snare: 0.8, hihat: 0.25, perc: 0.5 },
    description: "Hard trap, rolling hihat",
  },
  {
    name: "R&B",
    bpm: 72,
    swing: 0.4,
    pattern: {
      kick:  [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      perc:  [0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0],
    },
    levels: { kick: 0.85, snare: 0.7, hihat: 0.45, perc: 0.5 },
    description: "Smooth R&B pocket",
  },
  {
    name: "House",
    bpm: 120,
    swing: 0,
    pattern: {
      kick:  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      perc:  [0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0],
    },
    levels: { kick: 0.9, snare: 0.7, hihat: 0.5, perc: 0.45 },
    description: "Four-on-floor house",
  },
  {
    name: "Minimal",
    bpm: 100,
    swing: 0,
    pattern: {
      kick:  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      perc:  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    },
    levels: { kick: 0.85, snare: 0.65, hihat: 0.4, perc: 0 },
    description: "Sparse, clean groove",
  },
];

const INSTRUMENT_PRESETS: InstrumentPreset[] = [
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

const SLOT_PRESETS: Record<string, ChordSlot[]> = {
  Pop: [
    { slot:1, root:'C',  quality:'major', octave:4, inversion:'root' },
    { slot:2, root:'G',  quality:'major', octave:4, inversion:'root' },
    { slot:3, root:'A',  quality:'minor', octave:4, inversion:'root' },
    { slot:4, root:'F',  quality:'major', octave:4, inversion:'root' },
    { slot:5, root:'E',  quality:'minor', octave:4, inversion:'root' },
    { slot:6, root:'D',  quality:'minor', octave:4, inversion:'root' },
    { slot:7, root:'F',  quality:'maj7',  octave:4, inversion:'root' },
    { slot:8, root:'G',  quality:'sus4',  octave:4, inversion:'root' },
  ],
  'R&B': [
    { slot:1, root:'F',  quality:'maj7',  octave:4, inversion:'root' },
    { slot:2, root:'G',  quality:'min7',  octave:4, inversion:'root' },
    { slot:3, root:'A',  quality:'min7',  octave:4, inversion:'root' },
    { slot:4, root:'C',  quality:'dom7',  octave:4, inversion:'root' },
    { slot:5, root:'D',  quality:'min7',  octave:4, inversion:'root' },
    { slot:6, root:'E',  quality:'min7',  octave:4, inversion:'root' },
    { slot:7, root:'Bb', quality:'maj7',  octave:4, inversion:'root' },
    { slot:8, root:'C',  quality:'dom7',  octave:5, inversion:'root' },
  ],
  Sad: [
    { slot:1, root:'A',  quality:'minor', octave:4, inversion:'root' },
    { slot:2, root:'F',  quality:'major', octave:4, inversion:'root' },
    { slot:3, root:'C',  quality:'major', octave:4, inversion:'root' },
    { slot:4, root:'G',  quality:'major', octave:4, inversion:'root' },
    { slot:5, root:'D',  quality:'minor', octave:4, inversion:'root' },
    { slot:6, root:'E',  quality:'minor', octave:4, inversion:'root' },
    { slot:7, root:'F',  quality:'maj7',  octave:4, inversion:'root' },
    { slot:8, root:'G',  quality:'sus4',  octave:4, inversion:'root' },
  ],
  Jazz: [
    { slot:1, root:'D',  quality:'min7',  octave:4, inversion:'root' },
    { slot:2, root:'G',  quality:'dom7',  octave:4, inversion:'root' },
    { slot:3, root:'C',  quality:'maj7',  octave:4, inversion:'root' },
    { slot:4, root:'A',  quality:'min7',  octave:4, inversion:'root' },
    { slot:5, root:'F',  quality:'maj7',  octave:4, inversion:'root' },
    { slot:6, root:'B',  quality:'min7',  octave:4, inversion:'root' },
    { slot:7, root:'E',  quality:'dom7',  octave:4, inversion:'root' },
    { slot:8, root:'A',  quality:'min7',  octave:5, inversion:'root' },
  ],
  'Trap Dark': [
    { slot:1, root:'C',  quality:'minor', octave:4, inversion:'root' },
    { slot:2, root:'Ab', quality:'major', octave:4, inversion:'root' },
    { slot:3, root:'Eb', quality:'major', octave:4, inversion:'root' },
    { slot:4, root:'Bb', quality:'minor', octave:4, inversion:'root' },
    { slot:5, root:'F',  quality:'minor', octave:4, inversion:'root' },
    { slot:6, root:'G',  quality:'minor', octave:4, inversion:'root' },
    { slot:7, root:'Db', quality:'major', octave:4, inversion:'root' },
    { slot:8, root:'G',  quality:'dom7',  octave:4, inversion:'root' },
  ],
  Gospel: [
    { slot:1, root:'C',  quality:'maj7',  octave:4, inversion:'root' },
    { slot:2, root:'D',  quality:'min7',  octave:4, inversion:'root' },
    { slot:3, root:'E',  quality:'min7',  octave:4, inversion:'root' },
    { slot:4, root:'F',  quality:'maj7',  octave:4, inversion:'root' },
    { slot:5, root:'G',  quality:'dom7',  octave:4, inversion:'root' },
    { slot:6, root:'A',  quality:'min7',  octave:4, inversion:'root' },
    { slot:7, root:'D',  quality:'dom7',  octave:4, inversion:'root' },
    { slot:8, root:'G',  quality:'sus4',  octave:4, inversion:'root' },
  ],
};

const NOTE_NAMES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const ROOTS = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const QUALITIES: ChordQuality[] = ["major","minor","maj7","min7","dom7","sus2","sus4","dim","aug","add9","6","min6"];
const GESTURE_LABELS: Record<GestureId, string> = {
  open: "OPEN",
  pinch: "PINCH",
  two: "TWO",
  fist: "FIST",
  point: "POINT",
};

// Latch timing constants
const LATCH_HOLD_MS = 400;
const LATCH_COOLDOWN_MS = 800;

// ─── Music Utilities ─────────────────────────────────────────────────────────

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

function safeExp(ratio: number): number {
  return Math.max(0.0001, ratio);
}

function chordFrequencies(
  root: string,
  octave: number,
  quality: ChordQuality,
  inversion: "root" | "first" | "second"
): number[] {
  const baseMidi = noteNameToMidi(root, octave);
  const intervals = chordIntervals(quality);
  let notes = intervals.map((i) => baseMidi + i);

  if (inversion === "first" && notes.length > 1) {
    notes = [...notes.slice(1), notes[0] + 12];
  } else if (inversion === "second" && notes.length > 2) {
    notes = [...notes.slice(2), notes[0] + 12, notes[1] + 12];
  }

  return notes.map(midiToFreq);
}

function chordMidiNotes(
  root: string,
  octave: number,
  quality: ChordQuality
): number[] {
  const baseMidi = noteNameToMidi(root, octave);
  return chordIntervals(quality).map((i) => baseMidi + i);
}

function chordLabel(root: string, quality: ChordQuality): string {
  const suffixes: Record<ChordQuality, string> = {
    major: "", minor: "m", maj7: "maj7", min7: "m7",
    dom7: "7", sus2: "sus2", sus4: "sus4", dim: "°",
    aug: "aug", add9: "add9", 6: "6", min6: "m6",
  };
  return root + suffixes[quality];
}

// ─── Web Audio helpers ────────────────────────────────────────────────────────

function createReverb(ctx: AudioContext, wet: number): { input: GainNode; output: GainNode } {
  const input = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const output = ctx.createGain();

  dryGain.gain.value = 1 - wet;
  wetGain.gain.value = wet;

  // Simple impulse response: white noise with exponential decay
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

// ─── Drum Engine Hook ─────────────────────────────────────────────────────────

function useDrumEngine(destNode: AudioNode | null) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const drumGainRef = useRef<GainNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const schedulerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const nextBeatTimeRef = useRef(0);
  const playingRef = useRef(false);
  const presetRef = useRef<DrumPreset>(DRUM_PRESETS[0]);
  const bpmRef = useRef<number>(DRUM_PRESETS[0].bpm);

  const [playing, setPlaying] = useState(false);
  const [presetName, setPresetNameState] = useState(DRUM_PRESETS[0].name);
  const [masterVolume, setMasterVolumeState] = useState(0.8);
  const [drumVolume, setDrumVolumeState] = useState(0.7);
  const [filterCutoff, setFilterCutoffState] = useState(4000);
  const [currentBpm, setCurrentBpmState] = useState(DRUM_PRESETS[0].bpm);

  const ensureCtx = useCallback(() => {
    if (ctxRef.current) {
      // Resume if suspended (browser requires user gesture)
      if (ctxRef.current.state === "suspended") ctxRef.current.resume();
      return ctxRef.current;
    }
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGainRef.current = masterGain;

    const drumGain = ctx.createGain();
    drumGain.gain.value = drumVolume;
    drumGainRef.current = drumGain;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterCutoff;
    filterRef.current = filter;

    // Add dynamics compressor
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.1;

    drumGain.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(comp);
    comp.connect(ctx.destination);

    if (destNode) {
      comp.connect(destNode as AudioNode);
    }

    return ctx;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destNode]);

  const scheduleKick = useCallback((ctx: AudioContext, gain: GainNode, time: number, level: number) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env);
    env.connect(gain);
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(safeExp(40), time + 0.15);
    env.gain.setValueAtTime(0.001, time);
    env.gain.linearRampToValueAtTime(level, time + 0.001);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.4);
    osc.start(time);
    osc.stop(time + 0.45);
  }, []);

  const scheduleSnare = useCallback((ctx: AudioContext, gain: GainNode, time: number, level: number) => {
    // White noise component
    const bufLen = ctx.sampleRate * 0.2;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1200;
    noiseFilter.Q.value = 1.5;
    const noiseEnv = ctx.createGain();
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseEnv);
    noiseEnv.connect(gain);
    noiseEnv.gain.setValueAtTime(level * 0.7, time);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    noise.start(time);
    noise.stop(time + 0.2);

    // Sine tone component
    const osc = ctx.createOscillator();
    const oscEnv = ctx.createGain();
    osc.connect(oscEnv);
    oscEnv.connect(gain);
    osc.frequency.value = 200;
    oscEnv.gain.setValueAtTime(level * 0.5, time);
    oscEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.start(time);
    osc.stop(time + 0.12);
  }, []);

  const scheduleHihat = useCallback((ctx: AudioContext, gain: GainNode, time: number, level: number) => {
    const bufLen = ctx.sampleRate * 0.1;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 7000;
    const env = ctx.createGain();
    noise.connect(hpf);
    hpf.connect(env);
    env.connect(gain);
    env.gain.setValueAtTime(level * 0.45, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    noise.start(time);
    noise.stop(time + 0.08);
  }, []);

  const schedulePerc = useCallback((ctx: AudioContext, gain: GainNode, time: number, level: number) => {
    const bufLen = ctx.sampleRate * 0.12;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = 600;
    bpf.Q.value = 2;

    const osc = ctx.createOscillator();
    osc.frequency.value = 600;
    const oscEnv = ctx.createGain();
    osc.connect(oscEnv);
    oscEnv.gain.setValueAtTime(level * 0.4, time);
    oscEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    osc.start(time);
    osc.stop(time + 0.08);
    oscEnv.connect(gain);

    const env = ctx.createGain();
    noise.connect(bpf);
    bpf.connect(env);
    env.connect(gain);
    env.gain.setValueAtTime(level * 0.3, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    noise.start(time);
    noise.stop(time + 0.08);
  }, []);

  const scheduleStep = useCallback((ctx: AudioContext, drumGain: GainNode, step: number, time: number) => {
    const p = presetRef.current;
    if (p.pattern.kick[step]  && drumGainRef.current) scheduleKick(ctx, drumGain, time, p.levels.kick);
    if (p.pattern.snare[step] && drumGainRef.current) scheduleSnare(ctx, drumGain, time, p.levels.snare);
    if (p.pattern.hihat[step] && drumGainRef.current) scheduleHihat(ctx, drumGain, time, p.levels.hihat);
    if (p.pattern.perc[step]  && drumGainRef.current) schedulePerc(ctx, drumGain, time, p.levels.perc);
  }, [scheduleKick, scheduleSnare, scheduleHihat, schedulePerc]);

  const runScheduler = useCallback(() => {
    const ctx = ctxRef.current;
    const dGain = drumGainRef.current;
    if (!ctx || !dGain || !playingRef.current) return;

    const lookahead = 0.1; // seconds
    const p = presetRef.current;
    const stepDuration = 60 / bpmRef.current / 4; // 16th note duration

    while (nextBeatTimeRef.current < ctx.currentTime + lookahead) {
      const step = stepRef.current % 16;
      // Apply swing: odd steps are pushed forward
      const swingOffset = (step % 2 === 1) ? stepDuration * (p.swing - 0.5) : 0;
      const time = nextBeatTimeRef.current + swingOffset;
      scheduleStep(ctx, dGain, step, time);
      nextBeatTimeRef.current += stepDuration;
      stepRef.current++;
    }

    schedulerRef.current = requestAnimationFrame(runScheduler);
  }, [scheduleStep]);

  const play = useCallback(() => {
    const ctx = ensureCtx();
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    stepRef.current = 0;
    nextBeatTimeRef.current = ctx.currentTime;
    runScheduler();
  }, [ensureCtx, runScheduler]);

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (schedulerRef.current) {
      cancelAnimationFrame(schedulerRef.current);
      schedulerRef.current = null;
    }
  }, []);

  const setPreset = useCallback((name: string) => {
    const preset = DRUM_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    presetRef.current = preset;
    bpmRef.current = preset.bpm;
    setPresetNameState(name);
    setCurrentBpmState(preset.bpm);
  }, []);

  const setBpm = useCallback((bpm: number) => {
    const clamped = Math.max(50, Math.min(200, bpm));
    bpmRef.current = clamped;
    setCurrentBpmState(clamped);
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    setMasterVolumeState(vol);
    if (masterGainRef.current) masterGainRef.current.gain.value = vol;
  }, []);

  const setDrumVolume = useCallback((vol: number) => {
    setDrumVolumeState(vol);
    if (drumGainRef.current) drumGainRef.current.gain.value = vol;
  }, []);

  const setFilterCutoff = useCallback((freq: number) => {
    setFilterCutoffState(freq);
    if (filterRef.current) filterRef.current.frequency.value = freq;
  }, []);

  const getMasterGain = useCallback(() => masterGainRef.current, []);
  // getCtx ensures the AudioContext exists — creates it if needed.
  // This allows chord synth to share the same context before drums start.
  const getCtx = useCallback(() => {
    if (!ctxRef.current) ensureCtx();
    return ctxRef.current;
  }, [ensureCtx]);

  return {
    playing,
    presetName,
    masterVolume,
    drumVolume,
    filterCutoff,
    currentBpm,
    play,
    stop,
    setPreset,
    setBpm,
    setMasterVolume,
    setDrumVolume,
    setFilterCutoff,
    currentPreset: presetRef.current,
    getMasterGain,
    getCtx,
  };
}

// ─── Chord Synth Hook ─────────────────────────────────────────────────────────
// Uses the SAME AudioContext as the drum engine to ensure chords play while drums run.

function useChordSynth(destNode: AudioNode | null, getSharedCtx: () => AudioContext | null) {
  const activeNotesRef = useRef<number[]>([]);
  const currentChordRef = useRef<string | null>(null);
  const chordGainRef = useRef<GainNode | null>(null);
  const activeVoicesRef = useRef<{ osc: OscillatorNode; env: GainNode }[]>([]);

  const [activeNotes, setActiveNotes] = useState<number[]>([]);

  const ensureCtx = useCallback((): AudioContext => {
    // Use the shared AudioContext from the drum engine
    const shared = getSharedCtx();
    if (shared) {
      // Resume if suspended (browser policy)
      if (shared.state === "suspended") shared.resume();
      return shared;
    }
    // Fallback: create standalone context (should not happen in normal flow)
    const ctx = new AudioContext();
    return ctx;
  }, [getSharedCtx]);

  const ensureChordGain = useCallback((ctx: AudioContext): GainNode => {
    if (chordGainRef.current) return chordGainRef.current;
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    // Connect chord gain → destination (speakers)
    gain.connect(ctx.destination);
    // Also connect to recording destination if available
    if (destNode) {
      try { gain.connect(destNode); } catch { /* already connected or invalid */ }
    }
    chordGainRef.current = gain;
    return gain;
  }, [destNode]);

  const releaseChord = useCallback(() => {
    // Fade out and stop all active voices
    const voices = activeVoicesRef.current;
    if (voices.length > 0) {
      const ctx = getSharedCtx();
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
    activeNotesRef.current = [];
    setActiveNotes([]);
    currentChordRef.current = null;
  }, [getSharedCtx]);

  const playChord = useCallback((chord: { root: string; quality: ChordQuality; octave: number; inversion: "root" | "first" | "second" }) => {
    const ctx = ensureCtx();
    const chordGain = ensureChordGain(ctx);
    const { root, quality, octave, inversion } = chord;
    const chordName = chordLabel(root, quality);

    // Release previous chord cleanly
    releaseChord();

    const freqs = chordFrequencies(root, octave, quality, inversion);
    activeNotesRef.current = chordMidiNotes(root, octave, quality);
    setActiveNotes(activeNotesRef.current);
    currentChordRef.current = chordName;

    const preset = INSTRUMENT_PRESETS[0]; // Warm Keys
    const reverb = createReverb(ctx, preset.reverbWet);
    // Route reverb output → chordGain (which goes to speakers + recording)
    reverb.output.connect(chordGain);

    const newVoices: { osc: OscillatorNode; env: GainNode }[] = [];

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const oscType = preset.oscillatorTypes[i % preset.oscillatorTypes.length];
      osc.type = oscType;
      osc.frequency.value = freq;
      if (preset.detuneSpread && i > 0) {
        osc.detune.value = (Math.random() - 0.5) * preset.detuneSpread;
      }

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, ctx.currentTime);
      env.gain.linearRampToValueAtTime(0.28, ctx.currentTime + preset.attackTime);
      env.connect(reverb.input);

      osc.connect(env);
      osc.start(ctx.currentTime);
      // Don't auto-stop; we control release explicitly
      newVoices.push({ osc, env });
    });

    activeVoicesRef.current = newVoices;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureCtx, ensureChordGain, releaseChord]);

  return {
    activeNotes,
    playChord,
    releaseChord,
    currentChord: currentChordRef.current,
  };
}

// ─── Piano Keyboard Component ─────────────────────────────────────────────────

function PianoKeyboard({ activeNotes }: { activeNotes: number[] }) {
  const whiteKeys = ["C", "D", "E", "F", "G", "A", "B"];
  const blackKeys = ["C#", "D#", null, "F#", "G#", "A#"];

  const isWhiteActive = (note: string) => {
    return activeNotes.some((n) => NOTE_NAMES[n % 12] === note);
  };

  const isBlackActive = (note: string | null) => {
    if (!note) return false;
    return activeNotes.some((n) => NOTE_NAMES[n % 12] === note);
  };

  return (
    <div className="relative h-16 w-full overflow-hidden rounded-sm border border-ink-line/20">
      {/* White keys — clearly white/ivory */}
      <div className="absolute inset-0 flex gap-px bg-ink-line/30">
        {whiteKeys.map((note) => {
          const active = isWhiteActive(note);
          return (
            <div
              key={note}
              className={`flex flex-1 flex-col items-center justify-end pb-1 transition-colors duration-75 ${
                active
                  ? "bg-amber-400/40 shadow-[inset_0_-3px_0_rgba(251,191,36,0.7)]"
                  : "bg-[#f5f3ef]"
              }`}
            >
              <span className={`font-mono text-[7px] ${active ? "text-amber-700" : "text-neutral-400"}`}>
                {note}
              </span>
            </div>
          );
        })}
      </div>
      {/* Black keys — clearly black */}
      <div className="absolute inset-x-0 top-0 flex px-[7%]">
        {blackKeys.map((note, i) => (
          <div key={i} className="relative flex-1">
            {note && (
              <div
                className={`absolute left-1/2 top-0 h-10 w-[65%] -translate-x-1/2 rounded-b-sm shadow-md transition-colors duration-75 ${
                  isBlackActive(note)
                    ? "bg-amber-500/80 shadow-[0_2px_6px_rgba(251,191,36,0.4)]"
                    : "bg-[#1a1a1a]"
                }`}
              >
                {isBlackActive(note) && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[6px] text-amber-200">
                    {note}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PerformModal({
  open,
  onClose,
  songId,
  onTakeSaved,
  youtubeSession,
}: {
  open: boolean;
  onClose: () => void;
  songId: string;
  onTakeSaved: () => void;
  youtubeSession: {
    youtube_url: string;
    youtube_title: string | null;
    loop_start?: number | null;
    loop_end?: number | null;
  } | null;
}) {
  // MediaPipe refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handLandmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(0);
  const frameCount = useRef(0);
  const fpsTimer = useRef(0);
  const camStreamRef = useRef<MediaStream | null>(null);

  // Hand tracking refs
  const prevRightGesture = useRef<GestureId | null>(null);

  // Latched transport refs
  const beatLatchRef = useRef<'stopped' | 'playing' | 'muted'>('stopped');
  const leftGestureTimerRef = useRef<{ gesture: GestureId | null; startMs: number }>({ gesture: null, startMs: 0 });
  const leftLatchCooldownRef = useRef<number>(0);
  const lastLeftVolumeRef = useRef<number>(0.7);
  const lastLeftFilterRef = useRef<number>(4000);

  // Chord slot refs
  const prevSlotRef = useRef<number | null>(null);
  const sustainRef = useRef(false);

  // Recording refs
  const recDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStartTimeRef = useRef<number>(0);

  // State
  const [camActive, setCamActive] = useState(false);
  const [mediaPipeLoading, setMediaPipeLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_fps, setFps] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [recDestNode, setRecDestNode] = useState<AudioNode | null>(null);
  const [beatSource, setBeatSource] = useState<'drums' | 'youtube'>('drums');
  const [chordSlots, setChordSlots] = useState<ChordSlot[]>(SLOT_PRESETS['Pop']);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [isSilenced, setIsSilenced] = useState(false);
  const [chordVolume, setChordVolumeState] = useState(0.7);
  const [rightZone, setRightZone] = useState(0);
  const [activeTab, setActiveTab] = useState<'sound' | 'chords' | 'guide'>('sound');
  const [leftHand, setLeftHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  const [rightHand, setRightHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });

  // Hooks
  const drum = useDrumEngine(recDestNode);
  const chord = useChordSynth(recDestNode, drum.getCtx);

  // ── Setup recording destination ──
  useEffect(() => {
    const ctx = drum.getCtx();
    if (!ctx || recDestRef.current) return;
    try {
      const dest = ctx.createMediaStreamDestination();
      recDestRef.current = dest;
      setRecDestNode(dest);
      const mg = drum.getMasterGain();
      if (mg) mg.connect(dest);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drum]);

  // ── Gesture detection ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detectGesture = useCallback((landmarks: any[]): GestureId | null => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const thumbExtended = () => {
      const tip = landmarks[4], ip = landmarks[3], mcp = landmarks[2];
      return tip.y < ip.y && tip.y < mcp.y;
    };
    const indexExtended  = () => landmarks[8].y  < landmarks[6].y;
    const middleExtended = () => landmarks[12].y < landmarks[10].y;
    const ringExtended   = () => landmarks[16].y < landmarks[14].y;
    const pinkyExtended  = () => landmarks[20].y < landmarks[18].y;
    const extCount = [indexExtended(), middleExtended(), ringExtended(), pinkyExtended()].filter(Boolean).length;
    const thumbTip = landmarks[4], indexTip = landmarks[8];
    const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    if (pinchDist < 0.05) return "pinch";
    if (extCount === 0) return "fist";
    if (extCount === 1 && indexExtended()) return "point";
    if (extCount === 2 && indexExtended() && middleExtended()) return "two";
    if (extCount >= 4) return "open";
    return null;
  }, []);

  // ── Draw hand landmarks on canvas ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawHandLandmarks = useCallback((ctx2d: CanvasRenderingContext2D, lms: any[], w: number, h: number, color: string) => {
    const CONNECTIONS: [number,number][] = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],
      [0,17],
    ];
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 1.5;
    for (const [a, b] of CONNECTIONS) {
      ctx2d.beginPath();
      ctx2d.moveTo(lms[a].x * w, lms[a].y * h);
      ctx2d.lineTo(lms[b].x * w, lms[b].y * h);
      ctx2d.stroke();
    }
    ctx2d.fillStyle = color;
    for (const lm of lms) {
      ctx2d.beginPath();
      ctx2d.arc(lm.x * w, lm.y * h, 3, 0, 2 * Math.PI);
      ctx2d.fill();
    }
  }, []);

  // ── Load MediaPipe (tasks-vision) ──
  const loadMediaPipe = useCallback(async () => {
    if (handLandmarkerRef.current) return;
    setMediaPipeLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vision = await import("@mediapipe/tasks-vision" as any);
      const { HandLandmarker, FilesetResolver } = vision;
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
      );
      const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
      handLandmarkerRef.current = handLandmarker;
    } catch (err) {
      console.warn("MediaPipe load failed:", err);
      setCamError("Could not load hand tracking. Camera will show without gesture detection.");
    } finally {
      setMediaPipeLoading(false);
    }
  }, []);

  // ── Process gestures with latched transport and zone-based chords ──
  const processGestures = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    landmarks: any[][],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handedness: any[][]
  ) => {
    let newLeft: HandState  = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };
    let newRight: HandState = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };

    for (let i = 0; i < landmarks.length; i++) {
      const lms  = landmarks[i];
      const side = handedness[i]?.[0]?.categoryName ?? "Right";
      const gesture = detectGesture(lms);
      const wrist = lms[0];
      const state: HandState = { gesture, wristX: wrist.x, wristY: wrist.y, present: true };
      // MediaPipe mirrors: "Left" in camera = user's right hand
      if (side === "Left") newRight = state;
      else newLeft = state;
    }

    setLeftHand(newLeft);
    setRightHand(newRight);

    const left  = newLeft;
    const right = newRight;

    // LEFT HAND - Latched transport
    if (left.present && left.gesture) {
      const gesture = left.gesture;
      
      // Update volume/filter continuously while hand is visible
      const vol = 1 - left.wristY; // high hand = loud
      lastLeftVolumeRef.current = vol;
      lastLeftFilterRef.current = 200 + left.wristX * 7800;
      
      // Apply volume (respecting mute)
      if (beatLatchRef.current !== 'muted') {
        drum.setDrumVolume(vol);
        if (beatSource === 'youtube') {
          window.dispatchEvent(new CustomEvent('verses:beat-volume', { detail: { volume: vol * 100 } }));
        }
      }
      drum.setFilterCutoff(lastLeftFilterRef.current);
      
      // Latch logic: track how long gesture has been held
      if (gesture === leftGestureTimerRef.current.gesture) {
        const held = Date.now() - leftGestureTimerRef.current.startMs;
        const cooldownOk = Date.now() - leftLatchCooldownRef.current > LATCH_COOLDOWN_MS;
        
        if (held >= LATCH_HOLD_MS && cooldownOk) {
          // LATCH TRIGGER
          if (gesture === 'open' && beatLatchRef.current !== 'playing') {
            // Start beat
            if (beatSource === 'drums') drum.play();
            else window.dispatchEvent(new CustomEvent('verses:beat-play'));
            beatLatchRef.current = 'playing';
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 }; // reset timer
          } else if (gesture === 'fist' && beatLatchRef.current === 'playing') {
            // Stop beat
            if (beatSource === 'drums') drum.stop();
            else window.dispatchEvent(new CustomEvent('verses:beat-pause'));
            beatLatchRef.current = 'stopped';
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          } else if (gesture === 'pinch') {
            // Toggle mute
            if (beatLatchRef.current === 'muted') {
              beatLatchRef.current = 'playing';
              drum.setDrumVolume(lastLeftVolumeRef.current);
            } else if (beatLatchRef.current === 'playing') {
              beatLatchRef.current = 'muted';
              drum.setDrumVolume(0);
            }
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          }
        }
      } else {
        // Gesture changed, reset timer
        leftGestureTimerRef.current = { gesture, startMs: Date.now() };
      }
    } else {
      // Hand absent: KEEP beat state, just stop updating volume/filter
      leftGestureTimerRef.current = { gesture: null, startMs: 0 };
    }

    // RIGHT HAND - Zone-based chord system
    if (right.present && right.gesture) {
      const g = right.gesture;
      const zone = Math.min(3, Math.floor(right.wristX * 4)); // 0,1,2,3
      setRightZone(zone);
      
      if (g === 'fist') {
        // SILENCE: release all chords immediately
        chord.releaseChord(); // fast fade
        setActiveSlot(null);
        setIsSilenced(true);
        prevSlotRef.current = null;
      } else if (g === 'pinch') {
        // Sustain toggle OR retrigger
        sustainRef.current = !sustainRef.current;
        if (!sustainRef.current && activeSlot !== null) {
          // Re-trigger current slot
          const slot = chordSlots.find(s => s.slot === activeSlot);
          if (slot) chord.playChord(slot);
        }
      } else {
        setIsSilenced(false);
        let targetSlot: number;
        if (g === 'open') targetSlot = zone + 1; // 1,2,3,4
        else if (g === 'two') targetSlot = zone + 5; // 5,6,7,8
        else if (g === 'point') targetSlot = zone + 1; // also 1-4 for point
        else targetSlot = prevSlotRef.current ?? 1;
        
        if (targetSlot !== prevSlotRef.current) {
          // New slot — trigger chord
          const slot = chordSlots.find(s => s.slot === targetSlot);
          if (slot) {
            chord.playChord(slot);
            setActiveSlot(targetSlot);
            prevSlotRef.current = targetSlot;
          }
        }
      }
    } else {
      // Hand absent: if not sustaining, don't release (let chord ring)
      // This is intentional — sustain by default when hand leaves
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatSource, chord, chordSlots, activeSlot, drum]);

  // Camera controls
  // ── Detection loop (RAF-based) ──
  const detectionLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(detectionLoop);
      return;
    }
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) { rafRef.current = requestAnimationFrame(detectionLoop); return; }

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const now = performance.now();
    frameCount.current++;
    if (now - fpsTimer.current > 1000) {
      setFps(Math.round((frameCount.current * 1000) / (now - fpsTimer.current)));
      frameCount.current = 0;
      fpsTimer.current = now;
    }

    if (handLandmarkerRef.current && now - lastFrameTime.current > 33) {
      lastFrameTime.current = now;
      try {
        const result = handLandmarkerRef.current.detectForVideo(video, now);
        if (result.landmarks?.length) {
          processGestures(result.landmarks, result.handedness);
          result.landmarks.forEach((lms: { x: number; y: number; z: number }[], i: number) => {
            const side = result.handedness[i]?.[0]?.categoryName;
            const color = side === "Left" ? "#f59e0b" : "#6366f1";
            drawHandLandmarks(ctx2d, lms, canvas.width, canvas.height, color);
          });
        } else {
          if (prevRightGesture.current !== null) {
            chord.releaseChord();
            prevRightGesture.current = null;
          }
          setLeftHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
          setRightHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
        }
      } catch {}
    }
    rafRef.current = requestAnimationFrame(detectionLoop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processGestures, drawHandLandmarks, chord]);

  // Start/stop detection loop with camera
  useEffect(() => {
    if (camActive) {
      fpsTimer.current = performance.now();
      rafRef.current = requestAnimationFrame(detectionLoop);
    }
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [camActive, detectionLoop]);

  // ── Camera controls ──
  const startCamera = useCallback(async () => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      camStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamActive(true);
      await loadMediaPipe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCamError(`Camera error: ${msg}`);
    }
  }, [loadMediaPipe]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamActive(false);
    setLeftHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
    setRightHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  }, []);

  // ── Recording controls ──
  const startRecording = useCallback(() => {
    const dest = recDestRef.current;
    if (!dest) return;
    const audioStream = dest.stream;
    
    const recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
    recChunksRef.current = [];
    recStartTimeRef.current = Date.now();
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recChunksRef.current.push(e.data);
    };
    
    recorder.onstop = async () => {
      const blob = new Blob(recChunksRef.current, { type: "audio/webm" });
      const durationSec = (Date.now() - recStartTimeRef.current) / 1000;
      const take: Take = {
        id: newTakeId(),
        song_id: songId,
        label: "",
        mime: "audio/webm",
        duration: durationSec,
        size: blob.size,
        has_video: false,
        created_at: new Date().toISOString(),
        blob,
      };
      await takesStore.put(take);
      onTakeSaved();
    };
    
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
  }, [songId, onTakeSaved]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }, [recording]);

  // Update recording timer
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      setRecElapsed(Math.floor((Date.now() - recStartTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [recording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      drum.stop();
      chord.releaseChord();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!open) return null;

  const currentPreset = DRUM_PRESETS.find((p) => p.name === drum.presetName) ?? DRUM_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0d0f] print:hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium tracking-tight text-ink-text/90">
            Perform
          </span>
          {recording && (
            <span className="flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {fmtTime(recElapsed)}
            </span>
          )}
          {!recording && camActive && (
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
              Live
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded px-2.5 py-1 text-[11px] text-ink-mute/50 transition-colors hover:bg-ink-surface/40 hover:text-ink-text"
        >
          Close
        </button>
      </div>

      {/* ── Main 2-column layout: Camera (hero) + Right panel ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Left/Center: Camera stage (dominates — 60%+) ── */}
        <div className="flex min-w-0 flex-[3] flex-col">
          <div className="relative flex-1 overflow-hidden bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ transform: "scaleX(-1)" }}
            />
            {!camActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/92">
                <span className="text-sm text-ink-mute/60">Start camera to control rhythm and harmony.</span>
                <span className="text-[11px] text-ink-mute/35">Keep both hands in frame for gesture control.</span>
              </div>
            )}
            {mediaPipeLoading && (
              <div className="absolute bottom-3 left-3 right-3 rounded bg-ink/85 px-3 py-2 backdrop-blur">
                <span className="text-[11px] text-amber-gold">Loading hand tracking…</span>
              </div>
            )}
            {camError && (
              <div className="absolute bottom-3 left-3 right-3 rounded bg-ink/90 px-3 py-2 backdrop-blur">
                <span className="text-[11px] text-red-400">{camError}</span>
              </div>
            )}
            {camActive && (
              <div className="absolute left-3 top-3 flex gap-2">
                <span className="rounded bg-ink/60 px-2 py-1 font-mono text-[10px] text-amber-gold backdrop-blur-sm">
                  L: {leftHand.present ? (GESTURE_LABELS[leftHand.gesture as GestureId] ?? "—") : "—"}
                </span>
                <span className="rounded bg-ink/60 px-2 py-1 font-mono text-[10px] text-cyan-400 backdrop-blur-sm">
                  R: {rightHand.present ? (GESTURE_LABELS[rightHand.gesture as GestureId] ?? "—") : "—"}
                </span>
              </div>
            )}
            {/* Zone overlay indicator at bottom of camera */}
            {camActive && (
              <div className="absolute bottom-3 left-3 right-3 flex gap-1">
                {[0, 1, 2, 3].map((z) => (
                  <div
                    key={z}
                    className={`flex-1 rounded py-1 text-center font-mono text-[9px] transition-all duration-100 ${
                      rightZone === z && rightHand.present
                        ? "bg-cyan-400/25 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.2)]"
                        : "bg-ink/40 text-ink-mute/30 backdrop-blur-sm"
                    }`}
                  >
                    {z + 1}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Bottom bar: Chord display + gesture quick-ref */}
          <div className="flex items-center gap-4 border-t border-ink-line/15 bg-ink-surface/30 px-5 py-3">
            <div className="flex-1">
              <div className="text-[9px] text-ink-mute/40">Current chord</div>
              <div className="font-serif text-2xl font-bold tracking-tight text-ink-text/90">
                {isSilenced ? <span className="text-ink-mute/40">SILENCE</span> :
                 activeSlot ? chordLabel(
                   chordSlots.find((s) => s.slot === activeSlot)?.root ?? "C",
                   chordSlots.find((s) => s.slot === activeSlot)?.quality ?? "major"
                 ) : <span className="text-ink-mute/30">—</span>}
              </div>
            </div>
            <div className="w-48">
              <PianoKeyboard activeNotes={chord.activeNotes} />
            </div>
            <div className="flex gap-3 text-[8px]">
              <div><span className="text-amber-gold/50">L Open</span> <span className="text-ink-mute/35">Play</span></div>
              <div><span className="text-amber-gold/50">L Fist</span> <span className="text-ink-mute/35">Stop</span></div>
              <div><span className="text-cyan-400/50">R Open</span> <span className="text-ink-mute/35">Chord</span></div>
              <div><span className="text-cyan-400/50">R Fist</span> <span className="text-ink-mute/35">Mute</span></div>
            </div>
          </div>
        </div>

        {/* ── Right panel: Controls ── */}
        <div className="flex w-80 flex-shrink-0 flex-col border-l border-ink-line/10 bg-ink-surface/20">
          {/* Tabs */}
          <div className="flex border-b border-ink-line/10">
            {(['sound', 'chords', 'guide'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-2.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${
                  activeTab === tab
                    ? 'bg-ink-surface/40 text-amber-gold'
                    : 'text-ink-mute/40 hover:text-ink-text/70'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Beat source toggle */}
          <div className="flex border-b border-ink-line/10">
            <button
              onClick={() => {
                if (beatSource === 'youtube') {
                  window.dispatchEvent(new CustomEvent('verses:beat-pause'));
                }
                setBeatSource('drums');
                beatLatchRef.current = 'stopped';
              }}
              className={`flex-1 py-2 text-[10px] tracking-wide transition-colors ${
                beatSource === 'drums' ? 'text-amber-gold bg-amber-gold/5' : 'text-ink-mute/40'
              }`}
            >
              Drums
            </button>
            <button
              onClick={() => {
                drum.stop();
                setBeatSource('youtube');
                beatLatchRef.current = 'stopped';
              }}
              disabled={!youtubeSession}
              className={`flex-1 py-2 text-[10px] tracking-wide transition-colors ${
                beatSource === 'youtube' ? 'text-amber-gold bg-amber-gold/5' :
                youtubeSession ? 'text-ink-mute/40' : 'text-ink-mute/20 cursor-not-allowed'
              }`}
            >
              YouTube
            </button>
          </div>

          {/* Beat status compact */}
          <div className="flex items-center justify-between border-b border-ink-line/10 px-4 py-2.5">
            <div>
              <div className={`font-mono text-[10px] tracking-wider ${
                beatLatchRef.current === 'playing' ? 'text-amber-gold' :
                beatLatchRef.current === 'muted' ? 'text-amber-gold/40' : 'text-ink-mute/30'
              }`}>
                {beatLatchRef.current === 'playing' ? 'PLAYING' :
                 beatLatchRef.current === 'muted' ? 'MUTED' : 'STOPPED'}
              </div>
              <div className="text-sm text-ink-text/80">
                {currentPreset.name}
              </div>
            </div>
            <div className="font-mono text-lg text-ink-mute/50">{drum.currentBpm}</div>
          </div>

          {/* Scrollable tab content */}
          <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
            {activeTab === 'sound' && (
              <div className="space-y-4">
                {/* Drum presets */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Preset</div>
                  <div className="flex flex-wrap gap-1">
                    {DRUM_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        onClick={() => drum.setPreset(preset.name)}
                        className={`rounded px-2 py-1 text-[10px] transition-colors ${
                          drum.presetName === preset.name
                            ? 'bg-amber-gold/15 text-amber-gold'
                            : 'bg-ink-surface/40 text-ink-mute/60 hover:text-ink-text'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Volumes */}
                <div className="space-y-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[9px] text-ink-mute/50">
                      <span>Master</span><span>{Math.round(drum.masterVolume * 100)}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={drum.masterVolume}
                      onChange={(e) => drum.setMasterVolume(parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[9px] text-ink-mute/50">
                      <span>Chords</span><span>{Math.round(chordVolume * 100)}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={chordVolume}
                      onChange={(e) => setChordVolumeState(parseFloat(e.target.value))} className="w-full" />
                  </div>
                </div>

                {/* BPM */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">BPM</div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => drum.setBpm(drum.currentBpm - 5)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">-5</button>
                    <button onClick={() => drum.setBpm(drum.currentBpm - 1)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">-</button>
                    <span className="min-w-[2.5rem] text-center font-mono text-base text-ink-text">{drum.currentBpm}</span>
                    <button onClick={() => drum.setBpm(drum.currentBpm + 1)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">+</button>
                    <button onClick={() => drum.setBpm(drum.currentBpm + 5)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">+5</button>
                    <button onClick={() => drum.setBpm(currentPreset.bpm)}
                      className="ml-auto rounded bg-ink-surface/40 px-2 py-1 text-[9px] uppercase text-ink-mute hover:text-ink-text"
                      title="Reset to preset default">rst</button>
                  </div>
                </div>

                {/* Step Sequencer (read-only visualization) */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Pattern</div>
                  <div className="space-y-0.5">
                    {['kick', 'snare', 'hihat', 'perc'].map(drum => (
                      <div key={drum} className="flex gap-0.5">
                        {currentPreset.pattern[drum as keyof typeof currentPreset.pattern].map((step, i) => (
                          <div key={i} className={`h-3 w-3 rounded-sm ${
                            step ? 'bg-amber-gold/60' : 'bg-ink-surface/30'
                          }`} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Instrument presets */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Instrument</div>
                  <div className="flex flex-wrap gap-1">
                    {INSTRUMENT_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        className="rounded bg-ink-surface/40 px-2 py-1 text-[10px] text-ink-mute/60 hover:text-ink-text"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'chords' && (
              <div className="space-y-4">
                {/* Chord slots (compact pads) */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Chord Pads</div>
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(slot => {
                        const slotData = chordSlots.find(s => s.slot === slot);
                        return (
                          <div key={slot} className={`flex-1 rounded py-2 text-center font-mono text-[10px] transition-all duration-75 ${
                            activeSlot === slot
                              ? 'bg-amber-gold/20 text-amber-gold shadow-[0_0_6px_rgba(201,168,76,0.15)]'
                              : 'bg-ink-surface/40 text-ink-mute/60'
                          }`}>
                            {slotData ? chordLabel(slotData.root, slotData.quality) : slot}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-1">
                      {[5, 6, 7, 8].map(slot => {
                        const slotData = chordSlots.find(s => s.slot === slot);
                        return (
                          <div key={slot} className={`flex-1 rounded py-2 text-center font-mono text-[10px] transition-all duration-75 ${
                            activeSlot === slot
                              ? 'bg-amber-gold/20 text-amber-gold shadow-[0_0_6px_rgba(201,168,76,0.15)]'
                              : 'bg-ink-surface/40 text-ink-mute/60'
                          }`}>
                            {slotData ? chordLabel(slotData.root, slotData.quality) : slot}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Slot preset */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Progression</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(SLOT_PRESETS).map(preset => (
                      <button
                        key={preset}
                        onClick={() => setChordSlots(SLOT_PRESETS[preset])}
                        className={`rounded px-2 py-1 text-[10px] transition-colors ${
                          chordSlots === SLOT_PRESETS[preset]
                            ? 'bg-amber-gold/15 text-amber-gold'
                            : 'bg-ink-surface/40 text-ink-mute/60 hover:text-ink-text'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slot editor */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Edit Slots</div>
                  <div className="space-y-1.5">
                    {chordSlots.map(slot => (
                      <div key={slot.slot} className="rounded bg-ink-surface/30 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-mono text-[9px] text-ink-mute/50">Slot {slot.slot}</span>
                          <button onClick={() => chord.playChord(slot)}
                            className="text-[9px] text-ink-mute/40 hover:text-amber-gold">Preview</button>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          <select value={slot.root} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], root: e.target.value }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            {ROOTS.map(root => (<option key={root} value={root}>{root}</option>))}
                          </select>
                          <select value={slot.quality} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], quality: e.target.value as ChordQuality }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            {QUALITIES.map(quality => (<option key={quality} value={quality}>{quality}</option>))}
                          </select>
                          <select value={slot.octave} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], octave: parseInt(e.target.value) }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            {[1, 2, 3, 4, 5].map(oct => (<option key={oct} value={oct}>O{oct}</option>))}
                          </select>
                          <select value={slot.inversion} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], inversion: e.target.value as 'root' | 'first' | 'second' }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            <option value="root">Root</option>
                            <option value="first">1st</option>
                            <option value="second">2nd</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'guide' && (
              <div className="space-y-4 text-[11px] text-ink-mute/70">
                <div>
                  <div className="mb-2 text-[9px] uppercase tracking-widest text-ink-mute/40">Left Hand — Rhythm</div>
                  <div className="space-y-1">
                    <div><span className="text-amber-gold/70">Open palm</span> — Start beat loop</div>
                    <div><span className="text-amber-gold/70">Fist</span> — Stop beat</div>
                    <div><span className="text-amber-gold/70">Pinch</span> — Mute toggle</div>
                    <div><span className="text-amber-gold/70">Height</span> — Volume</div>
                    <div><span className="text-amber-gold/70">X position</span> — Filter</div>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[9px] uppercase tracking-widest text-ink-mute/40">Right Hand — Harmony</div>
                  <div className="space-y-1">
                    <div><span className="text-cyan-400/70">Open + zone</span> — Slots 1-4</div>
                    <div><span className="text-cyan-400/70">Two + zone</span> — Slots 5-8</div>
                    <div><span className="text-cyan-400/70">Fist</span> — Silence chords</div>
                    <div><span className="text-cyan-400/70">Pinch</span> — Sustain</div>
                  </div>
                </div>
                <div className="rounded bg-ink-surface/20 p-2 text-[10px] text-ink-mute/40">
                  Camera processes locally. Never leaves device.
                </div>
                {beatSource === 'youtube' && (
                  <div className="rounded bg-amber-gold/5 p-2 text-[10px] text-amber-gold/50">
                    YouTube audio cannot be captured in recordings.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Transport bar ── */}
      <div className="flex items-center justify-between border-t border-ink-line/10 bg-ink-surface/20 px-5 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={camActive ? stopCamera : startCamera}
            className={`rounded px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
              camActive
                ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                : 'bg-amber-gold/10 text-amber-gold hover:bg-amber-gold/20'
            }`}
          >
            {camActive ? 'Stop Camera' : 'Start Camera'}
          </button>

          {beatSource === 'drums' && (
            <button
              onClick={drum.playing ? drum.stop : drum.play}
              className={`rounded px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
                drum.playing
                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'bg-amber-gold/10 text-amber-gold hover:bg-amber-gold/20'
              }`}
            >
              {drum.playing ? 'Stop' : 'Play'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={!camActive}
            className={`rounded px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
              recording
                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                : camActive
                ? 'bg-amber-gold/10 text-amber-gold hover:bg-amber-gold/20'
                : 'text-ink-mute/30 cursor-not-allowed'
            }`}
          >
            {recording ? 'Stop Rec' : 'Record'}
          </button>

          <button
            onClick={onClose}
            className="rounded bg-ink-surface/40 px-3 py-1.5 text-[11px] text-ink-mute transition-colors hover:text-ink-text"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}