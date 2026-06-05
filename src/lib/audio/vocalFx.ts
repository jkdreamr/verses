"use client";

// ───────────────────────────────────────────────────────────────────────────
// Shared real-time vocal effects chain. ONE module, used by both:
//   • Perform Mode B (hands drive pitch + effects), and
//   • the Perform FX rack (sliders/knobs drive the same chain).
//
// Signal flow (all Tone nodes on the singleton engine's AudioContext):
//
//   mic ─► in ─►┬─► mainShift ─► wet ─┐
//               └──────────────► dry ─┴─► pitchMix ─►┬─► harmonyShift ─► harm ─┐
//                                                    └──────────────────────► ┴─► delay ─► reverb ─► out ─► master
//
// `master` already fans out to the speakers AND the recording tap, so the
// processed voice is monitored (use headphones) and captured in takes.
//
// Pitch shifting uses Tone.PitchShift — a native-node granular shifter. It is
// real-time and cheap but does NOT preserve formants, so very large shifts get
// "chipmunky". That's an honest in-browser limitation (documented in the UI +
// README); for autotune and ±octave harmony it sounds musical.
// ───────────────────────────────────────────────────────────────────────────

import type { AudioEngine } from "./engine";
import { snapToScale, keyToPc, type ScaleId } from "./scales";

export type VocalFxChain = {
  /** Connect a native mic source (or any node) into the chain input. */
  connectInput: (node: AudioNode) => void;
  disconnectInput: (node: AudioNode) => void;
  /** Main shifter pitch in semitones (autotune correction OR hand pitch). */
  setMainPitch: (semitones: number) => void;
  /** Correction blend 0..1 (0 = dry voice, 1 = fully shifted). */
  setCorrectionBlend: (amount: number) => void;
  setHarmony: (on: boolean, interval: number, mix: number) => void;
  setDelay: (on: boolean, time: number, feedback: number, mix: number) => void;
  setReverb: (on: boolean, decay: number, mix: number) => void;
  setOutput: (gain: number) => void;
  /** Granular window in seconds — smaller = lower latency, more artifacts. */
  setWindowSize: (seconds: number) => void;
  /** Approximate added latency of the pitch stage, in ms. */
  latencyMs: () => number;
  dispose: () => void;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export async function createVocalFxChain(engine: AudioEngine): Promise<VocalFxChain> {
  const Tone = await engine.loadTone();
  const RAMP = 0.04;

  const inGain = new Tone.Gain(1);
  const mainShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0 });
  const wetGain = new Tone.Gain(1); // shifted
  const dryGain = new Tone.Gain(0); // unshifted blend
  const pitchMix = new Tone.Gain(1);
  const harmonyShift = new Tone.PitchShift({ pitch: 7, windowSize: 0.1 });
  const harmonyGain = new Tone.Gain(0);
  const delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.3, wet: 0 });
  const reverb = new Tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 0 });
  const outGain = new Tone.Gain(0.9);

  // wiring
  inGain.connect(mainShift);
  mainShift.connect(wetGain);
  inGain.connect(dryGain);
  wetGain.connect(pitchMix);
  dryGain.connect(pitchMix);
  pitchMix.connect(delay); // main voice
  pitchMix.connect(harmonyShift); // parallel harmony
  harmonyShift.connect(harmonyGain);
  harmonyGain.connect(delay);
  delay.connect(reverb);
  reverb.connect(outGain);
  outGain.connect(engine.master);

  try { await reverb.ready; } catch { /* impulse generation best-effort */ }

  let windowSize = 0.1;
  const now = () => engine.ctx.currentTime;

  return {
    connectInput(node) { Tone.connect(node, inGain); },
    disconnectInput(node) { try { node.disconnect(inGain.input); } catch { /* */ } },
    setMainPitch(semitones) {
      // PitchShift.pitch is a plain setter (not an AudioParam); clamp to a sane range.
      mainShift.pitch = Math.max(-24, Math.min(24, semitones));
    },
    setCorrectionBlend(amount) {
      const a = clamp01(amount);
      wetGain.gain.rampTo(a, RAMP);
      dryGain.gain.rampTo(1 - a, RAMP);
    },
    setHarmony(on, interval, mix) {
      harmonyShift.pitch = Math.max(-24, Math.min(24, interval));
      harmonyGain.gain.rampTo(on ? clamp01(mix) : 0, RAMP);
    },
    setDelay(on, time, feedback, mix) {
      delay.delayTime.rampTo(Math.max(0.01, Math.min(1.2, time)), 0.1);
      delay.feedback.rampTo(Math.max(0, Math.min(0.92, feedback)), RAMP);
      delay.wet.rampTo(on ? clamp01(mix) : 0, RAMP);
    },
    setReverb(on, decay, mix) {
      const d = Math.max(0.3, Math.min(8, decay));
      // changing decay regenerates the impulse; only do it on meaningful change
      if (Math.abs((reverb.decay as number) - d) > 0.05) reverb.decay = d;
      reverb.wet.rampTo(on ? clamp01(mix) : 0, RAMP);
    },
    setOutput(gain) { outGain.gain.rampTo(clamp01(gain), RAMP); },
    setWindowSize(seconds) {
      windowSize = Math.max(0.03, Math.min(0.1, seconds));
      mainShift.windowSize = windowSize;
      harmonyShift.windowSize = windowSize;
    },
    latencyMs() { return Math.round(windowSize * 1000); },
    dispose() {
      void now;
      [inGain, mainShift, wetGain, dryGain, pitchMix, harmonyShift, harmonyGain, delay, reverb, outGain]
        .forEach((n) => { try { n.dispose(); } catch { /* */ } });
    },
  };
}

// ── Autotune helper: detected Hz → correction in (fractional) semitones ──
export function autotuneCorrection(freq: number, key: string, scale: ScaleId): number {
  if (freq <= 0) return 0;
  const detected = 69 + 12 * Math.log2(freq / 440);
  const target = snapToScale(Math.round(detected), keyToPc(key), scale);
  return target - detected; // semitones to add
}
