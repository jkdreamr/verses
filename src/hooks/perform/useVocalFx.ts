"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureEngine, resumeEngine } from "@/lib/audio/engine";
import { createVocalFxChain, autotuneCorrection, bestKeyFromChroma, type VocalFxChain } from "@/lib/audio/vocalFx";
import { aboveNoiseFloor } from "@/lib/audio/calibrate";
import { midiToLabel, type ScaleId } from "@/lib/audio/scales";

// ───────────────────────────────────────────────────────────────────────────
// React wrapper around the shared vocal-FX chain. Drives autotune from the
// existing pitchy McLeod worklet, exposes click-free param setters, persists
// settings, and surfaces detected pitch + level + honest latency.
// Used by the Perform FX rack and by Mode B (hands set the pitch directly).
// ───────────────────────────────────────────────────────────────────────────

export type VocalFxParams = {
  // Input / Gate
  inputGain: number; // 0..1
  gateOn: boolean;
  gateThresholdDb: number; // -60..-20
  gateDepth: number; // 0..1
  gateAttackMs: number;
  gateReleaseMs: number;
  highPassHz: number; // 60..180

  // Pitch
  autotuneOn: boolean;
  autotuneAmount: number; // 0..1 correction blend
  retuneMs: number; // 3 (hard) .. 140 (natural)
  key: string;
  scale: ScaleId;

  // EQ
  eqOn: boolean;
  eqBodyDb: number; // -6..6 @ 250Hz
  eqPresenceDb: number; // -6..6 @ 3kHz
  eqAirDb: number; // -6..6 @ 10kHz

  // De-esser
  deEsserOn: boolean;
  deEsserAmount: number; // 0..1
  deEsserFreq: number; // 5..10 kHz

  // Compressor
  compressorOn: boolean;
  compressorThresholdDb: number; // -40..-10
  compressorRatio: number; // 1..20
  compressorAttackMs: number;
  compressorReleaseMs: number;
  compressorMakeupDb: number; // 0..12
  compressorMix: number; // 0..1 (parallel)

  // Saturation
  saturationOn: boolean;
  saturationDrive: number; // 0..1
  saturationMix: number; // 0..1

  // Doubler
  doublerOn: boolean;
  doublerAmount: number; // 0..1
  doublerWidth: number; // 0..1 stereo width

  // Harmony
  harmonyOn: boolean;
  harmonyInterval: number; // semitones
  harmonyMix: number; // 0..1

  // Delay
  delayOn: boolean;
  delayTime: number; // seconds
  delayFeedback: number; // 0..0.92
  delayMix: number; // 0..1
  delayLowCutHz: number; // 100..800
  delayHighCutHz: number; // 4000..12000

  // Reverb
  reverbOn: boolean;
  reverbDecay: number; // 0.3..8 s
  reverbMix: number; // 0..1
  reverbPreDelay: number; // 0..0.1 s
  reverbLowCutHz: number; // 100..800
  reverbHighCutHz: number; // 4000..12000

  outputGain: number; // 0..1
  windowSize: number; // 0.03..0.1 s (latency vs quality)
};

export const VOCAL_FX_DEFAULT: VocalFxParams = {
  // Input
  inputGain: 0.85,
  gateOn: true,
  gateThresholdDb: -45,
  gateDepth: 0.8,
  gateAttackMs: 5,
  gateReleaseMs: 150,
  highPassHz: 80,

  // Pitch
  autotuneOn: true,
  autotuneAmount: 0.6,
  retuneMs: 55,
  key: "C",
  scale: "major",

  // EQ
  eqOn: true,
  eqBodyDb: 1.5,
  eqPresenceDb: 2,
  eqAirDb: 1,

  // De-esser
  deEsserOn: true,
  deEsserAmount: 0.4,
  deEsserFreq: 8,

  // Compressor
  compressorOn: true,
  compressorThresholdDb: -22,
  compressorRatio: 4,
  compressorAttackMs: 8,
  compressorReleaseMs: 120,
  compressorMakeupDb: 3,
  compressorMix: 1,

  // Saturation
  saturationOn: false,
  saturationDrive: 0.3,
  saturationMix: 0.3,

  // Doubler
  doublerOn: false,
  doublerAmount: 0.35,
  doublerWidth: 0.6,

  // Harmony
  harmonyOn: false,
  harmonyInterval: 7,
  harmonyMix: 0.35,

  // Delay
  delayOn: false,
  delayTime: 0.22,
  delayFeedback: 0.28,
  delayMix: 0.22,
  delayLowCutHz: 300,
  delayHighCutHz: 8000,

  // Reverb
  reverbOn: true,
  reverbDecay: 2.2,
  reverbMix: 0.18,
  reverbPreDelay: 0.02,
  reverbLowCutHz: 200,
  reverbHighCutHz: 10000,

  outputGain: 0.92,
  windowSize: 0.1,
};

