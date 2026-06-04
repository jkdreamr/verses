import { useCallback, useEffect, useRef, useState } from "react";
import { ensureEngine, resumeEngine } from "@/lib/audio/engine";
import { createTrumpetInstrument, type TrumpetInstrument } from "@/lib/audio/samplers";
import { snapToScale, keyToPc, midiToFreq, midiToLabel, type ScaleId } from "@/lib/audio/scales";

// ───────────────────────────────────────────────────────────────────────────
// Live (and Sing-then-Convert) voice → sampled trumpet.
//
//  • Live Monitor: mic → McLeod-pitch AudioWorklet (off main thread). Each
//    voiced frame (gated by clarity) drives a real recorded-trumpet Tone.Sampler
//    with portamento; loudness → velocity. ~30–100 ms latency is inherent and
//    documented — it is impossible to eliminate entirely.
//  • Sing-then-Convert: capture the dry vocal, run pitchy offline, then play a
//    perfectly-tracked trumpet line back — cleaner, no live-latency artefacts.
//
// Everything routes through the engine trumpet bus, so Takes capture it.
// ───────────────────────────────────────────────────────────────────────────

export type TrumpetPreset = {
  name: string;
  blurb: string;
  brightness: number; // 0..1 → lowpass cutoff
  portamento: number; // 0..1 → glide seconds
  outputGain: number; // 0..1
  reverbWet: number; // 0..1
};

export const TRUMPET_PRESETS: TrumpetPreset[] = [
  { name: "Trumpet", blurb: "Bright, open horn", brightness: 0.6, portamento: 0.18, outputGain: 0.8, reverbWet: 0.16 },
  { name: "Muted", blurb: "Dark harmon-mute", brightness: 0.28, portamento: 0.28, outputGain: 0.72, reverbWet: 0.12 },
  { name: "Brass Bold", blurb: "Punchy section", brightness: 0.78, portamento: 0.08, outputGain: 0.82, reverbWet: 0.1 },
  { name: "Flugel", blurb: "Warm, mellow", brightness: 0.4, portamento: 0.32, outputGain: 0.76, reverbWet: 0.24 },
  { name: "Jazz Lead", blurb: "Intimate, expressive", brightness: 0.5, portamento: 0.36, outputGain: 0.78, reverbWet: 0.2 },
];

const CLARITY_GATE = 0.55;
const MIN_FREQ = 75;
const MAX_FREQ = 1100;

const freqToMidi = (f: number) => Math.round(69 + 12 * Math.log2(f / 440));
const brightnessToHz = (b: number) => 1500 + Math.max(0, Math.min(1, b)) * 5500;
const lin01ToDb = (x: number) => (x <= 0.001 ? -60 : 20 * Math.log10(x));

export type CaptureState = "idle" | "capturing" | "converting" | "ready";

export type UseLiveTrumpetConfig = {
  micStream: MediaStream | null;
  enabled: boolean;
};

type ConvNote = { midi: number; start: number; duration: number; velocity: number };

