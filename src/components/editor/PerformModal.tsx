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
    if (ctxRef.current) return ctxRef.current;
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
  const getCtx = useCallback(() => ctxRef.current, []);

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function useChordSynth(destNode: AudioNode | null, _getCtx?: () => AudioContext | null) {
  const ctxRef = useRef<AudioContext | null>(null);
  const activeNotesRef = useRef<number[]>([]);
  const currentChordRef = useRef<string | null>(null);

  const [activeNotes, setActiveNotes] = useState<number[]>([]);

  const ensureCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    return ctx;
  }, []);

  const playChord = useCallback((chord: { root: string; quality: ChordQuality; octave: number; inversion: "root" | "first" | "second" }) => {
    const ctx = ensureCtx();
    const { root, quality, octave, inversion } = chord;
    const chordName = chordLabel(root, quality);

    // Release previous chord
    releaseChord();

    const freqs = chordFrequencies(root, octave, quality, inversion);
    activeNotesRef.current = chordMidiNotes(root, octave, quality);
    setActiveNotes(activeNotesRef.current);
    currentChordRef.current = chordName;

    const preset = INSTRUMENT_PRESETS[0]; // Default to Warm Keys
    const reverb = createReverb(ctx, preset.reverbWet);

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
      env.gain.linearRampToValueAtTime(0.3, ctx.currentTime + preset.attackTime);
      env.connect(reverb.input);

      osc.connect(env);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + preset.attackTime + preset.releaseTime + 1);

      setTimeout(() => {
        env.gain.cancelScheduledValues(ctx.currentTime);
        env.gain.setValueAtTime(0.3, ctx.currentTime);
        env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + preset.releaseTime);
      }, preset.attackTime * 1000);
    });

    reverb.output.connect(destNode || ctx.destination);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureCtx, destNode]);

  const releaseChord = useCallback(() => {
    activeNotesRef.current = [];
    setActiveNotes([]);
    currentChordRef.current = null;
  }, []);

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
    <div className="relative h-16 w-full overflow-hidden rounded-sm">
      {/* White keys */}
      <div className="absolute inset-0 flex gap-px">
        {whiteKeys.map((note) => {
          const active = isWhiteActive(note);
          return (
            <div
              key={note}
              className={`flex flex-1 flex-col items-center justify-end pb-1 transition-colors duration-75 ${
                active
                  ? "bg-amber-gold/30 shadow-[inset_0_-2px_0_rgba(201,168,76,0.6)]"
                  : "bg-ink-surface/80"
              }`}
            >
              <span className={`font-mono text-[7px] ${active ? "text-amber-gold" : "text-ink-mute/30"}`}>
                {note}
              </span>
            </div>
          );
        })}
      </div>
      {/* Black keys */}
      <div className="absolute inset-x-0 top-0 flex px-[7%]">
        {blackKeys.map((note, i) => (
          <div key={i} className="relative flex-1">
            {note && (
              <div
                className={`absolute left-1/2 top-0 h-9 w-[70%] -translate-x-1/2 rounded-b-sm transition-colors duration-75 ${
                  isBlackActive(note)
                    ? "bg-amber-gold/50 shadow-[0_2px_4px_rgba(201,168,76,0.3)]"
                    : "bg-ink/90"
                }`}
              />
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
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/98 backdrop-blur-lg print:hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-ink-line/40 px-6 py-3">
        <div className="flex items-center gap-4">
          <span className="font-serif text-sm tracking-tight text-ink-text/80">
            Perform
          </span>
          <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-amber-gold/60">
            gesture control
          </span>
        </div>
        <div className="flex items-center gap-4">
          {recording && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-red-400/80">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              REC {fmtTime(recElapsed)}
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.2em] text-ink-mute/50 transition-colors hover:text-ink-text"
          >
            Close
          </button>
        </div>
      </div>

      {/* ── Main 3-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Left: Camera + guide ── */}
        <div className="flex w-[400px] flex-shrink-0 flex-col border-r border-ink-line/30">
          <div className="border-b border-ink-line/30 px-4 py-2">
            <span className="font-mono text-[8px] uppercase tracking-[0.3em] text-ink-mute/50">Camera Feed</span>
          </div>
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
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/90">
                <span className="text-[13px] text-ink-mute/50">Start camera to control rhythm and harmony.</span>
                <span className="text-[10px] text-ink-mute/30">Keep both hands in frame.</span>
              </div>
            )}
            {mediaPipeLoading && (
              <div className="absolute bottom-2 left-2 right-2 border border-amber-gold/40 bg-ink/80 px-2 py-1">
                <span className="font-mono text-[10px] text-amber-gold">Loading hand tracking…</span>
              </div>
            )}
            {camError && (
              <div className="absolute bottom-2 left-2 right-2 border border-red-500/40 bg-ink/90 px-2 py-1">
                <span className="font-mono text-[10px] text-red-400">{camError}</span>
              </div>
            )}
            {camActive && (
              <div className="absolute right-2 top-2 flex gap-1.5">
                <span className="border border-amber-gold/30 bg-ink/70 px-1.5 py-0.5 font-mono text-[9px] text-amber-gold">
                  L: {leftHand.present ? (leftHand.gesture ?? "—") : "—"}
                </span>
                <span className="border border-indigo-400/30 bg-ink/70 px-1.5 py-0.5 font-mono text-[9px] text-indigo-400">
                  R: {rightHand.present ? (rightHand.gesture ?? "—") : "—"}
                </span>
              </div>
            )}
          </div>
          {/* Gesture guide — compact */}
          <div className="scrollbar-thin overflow-y-auto border-t border-ink-line/20 px-4 py-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[9px]">
              <div className="col-span-2 mb-1 text-ink-mute/40">Quick reference</div>
              <div className="text-amber-gold/60">L: Open 0.4s</div><div className="text-ink-mute/50">Start beat</div>
              <div className="text-amber-gold/60">L: Fist 0.4s</div><div className="text-ink-mute/50">Stop beat</div>
              <div className="text-amber-gold/60">L: Pinch</div><div className="text-ink-mute/50">Mute toggle</div>
              <div className="text-amber-gold/60">L: Height/X</div><div className="text-ink-mute/50">Vol / Filter</div>
              <div className="text-cyan-400/60">R: Open + zone</div><div className="text-ink-mute/50">Slots 1–4</div>
              <div className="text-cyan-400/60">R: Two + zone</div><div className="text-ink-mute/50">Slots 5–8</div>
              <div className="text-cyan-400/60">R: Fist</div><div className="text-ink-mute/50">Silence</div>
              <div className="text-cyan-400/60">R: Pinch</div><div className="text-ink-mute/50">Sustain</div>
            </div>
            <div className="mt-2 text-[8px] text-ink-mute/25">
              Local processing only. Camera never leaves device.
            </div>
          </div>
        </div>

        {/* ── Center: Performance status ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="scrollbar-thin flex flex-1 flex-col gap-5 overflow-y-auto p-6">

            {/* Beat source selector */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (beatSource === 'youtube') {
                    window.dispatchEvent(new CustomEvent('verses:beat-pause'));
                  }
                  setBeatSource('drums');
                  beatLatchRef.current = 'stopped';
                }}
                className={`flex-1 py-2.5 text-[11px] tracking-wide transition-colors ${
                  beatSource === 'drums'
                    ? 'bg-amber-gold/10 text-amber-gold border-b-2 border-amber-gold/50'
                    : 'text-ink-mute/50 hover:text-ink-text/70 border-b-2 border-transparent'
                }`}
              >
                Drum Machine
              </button>
              <button
                onClick={() => {
                  drum.stop();
                  setBeatSource('youtube');
                  beatLatchRef.current = 'stopped';
                }}
                disabled={!youtubeSession}
                className={`flex-1 py-2.5 text-[11px] tracking-wide transition-colors ${
                  beatSource === 'youtube'
                    ? 'bg-amber-gold/10 text-amber-gold border-b-2 border-amber-gold/50'
                    : youtubeSession
                    ? 'text-ink-mute/50 hover:text-ink-text/70 border-b-2 border-transparent'
                    : 'text-ink-mute/20 cursor-not-allowed border-b-2 border-transparent'
                }`}
              >
                YouTube Beat
              </button>
            </div>

            {beatSource === 'youtube' && !youtubeSession && (
              <div className="text-center text-[12px] text-ink-mute/40">
                Load a YouTube beat in the editor first.
              </div>
            )}

            {beatSource === 'youtube' && youtubeSession && (
              <div className="text-center text-[12px] text-ink-mute/60">
                {youtubeSession.youtube_title}
              </div>
            )}

            {/* Beat status — large and dominant */}
            <div className="py-4 text-center">
              <div className={`font-mono text-[13px] tracking-wider ${
                beatLatchRef.current === 'playing' ? 'text-amber-gold' :
                beatLatchRef.current === 'muted' ? 'text-amber-gold/40' :
                'text-ink-mute/40'
              }`}>
                {beatLatchRef.current === 'playing' ? 'LOOPING' :
                 beatLatchRef.current === 'muted' ? 'MUTED' : 'STOPPED'}
              </div>
              <div className="mt-2 font-serif text-3xl tracking-tight text-ink-text/90">
                {beatLatchRef.current !== 'stopped' ? (
                  <>{currentPreset.name} <span className="font-mono text-lg text-ink-mute/50">{drum.currentBpm}</span></>
                ) : (
                  <span className="text-ink-mute/20">—</span>
                )}
              </div>
            </div>

            {/* Guidance text */}
            {beatLatchRef.current === 'stopped' && !activeSlot && (
              <div className="text-center text-[12px] leading-relaxed text-ink-mute/40">
                Open left palm to start the loop. Use right hand zones for chords.
              </div>
            )}

            {/* Chord display */}
            <div className="rounded-sm bg-ink-surface/40 p-5">
              <div className="mb-2 text-[10px] text-ink-mute/40">Current chord</div>
              <div className="font-serif text-5xl font-bold tracking-tight text-ink-text/90">
                {isSilenced ? (
                  <span className="text-ink-mute">SILENCE</span>
                ) : activeSlot ? (
                  (() => {
                    const slot = chordSlots.find(s => s.slot === activeSlot);
                    return slot ? chordLabel(slot.root, slot.quality) : <span className="text-ink-mute">—</span>;
                  })()
                ) : (
                  <span className="text-ink-mute">—</span>
                )}
              </div>
              <div className="mt-3">
                <PianoKeyboard activeNotes={chord.activeNotes} />
              </div>
            </div>

            {/* Chord slot pads */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="w-16 text-[9px] text-ink-mute/40">Open hand</span>
                <div className="flex flex-1 gap-1">
                  {[1, 2, 3, 4].map(slot => {
                    const slotData = chordSlots.find(s => s.slot === slot);
                    return (
                      <div
                        key={slot}
                        className={`flex-1 rounded-sm py-2 text-center font-mono text-[11px] transition-all duration-75 ${
                          activeSlot === slot
                            ? 'bg-amber-gold/20 text-amber-gold shadow-[inset_0_0_0_1px_rgba(201,168,76,0.4)]'
                            : 'bg-ink-surface/40 text-ink-mute/60'
                        }`}
                      >
                        {slotData ? chordLabel(slotData.root, slotData.quality) : slot}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-16 text-[9px] text-ink-mute/40">Two fingers</span>
                <div className="flex flex-1 gap-1">
                  {[5, 6, 7, 8].map(slot => {
                    const slotData = chordSlots.find(s => s.slot === slot);
                    return (
                      <div
                        key={slot}
                        className={`flex-1 rounded-sm py-2 text-center font-mono text-[11px] transition-all duration-75 ${
                          activeSlot === slot
                            ? 'bg-amber-gold/20 text-amber-gold shadow-[inset_0_0_0_1px_rgba(201,168,76,0.4)]'
                            : 'bg-ink-surface/40 text-ink-mute/60'
                        }`}
                      >
                        {slotData ? chordLabel(slotData.root, slotData.quality) : slot}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Zone indicator */}
            <div className="flex gap-1">
              {[0, 1, 2, 3].map(zone => (
                <div
                  key={zone}
                  className={`flex-1 rounded-sm py-1.5 text-center font-mono text-[9px] transition-all duration-75 ${
                    rightZone === zone
                      ? 'bg-cyan-400/15 text-cyan-400 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.3)]'
                      : 'bg-ink-surface/20 text-ink-mute/30'
                  }`}
                >
                  {zone + 1}
                </div>
              ))}
            </div>

            {/* Hand tracking status */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-sm bg-ink-surface/30 p-3">
                <div className="text-[9px] text-amber-gold/60">Left — Rhythm</div>
                <div className="mt-1 font-mono text-base text-ink-text/80">
                  {leftHand.present && leftHand.gesture ? 
                    GESTURE_LABELS[leftHand.gesture as GestureId] : "—"}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-ink-mute/40">
                  {leftHand.present ? "Tracking" : "Not detected"}
                </div>
              </div>
              <div className="rounded-sm bg-ink-surface/30 p-3">
                <div className="text-[9px] text-cyan-400/60">Right — Harmony</div>
                <div className="mt-1 font-mono text-base text-ink-text/80">
                  {rightHand.present && rightHand.gesture ? 
                    GESTURE_LABELS[rightHand.gesture as GestureId] : "—"}
                </div>
                <div className="mt-0.5 font-mono text-[9px] text-ink-mute/40">
                  {activeSlot ? `Slot ${activeSlot}` : rightHand.present ? "Tracking" : "Not detected"}
                </div>
              </div>
            </div>

            {beatSource === 'youtube' && (
              <div className="rounded-sm bg-amber-gold/5 px-4 py-2.5 text-[11px] text-amber-gold/60">
                YouTube audio cannot be captured in recordings due to browser restrictions.
              </div>
            )}

          </div>
        </div>

        {/* ── Right: Controls ── */}
        <div className="w-72 flex-shrink-0 border-l border-ink-line/30">
          <div className="border-b border-ink-line/30">
            <div className="flex">
              {(['sound', 'chords', 'guide'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.2em] transition-colors ${
                    activeTab === tab
                      ? 'border-b border-amber-gold/60 text-amber-gold/90'
                      : 'text-ink-mute/40 hover:text-ink-text/70'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="scrollbar-thin h-full overflow-y-auto p-4">
            {activeTab === 'sound' && (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Drum Preset</div>
                  <div className="space-y-1">
                    {DRUM_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        onClick={() => drum.setPreset(preset.name)}
                        className={`w-full border px-2 py-1 font-mono text-xs text-left transition-colors ${
                          drum.presetName === preset.name
                            ? 'border-amber-gold bg-amber-gold/20 text-amber-gold'
                            : 'border-ink-line text-ink-mute hover:border-ink-text hover:text-ink-text'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Instrument</div>
                  <div className="space-y-1">
                    {INSTRUMENT_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        className="w-full border border-ink-line px-2 py-1 font-mono text-xs text-left text-ink-mute transition-colors hover:border-ink-text hover:text-ink-text"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">
                    Master Volume: {Math.round(drum.masterVolume * 100)}%
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={drum.masterVolume}
                    onChange={(e) => drum.setMasterVolume(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">
                    Chord Volume: {Math.round(chordVolume * 100)}%
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={chordVolume}
                    onChange={(e) => setChordVolumeState(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Step Sequencer</div>
                  <div className="space-y-1">
                    {['kick', 'snare', 'hihat', 'perc'].map(drum => (
                      <div key={drum} className="flex gap-1">
                        {currentPreset.pattern[drum as keyof typeof currentPreset.pattern].map((step, i) => (
                          <div
                            key={i}
                            className={`h-4 w-4 border ${
                              step ? 'bg-amber-gold border-amber-gold' : 'border-ink-line'
                            }`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* BPM controls */}
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">BPM</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => drum.setBpm(drum.currentBpm - 5)}
                      className="border border-ink-line px-2 py-0.5 font-mono text-sm text-ink-mute hover:border-ink-text hover:text-ink-text"
                    >
                      -5
                    </button>
                    <button
                      onClick={() => drum.setBpm(drum.currentBpm - 1)}
                      className="border border-ink-line px-2 py-0.5 font-mono text-sm text-ink-mute hover:border-ink-text hover:text-ink-text"
                    >
                      -
                    </button>
                    <span className="min-w-[3rem] text-center font-mono text-lg text-ink-text">
                      {drum.currentBpm}
                    </span>
                    <button
                      onClick={() => drum.setBpm(drum.currentBpm + 1)}
                      className="border border-ink-line px-2 py-0.5 font-mono text-sm text-ink-mute hover:border-ink-text hover:text-ink-text"
                    >
                      +
                    </button>
                    <button
                      onClick={() => drum.setBpm(drum.currentBpm + 5)}
                      className="border border-ink-line px-2 py-0.5 font-mono text-sm text-ink-mute hover:border-ink-text hover:text-ink-text"
                    >
                      +5
                    </button>
                    <button
                      onClick={() => drum.setBpm(currentPreset.bpm)}
                      className="ml-1 border border-ink-line px-2 py-0.5 font-mono text-[10px] uppercase text-ink-mute hover:border-ink-text hover:text-ink-text"
                      title="Reset to preset default"
                    >
                      rst
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'chords' && (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Slot Preset</div>
                  <div className="space-y-1">
                    {Object.keys(SLOT_PRESETS).map(preset => (
                      <button
                        key={preset}
                        onClick={() => setChordSlots(SLOT_PRESETS[preset])}
                        className={`w-full border px-2 py-1 font-mono text-xs text-left transition-colors ${
                          chordSlots === SLOT_PRESETS[preset]
                            ? 'border-amber-gold bg-amber-gold/20 text-amber-gold'
                            : 'border-ink-line text-ink-mute hover:border-ink-text hover:text-ink-text'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Slot Editor</div>
                  <div className="space-y-2">
                    {chordSlots.map(slot => (
                      <div key={slot.slot} className="border border-ink-line p-2">
                        <div className="mb-1 font-mono text-xs text-ink-mute">Slot {slot.slot}</div>
                        <div className="grid grid-cols-2 gap-1">
                          <select
                            value={slot.root}
                            onChange={(e) => {
                              const newSlots = [...chordSlots];
                              const idx = newSlots.findIndex(s => s.slot === slot.slot);
                              if (idx !== -1) {
                                newSlots[idx] = { ...newSlots[idx], root: e.target.value };
                                setChordSlots(newSlots);
                              }
                            }}
                            className="border border-ink-line bg-ink px-1 py-0.5 font-mono text-xs text-ink-text"
                          >
                            {ROOTS.map(root => (
                              <option key={root} value={root}>{root}</option>
                            ))}
                          </select>
                          <select
                            value={slot.quality}
                            onChange={(e) => {
                              const newSlots = [...chordSlots];
                              const idx = newSlots.findIndex(s => s.slot === slot.slot);
                              if (idx !== -1) {
                                newSlots[idx] = { ...newSlots[idx], quality: e.target.value as ChordQuality };
                                setChordSlots(newSlots);
                              }
                            }}
                            className="border border-ink-line bg-ink px-1 py-0.5 font-mono text-xs text-ink-text"
                          >
                            {QUALITIES.map(quality => (
                              <option key={quality} value={quality}>{quality}</option>
                            ))}
                          </select>
                          <select
                            value={slot.octave}
                            onChange={(e) => {
                              const newSlots = [...chordSlots];
                              const idx = newSlots.findIndex(s => s.slot === slot.slot);
                              if (idx !== -1) {
                                newSlots[idx] = { ...newSlots[idx], octave: parseInt(e.target.value) };
                                setChordSlots(newSlots);
                              }
                            }}
                            className="border border-ink-line bg-ink px-1 py-0.5 font-mono text-xs text-ink-text"
                          >
                            {[1, 2, 3, 4, 5].map(oct => (
                              <option key={oct} value={oct}>Oct {oct}</option>
                            ))}
                          </select>
                          <select
                            value={slot.inversion}
                            onChange={(e) => {
                              const newSlots = [...chordSlots];
                              const idx = newSlots.findIndex(s => s.slot === slot.slot);
                              if (idx !== -1) {
                                newSlots[idx] = { ...newSlots[idx], inversion: e.target.value as 'root' | 'first' | 'second' };
                                setChordSlots(newSlots);
                              }
                            }}
                            className="border border-ink-line bg-ink px-1 py-0.5 font-mono text-xs text-ink-text"
                          >
                            <option value="root">Root</option>
                            <option value="first">1st</option>
                            <option value="second">2nd</option>
                          </select>
                        </div>
                        <button
                          onClick={() => chord.playChord(slot)}
                          className="mt-1 w-full border border-ink-line px-1 py-0.5 font-mono text-xs text-ink-mute transition-colors hover:border-ink-text hover:text-ink-text"
                        >
                          Preview
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'guide' && (
              <div className="space-y-4 font-mono text-xs text-ink-mute">
                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Gesture Reference</div>
                  <div className="space-y-2">
                    <div>
                      <div className="text-amber-gold">LEFT HAND</div>
                      <div>OPEN: Hold 0.4s to start beat (latches)</div>
                      <div>FIST: Hold 0.4s to stop beat</div>
                      <div>PINCH: Toggle mute/unmute</div>
                      <div>HEIGHT: Control volume</div>
                      <div>X POSITION: Control filter</div>
                    </div>
                    <div>
                      <div className="text-indigo-400">RIGHT HAND</div>
                      <div>OPEN + ZONE: Slots 1-4</div>
                      <div>TWO + ZONE: Slots 5-8</div>
                      <div>FIST: Silence all chords</div>
                      <div>PINCH: Toggle sustain</div>
                      <div>POINT: Same as OPEN (slots 1-4)</div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Beat Source</div>
                  <div>DRUM PRESET: Built-in drum machine</div>
                  <div>YOUTUBE BEAT: External audio from editor</div>
                  <div>Note: YouTube audio cannot be recorded</div>
                </div>

                <div>
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Recording</div>
                  <div>Audio is captured from drum engine</div>
                  <div>and chord synthesizer only.</div>
                  <div>YouTube beats are excluded due to</div>
                  <div>browser security restrictions.</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Transport strip ── */}
      <div className="flex items-center justify-between border-t border-ink-line/30 px-6 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={camActive ? stopCamera : startCamera}
            className={`border px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
              camActive
                ? 'border-red-500 text-red-500 hover:bg-red-500/10'
                : 'border-amber-gold text-amber-gold hover:bg-amber-gold/10'
            }`}
          >
            {camActive ? 'STOP CAMERA' : 'START CAMERA'}
          </button>

          {beatSource === 'drums' && (
            <button
              onClick={drum.playing ? drum.stop : drum.play}
              className={`border px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
                drum.playing
                  ? 'border-red-500 text-red-500 hover:bg-red-500/10'
                  : 'border-amber-gold text-amber-gold hover:bg-amber-gold/10'
              }`}
            >
              {drum.playing ? 'STOP' : 'PLAY DRUMS'}
            </button>
          )}

          <select
            value={drum.presetName}
            onChange={(e) => drum.setPreset(e.target.value)}
            className="border border-ink-line bg-ink px-2 py-1 font-mono text-xs text-ink-text"
          >
            {DRUM_PRESETS.map(preset => (
              <option key={preset.name} value={preset.name}>{preset.name}</option>
            ))}
          </select>

          <select
            className="border border-ink-line bg-ink px-2 py-1 font-mono text-xs text-ink-text"
          >
            {INSTRUMENT_PRESETS.map(preset => (
              <option key={preset.name} value={preset.name}>{preset.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={!camActive}
            className={`border px-3 py-1 font-mono text-xs uppercase tracking-wider transition-colors ${
              recording
                ? 'border-red-500 text-red-500 hover:bg-red-500/10'
                : camActive
                ? 'border-amber-gold text-amber-gold hover:bg-amber-gold/10'
                : 'border-ink-line/40 text-ink-mute/40 cursor-not-allowed'
            }`}
          >
            {recording ? '■ STOP' : '● RECORD'}
          </button>

          <button
            onClick={onClose}
            className="border border-ink-line px-3 py-1 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-ink-text hover:text-ink-text"
          >
            SAVE TAKE
          </button>

          <div className="border border-ink-line px-3 py-1 font-mono text-xs text-ink-mute">
            BPM: {drum.currentBpm}
          </div>
        </div>
      </div>
    </div>
  );
}