export type VocalFxPreset = { name: string; blurb: string; params: Partial<VocalFxParams> };

export const VOCAL_FX_PRESETS: VocalFxPreset[] = [
  {
    name: "Clean Studio",
    blurb: "Natural tuning, gentle gate, low cut, subtle compression, small plate",
    params: {
      autotuneOn: true, autotuneAmount: 0.4, retuneMs: 90,
      gateOn: true, gateThresholdDb: -45, gateDepth: 0.7,
      highPassHz: 80,
      eqOn: true, eqBodyDb: 1, eqPresenceDb: 1.5, eqAirDb: 0.5,
      deEsserOn: true, deEsserAmount: 0.35,
      compressorOn: true, compressorThresholdDb: -20, compressorRatio: 3, compressorMix: 1,
      doublerOn: false, harmonyOn: false,
      delayOn: false,
      reverbOn: true, reverbDecay: 1.6, reverbMix: 0.12,
    }
  },
  {
    name: "Modern Pop",
    blurb: "Tight tuning, polished compression, de-esser, slap/plate, slight air",
    params: {
      autotuneOn: true, autotuneAmount: 0.75, retuneMs: 35,
      gateOn: true, gateThresholdDb: -42, gateDepth: 0.85,
      highPassHz: 90,
      eqOn: true, eqBodyDb: 1, eqPresenceDb: 2.5, eqAirDb: 2,
      deEsserOn: true, deEsserAmount: 0.55,
      compressorOn: true, compressorThresholdDb: -24, compressorRatio: 5, compressorMix: 0.85,
      saturationOn: false,
      doublerOn: false, harmonyOn: false,
      delayOn: true, delayTime: 0.18, delayFeedback: 0.16, delayMix: 0.16,
      reverbOn: true, reverbDecay: 2.2, reverbMix: 0.2,
    }
  },
  {
    name: "Rap Lead",
    blurb: "Medium-hard tuning, tighter compressor, short delay, controlled reverb",
    params: {
      autotuneOn: true, autotuneAmount: 0.8, retuneMs: 25,
      gateOn: true, gateThresholdDb: -40, gateDepth: 0.9,
      highPassHz: 100,
      eqOn: true, eqBodyDb: 2, eqPresenceDb: 3, eqAirDb: 1,
      deEsserOn: true, deEsserAmount: 0.6,
      compressorOn: true, compressorThresholdDb: -26, compressorRatio: 6, compressorAttackMs: 5, compressorMix: 0.9,
      saturationOn: true, saturationDrive: 0.25, saturationMix: 0.2,
      doublerOn: false, harmonyOn: false,
      delayOn: true, delayTime: 0.14, delayFeedback: 0.12, delayMix: 0.2, delayLowCutHz: 400,
      reverbOn: true, reverbDecay: 1.4, reverbMix: 0.12, reverbLowCutHz: 300,
    }
  },
  {
    name: "R&B Smooth",
    blurb: "Natural tuning, warm compression, wider reverb, tasteful doubler",
    params: {
      autotuneOn: true, autotuneAmount: 0.5, retuneMs: 75,
      gateOn: true, gateThresholdDb: -48, gateDepth: 0.6,
      highPassHz: 70,
      eqOn: true, eqBodyDb: 2, eqPresenceDb: 1, eqAirDb: 1.5,
      deEsserOn: true, deEsserAmount: 0.3,
      compressorOn: true, compressorThresholdDb: -18, compressorRatio: 3.5, compressorMix: 1,
      saturationOn: false,
      doublerOn: true, doublerAmount: 0.4, doublerWidth: 0.7,
      harmonyOn: false,
      delayOn: false,
      reverbOn: true, reverbDecay: 3.2, reverbMix: 0.35, reverbPreDelay: 0.025,
    }
  },
  {
    name: "Indie Double",
    blurb: "Light correction, doubler, slapback, small room",
    params: {
      autotuneOn: true, autotuneAmount: 0.3, retuneMs: 85,
      gateOn: false,
      highPassHz: 60,
      eqOn: true, eqBodyDb: 0.5, eqPresenceDb: 1, eqAirDb: 0.5,
      deEsserOn: false,
      compressorOn: true, compressorThresholdDb: -16, compressorRatio: 2.5, compressorMix: 1,
      doublerOn: true, doublerAmount: 0.5, doublerWidth: 0.5,
      harmonyOn: false,
      delayOn: true, delayTime: 0.11, delayFeedback: 0.05, delayMix: 0.35,
      reverbOn: true, reverbDecay: 1.2, reverbMix: 0.15,
    }
  },
  {
    name: "Dream Hall",
    blurb: "Softer correction, harmony optional, big filtered reverb, filtered delay",
    params: {
      autotuneOn: true, autotuneAmount: 0.35, retuneMs: 100,
      gateOn: true, gateThresholdDb: -50, gateDepth: 0.5,
      highPassHz: 70,
      eqOn: true, eqBodyDb: 1, eqPresenceDb: 0, eqAirDb: 2,
      deEsserOn: false,
      compressorOn: true, compressorThresholdDb: -20, compressorRatio: 3, compressorMix: 1,
      doublerOn: false,
      harmonyOn: true, harmonyInterval: 12, harmonyMix: 0.25,
      delayOn: true, delayTime: 0.4, delayFeedback: 0.34, delayMix: 0.3, delayLowCutHz: 400, delayHighCutHz: 6000,
      reverbOn: true, reverbDecay: 5, reverbMix: 0.45, reverbPreDelay: 0.035, reverbLowCutHz: 250, reverbHighCutHz: 8000,
    }
  },
  {
    name: "Live Low Latency",
    blurb: "Minimal reverb, smaller pitch window, safe gate, light compression",
    params: {
      autotuneOn: true, autotuneAmount: 0.5, retuneMs: 20,
      gateOn: true, gateThresholdDb: -40, gateDepth: 0.85,
      highPassHz: 100,
      eqOn: true, eqBodyDb: 1, eqPresenceDb: 1.5, eqAirDb: 0,
      deEsserOn: true, deEsserAmount: 0.3,
      compressorOn: true, compressorThresholdDb: -18, compressorRatio: 4, compressorMix: 1,
      doublerOn: false, harmonyOn: false,
      delayOn: false,
      reverbOn: true, reverbDecay: 0.8, reverbMix: 0.08,
      windowSize: 0.05,
    }
  },
  {
    name: "Raw Clean",
    blurb: "No pitch correction, light EQ/compression only",
    params: {
      autotuneOn: false, autotuneAmount: 0, retuneMs: 100,
      gateOn: true, gateThresholdDb: -50, gateDepth: 0.6,
      highPassHz: 80,
      eqOn: true, eqBodyDb: 0.5, eqPresenceDb: 1, eqAirDb: 0,
      deEsserOn: false,
      compressorOn: true, compressorThresholdDb: -16, compressorRatio: 2, compressorMix: 1,
      saturationOn: false,
      doublerOn: false, harmonyOn: false,
      delayOn: false,
      reverbOn: false,
    }
  },
];

