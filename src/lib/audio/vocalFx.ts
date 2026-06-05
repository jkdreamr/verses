"use client";

// ───────────────────────────────────────────────────────────────────────────
// Professional Vocal FX Chain for Verses
//
// Signal flow:
//
//   mic → inputGain → [gate expander] → highPass → toneEQ (3-band) →
//     pitchShift (Tone, wet) + dry path → pitchBlend →
//     de-esser → compressor (native parallel) → saturation →
//     vocalDry ──────────────────────────────────────────────────────────┐
//       + harmony (Tone, parallel)                                       │
//       + doubler (Tone, parallel)                                       ├─► masterBus
//       + delay send → delayFx → delayFilter → delayReturn               │
//       + reverb send → reverbFx → reverbFilter → reverbReturn           │
//                                                                        │
//     → outputGain (Tone) → limiter (native) → engine.master  ──────────┘
//
// Key design points:
// - Gate is driven by a ScriptProcessorNode for sample-accurate RMS tracking.
// - Delay/reverb sends feed into masterBus (NOT vocalDry) to prevent feedback.
// - All parameter changes use smooth ramps — no clicks.
// - Safety limiter at output.
// - De-esser: split-band gain reduction on sibilance (5–12 kHz).
// - Pitch shifting: Tone PitchShift (granular; sounds musical for ≤12 st range).
// ───────────────────────────────────────────────────────────────────────────

import type { AudioEngine } from "./engine";
import { snapToScale, keyToPc, type ScaleId } from "./scales";

