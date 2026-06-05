"use client";

// ───────────────────────────────────────────────────────────────────────────
// Professional Vocal FX Chain for Verses
//
// Signal flow:
//
//   mic → inputGain → gate → highPass → toneEQ (3-band) →
//     pitchShift (Tone, wet) + dry path → pitchBlend →
//     harmony (Tone, parallel) + doubler (parallel) +
//     de-esser → compressor (native parallel) → saturation →
//     vocalMain →
//       delay send (Tone, parallel) → delayFilter → delayReturn
//       reverb send (Tone, parallel) → reverbFilter → reverbReturn
//     → outputGain (Tone) → limiter (native) → engine.master
//
// Key design points:
// - Tone nodes connected via Tone.connect(). Native nodes via .connect().
// - All parameter changes use smooth ramps — no abrupt clicks.
// - Parallel delay/reverb sends so dry vocal stays clear.
// - Safety limiter at output.
// - De-esser: split-band gain reduction on sibilance (5–12 kHz).
// - Pitch shifting: Tone PitchShift (granular, no formant preservation —
//   documented limitation; sounds musical for autotune/harmony ranges).
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
const RAMP = 0.04; // seconds for smooth parameter transitions

export async function createVocalFxChain(engine: AudioEngine): Promise<VocalFxChain> {
  const Tone = await engine.loadTone();
  const ctx = engine.ctx;
  const now = () => ctx.currentTime;

  // ─────────────────────────────────────────────────────────────────────────
  // All native Web Audio nodes
  // ─────────────────────────────────────────────────────────────────────────
  const mkGain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const mkBQ = (type: BiquadFilterType, freq: number) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    return f;
  };

  // Input path (native)
  const inputGain = mkGain(0.85);
  const gateGain = mkGain(1);
  const highPass = mkBQ("highpass", 80);
  const eqLow = mkBQ("lowshelf", 250);
  const eqMid = mkBQ("peaking", 3000);
  const eqMid2 = mkBQ("peaking", 3000); // same node, just ref
  void eqMid2;
  eqMid.Q.value = 0.8;
  const eqHigh = mkBQ("highshelf", 10000);

  // Pitch blend (native gains, straddling the Tone PitchShift)
  const wetGain = mkGain(0);   // shifted
  const dryGain = mkGain(1);   // unshifted
  const pitchMixNode = mkGain(1); // combined after blend

  // De-esser (native split-band)
  const deEsserSplit = mkBQ("highpass", 8000);
  const deEsserHighGain = mkGain(1);  // sibilance reduction
  const deEsserLowPass = mkGain(1);   // low/mid path untouched
  const deEsserSum = mkGain(1);

  // Compressor (native, with parallel wet/dry)
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.12;
  const compMakeup = mkGain(dbToGain(3));
  const compWet = mkGain(1);
  const compDry = mkGain(0);
  const compSum = mkGain(1);

  // Saturation (WaveShaper, native)
  const satShaper = ctx.createWaveShaper();
  satShaper.oversample = "2x";
  const satWet = mkGain(0);
  const satDry = mkGain(1);
  const satSum = mkGain(1);

  // Vocal main bus and metering (native)
  const vocalBus = mkGain(1);
  const outputMeter = ctx.createAnalyser();
  outputMeter.fftSize = 64;

  // Safety limiter (native)
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -0.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;

  // ─────────────────────────────────────────────────────────────────────────
  // Tone nodes
  // ─────────────────────────────────────────────────────────────────────────
  const mainShift = new Tone.PitchShift({ pitch: 0, windowSize: 0.1, delayTime: 0, feedback: 0 });
  const harmonyShift = new Tone.PitchShift({ pitch: 7, windowSize: 0.1 });
  const harmonyGain = new Tone.Gain(0);
  const doublerDelay = new Tone.Delay(0.02);
  const doublerGain = new Tone.Gain(0);
  const doublerPanner = new Tone.Panner(0.7); // slightly right for stereo spread
  const delaySend = new Tone.Gain(0);
  const delayFx = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.3, wet: 1 });
  const delayReturn = new Tone.Gain(0);
  const reverbSend = new Tone.Gain(0);
  const reverbFx = new Tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 1 });
  const reverbReturn = new Tone.Gain(0);
  const outGain = new Tone.Gain(0.92);

  // Delay/reverb filters (native, placed in Tone send path)
  const delayLpf = mkBQ("lowpass", 8000);
  const delayHpf = mkBQ("highpass", 300);
  const reverbLpf = mkBQ("lowpass", 10000);
  const reverbHpf = mkBQ("highpass", 200);

  await reverbFx.ready.catch(() => {});

  // ─────────────────────────────────────────────────────────────────────────
  // Wiring
  // ─────────────────────────────────────────────────────────────────────────
  // Native input chain → Tone PitchShift input
  inputGain.connect(gateGain);
  gateGain.connect(highPass);
  highPass.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);

  // EQ output (native) feeds both the Tone pitch shift and the dry path
  // We need to go through Tone.connect for Tone nodes
  Tone.connect(eqHigh, mainShift);      // eqHigh (native) → mainShift (Tone)
  eqHigh.connect(dryGain);              // dry path stays native

  // Tone PitchShift → native wetGain
  Tone.connect(mainShift, wetGain);

  // Blend wet+dry into pitchMixNode (native)
  wetGain.connect(pitchMixNode);
  dryGain.connect(pitchMixNode);

  // Parallel harmony (Tone)
  Tone.connect(pitchMixNode, harmonyShift);
  Tone.connect(harmonyShift, harmonyGain);
  Tone.connect(harmonyGain, vocalBus);

  // Parallel doubler (Tone)
  Tone.connect(pitchMixNode, doublerDelay);
  Tone.connect(doublerDelay, doublerPanner);
  Tone.connect(doublerPanner, doublerGain);
  Tone.connect(doublerGain, vocalBus);

  // De-esser: split pitchMixNode → low path + high path, recombine
  pitchMixNode.connect(deEsserLowPass);
  pitchMixNode.connect(deEsserSplit);
  deEsserSplit.connect(deEsserHighGain);
  deEsserLowPass.connect(deEsserSum);
  deEsserHighGain.connect(deEsserSum);

  // Compressor: parallel dry/wet
  deEsserSum.connect(compressor);
  compressor.connect(compMakeup);
  compMakeup.connect(compWet);
  deEsserSum.connect(compDry);
  compWet.connect(compSum);
  compDry.connect(compSum);

  // Saturation: parallel dry/wet
  compSum.connect(satShaper);
  satShaper.connect(satWet);
  compSum.connect(satDry);
  satWet.connect(satSum);
  satDry.connect(satSum);

  // satSum → vocalBus (native)
  satSum.connect(vocalBus);

  // Parallel sends from vocalBus (Tone)
  Tone.connect(vocalBus, delaySend);
  Tone.connect(delaySend, delayFx);
  // delayFx output → native filter chain → delayReturn (Tone)
  Tone.connect(delayFx, delayHpf);
  delayHpf.connect(delayLpf);
  Tone.connect(delayLpf, delayReturn);
  Tone.connect(delayReturn, vocalBus);

  Tone.connect(vocalBus, reverbSend);
  Tone.connect(reverbSend, reverbFx);
  Tone.connect(reverbFx, reverbHpf);
  reverbHpf.connect(reverbLpf);
  Tone.connect(reverbLpf, reverbReturn);
  Tone.connect(reverbReturn, vocalBus);

  // Output: vocalBus → outGain (Tone) → native limiter → master
  Tone.connect(vocalBus, outGain);
  Tone.connect(outGain, limiter);
  limiter.connect(outputMeter);
  limiter.connect(engine.master);

  // ─────────────────────────────────────────────────────────────────────────
  // Saturation curve
  // ─────────────────────────────────────────────────────────────────────────
  function makeSatCurve(drive: number): Float32Array<ArrayBuffer> {
    const n = 512;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const amt = drive * 8;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * (1 + amt)) / Math.max(1, 1 + amt * 0.2);
    }
    return curve;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Gate state (software expander via polling)
  // ─────────────────────────────────────────────────────────────────────────
  let gateState = { on: true, thresholdDb: -45, depth: 0.8, attackMs: 5, releaseMs: 150 };
  let gateCurrentGain = 1.0;
  let lastGateTime = now();

  // Simple gate: sample the input RMS via analyser
  const gateAnalyser = ctx.createAnalyser();
  gateAnalyser.fftSize = 512;
  inputGain.connect(gateAnalyser);
  const gateBuf = new Float32Array(gateAnalyser.fftSize);

  function updateGate() {
    if (!gateState.on) { gateGain.gain.setTargetAtTime(1, now(), 0.01); return; }
    gateAnalyser.getFloatTimeDomainData(gateBuf);
    let sum = 0;
    for (let i = 0; i < gateBuf.length; i++) sum += gateBuf[i] * gateBuf[i];
    const rms = Math.sqrt(sum / gateBuf.length);
    const threshold = dbToGain(gateState.thresholdDb);
    const t = now();
    const dt = t - lastGateTime;
    lastGateTime = t;
    const targetGain = rms >= threshold ? 1 : 1 - gateState.depth;
    const tau = rms >= threshold ? gateState.attackMs / 1000 : gateState.releaseMs / 1000;
    const k = 1 - Math.exp(-dt / Math.max(tau, 0.001));
    gateCurrentGain += (targetGain - gateCurrentGain) * k;
    gateGain.gain.setTargetAtTime(gateCurrentGain, t, 0.005);
    meterCb.onGateActivity?.(1 - gateCurrentGain);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metering
  // ─────────────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    if (t - lastMeterT < 50) return;
    lastMeterT = t;

    updateGate();

    const red = compressor.reduction ?? 0;
    meterCb.onCompressorReduction?.(Math.max(0, -red) / 20);
    meterCb.onDeEsserActivity?.(1 - deEsserCurrentGain);

    const buf = new Float32Array(outputMeter.frequencyBinCount);
    outputMeter.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    meterCb.onOutputLevel?.(Math.min(1, Math.sqrt(s / buf.length) * 3));
  }

  const meterInterval = setInterval(updateMeters, 50);

  // ─────────────────────────────────────────────────────────────────────────
  // De-esser update
  // ─────────────────────────────────────────────────────────────────────────
  // deEsserFreq is stored in kHz (matching the param range 5..12 kHz from the hook)
  let deEsserState = { on: false, amount: 0.4, freqKhz: 8 };

  function applyDeEsser() {
    // Convert kHz → Hz for the BiquadFilter
    deEsserSplit.frequency.setTargetAtTime(clamp(deEsserState.freqKhz * 1000, 4000, 14000), now(), 0.02);
    const target = deEsserState.on ? 1 - deEsserState.amount * 0.6 : 1;
    deEsserCurrentGain = target;
    deEsserHighGain.gain.setTargetAtTime(target, now(), 0.02);
  }

  let windowSize = 0.1;

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────
  return {
    connectInput(node) { Tone.connect(node, inputGain); },
    disconnectInput(node) { try { node.disconnect(inputGain); } catch { /* */ } },
    connectOutput(node) { limiter.connect(node); },
    disconnectOutput(node) { try { limiter.disconnect(node); } catch { /* */ } },

    setInputGain(v) { inputGain.gain.setTargetAtTime(clamp01(v), now(), RAMP); },

    setGate(on, thresholdDb, depth, attackMs, releaseMs) {
      gateState = { on, thresholdDb, depth, attackMs, releaseMs };
      if (!on) { gateGain.gain.setTargetAtTime(1, now(), 0.05); gateCurrentGain = 1; }
    },

    setHighPass(freqHz) { highPass.frequency.setTargetAtTime(clamp(freqHz, 60, 500), now(), 0.02); },

    setToneEq({ bodyDb, presenceDb, airDb }) {
      eqLow.gain.setTargetAtTime(clamp(bodyDb, -6, 6), now(), 0.02);
      eqMid.gain.setTargetAtTime(clamp(presenceDb, -6, 6), now(), 0.02);
      eqHigh.gain.setTargetAtTime(clamp(airDb, -6, 6), now(), 0.02);
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
      // frequencyKhz comes from the hook in kHz units (param range 5..12)
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
        satShaper.curve = makeSatCurve(clamp01(drive));
        satWet.gain.setTargetAtTime(clamp01(mix), now(), RAMP);
        satDry.gain.setTargetAtTime(1 - clamp01(mix), now(), RAMP);
      } else {
        satWet.gain.setTargetAtTime(0, now(), RAMP);
        satDry.gain.setTargetAtTime(1, now(), RAMP);
      }
    },

    setDoubler(on, amount, width) {
      doublerDelay.delayTime.rampTo(0.015 + clamp01(amount) * 0.02, 0.1);
      doublerGain.gain.rampTo(on ? clamp01(amount) * 0.7 : 0, RAMP);
      // width 0 = center, width 1 = hard pan right; using 0.6 * width for a subtle spread
      doublerPanner.pan.rampTo(clamp01(width) * 0.6, RAMP);
    },

    setHarmony(on, interval, mix) {
      harmonyShift.pitch = clamp(interval, -24, 24);
      harmonyGain.gain.rampTo(on ? clamp01(mix) : 0, RAMP);
    },

    setDelay(on, time, feedback, mix, lowCutHz = 300, highCutHz = 8000) {
      delayFx.delayTime.rampTo(clamp(time, 0.01, 1.2), 0.1);
      delayFx.feedback.rampTo(clamp(feedback, 0, 0.92), RAMP);
      delayHpf.frequency.setTargetAtTime(clamp(lowCutHz, 100, 1000), now(), 0.02);
      delayLpf.frequency.setTargetAtTime(clamp(highCutHz, 4000, 16000), now(), 0.02);
      delaySend.gain.rampTo(on ? 0.8 : 0, RAMP);
      delayReturn.gain.rampTo(on ? clamp01(mix) : 0, RAMP);
    },

    setReverb(on, decay, mix, preDelay = 0.02, lowCutHz = 200, highCutHz = 10000) {
      const d = clamp(decay, 0.3, 8);
      if (Math.abs((reverbFx.decay as number) - d) > 0.1) {
        reverbFx.decay = d;
        reverbFx.preDelay = preDelay;
      }
      reverbHpf.frequency.setTargetAtTime(clamp(lowCutHz, 100, 1000), now(), 0.02);
      reverbLpf.frequency.setTargetAtTime(clamp(highCutHz, 4000, 16000), now(), 0.02);
      reverbSend.gain.rampTo(on ? 0.8 : 0, RAMP);
      reverbReturn.gain.rampTo(on ? clamp01(mix) : 0, RAMP);
    },

    setOutput(gain) { outGain.gain.rampTo(clamp01(gain), RAMP); },

    setWindowSize(seconds) {
      windowSize = clamp(seconds, 0.03, 0.1);
      mainShift.windowSize = windowSize;
      harmonyShift.windowSize = windowSize;
    },

    setMeterCallbacks(cb) { meterCb = { ...meterCb, ...cb }; },

    latencyMs() { return Math.round(windowSize * 1000); },

    dispose() {
      clearInterval(meterInterval);
      try {
        [mainShift, harmonyShift, harmonyGain, doublerDelay, doublerPanner, doublerGain,
         delaySend, delayFx, delayReturn,
         reverbSend, reverbFx, reverbReturn,
         outGain].forEach((n) => { try { n.dispose(); } catch { /* */ } });
        [inputGain, gateGain, highPass, eqLow, eqMid, eqHigh,
         wetGain, dryGain, pitchMixNode,
         deEsserSplit, deEsserHighGain, deEsserLowPass, deEsserSum,
         compressor, compMakeup, compWet, compDry, compSum,
         satShaper, satWet, satDry, satSum,
         vocalBus, outputMeter, limiter,
         gateAnalyser,
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
