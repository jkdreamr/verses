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

export type ChordInstrumentId = "grandPiano" | "warmStrings" | "feltKeys";

export type ChordInstrumentDef = {
  id: ChordInstrumentId;
  name: string;
  blurb: string;
  baseUrl: string;
  urls: Record<string, string>;
  attack: number;
  release: number;
  lowpassHz: number;
  reverbSec: number;
  reverbWet: number;
  volumeDb: number;
};

export const CHORD_INSTRUMENTS: ChordInstrumentDef[] = [
  {
    id: "grandPiano",
    name: "Grand Piano",
    blurb: "Bright, articulate acoustic grand",
    baseUrl: "/samples/piano/",
    urls: PIANO_URLS,
    attack: 0.005,
    release: 1.1,
    lowpassHz: 6500,
    reverbSec: 1.6,
    reverbWet: 0.18,
    volumeDb: -6,
  },
  {
    id: "warmStrings",
    name: "Warm Strings",
    blurb: "Mellow bowed cello section",
    baseUrl: "/samples/cello/",
    urls: CELLO_URLS,
    attack: 0.28,
    release: 1.4,
    lowpassHz: 3600,
    reverbSec: 2.6,
    reverbWet: 0.34,
    volumeDb: -9,
  },
  {
    id: "feltKeys",
    name: "Felt Keys",
    blurb: "Soft, muted felt-piano / EP",
    baseUrl: "/samples/piano/",
    urls: PIANO_URLS,
    attack: 0.02,
    release: 1.8,
    lowpassHz: 1900,
    reverbSec: 2.4,
    reverbWet: 0.3,
    volumeDb: -5,
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

  const sampler = new Tone.Sampler({
    urls: def.urls,
    baseUrl: def.baseUrl,
    attack: def.attack,
    release: def.release,
    onload: () => onReady?.(),
  });

  // Sampler ─► filter ─► reverb ─► volume ─► (native) chord bus
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
  /** Glide to a target frequency (Hz); starts the note if silent. */
  noteOn: (freqHz: number, velocity?: number, portamentoSec?: number) => void;
  noteOff: () => void;
  setVolumeDb: (db: number) => void;
  /** For offline Sing-then-Convert: schedule a note at an absolute time. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sampler: any;
  dispose: () => void;
  ready: Promise<void>;
};

/**
 * Sampled trumpet with monophonic portamento, wired into the trumpet bus.
 * Used by both Live Monitor and Sing-then-Convert in Takes.
 */
export async function createTrumpetInstrument(
  engine: AudioEngine,
  opts: { brightnessHz?: number; reverbWet?: number; volumeDb?: number } = {},
): Promise<TrumpetInstrument> {
  const Tone = await engine.loadTone();
  const reverb = new Tone.Reverb({ decay: 1.4, wet: opts.reverbWet ?? 0.16 });
  const filter = new Tone.Filter({ type: "lowpass", frequency: opts.brightnessHz ?? 4200, Q: 0.4 });
  const volume = new Tone.Volume(opts.volumeDb ?? -6);
  await reverb.ready;

  let loaded = false;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((res) => (resolveReady = res));

  const sampler = new Tone.Sampler({
    urls: TRUMPET_URLS,
    baseUrl: "/samples/trumpet/",
    attack: 0.02,
    release: 0.4,
    onload: () => {
      loaded = true;
      resolveReady();
    },
  });

  sampler.connect(filter);
  filter.connect(reverb);
  reverb.connect(volume);
  volume.connect(engine.trumpetBus);

  let sounding = false;
  let currentFreq = 0;

  return {
    sampler,
    ready,
    noteOn(freqHz, velocity = 0.85, portamentoSec = 0.06) {
      if (!loaded || freqHz <= 0) return;
      const now = engine.ctx.currentTime;
      if (!sounding) {
        sampler.triggerAttack(freqHz, now, velocity);
        sounding = true;
        currentFreq = freqHz;
      } else if (Math.abs(freqHz - currentFreq) > 0.5) {
        // Glide: Tone.Sampler has no native portamento, so emulate by
        // retriggering with a short crossfade only on larger pitch moves.
        const ratio = freqHz / (currentFreq || freqHz);
        if (ratio > 1.06 || ratio < 0.94) {
          sampler.triggerRelease(currentFreq, now + portamentoSec);
          sampler.triggerAttack(freqHz, now + portamentoSec * 0.5, velocity);
        }
        currentFreq = freqHz;
      }
    },
    noteOff() {
      if (!sounding) return;
      try { sampler.triggerRelease(currentFreq, engine.ctx.currentTime); } catch { /* */ }
      sounding = false;
      currentFreq = 0;
    },
    setVolumeDb(db) {
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
