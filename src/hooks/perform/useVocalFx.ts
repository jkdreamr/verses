"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureEngine, resumeEngine } from "@/lib/audio/engine";
import { createVocalFxChain, autotuneCorrection, type VocalFxChain } from "@/lib/audio/vocalFx";
import { midiToLabel, type ScaleId } from "@/lib/audio/scales";

// ───────────────────────────────────────────────────────────────────────────
// React wrapper around the shared vocal-FX chain. Drives autotune from the
// existing pitchy McLeod worklet, exposes click-free param setters, persists
// settings, and surfaces detected pitch + level + honest latency.
// Used by the Perform FX rack and by Mode B (hands set the pitch directly).
// ───────────────────────────────────────────────────────────────────────────

export type VocalFxParams = {
  autotuneOn: boolean;
  autotuneAmount: number; // 0..1 correction blend
  retuneMs: number;       // 3 (hard) .. 140 (natural)
  key: string;
  scale: ScaleId;
  harmonyOn: boolean;
  harmonyInterval: number; // semitones
  harmonyMix: number;      // 0..1
  delayOn: boolean;
  delayTime: number;       // seconds
  delayFeedback: number;   // 0..0.92
  delayMix: number;        // 0..1
  reverbOn: boolean;
  reverbDecay: number;     // 0.3..8 s
  reverbMix: number;       // 0..1
  outputGain: number;      // 0..1
  windowSize: number;      // 0.03..0.1 s (latency vs quality)
};

export const VOCAL_FX_DEFAULT: VocalFxParams = {
  autotuneOn: true, autotuneAmount: 0.6, retuneMs: 55, key: "C", scale: "major",
  harmonyOn: false, harmonyInterval: 7, harmonyMix: 0.35,
  delayOn: false, delayTime: 0.22, delayFeedback: 0.28, delayMix: 0.22,
  reverbOn: true, reverbDecay: 2.2, reverbMix: 0.18,
  outputGain: 0.92, windowSize: 0.1,
};

export type VocalFxPreset = { name: string; blurb: string; params: Partial<VocalFxParams> };

export const VOCAL_FX_PRESETS: VocalFxPreset[] = [
  { name: "Natural", blurb: "Gentle pitch nudge + air", params: { autotuneOn: true, autotuneAmount: 0.4, retuneMs: 90, harmonyOn: false, delayOn: false, reverbOn: true, reverbDecay: 1.8, reverbMix: 0.12 } },
  { name: "Pop Vocal", blurb: "Tight tune + slap + plate", params: { autotuneOn: true, autotuneAmount: 0.75, retuneMs: 35, harmonyOn: false, delayOn: true, delayTime: 0.18, delayFeedback: 0.16, delayMix: 0.16, reverbOn: true, reverbDecay: 2.2, reverbMix: 0.2 } },
  { name: "T-Pain", blurb: "Hard auto-tune", params: { autotuneOn: true, autotuneAmount: 1, retuneMs: 3, harmonyOn: false, delayOn: false, reverbOn: true, reverbDecay: 1.4, reverbMix: 0.12 } },
  { name: "Dreamy Hall", blurb: "Octave shimmer + big hall", params: { autotuneOn: true, autotuneAmount: 0.5, retuneMs: 95, harmonyOn: true, harmonyInterval: 12, harmonyMix: 0.24, delayOn: true, delayTime: 0.4, delayFeedback: 0.34, delayMix: 0.24, reverbOn: true, reverbDecay: 4.6, reverbMix: 0.4 } },
  { name: "Slapback Double", blurb: "Doubled voice, short slap", params: { autotuneOn: true, autotuneAmount: 0.3, retuneMs: 70, harmonyOn: false, delayOn: true, delayTime: 0.11, delayFeedback: 0.02, delayMix: 0.32, reverbOn: true, reverbDecay: 1.2, reverbMix: 0.1 } },
];

const STORE_KEY = "verses.vocalfx.v1";
const CLARITY_GATE = 0.5;
const MIN_FREQ = 70, MAX_FREQ = 1200;

function loadParams(): VocalFxParams {
  if (typeof window === "undefined") return VOCAL_FX_DEFAULT;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) return { ...VOCAL_FX_DEFAULT, ...JSON.parse(raw) };
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
  const [confidence, setConfidence] = useState(0);

  const chainRef = useRef<VocalFxChain | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const paramsRef = useRef(params);
  const smoothedRef = useRef(0);
  const lastMsgRef = useRef(0);
  const manualPitchRef = useRef(0);
  const manualActiveRef = useRef(false);

  // persist + push every change into the live chain
  useEffect(() => {
    paramsRef.current = params;
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(params)); } catch { /* */ }
    const c = chainRef.current;
    if (!c) return;
    c.setCorrectionBlend(params.autotuneOn ? params.autotuneAmount : 1);
    c.setHarmony(params.harmonyOn, params.harmonyInterval, params.harmonyMix);
    c.setDelay(params.delayOn, params.delayTime, params.delayFeedback, params.delayMix);
    c.setReverb(params.reverbOn, params.reverbDecay, params.reverbMix);
    c.setOutput(params.outputGain);
    c.setWindowSize(params.windowSize);
    if (!params.autotuneOn && !manualActiveRef.current) c.setMainPitch(manualPitchRef.current);
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
          chain.setCorrectionBlend(p.autotuneOn ? p.autotuneAmount : 1);
          chain.setHarmony(p.harmonyOn, p.harmonyInterval, p.harmonyMix);
          chain.setDelay(p.delayOn, p.delayTime, p.delayFeedback, p.delayMix);
          chain.setReverb(p.reverbOn, p.reverbDecay, p.reverbMix);
          chain.setOutput(p.outputGain);
          chain.setWindowSize(p.windowSize);
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
          const voiced = clarity >= CLARITY_GATE && freq >= MIN_FREQ && freq <= MAX_FREQ;
          if (voiced) {
            const detectedMidi = Math.round(69 + 12 * Math.log2(freq / 440));
            setDetectedNote(midiToLabel(detectedMidi));
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
    setReady(false);
  }

  useEffect(() => () => {
    teardown();
    try { chainRef.current?.dispose(); } catch { /* */ }
    chainRef.current = null;
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

  // Mode B: hands set the live pitch directly (bypasses autotune).
  const setManualPitch = useCallback((semitones: number) => {
    manualPitchRef.current = semitones;
    chainRef.current?.setMainPitch(semitones);
  }, []);
  const setManualActive = useCallback((active: boolean) => {
    manualActiveRef.current = active;
    const c = chainRef.current;
    if (!c) return;
    // in manual (hand) mode, push fully-shifted signal so the move is audible
    if (active) c.setCorrectionBlend(1);
    else if (!paramsRef.current.autotuneOn) c.setMainPitch(manualPitchRef.current);
  }, []);

  const latencyMs = chainRef.current?.latencyMs() ?? Math.round(params.windowSize * 1000);

  return useMemo(() => ({
    params, update, applyPreset, presetName,
    ready, loading, error, detectedNote, inputLevel, confidence, latencyMs,
    setManualPitch, setManualActive,
  }), [params, update, applyPreset, presetName, ready, loading, error, detectedNote, inputLevel, confidence, latencyMs, setManualPitch, setManualActive]);
}
