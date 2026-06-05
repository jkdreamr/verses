"use client";

// ───────────────────────────────────────────────────────────────────────────
// Sampled instruments via Tone.Sampler, loaded from vendored real recordings in
// /public/samples. Tone pitch-shifts between the anchor notes we ship, so a
// sparse, fast-loading set still covers the whole range. Each instrument routes
//   Sampler ─► lowpass filter ─► reverb ─► (native engine bus)
// for warmth, and reports a loading state while the MP3s fetch.
// ───────────────────────────────────────────────────────────────────────────

import type { AudioEngine } from "./engine";

// Note → filename. Sharps are spelled "s" on disk (Tone resolves the note key).
const PIANO_URLS: Record<string, string> = {
  C2: "C2.mp3", E2: "E2.mp3", "G#2": "Gs2.mp3",
  C3: "C3.mp3", E3: "E3.mp3", "G#3": "Gs3.mp3",
  C4: "C4.mp3", E4: "E4.mp3", "G#4": "Gs4.mp3",
  C5: "C5.mp3", E5: "E5.mp3", "G#5": "Gs5.mp3",
  C6: "C6.mp3",
};

const CELLO_URLS: Record<string, string> = {
  C2: "C2.mp3", E2: "E2.mp3", "G#2": "Gs2.mp3",
  C3: "C3.mp3", E3: "E3.mp3", "G#3": "Gs3.mp3",
  C4: "C4.mp3",
};

export const TRUMPET_URLS: Record<string, string> = {
  F3: "F3.mp3", A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3",
  F4: "F4.mp3", G4: "G4.mp3", "A#4": "As4.mp3", D5: "D5.mp3",
  F5: "F5.mp3", A5: "A5.mp3", C6: "C6.mp3",
};

export type ChordInstrumentId =
  | "grandPiano"
  | "electricPiano"
  | "warmStrings"
  | "feltKeys"
  | "softPad"
  | "synthPad";

export type ChordInstrumentDef = {
  id: ChordInstrumentId;
  name: string;
  blurb: string;
  /** "sampler" = real recordings; "synth" = soft Tone pad/EP. */
  kind: "sampler" | "synth";
  attack: number;
  release: number;
  lowpassHz: number;
  reverbSec: number;
  reverbWet: number;
  volumeDb: number;
  // sampler
  baseUrl?: string;
  urls?: Record<string, string>;
  // synth
  voice?: "poly" | "fm";
  oscillator?: "sine" | "triangle" | "sawtooth";
  decay?: number;
  sustain?: number;
  detune?: number;
};

export const CHORD_INSTRUMENTS: ChordInstrumentDef[] = [
  {
    id: "grandPiano", name: "Grand Piano", blurb: "Bright, articulate acoustic grand",
    kind: "sampler", baseUrl: "/samples/piano/", urls: PIANO_URLS,
    attack: 0.006, release: 1.2, lowpassHz: 5600, reverbSec: 1.7, reverbWet: 0.2, volumeDb: -7,
  },
  {
    id: "electricPiano", name: "Electric Piano", blurb: "Warm FM Rhodes-style EP",
    kind: "synth", voice: "fm", attack: 0.006, decay: 0.9, sustain: 0.55, release: 1.0,
    lowpassHz: 4200, reverbSec: 1.8, reverbWet: 0.24, volumeDb: -16,
  },
  {
    id: "warmStrings", name: "Warm Strings", blurb: "Mellow bowed cello section",
    kind: "sampler", baseUrl: "/samples/cello/", urls: CELLO_URLS,
    attack: 0.3, release: 1.6, lowpassHz: 3400, reverbSec: 2.8, reverbWet: 0.34, volumeDb: -9,
  },
  {
    id: "feltKeys", name: "Felt Keys", blurb: "Soft, muted felt piano",
    kind: "sampler", baseUrl: "/samples/piano/", urls: PIANO_URLS,
    attack: 0.025, release: 1.9, lowpassHz: 1800, reverbSec: 2.5, reverbWet: 0.32, volumeDb: -5,
  },
  {
    id: "softPad", name: "Soft Pad", blurb: "Gentle, slow-attack warmth",
    kind: "synth", voice: "poly", oscillator: "triangle", detune: 8,
    attack: 0.12, decay: 0.4, sustain: 0.85, release: 1.6, lowpassHz: 3000, reverbSec: 3.2, reverbWet: 0.34, volumeDb: -20,
  },
  {
    id: "synthPad", name: "Synth Pad", blurb: "Clean, airy saw pad",
    kind: "synth", voice: "poly", oscillator: "sawtooth", detune: 12,
    attack: 0.06, decay: 0.5, sustain: 0.7, release: 1.2, lowpassHz: 3600, reverbSec: 2.6, reverbWet: 0.3, volumeDb: -22,
  },
];

