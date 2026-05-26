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
  | "dim";

type ChordMapping = {
  gesture: GestureId;
  root: string;
  quality: ChordQuality;
  octave: number;
  inversion: "root" | "first" | "second";
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
    levels: { kick: 0.95, snare: 0.8, hihat: 0.35, perc: 0.5 },
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

const CHORD_MAP_PRESETS: Record<string, ChordMapping[]> = {
  Pop: [
    { gesture: "open",  root: "C",  quality: "major", octave: 4, inversion: "root" },
    { gesture: "pinch", root: "G",  quality: "major", octave: 4, inversion: "root" },
    { gesture: "two",   root: "A",  quality: "minor", octave: 4, inversion: "root" },
    { gesture: "fist",  root: "F",  quality: "major", octave: 4, inversion: "root" },
    { gesture: "point", root: "E",  quality: "minor", octave: 4, inversion: "root" },
  ],
  "R&B": [
    { gesture: "open",  root: "F",  quality: "maj7",  octave: 4, inversion: "root" },
    { gesture: "pinch", root: "E",  quality: "min7",  octave: 4, inversion: "root" },
    { gesture: "two",   root: "A",  quality: "min7",  octave: 4, inversion: "root" },
    { gesture: "fist",  root: "G",  quality: "major", octave: 4, inversion: "root" },
    { gesture: "point", root: "D",  quality: "minor", octave: 4, inversion: "root" },
  ],
  Sad: [
    { gesture: "open",  root: "A",  quality: "minor", octave: 4, inversion: "root" },
    { gesture: "pinch", root: "F",  quality: "major", octave: 4, inversion: "root" },
    { gesture: "two",   root: "C",  quality: "major", octave: 4, inversion: "root" },
    { gesture: "fist",  root: "G",  quality: "major", octave: 4, inversion: "root" },
    { gesture: "point", root: "E",  quality: "minor", octave: 4, inversion: "root" },
  ],
  Jazz: [
    { gesture: "open",  root: "D",  quality: "min7",  octave: 4, inversion: "root" },
    { gesture: "pinch", root: "G",  quality: "dom7",  octave: 4, inversion: "root" },
    { gesture: "two",   root: "C",  quality: "maj7",  octave: 4, inversion: "root" },
    { gesture: "fist",  root: "A",  quality: "min7",  octave: 4, inversion: "root" },
    { gesture: "point", root: "B",  quality: "min7",  octave: 4, inversion: "root" },
  ],
};

const NOTE_NAMES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const ROOTS = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
const QUALITIES: ChordQuality[] = ["major","minor","maj7","min7","dom7","sus2","sus4","dim"];
const GESTURE_LABELS: Record<GestureId, string> = {
  open: "Open Palm",
  pinch: "Pinch",
  two: "Peace ✌",
  fist: "Fist",
  point: "Point ☞",
};
const GESTURE_ICONS: Record<GestureId, string> = {
  open: "🖐",
  pinch: "🤌",
  two: "✌️",
  fist: "✊",
  point: "☝️",
};

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
  }
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

  const [playing, setPlaying] = useState(false);
  const [presetName, setPresetNameState] = useState(DRUM_PRESETS[0].name);
  const [masterVolume, setMasterVolumeState] = useState(0.8);
  const [drumVolume, setDrumVolumeState] = useState(0.7);
  const [filterCutoff, setFilterCutoffState] = useState(4000);

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

    drumGain.connect(filter);
    filter.connect(masterGain);

    if (destNode) {
      masterGain.connect(destNode as AudioNode);
    }
    masterGain.connect(ctx.destination);

    return ctx;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destNode]);

  const scheduleKick = useCallback((ctx: AudioContext, gain: GainNode, time: number, level: number) => {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.connect(env);
    env.connect(gain);
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.15);
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
    noiseFilter.Q.value = 0.8;
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
    env.gain.setValueAtTime(level * 0.6, time);
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
    const stepDuration = 60 / p.bpm / 4; // 16th note duration

    while (nextBeatTimeRef.current < ctx.currentTime + lookahead) {
      const step = stepRef.current % 16;
      // Apply swing: odd steps are pushed forward
      const swingOffset = (step % 2 === 1) ? stepDuration * (p.swing - 0.5) * 0.5 : 0;
      const schedTime = Math.max(ctx.currentTime, nextBeatTimeRef.current + swingOffset);
      scheduleStep(ctx, dGain, step, schedTime);
      nextBeatTimeRef.current += stepDuration;
      stepRef.current = (stepRef.current + 1) % 16;
    }
  }, [scheduleStep]);

  const play = useCallback(() => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") ctx.resume();
    playingRef.current = true;
    stepRef.current = 0;
    nextBeatTimeRef.current = ctx.currentTime + 0.05;
    if (schedulerRef.current !== null) clearInterval(schedulerRef.current);
    schedulerRef.current = window.setInterval(runScheduler, 25);
    setPlaying(true);
  }, [ensureCtx, runScheduler]);

  const stop = useCallback(() => {
    playingRef.current = false;
    if (schedulerRef.current !== null) {
      clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
    setPlaying(false);
  }, []);

  const selectPreset = useCallback((name: string) => {
    const preset = DRUM_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    presetRef.current = preset;
    setPresetNameState(name);
  }, []);

  const setMasterVolume = useCallback((v: number) => {
    setMasterVolumeState(v);
    if (masterGainRef.current) masterGainRef.current.gain.value = v;
  }, []);

  const setDrumVolume = useCallback((v: number) => {
    setDrumVolumeState(v);
    if (drumGainRef.current) drumGainRef.current.gain.value = v;
  }, []);

  const setFilterCutoff = useCallback((f: number) => {
    setFilterCutoffState(f);
    if (filterRef.current) filterRef.current.frequency.value = f;
  }, []);

  const getMasterGain = useCallback(() => masterGainRef.current, []);
  const getCtx = useCallback(() => ctxRef.current, []);

  const destroy = useCallback(() => {
    stop();
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
  }, [stop]);

  return {
    playing, presetName, masterVolume, drumVolume, filterCutoff,
    play, stop, selectPreset,
    setMasterVolume, setDrumVolume, setFilterCutoff,
    getMasterGain, getCtx,
    destroy, ensureCtx,
  };
}