export function useLiveTrumpet({ micStream, enabled }: UseLiveTrumpetConfig) {
  // ── params ──
  const [mode, setMode] = useState<"live" | "convert">("live");
  const [brightness, setBrightness] = useState(0.6);
  const [portamento, setPortamento] = useState(0.18);
  const [outputGain, setOutputGain] = useState(0.8);
  const [reverbWet] = useState(0.16);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [snapKey, setSnapKey] = useState("C");
  const [snapScale, setSnapScale] = useState<ScaleId>("major");
  const [rawVoiceMonitor, setRawVoiceMonitor] = useState(false);

  // ── detected ──
  const [detectedNote, setDetectedNote] = useState<string | null>(null);
  const [detectedFreq, setDetectedFreq] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── convert ──
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [convertNoteCount, setConvertNoteCount] = useState(0);

  // ── refs ──
  const trumpetRef = useRef<TrumpetInstrument | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sinkRef = useRef<GainNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const convRecorderRef = useRef<MediaRecorder | null>(null);
  const convChunksRef = useRef<Blob[]>([]);
  const convNotesRef = useRef<ConvNote[]>([]);

  // pitch smoothing (median + note hysteresis to stop semitone chatter)
  const pitchHistRef = useRef<number[]>([]);
  const committedMidiRef = useRef(0);
  const candidateRef = useRef<{ midi: number; count: number }>({ midi: 0, count: 0 });

  const brightnessRef = useRef(brightness);
  const portamentoRef = useRef(portamento);
  const snapRef = useRef({ enabled: snapEnabled, key: snapKey, scale: snapScale });
  const modeRef = useRef(mode);
  useEffect(() => { brightnessRef.current = brightness; trumpetRef.current?.setBrightnessHz(brightnessToHz(brightness)); }, [brightness]);
  useEffect(() => { portamentoRef.current = portamento; }, [portamento]);
  useEffect(() => { snapRef.current = { enabled: snapEnabled, key: snapKey, scale: snapScale }; }, [snapEnabled, snapKey, snapScale]);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { trumpetRef.current?.setVolumeDb(lin01ToDb(outputGain)); }, [outputGain]);
  useEffect(() => {
    if (monitorGainRef.current) {
      const e = ensureEngine();
      monitorGainRef.current.gain.setTargetAtTime(rawVoiceMonitor ? 0.35 : 0, e.ctx.currentTime, 0.03);
    }
  }, [rawVoiceMonitor]);

  const applyPreset = useCallback((p: TrumpetPreset) => {
    setBrightness(p.brightness);
    setPortamento(p.portamento);
    setOutputGain(p.outputGain);
  }, []);

  // ── Live pipeline ──
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !micStream) {
      teardownLive();
      return;
    }

    (async () => {
      try {
        const engine = ensureEngine();
        await resumeEngine();
        // sampled trumpet (load once)
        if (!trumpetRef.current) {
          const inst = await createTrumpetInstrument(engine, {
            brightnessHz: brightnessToHz(brightnessRef.current),
            reverbWet,
            volumeDb: lin01ToDb(outputGain),
          });
          if (cancelled) { inst.dispose(); return; }
          trumpetRef.current = inst;
          await inst.ready;
        }

        // worklet pitch detector
        await engine.ctx.audioWorklet.addModule("/worklets/pitch-detector.js").catch(() => {});
        if (cancelled) return;

        const micSource = engine.ctx.createMediaStreamSource(micStream);
        micSourceRef.current = micSource;

        const worklet = new AudioWorkletNode(engine.ctx, "pitch-detector");
        workletRef.current = worklet;
        // keep the worklet pumping without making sound
        const sink = engine.ctx.createGain();
        sink.gain.value = 0;
        sinkRef.current = sink;
        micSource.connect(worklet);
        worklet.connect(sink);
        sink.connect(engine.ctx.destination);

        // raw-voice monitor path
        const monitor = engine.ctx.createGain();
        monitor.gain.value = rawVoiceMonitor ? 0.35 : 0;
        monitorGainRef.current = monitor;
        micSource.connect(monitor);
        monitor.connect(engine.trumpetBus);

        worklet.port.onmessage = (ev: MessageEvent) => {
          const { freq, clarity, rms } = ev.data as { freq: number; clarity: number; rms: number };
          setInputLevel(Math.min(1, rms * 6));
          setConfidence(clarity);
          const trumpet = trumpetRef.current;
          if (!trumpet || modeRef.current !== "live") { setIsActive(false); return; }

          if (clarity >= CLARITY_GATE && freq >= MIN_FREQ && freq <= MAX_FREQ) {
            // 1) median-smooth the raw pitch (kills single-frame outliers / octave flips)
            const hist = pitchHistRef.current;
            hist.push(freq);
            if (hist.length > 5) hist.shift();
            const sorted = [...hist].sort((a, b) => a - b);
            const med = sorted[Math.floor(sorted.length / 2)];

            // 2) target note (optionally snapped to a key/scale)
            let targetMidi = freqToMidi(med);
            if (snapRef.current.enabled) {
              targetMidi = snapToScale(targetMidi, keyToPc(snapRef.current.key), snapRef.current.scale);
            }

            // 3) hysteresis — only commit to a new note once it's held ~2 frames,
            //    so we don't chatter back and forth across a semitone boundary.
            if (targetMidi === committedMidiRef.current) {
              candidateRef.current = { midi: targetMidi, count: 0 };
            } else if (candidateRef.current.midi === targetMidi) {
              if (++candidateRef.current.count >= 2) committedMidiRef.current = targetMidi;
            } else {
              candidateRef.current = { midi: targetMidi, count: 1 };
            }
            const playMidi = committedMidiRef.current || targetMidi;
            const f = midiToFreq(playMidi);

            // 4) dynamics: loudness → velocity AND brightness (open the lowpass)
            const expr = Math.min(1, rms * 7);
            const velocity = Math.max(0.35, expr);
            trumpet.setBrightnessHz(brightnessToHz(brightnessRef.current) + expr * 3200);
            const port = 0.01 + portamentoRef.current * 0.3;
            trumpet.noteOn(f, velocity, port);
            setDetectedFreq(f);
            setDetectedNote(midiToLabel(playMidi));
            setIsActive(true);
          } else {
            trumpet.noteOff();
            pitchHistRef.current = [];
            committedMidiRef.current = 0;
            candidateRef.current = { midi: 0, count: 0 };
            setIsActive(false);
          }
        };
        setError(null);
      } catch (e) {
        if (!cancelled) {
          console.warn("[useLiveTrumpet] setup failed:", e);
          setError("Could not start the trumpet. Check mic permissions.");
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
    try { monitorGainRef.current?.disconnect(); } catch { /* */ }
    try { trumpetRef.current?.noteOff(); } catch { /* */ }
    workletRef.current = null;
    sinkRef.current = null;
    micSourceRef.current = null;
    monitorGainRef.current = null;
    setIsActive(false);
  }

  // dispose the sampled instrument fully on unmount
  useEffect(() => {
    return () => {
      teardownLive();
      try { trumpetRef.current?.dispose(); } catch { /* */ }
      trumpetRef.current = null;
    };
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

  const finishCapture = useCallback(async () => {
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
      const arr = await blob.arrayBuffer();
      const audioBuf = await engine.ctx.decodeAudioData(arr.slice(0));
      const notes = await analyzeToNotes(audioBuf);
      convNotesRef.current = notes;
      setConvertNoteCount(notes.length);
      // ensure trumpet exists for playback even if live never ran
      if (!trumpetRef.current) {
        trumpetRef.current = await createTrumpetInstrument(engine, {
          brightnessHz: brightnessToHz(brightnessRef.current),
          reverbWet,
          volumeDb: lin01ToDb(outputGain),
        });
        await trumpetRef.current.ready;
      }
      setCaptureState("ready");
    } catch (e) {
      console.warn("[useLiveTrumpet] convert failed:", e);
      setError("Could not convert the recording.");
      setCaptureState("idle");
    }
  }, [outputGain, reverbWet]);

  const playConverted = useCallback(async () => {
    const trumpet = trumpetRef.current;
    if (!trumpet || convNotesRef.current.length === 0) return;
    await resumeEngine();
    const engine = ensureEngine();
    const t0 = engine.ctx.currentTime + 0.1;
    for (const n of convNotesRef.current) {
      trumpet.scheduleNote(midiToFreq(n.midi), t0 + n.start, n.duration, n.velocity);
    }
  }, []);

  const clearConvert = useCallback(() => {
    convNotesRef.current = [];
    setConvertNoteCount(0);
    setCaptureState("idle");
  }, []);

  return {
    // detected
    detectedNote, detectedFreq, confidence, inputLevel, isActive, error,
    // mode
    mode, setMode,
    // params
    brightness, setBrightness, portamento, setPortamento, outputGain, setOutputGain,
    snapEnabled, setSnapEnabled, snapKey, setSnapKey, snapScale, setSnapScale,
    rawVoiceMonitor, setRawVoiceMonitor,
    applyPreset,
    // convert
    captureState, convertNoteCount, startCapture, finishCapture, playConverted, clearConvert,
  };
}

// ── Offline analysis (pitchy McLeod) → quantised note events ──
async function analyzeToNotes(audioBuf: AudioBuffer): Promise<ConvNote[]> {
  const { PitchDetector } = await import("pitchy");
  const data = audioBuf.getChannelData(0);
  const sr = audioBuf.sampleRate;
  const size = 2048;
  const hop = 512;
  const detector = PitchDetector.forFloat32Array(size);
  const frames: { t: number; midi: number; clarity: number; rms: number }[] = [];
  const window = new Float32Array(size);
  for (let i = 0; i + size <= data.length; i += hop) {
    window.set(data.subarray(i, i + size));
    const [freq, clarity] = detector.findPitch(window, sr);
    let rms = 0;
    for (let j = 0; j < size; j++) rms += window[j] * window[j];
    rms = Math.sqrt(rms / size);
    const midi = freq > 0 ? Math.round(69 + 12 * Math.log2(freq / 440)) : 0;
    frames.push({ t: i / sr, midi, clarity, rms });
  }

  // median-smooth midi over 5 frames
  const sm = frames.map((f, i) => {
    const w = frames.slice(Math.max(0, i - 2), i + 3).map((x) => x.midi).filter((m) => m > 0).sort((a, b) => a - b);
    return { ...f, midi: w.length ? w[Math.floor(w.length / 2)] : 0 };
  });

  // segment by pitch stability + clarity gate
  const notes: ConvNote[] = [];
  let cur: { midi: number; start: number; frames: number; rmsSum: number } | null = null;
  const hopSec = hop / sr;
  for (const f of sm) {
    const voiced = f.clarity >= 0.5 && f.midi >= 40 && f.midi <= 96;
    if (voiced) {
      if (cur && Math.abs(cur.midi - f.midi) <= 1) {
        cur.frames++;
        cur.rmsSum += f.rms;
      } else {
        if (cur && cur.frames >= 3) notes.push(toNote(cur, hopSec));
        cur = { midi: f.midi, start: f.t, frames: 1, rmsSum: f.rms };
      }
    } else if (cur) {
      if (cur.frames >= 3) notes.push(toNote(cur, hopSec));
      cur = null;
    }
  }
  if (cur && cur.frames >= 3) notes.push(toNote(cur, hopSec));
  return notes;
}

function toNote(cur: { midi: number; start: number; frames: number; rmsSum: number }, hopSec: number): ConvNote {
  const duration = Math.max(0.12, cur.frames * hopSec);
  const velocity = Math.max(0.35, Math.min(1, (cur.rmsSum / cur.frames) * 7));
  return { midi: cur.midi, start: cur.start, duration, velocity };
}
