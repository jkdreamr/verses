import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ensureEngine, resumeEngine } from "@/lib/audio/engine";
import { createTrumpetInstrument, type TrumpetInstrument } from "@/lib/audio/samplers";
import { aboveNoiseFloor, getNoiseFloor } from "@/lib/audio/calibrate";
import { snapToScale, keyToPc, midiToFreq, midiToLabel, type ScaleId } from "@/lib/audio/scales";
import { OneEuroFilter } from "@/lib/audio/oneEuro";

// ───────────────────────────────────────────────────────────────────────────
// Voice → Trumpet — upgraded pipeline.
//
// Live Play: mic → McLeod pitch worklet (off main thread) → OneEuroFilter
//   smoothing → octave-range mapping → articulation model → brass synth voice.
//   Prioritises low latency; worklet config adapts to chosen tracking preset.
//
// Sing-then-Convert: record a phrase → offline pitchy analysis → improved
//   segmentation (octave-flip removal, tiny-fragment merging, vibrato smoothing,
//   scale snap) → scheduled sampler playback. Prioritises clean results.
//
// Both routes through engine.trumpetBus so Takes capture them.
// ───────────────────────────────────────────────────────────────────────────

// ── Trumpet sound presets ─────────────────────────────────────────────────
export type TrumpetPreset = {
  name: string;
  blurb: string;
  brightness: number; // 0..1 → lowpass cutoff
  outputGain: number; // 0..1
  reverbWet: number; // 0..1
};

export const TRUMPET_PRESETS: TrumpetPreset[] = [
  { name: "Trumpet",    blurb: "Bright, open horn",       brightness: 0.62, outputGain: 0.80, reverbWet: 0.14 },
  { name: "Muted",      blurb: "Dark harmon-mute",        brightness: 0.26, outputGain: 0.72, reverbWet: 0.10 },
  { name: "Brass Bold", blurb: "Punchy brass section",    brightness: 0.82, outputGain: 0.84, reverbWet: 0.08 },
  { name: "Flugel",     blurb: "Warm, mellow flugel",     brightness: 0.42, outputGain: 0.76, reverbWet: 0.22 },
  { name: "Jazz Lead",  blurb: "Intimate, expressive",    brightness: 0.52, outputGain: 0.78, reverbWet: 0.18 },
];

// ── Pitch tracking presets (worklet configuration) ─────────────────────────
export type TrackingPreset = "fast" | "balanced" | "accurate";

type WorkletConfig = {
  windowSize: number;   // samples
  hop: number;          // samples
  attackThresh: number; // clarity to open gate
  releaseThresh: number;// clarity to stay open
  rmsGate: number;      // absolute silence floor
  lowCpuMode: boolean;
};

const TRACKING_PRESETS: Record<TrackingPreset, WorkletConfig & { label: string; blurb: string; latencyMs: number }> = {
  fast: {
    label: "Fast", blurb: "Lowest latency — best for fast phrases",
    windowSize: 1024, hop: 256, attackThresh: 0.52, releaseThresh: 0.38, rmsGate: 0.006, lowCpuMode: false,
    latencyMs: 22,
  },
  balanced: {
    label: "Balanced", blurb: "Good all-round — default",
    windowSize: 2048, hop: 512, attackThresh: 0.55, releaseThresh: 0.42, rmsGate: 0.005, lowCpuMode: false,
    latencyMs: 43,
  },
  accurate: {
    label: "Accurate", blurb: "Smoother, more stable — higher latency",
    windowSize: 4096, hop: 1024, attackThresh: 0.60, releaseThresh: 0.46, rmsGate: 0.004, lowCpuMode: false,
    latencyMs: 85,
  },
};

// ── Octave / range modes ───────────────────────────────────────────────────
export type RangeMode = "auto" | "same" | "+12" | "+24" | "-12";

const TRUMPET_LOW_MIDI  = 46; // Bb3 — comfortable low (includes Bb3 on Bb instrument)
const TRUMPET_HIGH_MIDI = 84; // C6  — top of practical range
const TRUMPET_SWEET_LOW = 58; // Bb4
const TRUMPET_SWEET_HIGH = 79; // G5

/**
 * Map a raw MIDI (from the singer's voice, any octave) into the trumpet range.
 * "auto" = intelligently transpose into the sweet range using the nearest octave.
 * This is exported so it can be unit-tested independently.
 */