// ─── Chord Synth Hook ─────────────────────────────────────────────────────────

function useChordSynth(destNode: AudioNode | null, drumGetCtx: () => AudioContext | null) {
  const activeVoicesRef = useRef<{ gain: GainNode; oscs: OscillatorNode[]; stopAt: number }[]>([]);
  const instrumentRef = useRef<InstrumentPreset>(INSTRUMENT_PRESETS[0]);
  const masterGainRef = useRef<GainNode | null>(null);
  const reverbRef = useRef<{ input: GainNode; output: GainNode } | null>(null);
  const [instrumentName, setInstrumentNameState] = useState(INSTRUMENT_PRESETS[0].name);
  const [activeChord, setActiveChord] = useState<string | null>(null);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);

  const getCtx = useCallback((): AudioContext | null => {
    return drumGetCtx();
  }, [drumGetCtx]);

  const ensureGain = useCallback((ctx: AudioContext) => {
    if (masterGainRef.current) return masterGainRef.current;
    const mg = ctx.createGain();
    mg.gain.value = 0.6;
    masterGainRef.current = mg;

    const { reverbWet } = instrumentRef.current;
    const rev = createReverb(ctx, reverbWet);
    reverbRef.current = rev;
    mg.connect(rev.input);
    rev.output.connect(ctx.destination);
    if (destNode) rev.output.connect(destNode as AudioNode);
    return mg;
  }, [destNode]);

  const stopAllVoices = useCallback((ctx: AudioContext, fadeTime = 0.05) => {
    const now = ctx.currentTime;
    for (const v of activeVoicesRef.current) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + fadeTime);
      v.oscs.forEach((o) => {
        try { o.stop(now + fadeTime + 0.01); } catch {}
      });
    }
    activeVoicesRef.current = [];
  }, []);

  const playChord = useCallback((mapping: ChordMapping) => {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const mg = ensureGain(ctx);
    const inst = instrumentRef.current;
    stopAllVoices(ctx, 0.05);

    const freqs = chordFrequencies(mapping.root, mapping.octave, mapping.quality, mapping.inversion);
    const midiNotes = chordMidiNotes(mapping.root, mapping.octave, mapping.quality);
    setActiveNotes(midiNotes);
    setActiveChord(chordLabel(mapping.root, mapping.quality));

    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = inst.filterFreq;
    lpf.connect(mg);

    const now = ctx.currentTime;

    for (const freq of freqs) {
      for (let li = 0; li < inst.oscillatorTypes.length; li++) {
        const osc = ctx.createOscillator();
        const voiceGain = ctx.createGain();
        osc.type = inst.oscillatorTypes[li];
        osc.frequency.value = freq;
        osc.detune.value = (li - (inst.oscillatorTypes.length - 1) / 2) * inst.detuneSpread;
        osc.connect(voiceGain);
        voiceGain.connect(lpf);

        const peakGain = 0.18 / (freqs.length * inst.oscillatorTypes.length);
        voiceGain.gain.setValueAtTime(0, now);
        voiceGain.gain.linearRampToValueAtTime(peakGain, now + inst.attackTime);

        osc.start(now);
        activeVoicesRef.current.push({ gain: voiceGain, oscs: [osc], stopAt: Infinity });
      }
    }
  }, [getCtx, ensureGain, stopAllVoices]);

  const releaseChord = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    const inst = instrumentRef.current;
    stopAllVoices(ctx, inst.releaseTime);
    setActiveChord(null);
    setActiveNotes([]);
  }, [getCtx, stopAllVoices]);

  const selectInstrument = useCallback((name: string) => {
    const inst = INSTRUMENT_PRESETS.find((p) => p.name === name);
    if (!inst) return;
    instrumentRef.current = inst;
    setInstrumentNameState(name);
    // Rebuild reverb if needed
    const ctx = getCtx();
    if (ctx && masterGainRef.current && reverbRef.current) {
      try {
        masterGainRef.current.disconnect();
      } catch {}
      const rev = createReverb(ctx, inst.reverbWet);
      reverbRef.current = rev;
      masterGainRef.current.connect(rev.input);
      rev.output.connect(ctx.destination);
      if (destNode) rev.output.connect(destNode as AudioNode);
    }
  }, [getCtx, destNode]);

  return { instrumentName, activeChord, activeNotes, playChord, releaseChord, selectInstrument };
}