const STORE_KEY = "verses.vocalfx.v2";
const CLARITY_GATE = 0.5;
const MIN_FREQ = 70, MAX_FREQ = 1200;

function loadParams(): VocalFxParams {
  if (typeof window === "undefined") return VOCAL_FX_DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Merge with defaults for any missing fields (backward compatibility)
      return { ...VOCAL_FX_DEFAULT, ...parsed };
    }
  } catch { /* */ }
  return VOCAL_FX_DEFAULT;
}

export function useVocalFx({ micStream, enabled }: { micStream: MediaStream | null; enabled: boolean }) {
  const [params, setParams] = useState<VocalFxParams>(loadParams);
  const [presetName, setPresetName] = useState<string>("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedNote, setDetectedNote] = useState<string | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [detectingKey, setDetectingKey] = useState(false);
  const [gateActivity, setGateActivity] = useState(0);
  const [compressorReduction, setCompressorReduction] = useState(0);
  const [deEsserActivity, setDeEsserActivity] = useState(0);

  const chainRef = useRef<VocalFxChain | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const paramsRef = useRef(params);
  const smoothedRef = useRef(0);
  const lastMsgRef = useRef(0);
  const manualPitchRef = useRef(0);
  const manualActiveRef = useRef(false);
  const keyDetectRef = useRef<{ active: boolean; hist: number[] }>({ active: false, hist: new Array(12).fill(0) });

  // persist + push every change into the live chain
  useEffect(() => {
    paramsRef.current = params;
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(params)); } catch { /* */ }
    const c = chainRef.current;
    if (!c) return;

    // Input/Gate
    c.setInputGain(params.inputGain);
    c.setGate(params.gateOn, params.gateThresholdDb, params.gateDepth, params.gateAttackMs, params.gateReleaseMs);
    c.setHighPass(params.highPassHz);

    // Pitch correction blend: 0 = dry, 1 = fully corrected
    // CRITICAL FIX: When autotune is OFF, blend should be 0 (dry), not 1
    const blend = params.autotuneOn ? params.autotuneAmount : 0;
    c.setCorrectionBlend(blend);

    // EQ
    c.setToneEq({ bodyDb: params.eqBodyDb, presenceDb: params.eqPresenceDb, airDb: params.eqAirDb });

    // De-esser
    c.setDeEsser(params.deEsserOn, params.deEsserAmount, params.deEsserFreq);

    // Compressor
    c.setCompressor(
      params.compressorOn,
      params.compressorThresholdDb,
      params.compressorRatio,
      params.compressorAttackMs,
      params.compressorReleaseMs,
      params.compressorMakeupDb,
      params.compressorMix
    );

    // Saturation
    c.setSaturation(params.saturationOn, params.saturationDrive, params.saturationMix);

    // Doubler
    c.setDoubler(params.doublerOn, params.doublerAmount, params.doublerWidth);

    // Harmony
    c.setHarmony(params.harmonyOn, params.harmonyInterval, params.harmonyMix);

    // Delay
    c.setDelay(
      params.delayOn,
      params.delayTime,
      params.delayFeedback,
      params.delayMix,
      params.delayLowCutHz,
      params.delayHighCutHz
    );

    // Reverb
    c.setReverb(
      params.reverbOn,
      params.reverbDecay,
      params.reverbMix,
      params.reverbPreDelay,
      params.reverbLowCutHz,
      params.reverbHighCutHz
    );

    // Output
    c.setOutput(params.outputGain);
    c.setWindowSize(params.windowSize);

    // Update pitch only if not in manual mode and autotune is on
    if (!params.autotuneOn && !manualActiveRef.current) {
      c.setMainPitch(0);
    }
  }, [params]);

  // build / teardown the live chain
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !micStream) { teardown(); return; }
    (async () => {
      try {
        const engine = ensureEngine();
        await resumeEngine();
        if (!chainRef.current) {
          setLoading(true);
          const chain = await createVocalFxChain(engine);
          if (cancelled) { chain.dispose(); setLoading(false); return; }
          chainRef.current = chain;
          const p = paramsRef.current;

          // Initialize all parameters
          chain.setInputGain(p.inputGain);
          chain.setGate(p.gateOn, p.gateThresholdDb, p.gateDepth, p.gateAttackMs, p.gateReleaseMs);
          chain.setHighPass(p.highPassHz);
          chain.setCorrectionBlend(p.autotuneOn ? p.autotuneAmount : 0);
          chain.setToneEq({ bodyDb: p.eqBodyDb, presenceDb: p.eqPresenceDb, airDb: p.eqAirDb });
          chain.setDeEsser(p.deEsserOn, p.deEsserAmount, p.deEsserFreq);
          chain.setCompressor(p.compressorOn, p.compressorThresholdDb, p.compressorRatio, p.compressorAttackMs, p.compressorReleaseMs, p.compressorMakeupDb, p.compressorMix);
          chain.setSaturation(p.saturationOn, p.saturationDrive, p.saturationMix);
          chain.setDoubler(p.doublerOn, p.doublerAmount, p.doublerWidth);
          chain.setHarmony(p.harmonyOn, p.harmonyInterval, p.harmonyMix);
          chain.setDelay(p.delayOn, p.delayTime, p.delayFeedback, p.delayMix, p.delayLowCutHz, p.delayHighCutHz);
          chain.setReverb(p.reverbOn, p.reverbDecay, p.reverbMix, p.reverbPreDelay, p.reverbLowCutHz, p.reverbHighCutHz);
          chain.setOutput(p.outputGain);
          chain.setWindowSize(p.windowSize);

          // Set up metering callbacks
          chain.setMeterCallbacks({
            onGateActivity: (v) => setGateActivity(v),
            onCompressorReduction: (v) => setCompressorReduction(v),
            onDeEsserActivity: (v) => setDeEsserActivity(v),
            onOutputLevel: (v) => setOutputLevel(v),
          });

          setLoading(false);
        }
        await engine.ctx.audioWorklet.addModule("/worklets/pitch-detector.js").catch(() => {});
        if (cancelled) return;

        const micSource = engine.ctx.createMediaStreamSource(micStream);
        micSourceRef.current = micSource;
        chainRef.current.connectInput(micSource);

        const worklet = new AudioWorkletNode(engine.ctx, "pitch-detector");
        workletRef.current = worklet;
        const sink = engine.ctx.createGain();
        sink.gain.value = 0;
        sinkRef.current = sink;
        micSource.connect(worklet);
        worklet.connect(sink);
        sink.connect(engine.ctx.destination);

        worklet.port.onmessage = (ev: MessageEvent) => {
          const { freq, clarity, rms } = ev.data as { freq: number; clarity: number; rms: number };
          setInputLevel(Math.min(1, rms * 6));
          setConfidence(clarity);
          const c = chainRef.current;
          const p = paramsRef.current;
          if (!c) return;
          const voiced = clarity >= CLARITY_GATE && freq >= MIN_FREQ && freq <= MAX_FREQ && aboveNoiseFloor(rms);
          if (voiced) {
            const detectedMidi = Math.round(69 + 12 * Math.log2(freq / 440));
            setDetectedNote(midiToLabel(detectedMidi));
            if (keyDetectRef.current.active) keyDetectRef.current.hist[((detectedMidi % 12) + 12) % 12] += clarity;
          }
          // autotune only — Mode B drives pitch manually via setManualPitch()
          if (!p.autotuneOn || manualActiveRef.current) return;
          if (!voiced) return;
          const target = autotuneCorrection(freq, p.key, p.scale);
          const tNow = performance.now();
          const dt = lastMsgRef.current ? (tNow - lastMsgRef.current) / 1000 : 0.02;
          lastMsgRef.current = tNow;
          const tau = p.retuneMs / 1000;
          const k = tau <= 0.001 ? 1 : 1 - Math.exp(-dt / tau);
          smoothedRef.current += (target - smoothedRef.current) * k;
          c.setMainPitch(smoothedRef.current);
        };
        setReady(true);
        setError(null);
      } catch (e) {
        if (!cancelled) { console.warn("[useVocalFx] setup failed:", e); setError("Could not start vocal FX. Check mic permissions."); }
      }
    })();
    return () => { cancelled = true; teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, micStream]);

  function teardown() {
    try { if (workletRef.current?.port) workletRef.current.port.onmessage = null; } catch { /* */ }
    try { workletRef.current?.disconnect(); } catch { /* */ }
    try { sinkRef.current?.disconnect(); } catch { /* */ }
    if (micSourceRef.current && chainRef.current) chainRef.current.disconnectInput(micSourceRef.current);
    try { micSourceRef.current?.disconnect(); } catch { /* */ }
    workletRef.current = null; sinkRef.current = null; micSourceRef.current = null;
    // Dispose the entire chain so reverb/delay tails and pitch-shift nodes
    // are fully disconnected from engine.master immediately. Without this,
    // switching to Photobooth (or any other mode) leaves the Tone nodes wired
    // up and audible. chainRef is nulled so the next enable rebuilds fresh.
    try { chainRef.current?.dispose(); } catch { /* */ }
    chainRef.current = null;
    setReady(false);
  }

  useEffect(() => () => {
    teardown();
  }, []);

  // ── public setters ──
  const update = useCallback((patch: Partial<VocalFxParams>) => {
    setPresetName("");
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyPreset = useCallback((name: string) => {
    const p = VOCAL_FX_PRESETS.find((x) => x.name === name);
    if (!p) return;
    setParams((prev) => ({ ...prev, ...p.params }));
    setPresetName(name);
  }, []);

  // Listen ~4s and set the autotune key/scale to the key you're singing in.
  const detectKey = useCallback(() => {
    keyDetectRef.current = { active: true, hist: new Array(12).fill(0) };
    setDetectingKey(true);
    window.setTimeout(() => {
      keyDetectRef.current.active = false;
      const best = bestKeyFromChroma(keyDetectRef.current.hist);
      if (best) setParams((prev) => ({ ...prev, key: best.key, scale: best.scale, autotuneOn: true }));
      setDetectingKey(false);
    }, 4000);
  }, []);

  // Mode B: hands set the live pitch directly (bypasses autotune).
  const setManualPitch = useCallback((semitones: number) => {
    manualPitchRef.current = semitones;
    chainRef.current?.setMainPitch(semitones);
  }, []);

  // Mode B: the OTHER hand performs the effects live — wash (space), a momentary
  // harmony throw, or a "kill" (dry). Direct chain writes, layered on top of the
  // rack's base settings, so there's no per-frame React state churn. Pass null to
  // restore the base mix when the hand leaves.
  const setLiveFx = useCallback((s: { space: number; harmony: boolean; bypass: boolean } | null) => {
    const c = chainRef.current;
    const p = paramsRef.current;
    if (!c) return;
    if (s == null) {
      // CRITICAL FIX: Restore base rack settings properly when hand leaves
      c.setReverb(p.reverbOn, p.reverbDecay, p.reverbMix);
      c.setDelay(p.delayOn, p.delayTime, p.delayFeedback, p.delayMix);
      c.setHarmony(p.harmonyOn, p.harmonyInterval, p.harmonyMix);
      // Also restore pitch correction blend
      const blend = p.autotuneOn ? p.autotuneAmount : 0;
      c.setCorrectionBlend(blend);
      return;
    }
    if (s.bypass) {
      c.setReverb(false, p.reverbDecay, 0);
      c.setDelay(false, p.delayTime, p.delayFeedback, 0);
      c.setHarmony(false, p.harmonyInterval, 0);
      return;
    }
    const a = Math.max(0, Math.min(1, s.space));
    c.setReverb(true, Math.max(p.reverbDecay, 2.4), Math.min(0.92, p.reverbMix + a * 0.55));
    c.setDelay(true, p.delayTime, Math.min(0.85, p.delayFeedback + a * 0.2), Math.min(0.8, p.delayMix + a * 0.4));
    const harmOn = p.harmonyOn || s.harmony;
    c.setHarmony(harmOn, p.harmonyInterval, harmOn ? Math.max(p.harmonyMix, s.harmony ? 0.4 : 0) : 0);
  }, []);

  // CRITICAL FIX: setManualActive now properly restores rack settings when exiting manual mode
  const setManualActive = useCallback((active: boolean) => {
    manualActiveRef.current = active;
    const c = chainRef.current;
    const p = paramsRef.current;
    if (!c) return;

    if (active) {
      // In manual (hand) mode, push fully-shifted signal so the move is audible
      c.setCorrectionBlend(1);
    } else {
      // CRITICAL FIX: When exiting manual mode, restore proper settings
      c.setMainPitch(0);
      const blend = p.autotuneOn ? p.autotuneAmount : 0;
      c.setCorrectionBlend(blend);
      // Also restore any live FX that were active
      c.setReverb(p.reverbOn, p.reverbDecay, p.reverbMix);
      c.setDelay(p.delayOn, p.delayTime, p.delayFeedback, p.delayMix);
      c.setHarmony(p.harmonyOn, p.harmonyInterval, p.harmonyMix);
    }
  }, []);

  // CRITICAL FIX: Reset pitch when camera stops or hand leaves
  const resetPitch = useCallback(() => {
    manualPitchRef.current = 0;
    const c = chainRef.current;
    const p = paramsRef.current;
    if (!c) return;
    c.setMainPitch(0);
    // Restore correction blend to match autotune state
    const blend = p.autotuneOn ? p.autotuneAmount : 0;
    c.setCorrectionBlend(blend);
  }, []);

  const latencyMs = chainRef.current?.latencyMs() ?? Math.round(params.windowSize * 1000);

  return useMemo(() => ({
    params, update, applyPreset, presetName,
    ready, loading, error, detectedNote, inputLevel, outputLevel, confidence, latencyMs,
    gateActivity, compressorReduction, deEsserActivity,
    setManualPitch, setManualActive, setLiveFx, resetPitch, detectKey, detectingKey,
  }), [
    params, update, applyPreset, presetName,
    ready, loading, error, detectedNote, inputLevel, outputLevel, confidence, latencyMs,
    gateActivity, compressorReduction, deEsserActivity,
    setManualPitch, setManualActive, setLiveFx, resetPitch, detectKey, detectingKey
  ]);
}