export function mapToTrumpetRange(rawMidi: number, mode: RangeMode): number {
  switch (mode) {
    case "+12": return clampMidi(rawMidi + 12);
    case "+24": return clampMidi(rawMidi + 24);
    case "-12": return clampMidi(rawMidi - 12);
    case "same": return clampMidi(rawMidi);
    case "auto": {
      // Find which octave shift puts rawMidi closest to the sweet spot centre
      const sweetMid = (TRUMPET_SWEET_LOW + TRUMPET_SWEET_HIGH) / 2;
      let best = rawMidi;
      let bestDist = Infinity;
      for (const shift of [-24, -12, 0, 12, 24]) {
        const m = rawMidi + shift;
        if (m < TRUMPET_LOW_MIDI || m > TRUMPET_HIGH_MIDI) continue;
        const d = Math.abs(m - sweetMid);
        if (d < bestDist) { bestDist = d; best = m; }
      }
      return best;
    }
  }
}

function clampMidi(m: number): number {
  return Math.max(TRUMPET_LOW_MIDI, Math.min(TRUMPET_HIGH_MIDI, Math.round(m)));
}

// ── Pitch status ───────────────────────────────────────────────────────────
export type PitchStatus =
  | "idle"          // trumpet not enabled
  | "loading"       // instrument loading
  | "too_quiet"     // below noise floor
  | "no_pitch"      // rms ok but no clear pitch found
  | "out_of_range"  // pitch found but outside vocal range
  | "tracking"      // active note playing
  | "held"          // just stopped singing, tail ringing
  | "uncalibrated"; // no calibration data, showing warning

export type CaptureState = "idle" | "capturing" | "converting" | "ready";

export type UseLiveTrumpetConfig = {
  micStream: MediaStream | null;
  enabled: boolean;
};

type ConvNote = { midi: number; start: number; duration: number; velocity: number };

// ── Smoothing — OneEuroFilter config per tracking preset ───────────────────
const OEF_PARAMS: Record<TrackingPreset, { minCutoff: number; beta: number }> = {
  fast:     { minCutoff: 4.0, beta: 0.10 },
  balanced: { minCutoff: 2.0, beta: 0.06 },
  accurate: { minCutoff: 1.2, beta: 0.03 },
};

const lin01ToDb = (x: number) => (x <= 0.001 ? -60 : 20 * Math.log10(x));
const brightnessToHz = (b: number) => 1400 + Math.max(0, Math.min(1, b)) * 5800;
const freqToMidiF = (f: number) => 69 + 12 * Math.log2(f / 440);