// ─── Gesture Detection ───────────────────────────────────────────────────────

interface Landmark { x: number; y: number; z: number }

function fingerExtended(landmarks: Landmark[], tipIdx: number, pipIdx: number, mcpIdx: number): boolean {
  // When hand is upright, tip.y < pip.y (higher up = smaller y)
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];
  const mcp = landmarks[mcpIdx];
  const handDir = mcp.y - tip.y; // positive = finger pointing up
  return handDir > 0 && (tip.y < pip.y);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function thumbExtended(landmarks: Landmark[]): boolean {
  const tip = landmarks[4];
  const ip  = landmarks[3];
  const mcp = landmarks[2];
  // Thumb extends sideways; use x-distance
  return Math.abs(tip.x - mcp.x) > Math.abs(ip.x - mcp.x) * 1.2;
}

function detectGesture(landmarks: Landmark[]): GestureId {
  // Pinch: thumb tip close to index tip
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  if (pinchDist < 0.07) return "pinch";

  // Check extended fingers: index=8/6/5, middle=12/10/9, ring=16/14/13, pinky=20/18/17
  const indexExt  = fingerExtended(landmarks, 8,  6,  5);
  const middleExt = fingerExtended(landmarks, 12, 10, 9);
  const ringExt   = fingerExtended(landmarks, 16, 14, 13);
  const pinkyExt  = fingerExtended(landmarks, 20, 18, 17);

  const extCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length;

  if (extCount >= 3) return "open";
  if (extCount === 0) return "fist";
  if (indexExt && middleExt && !ringExt && !pinkyExt) return "two";
  if (indexExt && !middleExt && !ringExt && !pinkyExt) return "point";

  return "fist";
}

// ─── Piano Keyboard Component ─────────────────────────────────────────────────