export type VocalFxChain = {
  connectInput: (node: AudioNode) => void;
  disconnectInput: (node: AudioNode) => void;
  connectOutput: (node: AudioNode) => void;
  disconnectOutput: (node: AudioNode) => void;
  setInputGain: (value: number) => void;
  setGate: (on: boolean, thresholdDb: number, depth: number, attackMs: number, releaseMs: number) => void;
  setHighPass: (freqHz: number) => void;
  setToneEq: (params: { bodyDb: number; presenceDb: number; airDb: number }) => void;
  setMainPitch: (semitones: number) => void;
  setCorrectionBlend: (amount: number) => void;
  setDeEsser: (on: boolean, amount: number, frequencyKhz: number) => void;
  setCompressor: (on: boolean, thresholdDb: number, ratio: number, attackMs: number, releaseMs: number, makeupDb: number, mix: number) => void;
  setSaturation: (on: boolean, drive: number, mix: number) => void;
  setDoubler: (on: boolean, amount: number, width: number) => void;
  setHarmony: (on: boolean, interval: number, mix: number) => void;
  setDelay: (on: boolean, time: number, feedback: number, mix: number, lowCutHz?: number, highCutHz?: number) => void;
  setReverb: (on: boolean, decay: number, mix: number, preDelay?: number, lowCutHz?: number, highCutHz?: number) => void;
  setOutput: (gain: number) => void;
  setWindowSize: (seconds: number) => void;
  setMeterCallbacks: (cb: {
    onGateActivity?: (v: number) => void;
    onCompressorReduction?: (v: number) => void;
    onDeEsserActivity?: (v: number) => void;
    onOutputLevel?: (v: number) => void;
  }) => void;
  latencyMs: () => number;
  dispose: () => void;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const dbToGain = (db: number) => Math.pow(10, db / 20);
const RAMP = 0.035; // seconds for smooth parameter transitions

export async function createVocalFxChain(engine: AudioEngine): Promise<VocalFxChain> {
  const Tone = await engine.loadTone();
  const ctx = engine.ctx;
  const now = () => ctx.currentTime;

  // ─────────────────────────────────────────────────────────────────────────
  // Native Web Audio nodes
  // ─────────────────────────────────────────────────────────────────────────
  const mkGain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const mkBQ = (type: BiquadFilterType, freq: number) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    return f;
  };

  // ── Input / Gate ──────────────────────────────────────────────────────────
  const inputGain = mkGain(0.9);
  const gateGain  = mkGain(1);   // controlled by the gate expander below
  const highPass  = mkBQ("highpass", 80);

  // ── EQ (3-band) ───────────────────────────────────────────────────────────
  const eqLow  = mkBQ("lowshelf",  250);   // body / mud
  const eqMid  = mkBQ("peaking",  3000);   // presence
  eqMid.Q.value = 0.9;
  const eqHigh = mkBQ("highshelf", 10000); // air

  // ── Pitch blend ───────────────────────────────────────────────────────────
  const wetGain      = mkGain(0);  // pitch-shifted path
  const dryGain      = mkGain(1);  // unshifted path
  const pitchMixNode = mkGain(1);  // recombined

  // ── De-esser (split-band, native) ─────────────────────────────────────────
  const deEsserSplit    = mkBQ("highpass", 8000);
  const deEsserHighGain = mkGain(1);  // sibilance attenuation
  const deEsserLowPass  = mkGain(1);  // low/mid — untouched
  const deEsserSum      = mkGain(1);

  // ── Compressor (parallel wet/dry, native) ─────────────────────────────────
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value       = 8;
  compressor.ratio.value      = 4;
  compressor.attack.value     = 0.006;
  compressor.release.value    = 0.1;
  const compMakeup = mkGain(dbToGain(3));
  const compWet    = mkGain(1);
  const compDry    = mkGain(0);
  const compSum    = mkGain(1);

  // ── Saturation (WaveShaper, native) ───────────────────────────────────────
  const satShaper = ctx.createWaveShaper();
  satShaper.oversample = "4x";
  const satWet = mkGain(0);
  const satDry = mkGain(1);
  const satSum = mkGain(1);

  // ── Master mix bus (dry vocal + all parallel sends) ───────────────────────
  // Delay/reverb RETURN here — NOT back into vocalDry — to prevent feedback.
  const masterBus   = mkGain(1);
  const outputMeter = ctx.createAnalyser();
  outputMeter.fftSize = 128;

  // ── Safety limiter ────────────────────────────────────────────────────────
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value       = 0;
  limiter.ratio.value      = 20;
  limiter.attack.value     = 0.001;
  limiter.release.value    = 0.05;

  // ─────────────────────────────────────────────────────────────────────────
  // Tone nodes
  // ─────────────────────────────────────────────────────────────────────────
  const mainShift    = new Tone.PitchShift({ pitch: 0, windowSize: 0.08, delayTime: 0, feedback: 0 });
  const harmonyShift = new Tone.PitchShift({ pitch: 7, windowSize: 0.08 });
  const harmonyGain  = new Tone.Gain(0);
  const doublerDelay = new Tone.Delay(0.022);
  const doublerGain  = new Tone.Gain(0);
  const doublerPanner = new Tone.Panner(0.6);
  const delaySend    = new Tone.Gain(0);
  const delayFx      = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.28, wet: 1 });
  const delayReturn  = new Tone.Gain(0);
  const reverbSend   = new Tone.Gain(0);
  const reverbFx     = new Tone.Reverb({ decay: 1.8, preDelay: 0.015, wet: 1 });
  const reverbReturn = new Tone.Gain(0);
  const outGain      = new Tone.Gain(1.0);

  // Delay/reverb filters (native)
  const delayLpf  = mkBQ("lowpass",  8000);
  const delayHpf  = mkBQ("highpass",  300);
  const reverbLpf = mkBQ("lowpass",  10000);
  const reverbHpf = mkBQ("highpass",   200);

  await reverbFx.ready.catch(() => {});

  // ─────────────────────────────────────────────────────────────────────────
  // Wiring
  // ─────────────────────────────────────────────────────────────────────────

  // Input → Gate → EQ
  inputGain.connect(gateGain);
  gateGain.connect(highPass);
  highPass.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);

  // EQ → pitch shift (Tone) + dry bypass
  Tone.connect(eqHigh, mainShift);
  eqHigh.connect(dryGain);
  Tone.connect(mainShift, wetGain);
  wetGain.connect(pitchMixNode);
  dryGain.connect(pitchMixNode);

  // pitchMixNode → de-esser → compressor → saturation  (the "dry vocal" chain)
  pitchMixNode.connect(deEsserLowPass);
  pitchMixNode.connect(deEsserSplit);
  deEsserSplit.connect(deEsserHighGain);
  deEsserLowPass.connect(deEsserSum);
  deEsserHighGain.connect(deEsserSum);

  deEsserSum.connect(compressor);
  compressor.connect(compMakeup);
  compMakeup.connect(compWet);
  deEsserSum.connect(compDry);
  compWet.connect(compSum);
  compDry.connect(compSum);

  compSum.connect(satShaper);
  satShaper.connect(satWet);
  compSum.connect(satDry);
  satWet.connect(satSum);
  satDry.connect(satSum);

  // Processed dry vocal → masterBus
  satSum.connect(masterBus);

  // Parallel harmony send (from pitchMixNode, before de-esser — harmonies
  // sound more natural without extra compression)
  Tone.connect(pitchMixNode, harmonyShift);
  Tone.connect(harmonyShift, harmonyGain);
  Tone.connect(harmonyGain, masterBus);

  // Parallel doubler send
  Tone.connect(pitchMixNode, doublerDelay);
  Tone.connect(doublerDelay, doublerPanner);
  Tone.connect(doublerPanner, doublerGain);
  Tone.connect(doublerGain, masterBus);

  // Parallel delay send (from masterBus so it includes harmony/doubler in the echo)
  Tone.connect(masterBus, delaySend);
  Tone.connect(delaySend, delayFx);
  Tone.connect(delayFx, delayHpf);
  delayHpf.connect(delayLpf);
  Tone.connect(delayLpf, delayReturn);
  // delayReturn → masterBus would cause feedback; send to a separate return node
  const delayReturnNode = mkGain(1);
  Tone.connect(delayReturn, delayReturnNode);

  // Parallel reverb send (from masterBus)
  Tone.connect(masterBus, reverbSend);
  Tone.connect(reverbSend, reverbFx);
  Tone.connect(reverbFx, reverbHpf);
  reverbHpf.connect(reverbLpf);
  Tone.connect(reverbLpf, reverbReturn);
  const reverbReturnNode = mkGain(1);
  Tone.connect(reverbReturn, reverbReturnNode);

  // Final sum: masterBus + delay return + reverb return → outGain → limiter → master
  const finalBus = mkGain(1);
  masterBus.connect(finalBus);
  delayReturnNode.connect(finalBus);
  reverbReturnNode.connect(finalBus);

  Tone.connect(finalBus, outGain);
  Tone.connect(outGain, limiter);
  limiter.connect(outputMeter);
  limiter.connect(engine.master);
  // Also tap into recordDest so recordings capture the processed vocal
  limiter.connect(engine.recordDest);

  // ─────────────────────────────────────────────────────────────────────────
  // Saturation curve
  // ─────────────────────────────────────────────────────────────────────────
  function makeSatCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 512;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const amt = clamp01(drive) * 6;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // Soft-knee tanh with gain compensation
      curve[i] = Math.tanh(x * (1 + amt)) / Math.tanh(1 + amt);
    }
    return curve;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Noise gate — driven by a ScriptProcessorNode for reliable, low-latency
  // RMS measurement. The ScriptProcessorNode runs synchronously with the
  // audio thread (on the same quantum), avoiding the ±50 ms jitter of
  // setInterval-based polling. gateGain is updated via setTargetAtTime so
  // parameter changes remain click-free.
  // ─────────────────────────────────────────────────────────────────────────
  let gateState = { on: true, thresholdDb: -45, depth: 0.85, attackMs: 5, releaseMs: 180 };
  let gateCurrentGain = 1.0;
  let gateOpen = true; // true = signal above threshold

  // ScriptProcessorNode: 512-sample blocks, 1 in / 1 out (silent output)
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const gateProcessor = ctx.createScriptProcessor(512, 1, 1);
  inputGain.connect(gateProcessor);
  // Connect to destination with zero gain so it's silent but still processed
  const gateSink = mkGain(0);
  gateProcessor.connect(gateSink);
  gateSink.connect(ctx.destination);

  gateProcessor.onaudioprocess = (ev) => {
    if (!gateState.on) {
      if (gateCurrentGain !== 1) {
        gateCurrentGain = 1;
        gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
      }
      meterCb.onGateActivity?.(0);
      return;
    }
    const buf = ev.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const threshold = dbToGain(gateState.thresholdDb);

    const wasOpen = gateOpen;
    gateOpen = rms >= threshold;

    if (gateOpen !== wasOpen) {
      // State transition: use appropriate attack/release time-constant
      const tauSec = gateOpen
        ? gateState.attackMs / 1000
        : gateState.releaseMs / 1000;
      const targetGain = gateOpen ? 1.0 : 1 - gateState.depth;
      gateCurrentGain = targetGain;
      gateGain.gain.setTargetAtTime(targetGain, ctx.currentTime, Math.max(tauSec, 0.002));
    }

    meterCb.onGateActivity?.(gateOpen ? 0 : 1 - gateCurrentGain);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Metering
  // ─────────────────────────────────────────────────────────────────────────
  let meterCb: {
    onGateActivity?: (v: number) => void;
    onCompressorReduction?: (v: number) => void;
    onDeEsserActivity?: (v: number) => void;
    onOutputLevel?: (v: number) => void;
  } = {};
  let lastMeterT = 0;
  let deEsserCurrentGain = 1;

  function updateMeters() {
    const t = performance.now();
    if (t - lastMeterT < 60) return;
    lastMeterT = t;

    const red = compressor.reduction ?? 0;
    meterCb.onCompressorReduction?.(Math.max(0, -red) / 20);
    meterCb.onDeEsserActivity?.(1 - deEsserCurrentGain);

    const buf = new Float32Array(outputMeter.frequencyBinCount);
    outputMeter.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    meterCb.onOutputLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 4));
  }

  const meterInterval = setInterval(updateMeters, 60);

  // ─────────────────────────────────────────────────────────────────────────
  // De-esser update helper
  // ─────────────────────────────────────────────────────────────────────────
  let deEsserState = { on: false, amount: 0.4, freqKhz: 8 };

  function applyDeEsser() {
    deEsserSplit.frequency.setTargetAtTime(clamp(deEsserState.freqKhz * 1000, 4000, 14000), now(), 0.02);
    const target = deEsserState.on ? 1 - deEsserState.amount * 0.65 : 1;
    deEsserCurrentGain = target;
    deEsserHighGain.gain.setTargetAtTime(target, now(), 0.02);
  }

  let windowSize = 0.08;

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────
  return {
    connectInput(node) { Tone.connect(node, inputGain); },
    disconnectInput(node) { try { node.disconnect(inputGain); } catch { /* */ } },
    connectOutput(node) { limiter.connect(node); },
    disconnectOutput(node) { try { limiter.disconnect(node); } catch { /* */ } },

    setInputGain(v) { inputGain.gain.setTargetAtTime(clamp01(v) * 1.1, now(), RAMP); },

    setGate(on, thresholdDb, depth, attackMs, releaseMs) {
      gateState = { on, thresholdDb, depth, attackMs, releaseMs };
      if (!on) {
        gateCurrentGain = 1;
        gateOpen = true;
        gateGain.gain.setTargetAtTime(1, now(), 0.05);
      }
    },

    setHighPass(freqHz) { highPass.frequency.setTargetAtTime(clamp(freqHz, 60, 500), now(), 0.02); },

    setToneEq({ bodyDb, presenceDb, airDb }) {
      eqLow.gain.setTargetAtTime(clamp(bodyDb, -8, 8), now(), 0.02);
      eqMid.gain.setTargetAtTime(clamp(presenceDb, -8, 8), now(), 0.02);
      eqHigh.gain.setTargetAtTime(clamp(airDb, -8, 8), now(), 0.02);
    },

    setMainPitch(semitones) {
      mainShift.pitch = clamp(semitones, -24, 24);
    },

    setCorrectionBlend(amount) {
      const a = clamp01(amount);
      wetGain.gain.setTargetAtTime(a, now(), RAMP);
      dryGain.gain.setTargetAtTime(1 - a, now(), RAMP);
    },

    setDeEsser(on, amount, frequencyKhz) {
      deEsserState = { on, amount, freqKhz: frequencyKhz };
      applyDeEsser();
    },

    setCompressor(on, thresholdDb, ratio, attackMs, releaseMs, makeupDb, mix) {
      if (on) {
        compressor.threshold.setTargetAtTime(clamp(thresholdDb, -60, 0), now(), 0.01);
        compressor.ratio.setTargetAtTime(clamp(ratio, 1, 20), now(), 0.01);
        compressor.attack.setTargetAtTime(clamp(attackMs, 0.1, 100) / 1000, now(), 0.01);
        compressor.release.setTargetAtTime(clamp(releaseMs, 10, 1000) / 1000, now(), 0.01);
        compMakeup.gain.setTargetAtTime(dbToGain(clamp(makeupDb, 0, 20)), now(), RAMP);
        compWet.gain.setTargetAtTime(clamp01(mix), now(), RAMP);
        compDry.gain.setTargetAtTime(1 - clamp01(mix), now(), RAMP);
      } else {
        compWet.gain.setTargetAtTime(0, now(), RAMP);
        compDry.gain.setTargetAtTime(1, now(), RAMP);
      }
    },

    setSaturation(on, drive, mix) {
      if (on) {
        satShaper.curve = makeSatCurve(drive);
        satWet.gain.setTargetAtTime(clamp01(mix), now(), RAMP);
        satDry.gain.setTargetAtTime(1 - clamp01(mix), now(), RAMP);
      } else {
        satWet.gain.setTargetAtTime(0, now(), RAMP);
        satDry.gain.setTargetAtTime(1, now(), RAMP);
      }
    },

    setDoubler(on, amount, width) {
      doublerDelay.delayTime.rampTo(0.016 + clamp01(amount) * 0.018, 0.08);
      doublerGain.gain.rampTo(on ? clamp01(amount) * 0.55 : 0, RAMP);
      doublerPanner.pan.rampTo(clamp01(width) * 0.65, RAMP);
    },

    setHarmony(on, interval, mix) {
      harmonyShift.pitch = clamp(interval, -24, 24);
      harmonyGain.gain.rampTo(on ? clamp01(mix) : 0, RAMP);
    },

    setDelay(on, time, feedback, mix, lowCutHz = 300, highCutHz = 8000) {
      delayFx.delayTime.rampTo(clamp(time, 0.01, 1.5), 0.1);
      delayFx.feedback.rampTo(clamp(feedback, 0, 0.88), RAMP);
      delayHpf.frequency.setTargetAtTime(clamp(lowCutHz, 100, 1000), now(), 0.02);
      delayLpf.frequency.setTargetAtTime(clamp(highCutHz, 4000, 16000), now(), 0.02);
      delaySend.gain.rampTo(on ? 0.7 : 0, RAMP);
      delayReturn.gain.rampTo(on ? clamp01(mix) : 0, RAMP);
    },

    setReverb(on, decay, mix, preDelay = 0.015, lowCutHz = 200, highCutHz = 10000) {
      const d = clamp(decay, 0.3, 8);
      if (Math.abs((reverbFx.decay as number) - d) > 0.1) {
        reverbFx.decay = d;
        reverbFx.preDelay = preDelay;
      }
      reverbHpf.frequency.setTargetAtTime(clamp(lowCutHz, 100, 1000), now(), 0.02);
      reverbLpf.frequency.setTargetAtTime(clamp(highCutHz, 4000, 16000), now(), 0.02);
      reverbSend.gain.rampTo(on ? 0.75 : 0, RAMP);
      reverbReturn.gain.rampTo(on ? clamp01(mix) : 0, RAMP);
    },

    setOutput(gain) { outGain.gain.rampTo(clamp(gain, 0, 1.5), RAMP); },

    setWindowSize(seconds) {
      windowSize = clamp(seconds, 0.03, 0.12);
      mainShift.windowSize = windowSize;
      harmonyShift.windowSize = windowSize;
    },

    setMeterCallbacks(cb) { meterCb = { ...meterCb, ...cb }; },

    latencyMs() { return Math.round(windowSize * 1000); },

    dispose() {
      clearInterval(meterInterval);
      try { gateProcessor.onaudioprocess = null; } catch { /* */ }
      try {
        [mainShift, harmonyShift, harmonyGain, doublerDelay, doublerPanner, doublerGain,
         delaySend, delayFx, delayReturn,
         reverbSend, reverbFx, reverbReturn,
         outGain].forEach((n) => { try { n.dispose(); } catch { /* */ } });
        [inputGain, gateGain, gateProcessor, gateSink, highPass,
         eqLow, eqMid, eqHigh,
         wetGain, dryGain, pitchMixNode,
         deEsserSplit, deEsserHighGain, deEsserLowPass, deEsserSum,
         compressor, compMakeup, compWet, compDry, compSum,
         satShaper, satWet, satDry, satSum,
         masterBus, delayReturnNode, reverbReturnNode, finalBus,
         outputMeter, limiter,
         delayHpf, delayLpf, reverbHpf, reverbLpf].forEach((n) => { try { n.disconnect(); } catch { /* */ } });
      } catch { /* */ }
    },
  };
}

