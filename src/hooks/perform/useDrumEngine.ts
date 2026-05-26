import { useCallback, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrumPreset = {
  name: string;
  bpm: number;
  swing: number;
  pattern: { kick: number[]; snare: number[]; hihat: number[]; perc: number[] };
  levels: { kick: number; snare: number; hihat: number; perc: number };
  description: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const DRUM_PRESETS: DrumPreset[] = [
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

// ─── Internal helpers ─────────────────────────────────────────────────────────

function safeExp(ratio: number): number {
  return Math.max(0.0001, ratio);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useDrumEngine(destNode: AudioNode | null) {
  const ctxRef         = useRef<AudioContext | null>(null);
  const masterGainRef  = useRef<GainNode | null>(null);
  const drumGainRef    = useRef<GainNode | null>(null);
  const filterRef      = useRef<BiquadFilterNode | null>(null);
  const schedulerRef   = useRef<number | null>(null);
  const stepRef        = useRef(0);
  const nextBeatTimeRef = useRef(0);
  const playingRef     = useRef(false);
  const presetRef      = useRef<DrumPreset>(DRUM_PRESETS[0]);
  const bpmRef         = useRef<number>(DRUM_PRESETS[0].bpm);

  const [playing, setPlaying]              = useState(false);
  const [presetName, setPresetNameState]   = useState(DRUM_PRESETS[0].name);
  const [masterVolume, setMasterVolumeState] = useState(0.8);
  const [drumVolume, setDrumVolumeState]   = useState(0.7);
  const [filterCutoff, setFilterCutoffState] = useState(4000);
  const [currentBpm, setCurrentBpmState]   = useState(DRUM_PRESETS[0].bpm);

  // ── Lazy AudioContext creation ──────────────────────────────────────────────
  const ensureCtx = useCallback(() => {
    if (ctxRef.current) {
      // Resume if suspended (browser requires user gesture)
      if (ctxRef.current.state === "suspended") ctxRef.current.resume();
      return ctxRef.current;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx() as AudioContext;
    ctxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.8; // default — will be updated by setMasterVolume
    masterGainRef.current = masterGain;

    const drumGain = ctx.createGain();
    drumGain.gain.value = 0.7; // default
    drumGainRef.current = drumGain;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 4000; // default
    filterRef.current = filter;

    // DynamicsCompressorNode — glues the mix together
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value      = 10;
    comp.ratio.value     = 6;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.1;

    drumGain.connect(filter);
    filter.connect(masterGain);
    masterGain.connect(comp);
    comp.connect(ctx.destination);

    if (destNode) {
      comp.connect(destNode);
    }

    return ctx;
  // destNode is intentionally captured once at creation time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destNode]);

  // ── Drum synthesis ─────────────────────────────────────────────────────────

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
    // White-noise layer
    const bufLen = ctx.sampleRate * 0.2;
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type            = "bandpass";
    noiseFilter.frequency.value = 1200;
    noiseFilter.Q.value         = 1.5;

    const noiseEnv = ctx.createGain();
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseEnv);
    noiseEnv.connect(gain);
    noiseEnv.gain.setValueAtTime(level * 0.7, time);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    noise.start(time);
    noise.stop(time + 0.2);

    // Sine-tone body
    const osc    = ctx.createOscillator();
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
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const hpf = ctx.createBiquadFilter();
    hpf.type            = "highpass";
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
    const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;

    const bpf = ctx.createBiquadFilter();
    bpf.type            = "bandpass";
    bpf.frequency.value = 600;
    bpf.Q.value         = 2;

    // Tonal transient
    const osc    = ctx.createOscillator();
    osc.frequency.value = 600;
    const oscEnv = ctx.createGain();
    osc.connect(oscEnv);
    oscEnv.gain.setValueAtTime(level * 0.4, time);
    oscEnv.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    osc.start(time);
    osc.stop(time + 0.08);
    oscEnv.connect(gain);

    // Noise layer
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

  // ── Scheduler loop (RAF-based look-ahead) ──────────────────────────────────

  const runScheduler = useCallback(() => {
    const ctx   = ctxRef.current;
    const dGain = drumGainRef.current;
    if (!ctx || !dGain || !playingRef.current) return;

    const lookahead    = 0.1; // seconds
    const p            = presetRef.current;
    const stepDuration = 60 / bpmRef.current / 4; // 16th-note duration

    while (nextBeatTimeRef.current < ctx.currentTime + lookahead) {
      const step = stepRef.current % 16;
      // Apply swing: odd steps are pushed slightly forward in time
      const swingOffset = (step % 2 === 1) ? stepDuration * (p.swing - 0.5) : 0;
      const time        = nextBeatTimeRef.current + swingOffset;
      scheduleStep(ctx, dGain, step, time);
      nextBeatTimeRef.current += stepDuration;
      stepRef.current++;
    }

    schedulerRef.current = requestAnimationFrame(runScheduler);
  }, [scheduleStep]);

  // ── Transport ──────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const ctx = ensureCtx();
    if (playingRef.current) return;
    playingRef.current       = true;
    stepRef.current          = 0;
    nextBeatTimeRef.current  = ctx.currentTime;
    setPlaying(true);
    runScheduler();
  }, [ensureCtx, runScheduler]);

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (schedulerRef.current !== null) {
      cancelAnimationFrame(schedulerRef.current);
      schedulerRef.current = null;
    }
  }, []);

  // ── Parameter setters ──────────────────────────────────────────────────────

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
    // State
    playing,
    presetName,
    masterVolume,
    drumVolume,
    filterCutoff,
    currentBpm,
    currentPreset: presetRef.current,
    // Transport
    play,
    stop,
    // Setters
    setPreset,
    setBpm,
    setMasterVolume,
    setDrumVolume,
    setFilterCutoff,
    // Accessors (for external routing)
    getMasterGain,
    getCtx,
  };
}
