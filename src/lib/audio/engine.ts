"use client";

// ───────────────────────────────────────────────────────────────────────────
// Verses — singleton audio engine
//
// One AudioContext, one fixed node graph, created exactly once and shared by
// every Perform / Takes engine.
//
//   drumBus  ─┐
//   chordBus ─┤
//   trumpetBus┤─► master ─► glue compressor ─► limiter ─► destination
//   padBus   ─┘                                     └────► recordDest (tap)
//                                    master ─► analyser
//
// The *native* graph above (AudioContext + GainNodes + recorder tap) is built
// SYNCHRONOUSLY with no dependencies, so existing synchronous `ensureBus()`
// callers keep working and drums/recording/mic analysis run without Tone.
//
// Tone.js is lazy-imported only when a sampled instrument (chords / trumpet) is
// first needed — never in the initial bundle, never during SSR. Tone is told to
// use this same context, so a Sampler's output feeds straight into a native bus.
// ───────────────────────────────────────────────────────────────────────────

export type ToneModule = typeof import("tone");

export type BusName = "drum" | "chord" | "trumpet" | "pad";

export type AudioEngine = {
  /** The raw AudioContext shared with Tone. */
  ctx: AudioContext;
  master: GainNode;
  drumBus: GainNode;
  chordBus: GainNode;
  trumpetBus: GainNode;
  /** Soft synth-pad / fallback bus (touch instrument previews, etc.). */
  padBus: GainNode;
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  recordDest: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
  /** Lazily-loaded Tone module (null until `loadTone()` resolves once). */
  tone: ToneModule | null;
  /** Load Tone (idempotent) and bind it to this context. */
  loadTone: () => Promise<ToneModule>;
};

let engineRef: AudioEngine | null = null;
let tonePromise: Promise<ToneModule> | null = null;

/** Perceptual 0..1 → linear gain (square law ≈ human loudness). */
export function perceptualGain(x: number): number {
  const v = Math.max(0, Math.min(1, x));
  return v * v;
}

const BUS_DEFAULTS: Record<BusName, number> = {
  drum: 0.8,
  chord: 0.85,
  trumpet: 0.85,
  pad: 0.8,
};

/**
 * Create-or-return the singleton engine. Synchronous: the native graph needs no
 * async work. Must run in the browser (call from an effect or gesture handler).
 */
export function ensureEngine(): AudioEngine {
  if (engineRef) return engineRef;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new Ctor({ latencyHint: "interactive" });

  const mk = (g: number) => {
    const node = ctx.createGain();
    node.gain.value = g;
    return node;
  };

  const drumBus = mk(BUS_DEFAULTS.drum);
  const chordBus = mk(BUS_DEFAULTS.chord);
  const trumpetBus = mk(BUS_DEFAULTS.trumpet);
  const padBus = mk(BUS_DEFAULTS.pad);
  const master = mk(0.9);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.22;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  const recordDest = ctx.createMediaStreamDestination();

  drumBus.connect(master);
  chordBus.connect(master);
  trumpetBus.connect(master);
  padBus.connect(master);
  master.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(ctx.destination);
  limiter.connect(recordDest);
  master.connect(analyser);

  const engine: AudioEngine = {
    ctx,
    master,
    drumBus,
    chordBus,
    trumpetBus,
    padBus,
    compressor,
    limiter,
    recordDest,
    analyser,
    tone: null,
    loadTone(): Promise<ToneModule> {
      if (this.tone) return Promise.resolve(this.tone);
      if (!tonePromise) {
        tonePromise = import("tone").then((Tone) => {
          Tone.setContext(this.ctx);
          this.tone = Tone;
          return Tone;
        });
      }
      return tonePromise;
    },
  };

  engineRef = engine;
  return engine;
}

/** Synchronous access for code that already ensured the engine. */
export function getEngine(): AudioEngine | null {
  return engineRef;
}

/** Resume the context (call inside a user gesture; required on iOS/Safari). */
export async function resumeEngine(): Promise<void> {
  const e = engineRef ?? ensureEngine();
  if (e.ctx.state === "suspended") {
    await e.ctx.resume();
  }
  if (e.tone) {
    try {
      await e.tone.start();
    } catch {
      /* already started */
    }
  }
}

function busNode(e: AudioEngine, bus: BusName): GainNode {
  switch (bus) {
    case "drum":
      return e.drumBus;
    case "chord":
      return e.chordBus;
    case "trumpet":
      return e.trumpetBus;
    case "pad":
      return e.padBus;
  }
}

/** Smoothly set a bus level from a 0..1 slider value (perceptual curve). */
export function setBusLevel(bus: BusName, value01: number): void {
  const e = engineRef;
  if (!e) return;
  busNode(e, bus).gain.setTargetAtTime(perceptualGain(value01), e.ctx.currentTime, 0.02);
}

/** Smoothly set the master level from a 0..1 slider value (perceptual curve). */
export function setMasterLevel(value01: number): void {
  const e = engineRef;
  if (!e) return;
  e.master.gain.setTargetAtTime(perceptualGain(value01), e.ctx.currentTime, 0.02);
}

/** The MediaStream that captures everything routed through the engine. */
export function getRecorderStream(): MediaStream | null {
  return engineRef?.recordDest.stream ?? null;
}

/**
 * Tear the engine down completely. Rarely needed — the whole point is to keep
 * one graph alive — but useful on full unmount / hot-reload.
 */
export async function destroyEngine(): Promise<void> {
  const e = engineRef;
  engineRef = null;
  tonePromise = null;
  if (!e) return;
  try {
    e.drumBus.disconnect();
    e.chordBus.disconnect();
    e.trumpetBus.disconnect();
    e.padBus.disconnect();
    e.master.disconnect();
    e.compressor.disconnect();
    e.limiter.disconnect();
    e.analyser.disconnect();
  } catch {
    /* already gone */
  }
  if (e.ctx.state !== "closed") {
    await e.ctx.close().catch(() => {});
  }
}
