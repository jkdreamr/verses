"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecordingState = "idle" | "recording" | "analyzing" | "results" | "error";
type PlaybackMode = "detected" | "original";

interface NoteEvent {
  midi: number;
  name: string;
  startTime: number;
  duration: number;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DURATION = 15; // seconds
const SAMPLE_INTERVAL_MS = 20;
const PIANO_ROLL_ROW_H = 16; // px per note row
const PIANO_ROLL_LABEL_W = 44; // px for note name labels
const PIANO_ROLL_PX_PER_SEC = 90; // px per second

// ---------------------------------------------------------------------------
// Pitch detection — YIN algorithm
// ---------------------------------------------------------------------------

function detectPitchYIN(
  buffer: Float32Array<ArrayBuffer>,
  sampleRate: number,
): { freq: number; confidence: number } | null {
  const W = buffer.length;
  const tau_max = Math.floor(W / 2);

  // RMS check for silence
  let rms = 0;
  for (let i = 0; i < W; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / W);
  if (rms < 0.015) return null;

  // Step 1: difference function
  const d = new Float32Array(tau_max);
  for (let tau = 1; tau < tau_max; tau++) {
    let sum = 0;
    for (let i = 0; i < tau_max; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // Step 2: cumulative mean normalized difference
  const cmnd = new Float32Array(tau_max);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < tau_max; tau++) {
    runningSum += d[tau];
    cmnd[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 0;
  }

  // Step 3: find first dip below threshold
  const threshold = 0.15;
  let tau_estimate = -1;
  for (let tau = 2; tau < tau_max; tau++) {
    if (cmnd[tau] < threshold) {
      // local minimum search
      while (tau + 1 < tau_max && cmnd[tau + 1] < cmnd[tau]) tau++;
      tau_estimate = tau;
      break;
    }
  }

  if (tau_estimate === -1) {
    // No dip found — find global minimum
    let min = Infinity;
    for (let tau = 2; tau < tau_max; tau++) {
      if (cmnd[tau] < min) {
        min = cmnd[tau];
        tau_estimate = tau;
      }
    }
    if (min > 0.5) return null; // too noisy
  }

  // Step 4: parabolic interpolation for sub-sample accuracy
  if (tau_estimate > 1 && tau_estimate < tau_max - 1) {
    const alpha = cmnd[tau_estimate - 1];
    const beta = cmnd[tau_estimate];
    const gamma = cmnd[tau_estimate + 1];
    const denom = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denom) > 1e-10) {
      const offset = (gamma - alpha) / denom;
      tau_estimate += offset;
    }
  }

  const freq = sampleRate / tau_estimate;
  const cmndAtTau = cmnd[Math.round(Math.max(1, Math.min(tau_max - 1, tau_estimate)))];
  const confidence = 1 - Math.min(1, cmndAtTau / threshold);

  // Frequency range: 80–1200 Hz (full vocal range)
  if (freq < 80 || freq > 1200) return null;

  return { freq, confidence };
}

// ---------------------------------------------------------------------------
// MIDI / note helpers
// ---------------------------------------------------------------------------

const freqToMidi = (freq: number): number =>
  Math.round(12 * Math.log2(freq / 440) + 69);

const midiToNoteName = (midi: number): string => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return names[midi % 12] + octave;
};

// ---------------------------------------------------------------------------
// Raw sample → Note segmentation (improved)
// ---------------------------------------------------------------------------

interface RawSample {
  midi: number;
  time: number;
  confidence: number;
  freq: number;
}