// ── Autotune helper ──────────────────────────────────────────────────────────
export function autotuneCorrection(freq: number, key: string, scale: ScaleId): number {
  if (freq <= 0) return 0;
  const detected = 69 + 12 * Math.log2(freq / 440);
  const target = snapToScale(Math.round(detected), keyToPc(key), scale);
  return target - detected;
}

// ── Auto key detection (Krumhansl-Schmuckler) ────────────────────────────────
const KEY_NAMES_SHARP = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function bestKeyFromChroma(hist: number[]): { key: string; scale: ScaleId } | null {
  if (hist.reduce((s, x) => s + x, 0) <= 0) return null;
  let best = -Infinity, bestRoot = 0, bestMinor = false;
  for (let root = 0; root < 12; root++) {
    const rotated = hist.map((_, i) => hist[(i + root) % 12]);
    const cMaj = correlate(rotated, KRUMHANSL_MAJOR);
    const cMin = correlate(rotated, KRUMHANSL_MINOR);
    if (cMaj > best) { best = cMaj; bestRoot = root; bestMinor = false; }
    if (cMin > best) { best = cMin; bestRoot = root; bestMinor = true; }
  }
  return { key: KEY_NAMES_SHARP[bestRoot], scale: bestMinor ? "minor" : "major" };
}