// ─────────────────────────────────────────────────────────────────────────────
export function useLiveTrumpet({ micStream, enabled }: UseLiveTrumpetConfig) {

  // ── Sound params ──
  const [brightness, setBrightness] = useState(0.62);
  const [outputGain, setOutputGain]  = useState(0.80);
  const [reverbWet]                  = useState(0.14);

  // ── Feature params ──
  const [trackingPreset, setTrackingPreset] = useState<TrackingPreset>("balanced");
  const [rangeMode,      setRangeMode]      = useState<RangeMode>("auto");
  const [snapEnabled,    setSnapEnabled]    = useState(true);
  const [snapKey,        setSnapKey]        = useState("C");
  const [snapScale,      setSnapScale]      = useState<ScaleId>("major");

  // ── Status ──
  const [pitchStatus,    setPitchStatus]    = useState<PitchStatus>("idle");
  const [rawNote,        setRawNote]        = useState<string | null>(null);    // note detected from voice
  const [outputNote,     setOutputNote]     = useState<string | null>(null);   // note played on trumpet
  const [detectedNote,   setDetectedNote]   = useState<string | null>(null);   // alias (compat)
  const [confidence,     setConfidence]     = useState(0);   // 0..1
  const [inputLevel,     setInputLevel]     = useState(0);   // 0..1
  const [isActive,       setIsActive]       = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [loading,        setLoading]        = useState(false);
  const [latencyMs,      setLatencyMs]      = useState<number | null>(null);
  const [isCalibrated,   setIsCalibrated]   = useState(getNoiseFloor() > 0);

  // ── Mode / convert ──
  const [mode,           setMode]           = useState<"live" | "convert">("live");
  const [captureState,   setCaptureState]   = useState<CaptureState>("idle");
  const [convertNoteCount, setConvertNoteCount] = useState(0);

  // ── Refs ──
  const trumpetRef      = useRef<TrumpetInstrument | null>(null);
  const micSourceRef    = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef      = useRef<AudioWorkletNode | null>(null);
  const sinkRef         = useRef<GainNode | null>(null);
  const convRecorderRef = useRef<MediaRecorder | null>(null);
  const convChunksRef   = useRef<Blob[]>([]);
  const convNotesRef    = useRef<ConvNote[]>([]);

  // Pitch processing state (all in refs to avoid re-render churn)
  const oefRef          = useRef(new OneEuroFilter({ ...OEF_PARAMS.balanced, freq: 50 }));
  const committedMidiRef = useRef(0);
  const candidateRef    = useRef<{ midi: number; count: number }>({ midi: 0, count: 0 });
  const lastVoicedRef   = useRef(0); // performance.now() of last voiced frame
  const lastMsgRef      = useRef(0);
  // Throttle React state updates to avoid re-render every worklet frame
  const lastUiUpdateRef = useRef(0);
  const pendingUiRef    = useRef<{ rawNote?: string; outputNote?: string; confidence?: number; inputLevel?: number; isActive?: boolean; pitchStatus?: PitchStatus }>({});

  // Mirror-refs for params used in the worklet closure
  const brightnessRef     = useRef(brightness);
  const outputGainRef     = useRef(outputGain);
  const trackingPresetRef = useRef(trackingPreset);
  const rangeModeRef      = useRef(rangeMode);
  const snapRef           = useRef({ enabled: snapEnabled, key: snapKey, scale: snapScale });
  const modeRef           = useRef(mode);

  // ── Param sync to refs + live chain ──
  useEffect(() => {
    brightnessRef.current = brightness;
    trumpetRef.current?.setBrightnessHz(brightnessToHz(brightness));
  }, [brightness]);

  useEffect(() => {
    outputGainRef.current = outputGain;
    trumpetRef.current?.setVolumeDb(lin01ToDb(outputGain));
  }, [outputGain]);

  useEffect(() => { rangeModeRef.current = rangeMode; }, [rangeMode]);
  useEffect(() => { snapRef.current = { enabled: snapEnabled, key: snapKey, scale: snapScale }; }, [snapEnabled, snapKey, snapScale]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  useEffect(() => {
    trackingPresetRef.current = trackingPreset;
    // Reconfigure worklet when preset changes
    const cfg = TRACKING_PRESETS[trackingPreset];
    workletRef.current?.port.postMessage({
      windowSize:    cfg.windowSize,
      hop:           cfg.hop,
      attackThresh:  cfg.attackThresh,
      releaseThresh: cfg.releaseThresh,
      rmsGate:       cfg.rmsGate,
      lowCpuMode:    cfg.lowCpuMode,
    });
    // Reset OEF for new preset
    oefRef.current = new OneEuroFilter({ ...OEF_PARAMS[trackingPreset], freq: 50 });
    // Update latency display
    const engine = typeof window !== "undefined" ? (window as Window & { __audioEngine?: { ctx?: AudioContext } }).__audioEngine : undefined;
    void engine; // suppress
    setLatencyMs(TRACKING_PRESETS[trackingPreset].latencyMs);
  }, [trackingPreset]);

  // ── Calibration state sync ──
  useEffect(() => {
    setIsCalibrated(getNoiseFloor() > 0);
  }, []);

  const applyPreset = useCallback((p: TrumpetPreset) => {
    setBrightness(p.brightness);
    setOutputGain(p.outputGain);
  }, []);

  // ── Throttled UI flush (max 25 fps for status/note readouts) ──
  function flushUi(patch: typeof pendingUiRef.current) {
    Object.assign(pendingUiRef.current, patch);
    const now = performance.now();
    if (now - lastUiUpdateRef.current < 40) return; // 25 fps
    lastUiUpdateRef.current = now;
    const p = pendingUiRef.current;
    if (p.rawNote    !== undefined) { setRawNote(p.rawNote);       setDetectedNote(p.rawNote); }
    if (p.outputNote !== undefined) setOutputNote(p.outputNote);
    if (p.confidence !== undefined) setConfidence(p.confidence);
    if (p.inputLevel !== undefined) setInputLevel(p.inputLevel);
    if (p.isActive   !== undefined) setIsActive(p.isActive);
    if (p.pitchStatus !== undefined) setPitchStatus(p.pitchStatus);
    pendingUiRef.current = {};
  }

  // ── Live pipeline ──
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !micStream) {
      teardownLive();
      setPitchStatus("idle");
      return;
    }

    (async () => {
      try {
        const engine = ensureEngine();
        await resumeEngine();
        setPitchStatus("loading");
        setLoading(true);

        if (!trumpetRef.current) {
          const inst = await createTrumpetInstrument(engine, {
            brightnessHz: brightnessToHz(brightnessRef.current),
            reverbWet,
            volumeDb: lin01ToDb(outputGainRef.current),
          });
          if (cancelled) { inst.dispose(); setLoading(false); setPitchStatus("idle"); return; }
          trumpetRef.current = inst;
          await inst.ready;
        }
        setLoading(false);

        await engine.ctx.audioWorklet.addModule("/worklets/pitch-detector.js").catch(() => {});
        if (cancelled) return;

        const micSource = engine.ctx.createMediaStreamSource(micStream);
        micSourceRef.current = micSource;

        const worklet = new AudioWorkletNode(engine.ctx, "pitch-detector");
        workletRef.current = worklet;

        // Configure worklet immediately with current preset
        const cfg = TRACKING_PRESETS[trackingPresetRef.current];
        worklet.port.postMessage({
          windowSize:    cfg.windowSize,
          hop:           cfg.hop,
          attackThresh:  cfg.attackThresh,
          releaseThresh: cfg.releaseThresh,
          rmsGate:       cfg.rmsGate,
          lowCpuMode:    cfg.lowCpuMode,
        });

        const sink = engine.ctx.createGain();
        sink.gain.value = 0;
        sinkRef.current = sink;
        micSource.connect(worklet);
        worklet.connect(sink);
        sink.connect(engine.ctx.destination);

        // Compute honest latency
        const io = (engine.ctx.baseLatency ?? 0) + (engine.ctx.outputLatency ?? 0);
        setLatencyMs(Math.round(io * 1000) + TRACKING_PRESETS[trackingPresetRef.current].latencyMs);

        // Gate: hold the horn ringing briefly through momentary clarity dips
        const RELEASE_HOLD_MS = 120;

        worklet.port.onmessage = (ev: MessageEvent) => {
          const { freq, clarity, rms, pitchStatus: wStatus } =
            ev.data as { freq: number; clarity: number; rms: number; pitchStatus: string };

          const trumpet = trumpetRef.current;
          if (!trumpet || modeRef.current !== "live") {
            flushUi({ isActive: false, pitchStatus: "idle" });
            return;
          }

          // ── Throttled input level ──
          const lvl = Math.min(1, rms * 7);

          // ── Voiced / unvoiced gating ──
          const isVoiced = wStatus === "tracking" && freq > 0 && aboveNoiseFloor(rms);
          const now = performance.now();

          if (isVoiced) {
            // 1) OneEuro-smooth the raw frequency (kills jitter without killing fast changes)
            const tNow = now;
            const dt = lastMsgRef.current ? (tNow - lastMsgRef.current) : 20;
            lastMsgRef.current = tNow;
            const smoothedFreq = oefRef.current.filter(freq, tNow);

            // 2) Convert to MIDI, apply range mapping
            const rawMidiF   = freqToMidiF(smoothedFreq);
            const rawMidi    = Math.round(rawMidiF);
            const mappedMidi = mapToTrumpetRange(rawMidi, rangeModeRef.current);

            // 3) Optionally snap to scale
            const snapped = snapRef.current.enabled
              ? snapToScale(mappedMidi, keyToPc(snapRef.current.key), snapRef.current.scale)
              : mappedMidi;

            // 4) Note hysteresis — commit after 2 stable frames to avoid
            //    semi-tone chatter, but don't add lag on big jumps.
            const cand = candidateRef.current;
            const semitoneJump = Math.abs(snapped - (committedMidiRef.current || snapped));
            if (cand.midi === snapped) {
              cand.count++;
            } else {
              cand.midi  = snapped;
              cand.count = semitoneJump > 3 ? 2 : 1; // big jumps commit instantly
            }
            if (cand.count >= 2) committedMidiRef.current = snapped;
            const playMidi = committedMidiRef.current || snapped;

            // 5) Dynamics
            const expr     = Math.min(1, rms * 8);
            const velocity = Math.max(0.3, Math.min(1, expr));
            const legato   = committedMidiRef.current > 0; // legato unless first note

            // 6) Play — uses articulation model inside the brass synth
            trumpet.setBrightnessHz(brightnessToHz(brightnessRef.current) + expr * 2800);
            trumpet.noteOn(midiToFreq(playMidi), velocity, legato);
            lastVoicedRef.current = now;

            flushUi({
              inputLevel:  lvl,
              confidence:  clarity,
              rawNote:     midiToLabel(rawMidi),
              outputNote:  midiToLabel(playMidi),
              isActive:    true,
              pitchStatus: "tracking",
            });
            void dt; // suppress unused warning
          } else {
            // ── Unvoiced ──
            flushUi({ inputLevel: lvl, confidence: clarity });

            const elapsed = now - lastVoicedRef.current;
            if (elapsed > RELEASE_HOLD_MS && committedMidiRef.current > 0) {
              trumpet.noteOff();
              committedMidiRef.current = 0;
              candidateRef.current     = { midi: 0, count: 0 };
              oefRef.current.reset();
              flushUi({ isActive: false, outputNote: undefined, pitchStatus: mapWorkletStatus(wStatus, rms, isCalibrated) });
            } else if (committedMidiRef.current > 0) {
              flushUi({ pitchStatus: "held" });
            } else {
              flushUi({ pitchStatus: mapWorkletStatus(wStatus, rms, isCalibrated) });
            }
          }
        };

        setError(null);
        setPitchStatus(isCalibrated ? "no_pitch" : "uncalibrated");
      } catch (e) {
        if (!cancelled) {
          console.warn("[useLiveTrumpet] setup failed:", e);
          setError("Could not start the trumpet. Check mic permissions.");
          setPitchStatus("idle");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; teardownLive(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, micStream]);

  function teardownLive() {
    try { if (workletRef.current?.port) workletRef.current.port.onmessage = null; } catch { /* */ }
    try { workletRef.current?.disconnect(); } catch { /* */ }
    try { sinkRef.current?.disconnect(); } catch { /* */ }
    try { micSourceRef.current?.disconnect(); } catch { /* */ }
    try { trumpetRef.current?.noteOff(); } catch { /* */ }
    workletRef.current  = null;
    sinkRef.current     = null;
    micSourceRef.current = null;
    committedMidiRef.current = 0;
    candidateRef.current     = { midi: 0, count: 0 };
    oefRef.current.reset();
    setIsActive(false);
    setLoading(false);
  }

  useEffect(() => () => {
    teardownLive();
    try { trumpetRef.current?.dispose(); } catch { /* */ }
    trumpetRef.current = null;
  }, []);

  // ── Sing-then-Convert ──
  const startCapture = useCallback(() => {
    if (!micStream) return;
    convChunksRef.current = [];
    const mimeOpts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    let mime = "";
    for (const m of mimeOpts) { try { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } } catch { /* */ } }
    const rec = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
    rec.ondataavailable = (e) => { if (e.data.size > 0) convChunksRef.current.push(e.data); };
    rec.start(200);
    convRecorderRef.current = rec;
    setCaptureState("capturing");
  }, [micStream]);

  const finishCapture = useCallback(async (opts?: { smoothing?: ConvertSmoothing; scaleSnap?: boolean }) => {
    const rec = convRecorderRef.current;
    if (!rec) return;
    setCaptureState("converting");
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => resolve(new Blob(convChunksRef.current, { type: rec.mimeType || "audio/webm" }));
    });
    try { rec.stop(); } catch { /* */ }
    const blob = await done;
    try {
      const engine = ensureEngine();
      const arr    = await blob.arrayBuffer();
      const audioBuf = await engine.ctx.decodeAudioData(arr.slice(0));
      const notes = await analyzeToNotes(audioBuf, {
        smoothing: opts?.smoothing ?? "natural",
        scaleSnap: opts?.scaleSnap ? { key: snapRef.current.key, scale: snapRef.current.scale } : undefined,
      });
      convNotesRef.current = notes;
      setConvertNoteCount(notes.length);
      if (!trumpetRef.current) {
        trumpetRef.current = await createTrumpetInstrument(engine, {
          brightnessHz: brightnessToHz(brightnessRef.current),
          reverbWet,
          volumeDb: lin01ToDb(outputGainRef.current),
        });
        await trumpetRef.current.ready;
      }
      setCaptureState("ready");
    } catch (e) {
      console.warn("[useLiveTrumpet] convert failed:", e);
      setError("Could not convert the recording.");
      setCaptureState("idle");
    }
  }, [reverbWet]);

  const playConverted = useCallback(async () => {
    const trumpet = trumpetRef.current;
    if (!trumpet || convNotesRef.current.length === 0) return;
    await resumeEngine();
    const engine = ensureEngine();
    const t0 = engine.ctx.currentTime + 0.08;
    for (const n of convNotesRef.current) {
      trumpet.scheduleNote(midiToFreq(n.midi), t0 + n.start, n.duration, n.velocity);
    }
  }, []);

  const clearConvert = useCallback(() => {
    convNotesRef.current = [];
    setConvertNoteCount(0);
    setCaptureState("idle");
  }, []);

  // Notify parent that calibration happened
  const onCalibrated = useCallback(() => {
    setIsCalibrated(getNoiseFloor() > 0);
    if (pitchStatus === "uncalibrated") setPitchStatus("no_pitch");
  }, [pitchStatus]);

  return useMemo(() => ({
    // status
    pitchStatus, rawNote, outputNote,
    detectedNote, /* backward-compat alias for rawNote */
    confidence, inputLevel, isActive, error, loading, latencyMs, isCalibrated,
    // mode
    mode, setMode,
    // sound params
    brightness, setBrightness, outputGain, setOutputGain,
    applyPreset,
    // feature params
    trackingPreset, setTrackingPreset,
    rangeMode, setRangeMode,
    snapEnabled, setSnapEnabled, snapKey, setSnapKey, snapScale, setSnapScale,
    // convert
    captureState, convertNoteCount, startCapture, finishCapture, playConverted, clearConvert,
    // misc
    onCalibrated,
    TRACKING_PRESETS,
  }), [
    pitchStatus, rawNote, outputNote, detectedNote,
    confidence, inputLevel, isActive, error, loading, latencyMs, isCalibrated,
    mode, setMode,
    brightness, setBrightness, outputGain, setOutputGain, applyPreset,
    trackingPreset, setTrackingPreset,
    rangeMode, setRangeMode,
    snapEnabled, setSnapEnabled, snapKey, setSnapKey, snapScale, setSnapScale,
    captureState, convertNoteCount, startCapture, finishCapture, playConverted, clearConvert,
    onCalibrated,
  ]);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function mapWorkletStatus(wStatus: string, rms: number, calibrated: boolean): PitchStatus {
  if (!calibrated && rms < 0.01)  return "uncalibrated";
  if (wStatus === "too_quiet")     return "too_quiet";
  if (wStatus === "out_of_range")  return "out_of_range";
  return "no_pitch";
}

// ── Sing-then-Convert: offline analysis ───────────────────────────────────
export type ConvertSmoothing = "natural" | "tight" | "very_smooth";

/**
 * Analyze an AudioBuffer offline, producing clean note events suitable for
 * sampled-trumpet playback. Improvements over the old version:
 *  - Merges tiny fragments (< minDurSec)
 *  - Removes octave flips (adjacent notes differing by 12 semitones)
 *  - Smooths short vibrato into one note
 *  - Auto-transposes into trumpet range
 *  - Optionally scale-snaps using song key
 */
export async function analyzeToNotes(
  audioBuf: AudioBuffer,
  opts: { smoothing?: ConvertSmoothing; scaleSnap?: { key: string; scale: ScaleId } } = {},
): Promise<ConvNote[]> {
  const { PitchDetector } = await import("pitchy");
  const data   = audioBuf.getChannelData(0);
  const sr     = audioBuf.sampleRate;
  const size   = 2048;
  const hop    = 256; // smaller hop = better time resolution for offline
  const detector = PitchDetector.forFloat32Array(size);
  const frames: { t: number; midi: number; clarity: number; rms: number }[] = [];
  const win    = new Float32Array(size);

  for (let i = 0; i + size <= data.length; i += hop) {
    win.set(data.subarray(i, i + size));
    const [freq, clarity] = detector.findPitch(win, sr);
    let rms = 0;
    for (let j = 0; j < size; j++) rms += win[j] * win[j];
    rms = Math.sqrt(rms / size);
    const midi = freq > 0 ? Math.round(freqToMidiF(freq)) : 0;
    frames.push({ t: i / sr, midi, clarity, rms });
  }

  // ── Median smooth over window sized by smoothing preset ──
  const smoothWin = opts.smoothing === "very_smooth" ? 9 : opts.smoothing === "tight" ? 3 : 5;
  const smoothed  = frames.map((f, i) => {
    const w = frames
      .slice(Math.max(0, i - (smoothWin >> 1)), i + (smoothWin >> 1) + 1)
      .map((x) => x.midi)
      .filter((m) => m > 0)
      .sort((a, b) => a - b);
    return { ...f, midi: w.length ? w[Math.floor(w.length / 2)] : 0 };
  });

  // ── Clarity gate values by smoothing preset ──
  const clarityGate = opts.smoothing === "very_smooth" ? 0.55 : 0.48;
  const hopSec      = hop / sr;

  // ── Segment into raw note events ──
  const rawNotes: ConvNote[] = [];
  let cur: { midi: number; start: number; frames: number; rmsSum: number } | null = null;

  for (const f of smoothed) {
    const voiced = f.clarity >= clarityGate && f.midi >= 36 && f.midi <= 96 && f.rms > 0.003;
    if (voiced) {
      if (cur && Math.abs(cur.midi - f.midi) <= 1) {
        cur.frames++;
        cur.rmsSum += f.rms;
      } else {
        if (cur && cur.frames >= 2) rawNotes.push(toNote(cur, hopSec));
        cur = { midi: f.midi, start: f.t, frames: 1, rmsSum: f.rms };
      }
    } else if (cur) {
      if (cur.frames >= 2) rawNotes.push(toNote(cur, hopSec));
      cur = null;
    }
  }
  if (cur && cur.frames >= 2) rawNotes.push(toNote(cur, hopSec));

  if (rawNotes.length === 0) return [];

  // ── Post-process: remove octave flips ──
  const deFlipped = removeOctaveFlips(rawNotes);

  // ── Post-process: merge tiny fragments ──
  const minDurSec = opts.smoothing === "tight" ? 0.05 : 0.08;
  const merged    = mergeTiny(deFlipped, minDurSec);

  // ── Post-process: auto-transpose into trumpet range ──
  const transposed = merged.map((n) => ({
    ...n,
    midi: mapToTrumpetRange(n.midi, "auto"),
  }));

  // ── Post-process: scale snap ──
  const final = opts.scaleSnap
    ? transposed.map((n) => ({
        ...n,
        midi: snapToScale(n.midi, keyToPc(opts.scaleSnap!.key), opts.scaleSnap!.scale),
      }))
    : transposed;

  return final;
}

function toNote(cur: { midi: number; start: number; frames: number; rmsSum: number }, hopSec: number): ConvNote {
  const duration = Math.max(0.1, cur.frames * hopSec);
  const velocity = Math.max(0.3, Math.min(1, (cur.rmsSum / cur.frames) * 8));
  return { midi: cur.midi, start: cur.start, duration, velocity };
}

/** Remove octave flips: if adjacent notes differ by exactly 12, keep the one
 *  that matches the surrounding context better (most common octave wins). */
function removeOctaveFlips(notes: ConvNote[]): ConvNote[] {
  if (notes.length < 3) return notes;
  const out = [...notes];
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1].midi;
    const curr = out[i].midi;
    const next = out[i + 1].midi;
    if (Math.abs(curr - prev) === 12 && Math.abs(curr - next) === 12) {
      // curr is an octave off from both neighbours — snap it
      const shifted = curr + (prev > curr ? 12 : -12);
      out[i] = { ...out[i], midi: shifted };
    }
  }
  return out;
}

/** Merge notes shorter than minDurSec into the previous note when possible. */
function mergeTiny(notes: ConvNote[], minDurSec: number): ConvNote[] {
  const out: ConvNote[] = [];
  for (const n of notes) {
    if (out.length > 0 && n.duration < minDurSec && Math.abs(out[out.length - 1].midi - n.midi) <= 2) {
      // extend previous note
      out[out.length - 1] = {
        ...out[out.length - 1],
        duration: out[out.length - 1].duration + n.duration,
      };
    } else {
      out.push(n);
    }
  }
  return out;
}

// ── Pure exports for unit tests ────────────────────────────────────────────
export { TRACKING_PRESETS };
export type { WorkletConfig };