export type SampledInstrument = {
  /** Trigger a set of MIDI notes for `duration` seconds (one-shot). */
  trigger: (midis: number[], duration: number, velocity?: number) => void;
  /** Sustain a set of MIDI notes until released (held chord / pad). */
  attack: (midis: number[], velocity?: number) => void;
  /** Release specific MIDI notes. */
  release: (midis: number[]) => void;
  /** Hard release everything (for fist / silence). */
  releaseAll: () => void;
  setVolumeDb: (db: number) => void;
  dispose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sampler: any;
};

const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Build a chord instrument on the shared engine. `onReady` fires once the
 * samples have loaded. Output is wired into the engine's chord bus.
 */
export async function createChordInstrument(
  engine: AudioEngine,
  def: ChordInstrumentDef,
  onReady?: () => void,
): Promise<SampledInstrument> {
  const Tone = await engine.loadTone();

  const reverb = new Tone.Reverb({ decay: def.reverbSec, wet: def.reverbWet });
  const filter = new Tone.Filter({ type: "lowpass", frequency: def.lowpassHz, Q: 0.6 });
  const volume = new Tone.Volume(def.volumeDb);

  // Reverb needs to render its impulse response before audio flows.
  await reverb.ready;

  // The source is either a real sampler or a soft Tone pad/EP; both expose the
  // same trigger surface (triggerAttack/Release/AttackRelease/releaseAll).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sampler: any;
  if (def.kind === "synth") {
    const env = { attack: def.attack, decay: def.decay ?? 0.3, sustain: def.sustain ?? 0.7, release: def.release };
    if (def.voice === "fm") {
      sampler = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2, modulationIndex: 2.6,
        oscillator: { type: "sine" }, modulation: { type: "triangle" },
        envelope: env, modulationEnvelope: { attack: 0.01, decay: 0.6, sustain: 0.2, release: 0.7 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    } else {
      sampler = new Tone.PolySynth(Tone.Synth, {
        // unison "fat" oscillator for warmth without clusters
        oscillator: { type: `fat${def.oscillator ?? "triangle"}`, count: 3, spread: def.detune ?? 10 },
        envelope: env,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
    sampler.maxPolyphony = 12;
    onReady?.();
  } else {
    sampler = new Tone.Sampler({
      urls: def.urls,
      baseUrl: def.baseUrl,
      attack: def.attack,
      release: def.release,
      onload: () => onReady?.(),
    });
  }

  // source ─► filter ─► reverb ─► volume ─► (native) chord bus
  sampler.connect(filter);
  filter.connect(reverb);
  reverb.connect(volume);
  // Tone → native node connection (same AudioContext).
  volume.connect(engine.chordBus);

  return {
    sampler,
    trigger(midis, duration, velocity = 0.85) {
      try {
        const freqs = midis.map(midiToFreq);
        sampler.triggerAttackRelease(freqs, duration, undefined, velocity);
      } catch {
        /* sampler not ready yet */
      }
    },
    attack(midis, velocity = 0.85) {
      try {
        sampler.triggerAttack(midis.map(midiToFreq), undefined, velocity);
      } catch {
        /* not ready */
      }
    },
    release(midis) {
      try {
        sampler.triggerRelease(midis.map(midiToFreq));
      } catch {
        /* not ready */
      }
    },
    releaseAll() {
      try {
        sampler.releaseAll();
      } catch {
        /* ignore */
      }
    },
    setVolumeDb(db: number) {
      volume.volume.rampTo(db, 0.05);
    },
    dispose() {
      try { sampler.dispose(); } catch { /* */ }
      try { filter.dispose(); } catch { /* */ }
      try { reverb.dispose(); } catch { /* */ }
      try { volume.dispose(); } catch { /* */ }
    },
  };
}

export type TrumpetInstrument = {
  /** Drive the live brass synth to freq; re-articulates only when note changes. */
  noteOn: (freqHz: number, velocity?: number, legato?: boolean) => void;
  noteOff: () => void;
  setVolumeDb: (db: number) => void;
  /** Brightness = lowpass cutoff in Hz. */
  setBrightnessHz: (hz: number) => void;
  /** Schedule a note at an absolute context time (Sing-then-Convert). */
  scheduleNote: (freqHz: number, startTime: number, duration: number, velocity?: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sampler: any;
  dispose: () => void;
  ready: Promise<void>;
};

const freqToMidiLocal  = (f: number) => 69 + 12 * Math.log2(f / 440);

// ─── Live Brass Synth ───────────────────────────────────────────────────────
// A lightweight subtractive brass voice for real-time following. Uses two
// oscillators (square + sawtooth) for a buzzy lip-reed timbre, a formant
// bandpass near 1.2 kHz, a lowpass brightness filter, and a soft noise layer
// for breath. Pitch is ramped continuously so there's no click on note changes.
// We keep the sampler for Sing-then-Convert playback where quality matters more.
function createBrassSynth(ctx: AudioContext, outputNode: AudioNode, brightnessHz: number) {
  const now = () => ctx.currentTime;

  // ── Oscillators ──
  const osc1 = ctx.createOscillator(); osc1.type = "sawtooth";
  const osc2 = ctx.createOscillator(); osc2.type = "square";
  const osc1Gain = ctx.createGain(); osc1Gain.gain.value = 0.55;
  const osc2Gain = ctx.createGain(); osc2Gain.gain.value = 0.35;
  osc1.start(); osc2.start();

  // ── Noise layer (breath) ──
  const bufLen = ctx.sampleRate * 2;
  const noiseBuffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const nd = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufLen; i++) nd[i] = Math.random() * 2 - 1;
  const noiseNode = ctx.createBufferSource();
  noiseNode.buffer = noiseBuffer;
  noiseNode.loop = true;
  noiseNode.start();
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 3000;
  noiseFilter.Q.value = 0.6;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0;

  // ── Amplitude envelope (VCA) ──
  const vca = ctx.createGain(); vca.gain.value = 0;

  // ── Formant bandpass (simulates bell/cup resonance ~1.2 kHz) ──
  const formant = ctx.createBiquadFilter();
  formant.type = "peaking";
  formant.frequency.value = 1200;
  formant.Q.value = 2.5;
  formant.gain.value = 6;

  // ── Brightness lowpass ──
  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = brightnessHz;
  lpf.Q.value = 0.5;

  // ── Output gain (per-voice) ──
  const outGain = ctx.createGain(); outGain.gain.value = 0.7;

  // Wiring
  osc1.connect(osc1Gain); osc1Gain.connect(vca);
  osc2.connect(osc2Gain); osc2Gain.connect(vca);
  noiseNode.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(vca);
  vca.connect(formant); formant.connect(lpf); lpf.connect(outGain);
  outGain.connect(outputNode);

  let playing = false;
  let currentMidi = 0;
  // Detune osc2 slightly for width/chorusing (cents)
  osc2.detune.value = 7;

  function setFreq(hz: number, rampSec = 0.015) {
    const t = now();
    osc1.frequency.cancelScheduledValues(t);
    osc2.frequency.cancelScheduledValues(t);
    osc1.frequency.setTargetAtTime(hz, t, rampSec);
    osc2.frequency.setTargetAtTime(hz * 1.003, t, rampSec); // slight detune
  }

  function attack(hz: number, velocity: number, legato: boolean) {
    const t = now();
    setFreq(hz, legato ? 0.025 : 0.006);
    if (!legato || !playing) {
      // Short tongue articulation: quick dip then ramp
      vca.gain.cancelScheduledValues(t);
      if (!legato) {
        vca.gain.setValueAtTime(0, t);
        vca.gain.linearRampToValueAtTime(velocity * 0.9, t + 0.012);
      } else {
        vca.gain.setTargetAtTime(velocity * 0.9, t, 0.018);
      }
      // Noise burst on attack (breath)
      noiseGain.gain.cancelScheduledValues(t);
      noiseGain.gain.setValueAtTime(velocity * 0.08, t);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    }
    playing = true;
  }

  function release() {
    const t = now();
    vca.gain.cancelScheduledValues(t);
    vca.gain.setTargetAtTime(0, t, 0.04);
    noiseGain.gain.cancelScheduledValues(t);
    noiseGain.gain.setTargetAtTime(0, t, 0.02);
    playing = false;
  }

  return {
    noteOn(hz: number, velocity: number, legato: boolean) {
      const midi = Math.round(freqToMidiLocal(hz));
      if (playing && midi === currentMidi) {
        // Same note sustaining — just update dynamics smoothly
        vca.gain.setTargetAtTime(velocity * 0.9, now(), 0.05);
        return;
      }
      currentMidi = midi;
      attack(hz, velocity, legato);
    },
    noteOff: release,
    setFreq,
    setVolumeGain(g: number) { outGain.gain.setTargetAtTime(g, now(), 0.03); },
    setBrightnessHz(hz: number) { lpf.frequency.setTargetAtTime(Math.max(400, Math.min(14000, hz)), now(), 0.05); },
    get isPlaying() { return playing; },
    get currentMidi() { return currentMidi; },
    dispose() {
      try { osc1.stop(); osc1.disconnect(); osc1Gain.disconnect(); } catch { /* */ }
      try { osc2.stop(); osc2.disconnect(); osc2Gain.disconnect(); } catch { /* */ }
      try { noiseNode.stop(); noiseNode.disconnect(); noiseFilter.disconnect(); noiseGain.disconnect(); } catch { /* */ }
      try { vca.disconnect(); formant.disconnect(); lpf.disconnect(); outGain.disconnect(); } catch { /* */ }
    },
  };
}

/**
 * Trumpet instrument with:
 *  - Live mode: low-latency brass synth (continuous pitch ramp, articulation model)
 *  - Convert mode: real sampler for clean scheduled playback
 * Both route through filter → reverb → volume → limiter → trumpet bus.
 */
export async function createTrumpetInstrument(
  engine: AudioEngine,
  opts: { brightnessHz?: number; reverbWet?: number; volumeDb?: number } = {},
): Promise<TrumpetInstrument> {
  const Tone = await engine.loadTone();
  const ctx  = engine.ctx;

  const reverb = new Tone.Reverb({ decay: 1.2, wet: opts.reverbWet ?? 0.14 });
  const filter = new Tone.Filter({ type: "lowpass", frequency: opts.brightnessHz ?? 4200, Q: 0.4 });
  const volume = new Tone.Volume(opts.volumeDb ?? -6);

  // Safety limiter so the trumpet can never blast the master
  const limiterNode = ctx.createDynamicsCompressor();
  limiterNode.threshold.value = -3;
  limiterNode.knee.value       = 2;
  limiterNode.ratio.value      = 16;
  limiterNode.attack.value     = 0.001;
  limiterNode.release.value    = 0.05;

  await reverb.ready;

  // Native intermediate gain node as bridging point for the synth voice
  const synthBus = ctx.createGain(); synthBus.gain.value = 1;
  synthBus.connect(limiterNode);
  limiterNode.connect(engine.trumpetBus);

  // Connect Tone chain also to trumpetBus (for sampler)
  // Tone: sampler → filter → reverb → volume → (native) limiter → trumpetBus
  volume.connect(limiterNode);
  filter.connect(reverb);
  reverb.connect(volume);

  let loaded = false;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((res) => (resolveReady = res));

  const sampler = new Tone.Sampler({
    urls: TRUMPET_URLS,
    baseUrl: "/samples/trumpet/",
    attack: 0.015,
    release: 0.5,
    onload: () => { loaded = true; resolveReady(); },
  });
  sampler.connect(filter);

  // Brightness filter (Tone Filter) tracks the same hz as the synth lpf
  const bHz = opts.brightnessHz ?? 4200;

  // Live brass synth voice
  const synth = createBrassSynth(ctx, synthBus, bHz);

  // Articulation state
  let synthSounding = false;
  let synthLastMidi  = 0;

  return {
    sampler,
    ready,

    noteOn(freqHz, velocity = 0.8, legato = true) {
      if (freqHz <= 0) return;
      const midi = Math.round(freqToMidiLocal(freqHz));
      synth.noteOn(freqHz, velocity, legato && synthSounding);
      synthSounding = true;
      synthLastMidi  = midi;
    },

    noteOff() {
      if (!synthSounding) return;
      synth.noteOff();
      synthSounding = false;
      synthLastMidi  = 0;
    },

    setVolumeDb(db) {
      volume.volume.rampTo(db, 0.05);
      // Also scale synth bus to match (convert dB → linear)
      const g = Math.pow(10, Math.max(-40, Math.min(6, db)) / 20);
      synthBus.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
    },

    setBrightnessHz(hz) {
      const clamped = Math.max(400, Math.min(14000, hz));
      filter.frequency.rampTo(clamped, 0.06);
      synth.setBrightnessHz(clamped);
    },

    scheduleNote(freqHz, startTime, duration, velocity = 0.85) {
      if (!loaded || freqHz <= 0) return;
      try { sampler.triggerAttackRelease(freqHz, duration, startTime, velocity); } catch { /* */ }
    },

    dispose() {
      synth.dispose();
      try { synthBus.disconnect(); } catch { /* */ }
      try { limiterNode.disconnect(); } catch { /* */ }
      try { sampler.dispose(); } catch { /* */ }
      try { filter.dispose(); } catch { /* */ }
      try { reverb.dispose(); } catch { /* */ }
      try { volume.dispose(); } catch { /* */ }
      // suppress unused warning
      void synthLastMidi;
    },
  };
}