function PianoKeyboard({ activeNotes }: { activeNotes: number[] }) {
  // Render C4 (midi 60) through E5 (midi 76) — 1.5 octaves
  const startMidi = 60;
  const endMidi = 76;
  const notes: number[] = [];
  for (let m = startMidi; m <= endMidi; m++) notes.push(m);

  const isBlack = (midi: number) => {
    const n = midi % 12;
    return [1, 3, 6, 8, 10].includes(n);
  };

  // Build layout: only white keys get explicit positions
  const whiteKeys: number[] = notes.filter((m) => !isBlack(m));
  const keyWidth = 100 / whiteKeys.length;

  return (
    <div className="relative h-16 select-none" style={{ width: "100%" }}>
      {whiteKeys.map((midi, idx) => {
        const active = activeNotes.includes(midi);
        return (
          <div
            key={midi}
            className={`absolute bottom-0 border border-ink-line ${
              active ? "bg-amber-gold" : "bg-ink-surface"
            }`}
            style={{
              left: `${idx * keyWidth}%`,
              width: `${keyWidth - 0.5}%`,
              height: "100%",
            }}
          />
        );
      })}
      {notes.filter(isBlack).map((midi) => {
        const active = activeNotes.includes(midi);
        // Find position: count white keys to the left
        const whitesBefore = notes.filter((m) => m < midi && !isBlack(m)).length - notes.filter((m) => m < startMidi && !isBlack(m)).length;
        return (
          <div
            key={midi}
            className={`absolute z-10 ${active ? "bg-amber-gold" : "bg-ink-text"}`}
            style={{
              left: `${(whitesBefore) * keyWidth + keyWidth * 0.65}%`,
              width: `${keyWidth * 0.6}%`,
              height: "58%",
              top: 0,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Landmark canvas draw ─────────────────────────────────────────────────────

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],         // thumb
  [0,5],[5,6],[6,7],[7,8],         // index
  [5,9],[9,10],[10,11],[11,12],    // middle
  [9,13],[13,14],[14,15],[15,16],  // ring
  [13,17],[17,18],[18,19],[19,20], // pinky
  [0,17],                          // palm base
];

function drawHandLandmarks(
  ctx2d: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  color: string
) {
  ctx2d.strokeStyle = color;
  ctx2d.lineWidth = 2;
  for (const [a, b] of HAND_CONNECTIONS) {
    const lA = landmarks[a], lB = landmarks[b];
    ctx2d.beginPath();
    ctx2d.moveTo(lA.x * width, lA.y * height);
    ctx2d.lineTo(lB.x * width, lB.y * height);
    ctx2d.stroke();
  }
  ctx2d.fillStyle = color;
  for (const lm of landmarks) {
    ctx2d.beginPath();
    ctx2d.arc(lm.x * width, lm.y * height, 4, 0, Math.PI * 2);
    ctx2d.fill();
  }
}

// ─── PerformModal Component ────────────────────────────────────────────────────

export function PerformModal({
  open,
  onClose,
  songId,
  onTakeSaved,
}: {
  open: boolean;
  onClose: () => void;
  songId: string;
  onTakeSaved: () => void;
}) {
  // Recording destination
  const recDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const [recDestNode, setRecDestNode] = useState<AudioNode | null>(null);

  // Drum engine
  const drum = useDrumEngine(recDestNode);

  // Chord synth
  const chord = useChordSynth(recDestNode, drum.getCtx);

  // ── Camera / MediaPipe state ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handLandmarkerRef = useRef<{
    detectForVideo: (video: HTMLVideoElement, time: number) => {
      landmarks: Landmark[][];
      handedness: { categoryName: string }[][];
    };
    close: () => void;
  } | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTime = useRef(0);
  const frameCount = useRef(0);
  const fpsTimer = useRef(0);

  const [camActive, setCamActive] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [mediaPipeLoading, setMediaPipeLoading] = useState(false);
  const [fps, setFps] = useState(0);

  // ── Hand state ──
  const [leftHand, setLeftHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  const [rightHand, setRightHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  const prevLeftGesture = useRef<GestureId | null>(null);
  const prevRightGesture = useRef<GestureId | null>(null);
  const drumMuted = useRef(false);

  // ── Chord mappings ──
  const [chordMappings, setChordMappings] = useState<ChordMapping[]>(CHORD_MAP_PRESETS["Pop"]);
  const [chordMapPreset, setChordMapPreset] = useState("Pop");
  const [mappingTab, setMappingTab] = useState<"mappings" | "presets">("mappings");

  // ── Recording ──
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const recStartRef = useRef(0);
  const recTickRef = useRef<number | null>(null);
  const [savedBlob, setSavedBlob] = useState<Blob | null>(null);
  const [takeCount, setTakeCount] = useState(1);

  // ── UI state ──
  const [activeRightChord, setActiveRightChord] = useState<string | null>(null);

  // Sync activeChord display
  useEffect(() => {
    setActiveRightChord(chord.activeChord);
  }, [chord.activeChord]);

  // ── Setup recording destination once AudioContext is live ──
  const setupRecDest = useCallback(() => {
    const ctx = drum.getCtx();
    if (!ctx || recDestRef.current) return;
    try {
      const dest = ctx.createMediaStreamDestination();
      recDestRef.current = dest;
      setRecDestNode(dest);
      const mg = drum.getMasterGain();
      if (mg) mg.connect(dest);
    } catch {}
  }, [drum]);

  // ── Load MediaPipe ──
  const loadMediaPipe = useCallback(async () => {
    if (handLandmarkerRef.current) return;
    setMediaPipeLoading(true);
    try {
      // Dynamic import to avoid SSR crash
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

  // ── Start camera ──
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

  // ── Stop camera ──
  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamActive(false);
    setLeftHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
    setRightHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  }, []);

  // ── Process gesture results ──
  const processGestures = useCallback((
    landmarks: Landmark[][],
    handedness: { categoryName: string }[][]
  ) => {
    let newLeft: HandState = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };
    let newRight: HandState = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };

    for (let i = 0; i < landmarks.length; i++) {
      const lms = landmarks[i];
      const side = handedness[i]?.[0]?.categoryName ?? "Right";
      const gesture = detectGesture(lms);
      const wrist = lms[0];
      const state: HandState = { gesture, wristX: wrist.x, wristY: wrist.y, present: true };

      // MediaPipe mirrors: "Left" in camera = user's right hand
      if (side === "Left") {
        newRight = state;
      } else {
        newLeft = state;
      }
    }

    setLeftHand(newLeft);
    setRightHand(newRight);

    // ── Left hand → drum controls ──
    if (newLeft.present && newLeft.gesture) {
      const g = newLeft.gesture;
      if (g !== prevLeftGesture.current) {
        if (g === "open" && !drumMuted.current) {
          if (!drum.playing) drum.play();
        } else if (g === "fist") {
          if (drum.playing) drum.stop();
        } else if (g === "pinch") {
          drumMuted.current = !drumMuted.current;
          drum.setDrumVolume(drumMuted.current ? 0 : 0.7);
        }
        prevLeftGesture.current = g;
      }
      // Wrist Y → drum volume (inverted: higher hand = louder)
      const vol = Math.max(0, Math.min(1, 1 - newLeft.wristY));
      drum.setDrumVolume(drumMuted.current ? 0 : vol);
      // Wrist X → filter cutoff
      const cutoff = 200 + newLeft.wristX * 7800;
      drum.setFilterCutoff(cutoff);
    } else {
      prevLeftGesture.current = null;
    }

    // ── Right hand → chord controls ──
    if (newRight.present && newRight.gesture) {
      const g = newRight.gesture;
      if (g !== prevRightGesture.current) {
        const mapping = chordMappings.find((m) => m.gesture === g);
        if (mapping) {
          chord.playChord(mapping);
        }
        prevRightGesture.current = g;
      }
    } else {
      if (prevRightGesture.current !== null) {
        chord.releaseChord();
        prevRightGesture.current = null;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordMappings, drum, chord]);

  // ── Detection loop ──
  const detectionLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(detectionLoop);
      return;
    }

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) {
      rafRef.current = requestAnimationFrame(detectionLoop);
      return;
    }

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const now = performance.now();
    // FPS counter
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
          result.landmarks.forEach((lms, i) => {
            const side = result.handedness[i]?.[0]?.categoryName;
            const color = side === "Left" ? "#f59e0b" : "#6366f1";
            drawHandLandmarks(ctx2d, lms, canvas.width, canvas.height, color);
          });
        } else {
          // No hands: release chord
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
  }, [processGestures, chord]);

  // Start detection loop when camera is active
  useEffect(() => {
    if (camActive) {
      fpsTimer.current = performance.now();
      rafRef.current = requestAnimationFrame(detectionLoop);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [camActive, detectionLoop]);

  // ── Recording logic ──
  const startRecording = useCallback(() => {
    setupRecDest();
    const dest = recDestRef.current;
    if (!dest) {
      // Try to init audio first
      drum.ensureCtx();
      return;
    }
    try {
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/ogg";
      const mr = new MediaRecorder(dest.stream, { mimeType: mime, audioBitsPerSecond: 192_000 });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        setSavedBlob(blob);
      };
      mr.start(100);
      recorderRef.current = mr;
      recStartRef.current = Date.now();
      setRecording(true);
      if (recTickRef.current !== null) clearInterval(recTickRef.current);
      recTickRef.current = window.setInterval(() => {
        setRecElapsed(Math.floor((Date.now() - recStartRef.current) / 1000));
      }, 500);
    } catch (err) {
      console.error("Recording failed:", err);
    }
  }, [drum, setupRecDest]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (recTickRef.current !== null) {
      clearInterval(recTickRef.current);
      recTickRef.current = null;
    }
    setRecording(false);
  }, []);

  const saveTake = useCallback(async () => {
    if (!savedBlob) return;
    const id = newTakeId();
    const duration = recElapsed;
    const mime = savedBlob.type;
    const take: Take = {
      id,
      song_id: songId,
      label: `gesture take ${takeCount}`,
      mime,
      duration,
      size: savedBlob.size,
      has_video: false,
      created_at: new Date().toISOString(),
      blob: savedBlob,
    };
    await takesStore.put(take);
    setTakeCount((c) => c + 1);
    setSavedBlob(null);
    setRecElapsed(0);
    onTakeSaved();
  }, [savedBlob, recElapsed, songId, takeCount, onTakeSaved]);

  // ── Cleanup on close / unmount ──
  const fullCleanup = useCallback(() => {
    stopCamera();
    drum.stop();
    drum.destroy();
    stopRecording();
    if (handLandmarkerRef.current) {
      try { handLandmarkerRef.current.close(); } catch {}
      handLandmarkerRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      drum.stop();
      stopRecording();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => { fullCleanup(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mapping editor helpers ──
  const updateMapping = useCallback((gesture: GestureId, patch: Partial<Omit<ChordMapping, "gesture">>) => {
    setChordMappings((prev) =>
      prev.map((m) => (m.gesture === gesture ? { ...m, ...patch } : m))
    );
  }, []);

  const applyMapPreset = useCallback((name: string) => {
    const preset = CHORD_MAP_PRESETS[name];
    if (!preset) return;
    setChordMappings(preset);
    setChordMapPreset(name);
  }, []);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!open) return null;

  const currentPreset = DRUM_PRESETS.find((p) => p.name === drum.presetName) ?? DRUM_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95 backdrop-blur-md print:hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-ink-line px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs uppercase tracking-widest text-amber-gold">
            Perform Mode
          </span>
          <span className="font-mono text-xs text-ink-mute">/ Gesture Instrument</span>
        </div>
        <div className="flex items-center gap-3">
          {recording && (
            <span className="flex items-center gap-1.5 font-mono text-xs text-red-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
              REC {fmtTime(recElapsed)}
            </span>
          )}
          <button
            onClick={onClose}
            className="border border-ink-line px-3 py-1 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-ink-text hover:text-ink-text"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {/* ── Main 3-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Left: Camera + guide ── */}
        <div className="flex w-72 flex-shrink-0 flex-col border-r border-ink-line">
          <div className="border-b border-ink-line px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">Camera Feed</span>
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
              <div className="absolute inset-0 flex items-center justify-center bg-ink/80">
                <span className="font-mono text-xs text-ink-mute">Camera off</span>
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
          {/* Gesture guide */}
          <div className="scrollbar-thin overflow-y-auto border-t border-ink-line p-3">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              Gesture Guide
            </div>
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] text-amber-gold">LEFT HAND — DRUMS</div>
              {[
                { g: "🖐 Open", desc: "Play drums" },
                { g: "✊ Fist", desc: "Pause drums" },
                { g: "🤌 Pinch", desc: "Toggle mute" },
                { g: "↕ Wrist Y", desc: "Drum volume" },
                { g: "↔ Wrist X", desc: "Filter cutoff" },
              ].map((item) => (
                <div key={item.g} className="flex justify-between gap-2">
                  <span className="font-mono text-[10px] text-ink-mute">{item.g}</span>
                  <span className="font-mono text-[10px] text-ink-text">{item.desc}</span>
                </div>
              ))}
              <div className="mt-2 font-mono text-[10px] text-indigo-400">RIGHT HAND — CHORDS</div>
              {(["open","pinch","two","fist","point"] as GestureId[]).map((g) => {
                const m = chordMappings.find((x) => x.gesture === g);
                return (
                  <div key={g} className="flex justify-between gap-2">
                    <span className="font-mono text-[10px] text-ink-mute">
                      {GESTURE_ICONS[g]} {GESTURE_LABELS[g]}
                    </span>
                    <span className="font-mono text-[10px] text-ink-text">
                      {m ? chordLabel(m.root, m.quality) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Center: Performance status ── */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-ink-line px-4 py-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">Performance</span>
          </div>
          <div className="scrollbar-thin flex flex-1 flex-col gap-4 overflow-y-auto p-5">

            {/* Chord display */}
            <div className="border border-ink-line bg-ink-surface p-4">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Current Chord</div>
              <div className="font-mono text-4xl font-bold tracking-tight text-ink-text">
                {activeRightChord ?? <span className="text-ink-mute text-3xl">—</span>}
              </div>
              <div className="mt-3">
                <PianoKeyboard activeNotes={chord.activeNotes} />
              </div>
            </div>

            {/* Hand states */}
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-ink-line bg-ink-surface p-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-amber-gold">Left Hand</div>
                <div className="font-mono text-2xl">
                  {leftHand.present && leftHand.gesture ? GESTURE_ICONS[leftHand.gesture] : "—"}
                </div>
                <div className="mt-1 font-mono text-xs text-ink-mute">
                  {leftHand.present && leftHand.gesture ? GESTURE_LABELS[leftHand.gesture] : "Not detected"}
                </div>
                {leftHand.present && (
                  <div className="mt-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-14 font-mono text-[10px] text-ink-mute">VOL</span>
                      <div className="h-1.5 flex-1 bg-ink-line">
                        <div
                          className="h-full bg-amber-gold transition-all"
                          style={{ width: `${(1 - leftHand.wristY) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-14 font-mono text-[10px] text-ink-mute">FILTER</span>
                      <div className="h-1.5 flex-1 bg-ink-line">
                        <div
                          className="h-full bg-amber-gold/60 transition-all"
                          style={{ width: `${leftHand.wristX * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="border border-ink-line bg-ink-surface p-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-indigo-400">Right Hand</div>
                <div className="font-mono text-2xl">
                  {rightHand.present && rightHand.gesture ? GESTURE_ICONS[rightHand.gesture] : "—"}
                </div>
                <div className="mt-1 font-mono text-xs text-ink-mute">
                  {rightHand.present && rightHand.gesture ? GESTURE_LABELS[rightHand.gesture] : "Not detected"}
                </div>
                {rightHand.present && rightHand.gesture && (
                  <div className="mt-2">
                    <span className="font-mono text-xs text-ink-text">
                      → {chordMappings.find((m) => m.gesture === rightHand.gesture)
                          ? chordLabel(
                              chordMappings.find((m) => m.gesture === rightHand.gesture)!.root,
                              chordMappings.find((m) => m.gesture === rightHand.gesture)!.quality
                            )
                          : "—"}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Drum status */}
            <div className="border border-ink-line bg-ink-surface p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Drum Engine</div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="font-mono text-[10px] text-ink-mute">PRESET</div>
                  <div className="font-mono text-sm text-ink-text">{drum.presetName}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] text-ink-mute">BPM</div>
                  <div className="font-mono text-sm text-ink-text">{currentPreset.bpm}</div>
                </div>
                <div>
                  <div className="font-mono text-[10px] text-ink-mute">STATUS</div>
                  <div className={`font-mono text-sm ${drum.playing ? "text-amber-gold" : "text-ink-mute"}`}>
                    {drum.playing ? "● PLAYING" : "○ STOPPED"}
                  </div>
                </div>
              </div>
              {/* Step sequencer visual */}
              <div className="mt-3 space-y-1.5">
                {(["kick","snare","hihat","perc"] as const).map((part) => (
                  <div key={part} className="flex items-center gap-2">
                    <span className="w-10 font-mono text-[9px] uppercase text-ink-mute">{part}</span>
                    <div className="flex gap-0.5">
                      {currentPreset.pattern[part].map((on, i) => (
                        <div
                          key={i}
                          className={`h-3 w-3 border ${
                            on
                              ? "border-amber-gold bg-amber-gold/70"
                              : "border-ink-line bg-transparent"
                          } ${i % 4 === 0 ? "ml-1 first:ml-0" : ""}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* FPS indicator */}
            {camActive && (
              <div className="font-mono text-[10px] text-ink-mute">
                CAM {fps} fps · HAND TRACKING {handLandmarkerRef.current ? "ON" : "OFF"}
              </div>
            )}

            {/* Privacy notice */}
            <div className="mt-auto border border-ink-line/50 p-2">
              <span className="font-mono text-[10px] text-ink-mute">
                🔒 Camera and mic stay on this device. Hand tracking runs locally in your browser.
              </span>
            </div>
          </div>
        </div>

        {/* ── Right: Chord mappings ── */}
        <div className="flex w-72 flex-shrink-0 flex-col border-l border-ink-line">
          <div className="flex items-center border-b border-ink-line">
            {(["mappings", "presets"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setMappingTab(tab)}
                className={`flex-1 border-b-2 py-2 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  mappingTab === tab
                    ? "border-amber-gold text-amber-gold"
                    : "border-transparent text-ink-mute hover:text-ink-text"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto p-3">
            {mappingTab === "presets" ? (
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">Chord Map Presets</div>
                {Object.keys(CHORD_MAP_PRESETS).map((name) => (
                  <button
                    key={name}
                    onClick={() => applyMapPreset(name)}
                    className={`w-full border px-3 py-2 text-left font-mono text-xs uppercase tracking-wider transition-colors ${
                      chordMapPreset === name
                        ? "border-amber-gold text-amber-gold"
                        : "border-ink-line text-ink-mute hover:border-ink-text hover:text-ink-text"
                    }`}
                  >
                    {name}
                  </button>
                ))}
                <div className="mt-4 border-t border-ink-line pt-3">
                  <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">Instrument</div>
                  {INSTRUMENT_PRESETS.map((ip) => (
                    <button
                      key={ip.name}
                      onClick={() => chord.selectInstrument(ip.name)}
                      className={`mb-1.5 w-full border px-3 py-1.5 text-left font-mono text-xs uppercase tracking-wider transition-colors ${
                        chord.instrumentName === ip.name
                          ? "border-amber-gold text-amber-gold"
                          : "border-ink-line text-ink-mute hover:border-ink-text hover:text-ink-text"
                      }`}
                    >
                      {ip.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {(["open","pinch","two","fist","point"] as GestureId[]).map((gesture) => {
                  const m = chordMappings.find((x) => x.gesture === gesture)!;
                  return (
                    <div key={gesture} className="border border-ink-line p-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-gold">
                          {GESTURE_ICONS[gesture]} {GESTURE_LABELS[gesture]}
                        </span>
                        <button
                          onClick={() => chord.playChord(m)}
                          className="border border-ink-line px-2 py-0.5 font-mono text-[9px] uppercase text-ink-mute hover:border-ink-text hover:text-ink-text"
                        >
                          ▶
                        </button>
                      </div>
                      <div className="flex gap-1.5">
                        {/* Root picker */}
                        <select
                          value={m.root}
                          onChange={(e) => updateMapping(gesture, { root: e.target.value })}
                          className="flex-1 border border-ink-line bg-ink px-1 py-0.5 font-mono text-[10px] text-ink-text"
                        >
                          {ROOTS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {/* Quality picker */}
                        <select
                          value={m.quality}
                          onChange={(e) => updateMapping(gesture, { quality: e.target.value as ChordQuality })}
                          className="flex-1 border border-ink-line bg-ink px-1 py-0.5 font-mono text-[10px] text-ink-text"
                        >
                          {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                        </select>
                        {/* Octave picker */}
                        <select
                          value={m.octave}
                          onChange={(e) => updateMapping(gesture, { octave: parseInt(e.target.value) })}
                          className="w-12 border border-ink-line bg-ink px-1 py-0.5 font-mono text-[10px] text-ink-text"
                        >
                          {[2,3,4,5].map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div className="mt-1.5">
                        <select
                          value={m.inversion}
                          onChange={(e) => updateMapping(gesture, { inversion: e.target.value as "root" | "first" | "second" })}
                          className="w-full border border-ink-line bg-ink px-1 py-0.5 font-mono text-[10px] text-ink-text"
                        >
                          <option value="root">Root position</option>
                          <option value="first">1st inversion</option>
                          <option value="second">2nd inversion</option>
                        </select>
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-ink-mute">
                        → {chordLabel(m.root, m.quality)} oct {m.octave}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom transport ── */}
      <div className="border-t border-ink-line bg-ink-surface px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">

          {/* Camera toggle */}
          <button
            onClick={camActive ? stopCamera : startCamera}
            className={`border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
              camActive
                ? "border-amber-gold text-amber-gold hover:bg-amber-gold/10"
                : "border-ink-line text-ink-mute hover:border-ink-text hover:text-ink-text"
            }`}
          >
            {camActive ? "◼ Stop Cam" : "⬤ Start Cam"}
          </button>

          {/* Drums play/stop */}
          <button
            onClick={() => {
              if (drum.playing) {
                drum.stop();
              } else {
                drum.ensureCtx();
                drum.play();
                setupRecDest();
              }
            }}
            className={`border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
              drum.playing
                ? "border-amber-gold text-amber-gold hover:bg-amber-gold/10"
                : "border-ink-line text-ink-mute hover:border-ink-text hover:text-ink-text"
            }`}
          >
            {drum.playing ? "◼ Stop Drums" : "▶ Play Drums"}
          </button>

          {/* Separator */}
          <div className="h-5 w-px bg-ink-line" />

          {/* Drum preset */}
          <select
            value={drum.presetName}
            onChange={(e) => drum.selectPreset(e.target.value)}
            className="border border-ink-line bg-ink-surface px-2 py-1.5 font-mono text-xs text-ink-text"
          >
            {DRUM_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name} — {p.bpm} BPM</option>
            ))}
          </select>

          {/* Instrument */}
          <select
            value={chord.instrumentName}
            onChange={(e) => chord.selectInstrument(e.target.value)}
            className="border border-ink-line bg-ink-surface px-2 py-1.5 font-mono text-xs text-ink-text"
          >
            {INSTRUMENT_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>

          {/* Chord map preset */}
          <select
            value={chordMapPreset}
            onChange={(e) => applyMapPreset(e.target.value)}
            className="border border-ink-line bg-ink-surface px-2 py-1.5 font-mono text-xs text-ink-text"
          >
            {Object.keys(CHORD_MAP_PRESETS).map((name) => (
              <option key={name} value={name}>Map: {name}</option>
            ))}
          </select>

          {/* BPM display */}
          <span className="font-mono text-xs text-ink-mute">
            BPM: <span className="text-ink-text">{currentPreset.bpm}</span>
          </span>

          {/* Separator */}
          <div className="ml-auto h-5 w-px bg-ink-line" />

          {/* Master volume */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase text-ink-mute">Vol</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={drum.masterVolume}
              onChange={(e) => drum.setMasterVolume(parseFloat(e.target.value))}
              className="w-20 accent-amber-gold"
            />
          </div>

          {/* Record button */}
          <button
            onClick={recording ? stopRecording : startRecording}
            className={`border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
              recording
                ? "border-red-500 text-red-400 hover:bg-red-500/10"
                : "border-ink-line text-ink-mute hover:border-red-500 hover:text-red-400"
            }`}
          >
            {recording ? `◼ Stop ${fmtTime(recElapsed)}` : "● Record"}
          </button>

          {/* Save take */}
          <button
            onClick={saveTake}
            disabled={!savedBlob}
            className={`border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors ${
              savedBlob
                ? "border-amber-gold text-amber-gold hover:bg-amber-gold/10"
                : "cursor-not-allowed border-ink-line text-ink-line"
            }`}
          >
            ↓ Save Take
          </button>
        </div>

        {/* Preset description */}
        <div className="mt-1.5 font-mono text-[10px] text-ink-mute">
          {currentPreset.description} · {currentPreset.bpm} BPM · swing {Math.round(currentPreset.swing * 100)}%
        </div>
      </div>
    </div>
  );
}