function samplesToNotes(samples: RawSample[]): NoteEvent[] {
  if (samples.length === 0) return [];

  // Step 1: median smoothing over a 5-sample window
  const smoothed = samples.map((s, i) => {
    const window = samples.slice(Math.max(0, i - 2), Math.min(samples.length, i + 3));
    const midis = window.map((x) => x.midi).sort((a, b) => a - b);
    return { ...s, midi: midis[Math.floor(midis.length / 2)] };
  });

  // Step 2: group into segments where midi stays within ±1 semitone
  const segments: RawSample[][] = [];
  let current: RawSample[] = [smoothed[0]];
  for (let i = 1; i < smoothed.length; i++) {
    if (Math.abs(smoothed[i].midi - current[current.length - 1].midi) <= 1) {
      current.push(smoothed[i]);
    } else {
      segments.push(current);
      current = [smoothed[i]];
    }
  }
  segments.push(current);

  // Step 3: build note events, filtering short blips
  const MIN_SAMPLES = 5; // at 20ms intervals = 100ms minimum
  const notes: NoteEvent[] = [];

  for (const seg of segments) {
    if (seg.length < MIN_SAMPLES) continue;

    const startTime = seg[0].time;
    const endTime = seg[seg.length - 1].time + 0.02;
    const rawDuration = endTime - startTime;

    // Light quantize to 1/8 beat
    const QUANT = 0.125;
    const duration = Math.max(QUANT, Math.round(rawDuration / QUANT) * QUANT);

    // Median pitch
    const midis = seg.map((s) => s.midi).sort((a, b) => a - b);
    const midi = midis[Math.floor(midis.length / 2)];

    // Average confidence
    const confidence = seg.reduce((s, x) => s + x.confidence, 0) / seg.length;

    // Skip very low confidence
    if (confidence < 0.15) continue;

    notes.push({
      midi,
      name: midiToNoteName(midi),
      startTime: Math.round(startTime * 100) / 100,
      duration: Math.round(duration * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
    });
  }

  // Step 4: merge adjacent notes with same pitch (vibrato handling)
  const merged: NoteEvent[] = [];
  for (const note of notes) {
    const prev = merged[merged.length - 1];
    const gap = prev ? note.startTime - (prev.startTime + prev.duration) : Infinity;
    if (prev && prev.midi === note.midi && gap < 0.15) {
      // merge
      prev.duration =
        Math.round((note.startTime + note.duration - prev.startTime) * 100) / 100;
      prev.confidence = Math.round(((prev.confidence + note.confidence) / 2) * 100) / 100;
    } else {
      merged.push({ ...note });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Piano Roll Canvas renderer
// ---------------------------------------------------------------------------

function drawPianoRoll(
  canvas: HTMLCanvasElement,
  notes: NoteEvent[],
  totalDuration: number,
  playheadTime: number | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Determine MIDI range with padding
  const midiValues = notes.map((n) => n.midi);
  const rawMin = midiValues.length > 0 ? Math.min(...midiValues) : 60;
  const rawMax = midiValues.length > 0 ? Math.max(...midiValues) : 72;
  const spread = rawMax - rawMin;
  const padding = Math.max(4, Math.floor((14 - spread) / 2));
  const midiMin = Math.max(0, rawMin - padding);
  const midiMax = Math.min(127, rawMax + padding);
  const noteCount = midiMax - midiMin + 1;

  const contentW = Math.max(totalDuration, 1) * PIANO_ROLL_PX_PER_SEC;
  const W = PIANO_ROLL_LABEL_W + contentW;
  const H = noteCount * PIANO_ROLL_ROW_H;

  canvas.width = W;
  canvas.height = H;

  // Background
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, W, H);

  // Row backgrounds
  for (let m = midiMin; m <= midiMax; m++) {
    const row = midiMax - m;
    const y = row * PIANO_ROLL_ROW_H;
    const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
    ctx.fillStyle = isBlack ? "#101010" : "#161616";
    ctx.fillRect(PIANO_ROLL_LABEL_W, y, contentW, PIANO_ROLL_ROW_H);
    // Thin row divider
    ctx.fillStyle = "#1e1e1e";
    ctx.fillRect(PIANO_ROLL_LABEL_W, y + PIANO_ROLL_ROW_H - 1, contentW, 1);
  }

  // Label background column
  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, PIANO_ROLL_LABEL_W, H);
  // Separator line
  ctx.fillStyle = "#252525";
  ctx.fillRect(PIANO_ROLL_LABEL_W - 1, 0, 1, H);

  // Beat grid lines (every 0.5s — subtle)
  for (let t = 0; t <= totalDuration + 0.01; t += 0.5) {
    const x = PIANO_ROLL_LABEL_W + t * PIANO_ROLL_PX_PER_SEC;
    const isBar = Math.abs(t % 2) < 0.01;
    ctx.fillStyle = isBar ? "#2a2a2a" : "#1c1c1c";
    ctx.fillRect(x, 0, 1, H);
  }

  // Time ruler labels
  ctx.fillStyle = "#3a3a3a";
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let t = 0; t <= totalDuration; t += 1) {
    const x = PIANO_ROLL_LABEL_W + t * PIANO_ROLL_PX_PER_SEC;
    ctx.fillText(`${t}s`, x, 9);
  }

  // Note blocks
  for (const note of notes) {
    const row = midiMax - note.midi;
    if (row < 0 || row >= noteCount) continue;
    const y = row * PIANO_ROLL_ROW_H;
    const x = PIANO_ROLL_LABEL_W + note.startTime * PIANO_ROLL_PX_PER_SEC;
    const w = Math.max(3, note.duration * PIANO_ROLL_PX_PER_SEC - 2);
    const h = PIANO_ROLL_ROW_H - 2;
    const conf = Math.max(0, Math.min(1, note.confidence));

    // Color by confidence
    let fillColor: string;
    if (conf >= 0.7) {
      // Solid amber-gold
      fillColor = `rgba(201,168,76,${0.85 + conf * 0.1})`;
    } else if (conf >= 0.4) {
      // Medium amber
      fillColor = `rgba(201,168,76,${0.35 + conf * 0.4})`;
    } else {
      // Muted gray — uncertain
      fillColor = `rgba(90,90,90,0.7)`;
    }

    ctx.fillStyle = fillColor;
    // Rounded rectangle (2px radius)
    const r = Math.min(2, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y + 1);
    ctx.lineTo(x + w - r, y + 1);
    ctx.quadraticCurveTo(x + w, y + 1, x + w, y + 1 + r);
    ctx.lineTo(x + w, y + 1 + h - r);
    ctx.quadraticCurveTo(x + w, y + 1 + h, x + w - r, y + 1 + h);
    ctx.lineTo(x + r, y + 1 + h);
    ctx.quadraticCurveTo(x, y + 1 + h, x, y + 1 + h - r);
    ctx.lineTo(x, y + 1 + r);
    ctx.quadraticCurveTo(x, y + 1, x + r, y + 1);
    ctx.closePath();
    ctx.fill();

    // Note name label inside block if wide enough
    if (w > 28) {
      ctx.fillStyle = conf >= 0.4 ? "rgba(0,0,0,0.75)" : "rgba(180,180,180,0.6)";
      ctx.font = "bold 8px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(note.name, x + 3, y + PIANO_ROLL_ROW_H - 4);
    }
  }

  // Piano key labels (left column)
  ctx.textAlign = "right";
  for (let m = midiMin; m <= midiMax; m++) {
    const row = midiMax - m;
    const y = row * PIANO_ROLL_ROW_H;
    const name = midiToNoteName(m);
    const isC = m % 12 === 0;
    const isBlack = [1, 3, 6, 8, 10].includes(m % 12);

    if (isC) {
      ctx.fillStyle = "#c9a84c";
      ctx.font = "bold 9px ui-monospace, monospace";
      ctx.fillText(name, PIANO_ROLL_LABEL_W - 5, y + PIANO_ROLL_ROW_H - 4);
    } else if (!isBlack && m % 2 === 0) {
      // Show every other white key to avoid crowding
      ctx.fillStyle = "#3a3a3a";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(name, PIANO_ROLL_LABEL_W - 5, y + PIANO_ROLL_ROW_H - 4);
    }
  }

  // Playhead
  if (playheadTime !== null) {
    const px = PIANO_ROLL_LABEL_W + playheadTime * PIANO_ROLL_PX_PER_SEC;
    // Glow effect
    ctx.fillStyle = "rgba(201,168,76,0.15)";
    ctx.fillRect(px - 3, 0, 6, H);
    ctx.fillStyle = "rgba(201,168,76,0.9)";
    ctx.fillRect(px - 1, 0, 2, H);
  }
}

// ---------------------------------------------------------------------------
// Timer display helper
// ---------------------------------------------------------------------------

const fmtTime = (s: number): string => {
  const sec = Math.max(0, Math.floor(s));
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

// ---------------------------------------------------------------------------
// Confidence bar helper
// ---------------------------------------------------------------------------

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="inline-flex items-center gap-1.5">
      <div className="h-1.5 w-20 overflow-hidden bg-ink-line" style={{ borderRadius: 1 }}>
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            background:
              pct >= 70
                ? "rgba(201,168,76,0.85)"
                : pct >= 40
                  ? "rgba(201,168,76,0.5)"
                  : "rgba(100,100,100,0.7)",
          }}
        />
      </div>
      <span className="text-[10px] text-ink-mute/70">{pct}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin text-amber-gold" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VoiceToScoreModal({
  open,
  onClose,
  songId,
}: {
  open: boolean;
  onClose: () => void;
  songId: string;
}) {
  const { toast } = useToast();

  // ── State ──────────────────────────────────────────────────────────────────
  const [recState, setRecState] = useState<RecordingState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const [playheadTime, setPlayheadTime] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<PlaybackMode>("detected");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_rawAudioBlob, setRawAudioBlob] = useState<Blob | null>(null);
  const [rawAudioUrl, setRawAudioUrl] = useState<string | null>(null);

  // ── Audio pipeline refs ───────────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const pitchBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rawSamplesRef = useRef<RawSample[]>([]);
  const recordingStartRef = useRef<number>(0);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackSourcesRef = useRef<OscillatorNode[]>([]);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const playheadRafRef = useRef<number | null>(null);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // ── Cleanup helpers ───────────────────────────────────────────────────────

  const stopMicPipeline = useCallback(() => {
    if (sampleIntervalRef.current !== null) {
      clearInterval(sampleIntervalRef.current);
      sampleIntervalRef.current = null;
    }
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (timerIntervalRef.current !== null) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    mediaRecorderRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    if (playheadRafRef.current !== null) {
      cancelAnimationFrame(playheadRafRef.current);
      playheadRafRef.current = null;
    }
    for (const osc of playbackSourcesRef.current) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    }
    playbackSourcesRef.current = [];
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current.src = "";
      playbackAudioRef.current = null;
    }
    setIsPlaying(false);
    setPlayheadTime(null);
  }, []);

  const fullReset = useCallback(() => {
    stopMicPipeline();
    stopPlayback();
    rawSamplesRef.current = [];
    pitchBufferRef.current = null;
    recordedChunksRef.current = [];
    setRecState("idle");
    setErrorMsg("");
    setElapsed(0);
    setLevel(0);
    setNotes([]);
    setTotalDuration(0);
    setPlayheadTime(null);
    setIsPlaying(false);
    setRawAudioBlob(null);
    if (rawAudioUrl) {
      URL.revokeObjectURL(rawAudioUrl);
    }
    setRawAudioUrl(null);
  }, [stopMicPipeline, stopPlayback, rawAudioUrl]);

  // Cleanup on modal close / unmount
  useEffect(() => {
    if (!open) fullReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      stopMicPipeline();
      stopPlayback();
      if (rawAudioUrl) URL.revokeObjectURL(rawAudioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Piano Roll: redraw when notes/playhead change ─────────────────────────

  useEffect(() => {
    if (!canvasRef.current || notes.length === 0) return;
    drawPianoRoll(canvasRef.current, notes, totalDuration, playheadTime);
  }, [notes, totalDuration, playheadTime]);

  // ── Level meter (RAF loop) ─────────────────────────────────────────────────

  const startMeterLoop = useCallback((analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) {
        const dev = Math.abs(v - 128);
        if (dev > peak) peak = dev;
      }
      setLevel(Math.min(1, peak / 96));
      meterRafRef.current = requestAnimationFrame(tick);
    };
    meterRafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Recording ─────────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    setErrorMsg("");

    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      setErrorMsg("This feature requires a modern browser with Web Audio API support.");
      setRecState("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setErrorMsg("Microphone access required. Enable it in your browser settings and try again.");
      setRecState("error");
      return;
    }

    streamRef.current = stream;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx() as AudioContext;
    audioCtxRef.current = ctx;

    // fftSize = 4096 for better low-frequency resolution (bass vocals)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyserRef.current = analyser;

    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);

    const bufferLength = analyser.fftSize;
    pitchBufferRef.current = new Float32Array(bufferLength);

    rawSamplesRef.current = [];
    recordedChunksRef.current = [];
    recordingStartRef.current = performance.now();
    setElapsed(0);
    setRecState("recording");

    // MediaRecorder for raw audio blob capture
    try {
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.start(100);
      mediaRecorderRef.current = mr;
    } catch {
      // MediaRecorder not critical — pitch detection still works
    }

    // Level meter
    startMeterLoop(analyser);

    // Elapsed timer + auto-stop
    timerIntervalRef.current = setInterval(() => {
      const e = (performance.now() - recordingStartRef.current) / 1000;
      setElapsed(e);
      if (e >= MAX_DURATION) {
        stopRecordingRef.current();
      }
    }, 200);

    // YIN pitch sampling at 20ms intervals
    sampleIntervalRef.current = setInterval(() => {
      if (!analyserRef.current || !pitchBufferRef.current || !audioCtxRef.current) return;
      analyserRef.current.getFloatTimeDomainData(pitchBufferRef.current);
      const sr = audioCtxRef.current.sampleRate;
      const result = detectPitchYIN(pitchBufferRef.current, sr);
      if (result !== null) {
        const { freq, confidence } = result;
        const midi = freqToMidi(freq);
        if (midi >= 36 && midi <= 96) {
          const time = (performance.now() - recordingStartRef.current) / 1000;
          rawSamplesRef.current.push({ midi, time, confidence, freq });
        }
      }
    }, SAMPLE_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMeterLoop]);

  // Stable ref so timer callback can call stopRecording without stale closure
  const stopRecordingRef = useRef<() => void>(() => {});

  const stopRecording = useCallback(() => {
    if (recState !== "recording") return;

    const duration = (performance.now() - recordingStartRef.current) / 1000;
    setTotalDuration(duration);
    setRecState("analyzing");
    setLevel(0);

    // Capture blob before stopping pipeline
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setRawAudioBlob(blob);
        setRawAudioUrl(url);
      };
      try {
        mr.stop();
      } catch {}
    }

    stopMicPipeline();

    setTimeout(() => {
      const samples = rawSamplesRef.current;
      const detected = samplesToNotes(samples);
      setNotes(detected);
      setRecState("results");
    }, 80);
  }, [recState, stopMicPipeline]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // ── Re-analyze ────────────────────────────────────────────────────────────

  const reAnalyze = useCallback(() => {
    if (rawSamplesRef.current.length === 0) return;
    setRecState("analyzing");
    stopPlayback();
    setTimeout(() => {
      const detected = samplesToNotes(rawSamplesRef.current);
      setNotes(detected);
      setRecState("results");
    }, 80);
  }, [stopPlayback]);

  // ── Playback ──────────────────────────────────────────────────────────────

  const playMelody = useCallback(() => {
    if (isPlaying) return;

    if (playMode === "original" && rawAudioUrl) {
      // Play original recording
      const audio = new Audio(rawAudioUrl);
      playbackAudioRef.current = audio;
      setIsPlaying(true);
      setPlayheadTime(0);
      const startReal = performance.now();
      const endTime = totalDuration;

      const rafFn = () => {
        const t = (performance.now() - startReal) / 1000;
        if (t >= endTime) {
          setPlayheadTime(null);
          setIsPlaying(false);
          return;
        }
        setPlayheadTime(t);
        playheadRafRef.current = requestAnimationFrame(rafFn);
      };
      playheadRafRef.current = requestAnimationFrame(rafFn);
      audio.play().catch(() => {
        setIsPlaying(false);
        setPlayheadTime(null);
      });
      audio.onended = () => {
        setIsPlaying(false);
        setPlayheadTime(null);
        if (playheadRafRef.current !== null) {
          cancelAnimationFrame(playheadRafRef.current);
        }
      };
      return;
    }

    // Detected melody via oscillators
    if (notes.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx() as AudioContext;

    setIsPlaying(true);
    setPlayheadTime(0);

    const oscs: OscillatorNode[] = [];
    const startTime = ctx.currentTime;

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
      osc.frequency.setValueAtTime(freq, startTime + note.startTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.setValueAtTime(0.28, startTime + note.startTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        startTime + note.startTime + Math.max(0.04, note.duration - 0.04),
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime + note.startTime);
      osc.stop(startTime + note.startTime + note.duration + 0.06);
      oscs.push(osc);
    }

    playbackSourcesRef.current = oscs;

    const endTime = notes.reduce((max, n) => Math.max(max, n.startTime + n.duration), 0);

    const rafFn = () => {
      const t = ctx.currentTime - startTime;
      if (t >= endTime) {
        setPlayheadTime(null);
        setIsPlaying(false);
        void ctx.close().catch(() => {});
        return;
      }
      setPlayheadTime(t);
      playheadRafRef.current = requestAnimationFrame(rafFn);
    };
    playheadRafRef.current = requestAnimationFrame(rafFn);
  }, [notes, isPlaying, playMode, rawAudioUrl, totalDuration]);

  // ── Export ────────────────────────────────────────────────────────────────

  const exportJson = useCallback(() => {
    const data = {
      songId,
      recordedAt: new Date().toISOString(),
      durationSeconds: totalDuration,
      noteCount: notes.length,
      notes: notes.map((n) => ({
        note: n.name,
        midi: n.midi,
        startTime: n.startTime,
        duration: n.duration,
        confidence: n.confidence,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `melody-${songId}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Exported JSON", "ok");
  }, [notes, totalDuration, songId, toast]);

  const copyNotes = useCallback(async () => {
    const spaced = notes.map((n) => n.name).join(" ");
    try {
      await navigator.clipboard.writeText(spaced);
      toast("Note sequence copied", "ok");
    } catch {
      toast("Could not access clipboard", "error");
    }
  }, [notes, toast]);

  const copySequenceFormatted = useCallback(async () => {
    const text = notes
      .map((n) => `${n.name} (${n.duration.toFixed(2)}s)`)
      .join(" · ");
    try {
      await navigator.clipboard.writeText(text);
      toast("Formatted sequence copied", "ok");
    } catch {
      toast("Could not access clipboard", "error");
    }
  }, [notes, toast]);

  // ── Derived UI values ─────────────────────────────────────────────────────

  const remaining = Math.max(0, MAX_DURATION - elapsed);

  const statusMessage = (() => {
    switch (recState) {
      case "idle":
        return "Ready. Press Record to begin.";
      case "recording":
        return `Recording — ${fmtTime(elapsed)} / ${fmtTime(MAX_DURATION)}`;
      case "analyzing":
        return "Analyzing pitch data…";
      case "results":
        if (notes.length === 0)
          return "No clear pitch detected. Try singing louder in a quieter room.";
        return `${notes.length} note${notes.length !== 1 ? "s" : ""} detected — ${totalDuration.toFixed(1)}s recording.`;
      case "error":
        return errorMsg;
    }
  })();

  const canRecord = recState === "idle" || recState === "results" || recState === "error";
  const canStop = recState === "recording";
  const canPlay = notes.length > 0 && !isPlaying && recState !== "recording" && recState !== "analyzing";
  const hasResults = recState === "results";

  // ── Render ────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink print:hidden">

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-ink-line px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] uppercase tracking-widest text-amber-gold">
            Voice to Score
          </span>
          {recState === "recording" && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-red-400/80">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              REC {fmtTime(elapsed)}
            </span>
          )}
          {recState === "analyzing" && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute">
              <Spinner />
              Analyzing
            </span>
          )}
        </div>
        <button
          onClick={() => {
            fullReset();
            onClose();
          }}
          className="border border-ink-line px-2.5 py-1 font-mono text-[11px] text-ink-mute transition-colors hover:border-ink-text/50 hover:text-ink-text"
          aria-label="Close Voice to Score"
        >
          x exit
        </button>
      </div>

      {/* ─── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-5">

        {/* Subtitle */}
        <p className="mb-5 max-w-lg text-sm text-ink-mute">
          Melody sketch —{" "}
          <span className="text-ink-text">works best with one clear monophonic vocal line.</span>{" "}
          Pitch detection runs entirely in your browser.
        </p>

        {/* ── Level meter ───────────────────────────────────────────────── */}
        <div className="mb-4">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-mute/60">
            Input Level
          </div>
          <div className="h-2 w-full max-w-sm overflow-hidden border border-ink-line bg-ink-surface">
            <div
              className="h-full transition-all duration-75"
              style={{
                width: `${Math.round(level * 100)}%`,
                background:
                  level > 0.8
                    ? "#ef4444"
                    : level > 0.5
                      ? "#c9a84c"
                      : "rgba(201,168,76,0.6)",
              }}
            />
          </div>
          {recState === "recording" && level < 0.05 && (
            <p className="mt-1 font-mono text-[10px] text-ink-mute/50">
              No signal detected — check mic permissions
            </p>
          )}
        </div>

        {/* ── Status line ───────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center gap-2">
          {recState === "analyzing" && <Spinner />}
          <span
            className={[
              "font-mono text-xs",
              recState === "error" ? "text-red-400" : "text-ink-mute",
            ].join(" ")}
          >
            {statusMessage}
          </span>
          {recState === "recording" && (
            <span className="ml-auto font-mono text-[10px] text-ink-mute/60">
              {fmtTime(remaining)} remaining
            </span>
          )}
        </div>

        {/* ── Control row ───────────────────────────────────────────────── */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {/* Record */}
          <button
            disabled={!canRecord}
            onClick={() => void startRecording()}
            className={[
              "flex items-center gap-2 border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
              canRecord
                ? "border-ink-line text-ink-mute hover:border-amber-gold/50 hover:text-amber-gold"
                : "cursor-not-allowed border-ink-line text-ink-mute/30",
            ].join(" ")}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-red-500/70" />
            Record
          </button>

          {/* Stop */}
          <button
            disabled={!canStop}
            onClick={stopRecording}
            className={[
              "border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
              canStop
                ? "border-ink-line text-ink-text hover:border-amber-gold/50 hover:text-amber-gold"
                : "cursor-not-allowed border-ink-line text-ink-mute/30",
            ].join(" ")}
          >
            Stop
          </button>

          {/* Play / Stop playback */}
          {isPlaying ? (
            <button
              onClick={stopPlayback}
              className="border border-amber-gold/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-amber-gold transition-colors hover:border-amber-gold"
            >
              Stop Playback
            </button>
          ) : (
            <button
              disabled={!canPlay}
              onClick={playMelody}
              className={[
                "flex items-center gap-1.5 border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
                canPlay
                  ? "border-ink-line text-ink-mute hover:border-amber-gold/50 hover:text-amber-gold"
                  : "cursor-not-allowed border-ink-line text-ink-mute/30",
              ].join(" ")}
            >
              Play Back
            </button>
          )}

          {/* Playback mode selector */}
          {hasResults && (
            <div className="flex items-center border border-ink-line font-mono text-[10px] uppercase tracking-wider">
              <button
                onClick={() => setPlayMode("detected")}
                className={[
                  "px-2.5 py-1.5 transition-colors",
                  playMode === "detected"
                    ? "bg-amber-gold/10 text-amber-gold"
                    : "text-ink-mute hover:text-ink-text",
                ].join(" ")}
              >
                Detected
              </button>
              <div className="w-px self-stretch bg-ink-line" />
              <button
                onClick={() => setPlayMode("original")}
                disabled={!rawAudioUrl}
                className={[
                  "px-2.5 py-1.5 transition-colors",
                  playMode === "original"
                    ? "bg-amber-gold/10 text-amber-gold"
                    : rawAudioUrl
                      ? "text-ink-mute hover:text-ink-text"
                      : "cursor-not-allowed text-ink-mute/30",
                ].join(" ")}
              >
                Original
              </button>
            </div>
          )}

          {/* Re-analyze */}
          {hasResults && (
            <button
              onClick={reAnalyze}
              className="border border-ink-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Re-analyze
            </button>
          )}

          {/* Clear */}
          {hasResults && (
            <button
              onClick={fullReset}
              className="border border-ink-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-ink-text/50 hover:text-ink-text"
            >
              Clear
            </button>
          )}
        </div>

        {/* ── Analyzing state ───────────────────────────────────────────── */}
        {recState === "analyzing" && (
          <div className="mb-6 flex items-center gap-2 font-mono text-xs text-ink-mute">
            <Spinner />
            Running YIN pitch analysis…
          </div>
        )}

        {/* ── Piano Roll ────────────────────────────────────────────────── */}
        {hasResults && notes.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute/60">
                Piano Roll
              </span>
              <div className="flex items-center gap-3 font-mono text-[10px] text-ink-mute/50">
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-3"
                    style={{ background: "rgba(201,168,76,0.85)", borderRadius: 1 }}
                  />
                  high confidence
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-3"
                    style={{ background: "rgba(201,168,76,0.4)", borderRadius: 1 }}
                  />
                  medium
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-3"
                    style={{ background: "rgba(90,90,90,0.7)", borderRadius: 1 }}
                  />
                  uncertain
                </span>
              </div>
            </div>
            <div
              ref={canvasWrapRef}
              className="overflow-x-auto border border-ink-line"
              style={{ maxHeight: 360, background: "#0d0d0d" }}
            >
              <canvas ref={canvasRef} style={{ display: "block" }} />
            </div>
          </div>
        )}

        {/* ── No notes detected ─────────────────────────────────────────── */}
        {hasResults && notes.length === 0 && (
          <div className="mb-6 border border-ink-line bg-ink-surface px-4 py-3">
            <p className="font-mono text-xs text-ink-mute">
              No clear pitch detected in this recording. Check the tips below and try again.
            </p>
          </div>
        )}

        {/* ── Note sequence (chip row) ───────────────────────────────────── */}
        {hasResults && notes.length > 0 && (
          <div className="mb-6">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute/60">
              Note Sequence
            </div>
            <div className="flex flex-wrap gap-1.5">
              {notes.map((note, i) => (
                <span
                  key={i}
                  title={`Start: ${note.startTime.toFixed(2)}s · Duration: ${note.duration.toFixed(2)}s · Confidence: ${Math.round(note.confidence * 100)}%`}
                  className={[
                    "border px-2 py-0.5 font-mono text-xs",
                    note.confidence >= 0.7
                      ? "border-amber-gold/40 text-amber-gold"
                      : note.confidence >= 0.4
                        ? "border-amber-gold/20 text-amber-gold/60"
                        : "border-ink-line text-ink-mute/50",
                  ].join(" ")}
                >
                  {note.name}
                  <span className="ml-1 text-[10px] opacity-50">
                    {note.duration.toFixed(2)}s
                  </span>
                  {note.confidence < 0.4 && (
                    <span className="ml-1 text-[9px] opacity-40">?</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Detailed note table ────────────────────────────────────────── */}
        {hasResults && notes.length > 0 && (
          <div className="mb-6 overflow-x-auto">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute/60">
              Detected Notes
            </div>
            <table className="w-full border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-ink-line">
                  <th className="py-1.5 pr-3 text-left font-normal text-[10px] uppercase tracking-wider text-ink-mute/50">
                    #
                  </th>
                  <th className="py-1.5 pr-4 text-left font-normal text-[10px] uppercase tracking-wider text-ink-mute/50">
                    Note
                  </th>
                  <th className="py-1.5 pr-4 text-left font-normal text-[10px] uppercase tracking-wider text-ink-mute/50">
                    Start
                  </th>
                  <th className="py-1.5 pr-4 text-left font-normal text-[10px] uppercase tracking-wider text-ink-mute/50">
                    End
                  </th>
                  <th className="py-1.5 pr-4 text-left font-normal text-[10px] uppercase tracking-wider text-ink-mute/50">
                    Dur
                  </th>
                  <th className="py-1.5 text-left font-normal text-[10px] uppercase tracking-wider text-ink-mute/50">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note, i) => (
                  <tr
                    key={i}
                    className="border-b border-ink-line/30 last:border-0 hover:bg-ink-surface/60"
                  >
                    <td className="py-1.5 pr-3 text-ink-mute/40">{i + 1}</td>
                    <td className="py-1.5 pr-4">
                      <span
                        className={
                          note.confidence >= 0.4 ? "text-ink-text" : "text-ink-mute/50"
                        }
                      >
                        {note.name}
                      </span>
                      {note.confidence < 0.4 && (
                        <span className="ml-1.5 border border-ink-line px-1 py-px text-[9px] uppercase tracking-wider text-ink-mute/40">
                          uncertain
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-ink-mute">
                      {note.startTime.toFixed(2)}s
                    </td>
                    <td className="py-1.5 pr-4 text-ink-mute">
                      {(note.startTime + note.duration).toFixed(2)}s
                    </td>
                    <td className="py-1.5 pr-4 text-ink-mute">
                      {note.duration.toFixed(2)}s
                    </td>
                    <td className="py-1.5">
                      <ConfBar value={note.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Export / action row ────────────────────────────────────────── */}
        {hasResults && notes.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <button
              onClick={exportJson}
              className="border border-ink-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Export JSON
            </button>
            <button
              onClick={() => void copyNotes()}
              className="border border-ink-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Copy Notes
            </button>
            <button
              onClick={() => void copySequenceFormatted()}
              className="border border-ink-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Copy Formatted
            </button>
          </div>
        )}

        {/* ── Error retry ───────────────────────────────────────────────── */}
        {recState === "error" && (
          <button
            onClick={fullReset}
            className="mb-6 border border-ink-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-ink-text/50 hover:text-ink-text"
          >
            Try Again
          </button>
        )}

        {/* ── Tips ──────────────────────────────────────────────────────── */}
        <div className="border-t border-ink-line pt-5">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute/50">
            Tips for Better Transcription
          </div>
          <ul className="space-y-1 font-mono text-[11px] text-ink-mute/60">
            <li>Sing one note at a time, clearly and without sliding</li>
            <li>Hold each note for at least 0.3 seconds</li>
            <li>Record in a quiet room — background noise degrades accuracy</li>
            <li>If a beat is playing, use headphones to prevent bleed</li>
            <li>Avoid melisma or fast runs — this tool handles steady pitches best</li>
            <li>Hum works just as well as singing — sometimes better</li>
          </ul>
          <p className="mt-3 font-mono text-[10px] text-ink-mute/35">
            Melody sketch, not notation. Max {MAX_DURATION}s · All processing is client-side.
          </p>
        </div>

      </div>
    </div>
  );
}
