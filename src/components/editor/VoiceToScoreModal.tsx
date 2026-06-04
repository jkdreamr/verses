"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";
import { detectPitchYIN, freqToMidi, midiToNoteName } from "@/lib/pitchDetection";
import { StaffView } from "./score/StaffView";
import {
  transcribeNeural,
  monophonicReduce,
  mergeShortFragments,
  quantizeNotes,
  inferKey,
  inferChords,
  buildMusicXML,
  estimateBpm,
  type QuantGrid,
  type KeyInfo,
  type ChordHit,
} from "@/lib/music/voiceScore";
import { ensureEngine, resumeEngine } from "@/lib/audio/engine";
import { createChordInstrument, CHORD_INSTRUMENTS, type SampledInstrument } from "@/lib/audio/samplers";

// Voice Score runs one auto-optimal pipeline — no user-facing quality/timing
// knobs. The neural model (basic-pitch) is always primary; YIN is the silent
// fallback. Timing snaps to a 1/16 grid at the detected tempo.
const QUANT_GRID: QuantGrid = "16";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecordingState = "idle" | "recording" | "analyzing" | "results" | "error";
type PlaybackMode = "detected" | "original";
type ViewMode = "piano" | "list" | "staff";

interface NoteEvent {
  midi: number;
  name: string;
  startTime: number;
  duration: number;
  confidence: number;
  id: string; // unique ID for editing
}

interface InputWarning {
  type: "quiet" | "clipping" | "noise" | "no_pitch";
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DURATION = 30; // seconds (increased from 15)
const SAMPLE_INTERVAL_MS = 15; // faster sampling for better resolution
const PIANO_ROLL_ROW_H = 18; // px per note row
const PIANO_ROLL_LABEL_W = 48; // px for note name labels
const PIANO_ROLL_PX_PER_SEC = 100; // px per second

// One auto-tuned parameter set for the YIN fallback path — picked to balance
// accuracy against over-segmentation for a single sung melody.
const YIN_PARAMS = {
  yinThreshold: 0.15,
  silenceRms: 0.012,
  noisyFallback: 0.5,
  confidenceFloor: 0.18,
  minSamples: 6, // ~90ms
  segmentTolerance: 2,
  mergeGap: 0.18,
  minNoteMs: 110,
};

let noteIdCounter = 0;
function nextNoteId(): string { return `n_${++noteIdCounter}_${Date.now()}`; }

// ---------------------------------------------------------------------------
// Raw sample → Note segmentation (improved with onset detection)
// ---------------------------------------------------------------------------

interface RawSample {
  midi: number;
  time: number;
  confidence: number;
  freq: number;
  rms: number;
}

function samplesToNotes(samples: RawSample[]): NoteEvent[] {
  if (samples.length === 0) return [];

  const params = YIN_PARAMS;

  // Step 0.5: octave-error correction — if a sample jumps exactly ±12 semitones
  // from its neighbors but the neighbors agree, snap it back
  const corrected = [...samples];
  for (let i = 1; i < corrected.length - 1; i++) {
    const prev = corrected[i - 1].midi;
    const cur = corrected[i].midi;
    const next = corrected[i + 1].midi;
    if (Math.abs(prev - next) <= 2) {
      if (Math.abs(cur - prev - 12) <= 1) corrected[i] = { ...corrected[i], midi: prev };
      else if (Math.abs(cur - prev + 12) <= 1) corrected[i] = { ...corrected[i], midi: prev };
    }
  }

  // Step 1: median smoothing over a 7-sample window (broader for vocal vibrato)
  const smoothed = corrected.map((s, i) => {
    const win = corrected.slice(Math.max(0, i - 3), Math.min(corrected.length, i + 4));
    const midis = win.map((x) => x.midi).sort((a, b) => a - b);
    return { ...s, midi: midis[Math.floor(midis.length / 2)] };
  });

  // Step 1.5: Onset detection — mark amplitude re-attacks
  // A re-attack is when RMS drops significantly then rises again (new note articulation)
  const onsets = new Set<number>();
  for (let i = 2; i < smoothed.length; i++) {
    const prevRms = smoothed[i - 2].rms;
    const curRms = smoothed[i].rms;
    // If there was a dip (RMS dropped to <40% of current) then came back up
    if (smoothed[i - 1].rms < prevRms * 0.4 && curRms > smoothed[i - 1].rms * 2.0) {
      onsets.add(i);
    }
  }

  // Step 2: group into segments (break on pitch change OR onset re-attack)
  const tolerance = params.segmentTolerance;
  const segments: RawSample[][] = [];
  let current: RawSample[] = [smoothed[0]];
  for (let i = 1; i < smoothed.length; i++) {
    // Compare against the segment's median pitch
    const segMidis = current.map(s => s.midi).sort((a, b) => a - b);
    const segMedian = segMidis[Math.floor(segMidis.length / 2)];
    const pitchChanged = Math.abs(smoothed[i].midi - segMedian) > tolerance;
    const isOnset = onsets.has(i);
    const silenceGap = smoothed[i].time - smoothed[i - 1].time > params.mergeGap;

    if (pitchChanged || isOnset || silenceGap) {
      segments.push(current);
      current = [smoothed[i]];
    } else {
      current.push(smoothed[i]);
    }
  }
  segments.push(current);

  // Step 3: build note events, filtering short blips
  const minSamples = params.minSamples;
  const notes: NoteEvent[] = [];
  const sampleIntervalSec = SAMPLE_INTERVAL_MS / 1000;

  for (const seg of segments) {
    if (seg.length < minSamples) continue;

    const startTime = seg[0].time;
    const endTime = seg[seg.length - 1].time + sampleIntervalSec;
    const rawDuration = endTime - startTime;

    // Raw duration — timing is quantized later (in runInference) against the
    // detected tempo, so the neural and YIN paths share a single grid.
    const duration = Math.max(0.04, rawDuration);

    // Median pitch
    const midis = seg.map((s) => s.midi).sort((a, b) => a - b);
    const midi = midis[Math.floor(midis.length / 2)];

    // Average confidence
    const confidence = seg.reduce((s, x) => s + x.confidence, 0) / seg.length;

    // Skip very low confidence
    if (confidence < params.confidenceFloor) continue;

    notes.push({
      midi,
      name: midiToNoteName(midi),
      startTime: Math.round(startTime * 1000) / 1000,
      duration: Math.round(duration * 1000) / 1000,
      confidence: Math.round(confidence * 100) / 100,
      id: nextNoteId(),
    });
  }

  // Step 4: merge adjacent notes with same pitch (vibrato handling)
  const merged: NoteEvent[] = [];
  for (const note of notes) {
    const prev = merged[merged.length - 1];
    const gap = prev ? note.startTime - (prev.startTime + prev.duration) : Infinity;
    if (prev && Math.abs(prev.midi - note.midi) <= 1 && gap < params.mergeGap) {
      // merge
      prev.duration =
        Math.round((note.startTime + note.duration - prev.startTime) * 1000) / 1000;
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
  selectedNoteId: string | null = null,
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

  // Background — clean dark surface
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, W, H);

  // Row backgrounds
  for (let m = midiMin; m <= midiMax; m++) {
    const row = midiMax - m;
    const y = row * PIANO_ROLL_ROW_H;
    const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
    ctx.fillStyle = isBlack ? "#111111" : "#181818";
    ctx.fillRect(PIANO_ROLL_LABEL_W, y, contentW, PIANO_ROLL_ROW_H);
    // Very subtle row divider
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(PIANO_ROLL_LABEL_W, y + PIANO_ROLL_ROW_H - 1, contentW, 1);
  }

  // Label background column
  ctx.fillStyle = "#141414";
  ctx.fillRect(0, 0, PIANO_ROLL_LABEL_W, H);
  // Separator line — subtle
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(PIANO_ROLL_LABEL_W - 1, 0, 1, H);

  // Beat grid lines (every 0.5s — very subtle)
  for (let t = 0; t <= totalDuration + 0.01; t += 0.5) {
    const x = PIANO_ROLL_LABEL_W + t * PIANO_ROLL_PX_PER_SEC;
    const isBar = Math.abs(t % 2) < 0.01;
    ctx.fillStyle = isBar ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)";
    ctx.fillRect(x, 0, 1, H);
  }

  // Time ruler labels — crisp monospace
  ctx.fillStyle = "rgba(255,255,255,0.2)";
  ctx.font = "9px ui-monospace, 'Cascadia Code', 'Fira Code', monospace";
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

    // Selection ring
    if (selectedNoteId === note.id) {
      ctx.strokeStyle = "rgba(201,168,76,1)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Note name label inside block if wide enough — crisp monospace
    if (w > 28) {
      ctx.fillStyle = conf >= 0.4 ? "rgba(0,0,0,0.8)" : "rgba(200,200,200,0.5)";
      ctx.font = "bold 8px ui-monospace, 'Cascadia Code', 'Fira Code', monospace";
      ctx.textAlign = "left";
      ctx.fillText(note.name, x + 3, y + PIANO_ROLL_ROW_H - 4);
    }
  }

  // Piano key labels (left column) — crisp monospace
  ctx.textAlign = "right";
  for (let m = midiMin; m <= midiMax; m++) {
    const row = midiMax - m;
    const y = row * PIANO_ROLL_ROW_H;
    const name = midiToNoteName(m);
    const isC = m % 12 === 0;
    const isBlack = [1, 3, 6, 8, 10].includes(m % 12);

    if (isC) {
      ctx.fillStyle = "rgba(201,168,76,0.9)";
      ctx.font = "bold 9px ui-monospace, 'Cascadia Code', 'Fira Code', monospace";
      ctx.fillText(name, PIANO_ROLL_LABEL_W - 5, y + PIANO_ROLL_ROW_H - 4);
    } else if (!isBlack && m % 2 === 0) {
      // Show every other white key to avoid crowding
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.font = "9px ui-monospace, 'Cascadia Code', 'Fira Code', monospace";
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
      <div
        className="h-1 w-20 overflow-hidden"
        style={{ borderRadius: 1, background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            borderRadius: 1,
            background:
              pct >= 70
                ? "rgba(201,168,76,0.85)"
                : pct >= 40
                  ? "rgba(201,168,76,0.5)"
                  : "rgba(120,120,120,0.5)",
          }}
        />
      </div>
      <span className="font-mono text-[10px] tabular-nums text-ink-mute/60">{pct}%</span>
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
  const [tipsOpen, setTipsOpen] = useState(false);

  // View mode, editing, warnings. Pitch/timing settings are auto-optimal.
  const [viewMode, setViewMode] = useState<ViewMode>("piano");
  const [bpm, setBpm] = useState(0); // 0 = auto-estimate
  const [detectedBpm, setDetectedBpm] = useState(100);
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [chords, setChords] = useState<ChordHit[]>([]);
  const [neuralProgress, setNeuralProgress] = useState(0);
  const bpmRef = useRef(0);
  const recordedBlobRef = useRef<Blob | null>(null);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [inputWarnings, setInputWarnings] = useState<InputWarning[]>([]);
  const [, setPeakLevel] = useState(0);
  const [, setNoiseFloor] = useState(0);

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
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const pianoRef = useRef<SampledInstrument | null>(null);
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
    try { pianoRef.current?.releaseAll(); } catch { /* */ }
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
    }
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
    drawPianoRoll(canvasRef.current, notes, totalDuration, playheadTime, selectedNoteId);
  }, [notes, totalDuration, playheadTime, selectedNoteId]);

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
      setErrorMsg(
        "No microphone API available. Try a modern browser (Chrome, Firefox, Safari) and ensure the page is served over HTTPS.",
      );
      setRecState("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setErrorMsg(
        "Microphone access was denied or no microphone was found. Enable mic permissions in your browser settings, then try again.",
      );
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

    // YIN pitch sampling
    let clipCount = 0;
    let silentFrames = 0;
    let totalFrames = 0;
    let maxPeak = 0;
    let noiseAcc = 0;
    let noiseCount = 0;

    sampleIntervalRef.current = setInterval(() => {
      if (!analyserRef.current || !pitchBufferRef.current || !audioCtxRef.current) return;
      analyserRef.current.getFloatTimeDomainData(pitchBufferRef.current);
      const sr = audioCtxRef.current.sampleRate;
      totalFrames++;

      // Track input quality
      let frameMax = 0;
      for (let i = 0; i < pitchBufferRef.current.length; i++) {
        const abs = Math.abs(pitchBufferRef.current[i]);
        if (abs > frameMax) frameMax = abs;
      }
      if (frameMax > maxPeak) maxPeak = frameMax;
      if (frameMax > 0.95) clipCount++;
      if (frameMax < 0.01) { silentFrames++; noiseAcc += frameMax; noiseCount++; }
      setPeakLevel(maxPeak);
      if (noiseCount > 0) setNoiseFloor(noiseAcc / noiseCount);

      const result = detectPitchYIN(pitchBufferRef.current, sr, YIN_PARAMS);
      if (result !== null) {
        const { freq, confidence, rms } = result;
        const midi = freqToMidi(freq);
        if (midi >= 36 && midi <= 96) {
          const time = (performance.now() - recordingStartRef.current) / 1000;
          rawSamplesRef.current.push({ midi, time, confidence, freq, rms });
        }
      }

      // Update warnings periodically
      if (totalFrames % 20 === 0) {
        const warnings: InputWarning[] = [];
        if (maxPeak < 0.1 && totalFrames > 10) {
          warnings.push({ type: "quiet", message: "Too quiet — sing closer to the mic" });
        }
        if (clipCount > 5) {
          warnings.push({ type: "clipping", message: "Clipping detected — reduce volume or move back" });
        }
        if (silentFrames > totalFrames * 0.8 && totalFrames > 30) {
          warnings.push({ type: "no_pitch", message: "No stable pitch detected" });
        }
        if (noiseCount > 0 && noiseAcc / noiseCount > 0.005 && rawSamplesRef.current.length < totalFrames * 0.1) {
          warnings.push({ type: "noise", message: "Background noise may be affecting detection" });
        }
        setInputWarnings(warnings);
      }
    }, SAMPLE_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMeterLoop]);

  // Stable ref so timer callback can call stopRecording without stale closure
  const stopRecordingRef = useRef<() => void>(() => {});

  // ── Inference pipeline: quantize → key → chords → results ─────────────────
  const runInference = useCallback(async (rawNotes: NoteEvent[]) => {
    const bpmVal = bpmRef.current > 0 ? bpmRef.current : estimateBpm(rawNotes);
    setDetectedBpm(bpmVal);
    const finalNotes = quantizeNotes(rawNotes, QUANT_GRID, bpmVal);
    const k = inferKey(finalNotes);
    let ch: ChordHit[] = [];
    try { ch = await inferChords(finalNotes, bpmVal, 2, k.accidental); } catch { ch = []; }
    setNotes(finalNotes);
    setKeyInfo(finalNotes.length ? k : null);
    setChords(ch);
    setSelectedNoteId(null);
    setRecState("results");
  }, []);

  // Always run the most accurate path: neural (basic-pitch) first, with the YIN
  // track as a silent fallback. Both feed the same quantize → key → chords step.
  const analyze = useCallback(async (blob: Blob | null) => {
    if (blob && blob.size > 1024) {
      try {
        const ac = new AudioContext();
        const buf = await ac.decodeAudioData(await blob.arrayBuffer());
        await ac.close();
        let nn = await transcribeNeural(buf, (p) => setNeuralProgress(p));
        nn = monophonicReduce(nn);
        nn = mergeShortFragments(nn, 0.08); // absorb slivers left by overlap-trimming
        setNeuralProgress(0);
        if (nn.length > 0) { await runInference(nn); return; }
        toast("Neural model found no clear notes — used fast detection", "info");
      } catch (err) {
        console.warn("[VoiceScore] neural transcription failed:", err);
        toast("Neural model unavailable — used fast detection", "info");
        setNeuralProgress(0);
      }
    }
    // YIN fallback
    await runInference(samplesToNotes(rawSamplesRef.current));
  }, [runInference, toast]);

  const stopRecording = useCallback(() => {
    if (recState !== "recording") return;
    const duration = (performance.now() - recordingStartRef.current) / 1000;
    setTotalDuration(duration);
    setRecState("analyzing");
    setLevel(0);

    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || "audio/webm" });
        recordedBlobRef.current = blob;
        setRawAudioBlob(blob);
        setRawAudioUrl(URL.createObjectURL(blob));
        stopMicPipeline();
        void analyze(blob);
      };
      try { mr.stop(); } catch { stopMicPipeline(); void analyze(null); }
    } else {
      stopMicPipeline();
      void analyze(recordedBlobRef.current);
    }
  }, [recState, analyze, stopMicPipeline]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // ── Re-analyze (respects the current engine / quality / quantize) ─────────
  const reAnalyze = useCallback(() => {
    if (rawSamplesRef.current.length === 0 && !recordedBlobRef.current) return;
    setRecState("analyzing");
    stopPlayback();
    void analyze(recordedBlobRef.current);
  }, [analyze, stopPlayback]);

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

    // Detected melody via a real sampled piano (Tone.Sampler on the shared engine)
    if (notes.length === 0) return;
    setIsPlaying(true);
    setPlayheadTime(0);
    void (async () => {
      const engine = ensureEngine();
      await resumeEngine();
      if (!pianoRef.current) {
        pianoRef.current = await createChordInstrument(engine, CHORD_INSTRUMENTS[0]); // Grand Piano
      }
      const piano = pianoRef.current;
      const startTime = engine.ctx.currentTime + 0.1;
      for (const note of notes) {
        const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
        try {
          piano.sampler.triggerAttackRelease(
            freq,
            Math.max(0.12, note.duration),
            startTime + note.startTime,
            Math.min(1, note.confidence + 0.25),
          );
        } catch { /* sampler not ready */ }
      }
      const endTime = notes.reduce((max, n) => Math.max(max, n.startTime + n.duration), 0);
      const rafFn = () => {
        const t = engine.ctx.currentTime - startTime;
        if (t >= endTime) {
          setPlayheadTime(null);
          setIsPlaying(false);
          return;
        }
        setPlayheadTime(Math.max(0, t));
        playheadRafRef.current = requestAnimationFrame(rafFn);
      };
      playheadRafRef.current = requestAnimationFrame(rafFn);
    })();
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

  const exportCsv = useCallback(() => {
    const rows = [
      ["note", "midi", "start_time", "duration", "confidence"],
      ...notes.map((n) => [
        n.name,
        String(n.midi),
        n.startTime.toFixed(3),
        n.duration.toFixed(3),
        n.confidence.toFixed(2),
      ]),
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `melody-${songId}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Exported CSV", "ok");
  }, [notes, songId, toast]);

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
      .map((n) => `${n.name} ${n.startTime.toFixed(2)}s ${n.duration.toFixed(2)}s confidence ${n.confidence.toFixed(2)}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Formatted sequence copied", "ok");
    } catch {
      toast("Could not access clipboard", "error");
    }
  }, [notes, toast]);

  // ── MIDI export ─────────────────────────────────────────────────────────────

  const exportMidi = useCallback(() => {
    // Simple single-track MIDI file (format 0)
    const ticksPerBeat = 480;
    const tempo = 120; // BPM
    const ticksPerSec = (ticksPerBeat * tempo) / 60;

    // Build MIDI events
    const events: { tick: number; data: number[] }[] = [];

    // Tempo meta event
    const uspb = Math.round(60000000 / tempo);
    events.push({ tick: 0, data: [0xFF, 0x51, 0x03, (uspb >> 16) & 0xFF, (uspb >> 8) & 0xFF, uspb & 0xFF] });

    for (const note of notes) {
      const startTick = Math.round(note.startTime * ticksPerSec);
      const endTick = Math.round((note.startTime + note.duration) * ticksPerSec);
      const velocity = Math.min(127, Math.max(40, Math.round(note.confidence * 100 + 27)));
      events.push({ tick: startTick, data: [0x90, note.midi, velocity] }); // note on
      events.push({ tick: endTick, data: [0x80, note.midi, 0] }); // note off
    }

    // End of track
    const lastTick = events.length > 0 ? Math.max(...events.map(e => e.tick)) + 1 : 0;
    events.push({ tick: lastTick, data: [0xFF, 0x2F, 0x00] });

    events.sort((a, b) => a.tick - b.tick);

    // Encode variable-length quantity
    function vlq(val: number): number[] {
      if (val < 0x80) return [val];
      const bytes: number[] = [];
      bytes.unshift(val & 0x7F);
      val >>= 7;
      while (val > 0) {
        bytes.unshift((val & 0x7F) | 0x80);
        val >>= 7;
      }
      return bytes;
    }

    // Build track data
    const trackData: number[] = [];
    let prevTick = 0;
    for (const ev of events) {
      const delta = ev.tick - prevTick;
      prevTick = ev.tick;
      trackData.push(...vlq(delta), ...ev.data);
    }

    // Build file
    const header = [
      0x4D, 0x54, 0x68, 0x64, // MThd
      0x00, 0x00, 0x00, 0x06, // header length
      0x00, 0x00, // format 0
      0x00, 0x01, // 1 track
      (ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF,
    ];

    const trackLen = trackData.length;
    const track = [
      0x4D, 0x54, 0x72, 0x6B, // MTrk
      (trackLen >> 24) & 0xFF, (trackLen >> 16) & 0xFF, (trackLen >> 8) & 0xFF, trackLen & 0xFF,
      ...trackData,
    ];

    const midiBytes = new Uint8Array([...header, ...track]);
    const blob = new Blob([midiBytes], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `melody-${songId}-${Date.now()}.mid`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Exported MIDI", "ok");
  }, [notes, songId, toast]);

  // ── MusicXML + printable lead sheet ──────────────────────────────────────────

  const exportMusicXml = useCallback(() => {
    if (notes.length === 0 || !keyInfo) return;
    const xml = buildMusicXML(notes, keyInfo, chords, detectedBpm);
    const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lead-sheet-${songId}-${Date.now()}.musicxml`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Exported MusicXML", "ok");
  }, [notes, keyInfo, chords, detectedBpm, songId, toast]);

  const printLeadSheet = useCallback(() => {
    const w = window.open("", "_blank");
    if (!w) { toast("Allow pop-ups to print the lead sheet", "error"); return; }
    const chordLine = chords.map((c) => `${c.symbol} (${c.startTime.toFixed(1)}s)`).join("   ");
    const noteLine = notes.map((n) => n.name).join("  ");
    w.document.write(`<!doctype html><html><head><title>Lead sheet</title>
      <style>
        body{font-family:Georgia,serif;color:#1a1a1a;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.6}
        h1{font-size:22px;margin:0 0 4px} .meta{color:#666;font-size:13px;margin-bottom:24px}
        .chords{font-family:ui-monospace,monospace;font-size:14px;background:#f5f3ef;padding:12px 14px;border-radius:6px;margin-bottom:18px}
        .notes{font-family:ui-monospace,monospace;font-size:13px;color:#444;word-spacing:2px}
        h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:#888;margin:20px 0 6px}
        @media print{body{margin:0}}
      </style></head><body>
      <h1>Lead Sheet</h1>
      <div class="meta">Key ${keyInfo?.name ?? "—"} · ${detectedBpm} BPM · ${notes.length} notes</div>
      <h2>Chords</h2><div class="chords">${chordLine || "—"}</div>
      <h2>Melody</h2><div class="notes">${noteLine}</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
      </body></html>`);
    w.document.close();
  }, [notes, chords, keyInfo, detectedBpm, toast]);

  // ── Note editing ────────────────────────────────────────────────────────────

  const editNotePitch = useCallback((noteId: string, direction: 1 | -1) => {
    setNotes(prev => prev.map(n => {
      if (n.id !== noteId) return n;
      const newMidi = n.midi + direction;
      return { ...n, midi: newMidi, name: midiToNoteName(newMidi) };
    }));
  }, []);

  const deleteNote = useCallback((noteId: string) => {
    setNotes(prev => prev.filter(n => n.id !== noteId));
    setSelectedNoteId(null);
  }, []);

  const mergeWithNext = useCallback((noteId: string) => {
    setNotes(prev => {
      const idx = prev.findIndex(n => n.id === noteId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const curr = prev[idx];
      const next = prev[idx + 1];
      const merged: NoteEvent = {
        ...curr,
        duration: Math.round((next.startTime + next.duration - curr.startTime) * 1000) / 1000,
        confidence: (curr.confidence + next.confidence) / 2,
      };
      return [...prev.slice(0, idx), merged, ...prev.slice(idx + 2)];
    });
  }, []);

  const splitNote = useCallback((noteId: string) => {
    setNotes(prev => {
      const idx = prev.findIndex(n => n.id === noteId);
      if (idx < 0) return prev;
      const note = prev[idx];
      if (note.duration < 0.1) return prev; // too short to split
      const halfDur = Math.round((note.duration / 2) * 1000) / 1000;
      const first: NoteEvent = { ...note, duration: halfDur, id: nextNoteId() };
      const second: NoteEvent = {
        ...note,
        startTime: Math.round((note.startTime + halfDur) * 1000) / 1000,
        duration: halfDur,
        id: nextNoteId(),
      };
      return [...prev.slice(0, idx), first, second, ...prev.slice(idx + 1)];
    });
  }, []);

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
        <div className="flex items-center gap-4">
          <span className="font-serif text-base tracking-tight text-ink-text">
            Voice to Score
          </span>
          {/* State badge */}
          {recState === "idle" && (
            <span className="font-mono text-[10px] text-ink-mute/50">
              Ready to capture
            </span>
          )}
          {recState === "recording" && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-red-400/80">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              Recording… {fmtTime(elapsed)}
            </span>
          )}
          {recState === "analyzing" && (
            <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute">
              <Spinner />
              Analyzing pitch…
            </span>
          )}
          {recState === "results" && (
            <span className="font-mono text-[10px] text-amber-gold/70">
              {notes.length > 0
                ? `${notes.length} note${notes.length !== 1 ? "s" : ""} detected`
                : "No pitch detected"}
            </span>
          )}
          {recState === "error" && (
            <span className="font-mono text-[10px] text-red-400/80">Error</span>
          )}
        </div>
        <button
          onClick={() => {
            stopMicPipeline();
            fullReset();
            onClose();
          }}
          className="border border-ink-line/40 px-2.5 py-1 font-mono text-[11px] text-ink-mute transition-colors hover:border-ink-text/50 hover:text-ink-text"
          aria-label="Close Voice to Score"
        >
          ✕ exit
        </button>
      </div>

      {/* ─── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-5">

        {/* Subtitle + quality controls */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-md text-sm text-ink-mute">
            <span className="text-ink-text/80">Best for one clear vocal melody.</span>{" "}
            Pitch detection runs entirely in your browser.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {/* Tempo — auto-detected, with optional override */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-ink-mute/40">Tempo</span>
              <input
                type="number" min={40} max={240}
                value={bpm > 0 ? bpm : ""}
                placeholder={`${detectedBpm}`}
                onChange={(e) => setBpm(e.target.value ? Math.max(40, Math.min(240, parseInt(e.target.value) || 0)) : 0)}
                title="Auto-detected from your singing. Type a value to override."
                className="w-16 rounded border border-ink-line/40 bg-ink/40 px-1.5 py-0.5 text-center text-[11px] text-ink-text outline-none"
              />
              <span className="text-[9px] uppercase tracking-wider text-ink-mute/40">{bpm > 0 ? "BPM" : "BPM · auto"}</span>
            </div>
            {/* Everything else is tuned automatically */}
            <span
              className="rounded-full bg-amber-gold/10 px-2 py-0.5 text-[10px] text-amber-gold/80"
              title="The neural pitch model, octave repair and 1/16 timing grid are all tuned automatically for the most accurate result."
            >
              ✦ Auto-tuned
            </span>
          </div>
        </div>

        {/* Idle: quick tips nudge */}
        {recState === "idle" && (
          <div className="mb-5 max-w-sm">
            <button
              onClick={() => setTipsOpen((v) => !v)}
              className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute/40 transition-colors hover:text-ink-mute/70"
              aria-expanded={tipsOpen}
            >
              <span
                className="inline-block transition-transform duration-150"
                style={{ transform: tipsOpen ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▶
              </span>
              Tips for better capture
            </button>
            {tipsOpen && (
              <ul className="mt-2 space-y-1 pl-4 font-mono text-[11px] text-ink-mute/55">
                <li>Sing one clear melody line</li>
                <li>Use headphones to avoid feedback</li>
                <li>Avoid background music playing</li>
                <li>Hold notes slightly longer for better detection</li>
              </ul>
            )}
          </div>
        )}

        {/* ── Level meter ───────────────────────────────────────────────── */}
        <div className="mb-5">
          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-mute/50">
            Input Level
          </div>
          <div
            className="h-1.5 w-full max-w-sm overflow-hidden"
            style={{ background: "rgba(255,255,255,0.06)", borderRadius: 1 }}
          >
            <div
              className="h-full transition-all duration-75"
              style={{
                width: `${Math.round(level * 100)}%`,
                borderRadius: 1,
                background:
                  level > 0.85
                    ? "rgba(239,68,68,0.9)"
                    : level > 0.5
                      ? "rgba(201,168,76,0.9)"
                      : "rgba(201,168,76,0.55)",
              }}
            />
          </div>
          {recState === "recording" && level < 0.04 && (
            <p className="mt-1 font-mono text-[10px] text-ink-mute/40">
              No signal — check mic permissions
            </p>
          )}
          {/* Input quality warnings */}
          {recState === "recording" && inputWarnings.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
              {inputWarnings.map((w, i) => (
                <span key={i} className={`font-mono text-[10px] ${
                  w.type === "clipping" ? "text-red-400/80" :
                  w.type === "quiet" ? "text-amber-gold/60" : "text-ink-mute/50"
                }`}>
                  {w.message}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ── Status line ───────────────────────────────────────────────── */}
        <div className="mb-4 flex items-center gap-2">
          {recState === "analyzing" && <Spinner />}
          <span
            className={[
              "font-mono text-xs",
              recState === "error"
                ? "text-red-400"
                : recState === "idle"
                  ? "text-ink-mute/50"
                  : recState === "results" && notes.length > 0
                    ? "text-ink-text/80"
                    : "text-ink-mute",
            ].join(" ")}
          >
            {statusMessage}
          </span>
          {recState === "recording" && (
            <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-mute/60">
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
                ? "border-ink-line/40 text-ink-mute hover:border-amber-gold/50 hover:text-amber-gold"
                : "cursor-not-allowed border-ink-line/20 text-ink-mute/25",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-2 w-2 rounded-full",
                canRecord ? "bg-red-500/70" : "bg-red-500/25",
              ].join(" ")}
            />
            Record
          </button>

          {/* Stop */}
          <button
            disabled={!canStop}
            onClick={stopRecording}
            className={[
              "border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors",
              canStop
                ? "border-ink-line/40 text-ink-text hover:border-amber-gold/50 hover:text-amber-gold"
                : "cursor-not-allowed border-ink-line/20 text-ink-mute/25",
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
                  ? "border-ink-line/40 text-ink-mute hover:border-amber-gold/50 hover:text-amber-gold"
                  : "cursor-not-allowed border-ink-line/20 text-ink-mute/25",
              ].join(" ")}
            >
              Play Back
            </button>
          )}

          {/* Playback mode selector */}
          {hasResults && (
            <div className="flex items-center border border-ink-line/40 font-mono text-[10px] uppercase tracking-wider">
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
              className="border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Re-analyze
            </button>
          )}

          {/* Try again / Clear */}
          {hasResults && (
            <button
              onClick={fullReset}
              className="border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-ink-text/50 hover:text-ink-text"
            >
              Try again
            </button>
          )}
        </div>

        {/* ── Analyzing state ───────────────────────────────────────────── */}
        {recState === "analyzing" && (
          <div className="mb-6 flex items-center gap-2 font-mono text-xs text-ink-mute">
            <Spinner />
            {`Transcribing with the neural model…${neuralProgress > 0 ? ` ${Math.round(neuralProgress * 100)}%` : ""}`}
          </div>
        )}

        {/* ── Key + chord summary ───────────────────────────────────────── */}
        {hasResults && notes.length > 0 && keyInfo && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-ink-surface/40 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-mute/50">Key</span>
            <span className="font-serif text-base text-amber-gold">{keyInfo.name}</span>
            <span className="text-ink-mute/30">·</span>
            <span className="text-[10px] uppercase tracking-wider text-ink-mute/50">Chords</span>
            <span className="flex flex-wrap gap-1.5 font-mono text-[11px] text-ink-text/80">
              {chords.length > 0
                ? chords.slice(0, 12).map((c, i) => <span key={i} className="rounded bg-ink/40 px-1.5 py-0.5">{c.symbol}</span>)
                : <span className="text-ink-mute/40">—</span>}
            </span>
          </div>
        )}

        {/* ── View mode tabs ────────────────────────────────────────────── */}
        {hasResults && notes.length > 0 && (
          <div className="mb-3 flex items-center gap-1 border-b border-ink-line/20 pb-2">
            {(["piano", "list", "staff"] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className={`px-3 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                  viewMode === v ? "text-amber-gold border-b border-amber-gold" : "text-ink-mute/40 hover:text-ink-text"
                }`}>
                {v === "piano" ? "Piano Roll" : v === "list" ? "Note List" : "Staff"}
              </button>
            ))}
            <span className="ml-auto text-[9px] text-ink-mute/30">
              Click notes to select and edit
            </span>
          </div>
        )}

        {/* ── Piano Roll ────────────────────────────────────────────────── */}
        {hasResults && notes.length > 0 && viewMode === "piano" && (
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
              className="overflow-x-auto border border-ink-line/30"
              style={{ maxHeight: 360, background: "#141414" }}
            >
              <canvas
                ref={canvasRef}
                style={{ display: "block", cursor: "pointer" }}
                onClick={(e) => {
                  const canvas = canvasRef.current;
                  if (!canvas || notes.length === 0) return;
                  const rect = canvas.getBoundingClientRect();
                  const scaleX = canvas.width / rect.width;
                  const scaleY = canvas.height / rect.height;
                  const cx = (e.clientX - rect.left) * scaleX;
                  const cy = (e.clientY - rect.top) * scaleY;

                  // Reconstruct MIDI range (must match drawPianoRoll)
                  const midiValues = notes.map(n => n.midi);
                  const rawMin = Math.min(...midiValues);
                  const rawMax = Math.max(...midiValues);
                  const spread = rawMax - rawMin;
                  const padding = Math.max(4, Math.floor((14 - spread) / 2));
                  const midiMax = Math.min(127, rawMax + padding);

                  // Hit-test each note
                  let hitId: string | null = null;
                  for (const note of notes) {
                    const row = midiMax - note.midi;
                    const ny = row * PIANO_ROLL_ROW_H;
                    const nx = PIANO_ROLL_LABEL_W + note.startTime * PIANO_ROLL_PX_PER_SEC;
                    const nw = Math.max(3, note.duration * PIANO_ROLL_PX_PER_SEC - 2);
                    const nh = PIANO_ROLL_ROW_H - 2;
                    if (cx >= nx && cx <= nx + nw && cy >= ny + 1 && cy <= ny + 1 + nh) {
                      hitId = note.id;
                      break;
                    }
                  }
                  setSelectedNoteId(hitId === selectedNoteId ? null : hitId);
                }}
              />
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
                <button
                  key={i}
                  onClick={() => setSelectedNoteId(selectedNoteId === note.id ? null : note.id)}
                  title={`Start: ${note.startTime.toFixed(2)}s · Duration: ${note.duration.toFixed(2)}s · Confidence: ${Math.round(note.confidence * 100)}%`}
                  className={[
                    "inline-flex items-baseline gap-1 border px-2 py-0.5 transition-colors",
                    selectedNoteId === note.id
                      ? "border-amber-gold bg-amber-gold/10 text-amber-gold"
                      : note.confidence >= 0.7
                        ? "border-amber-gold/35 text-amber-gold hover:bg-amber-gold/5"
                        : note.confidence >= 0.4
                          ? "border-amber-gold/15 text-amber-gold/55 hover:bg-amber-gold/5"
                          : "border-ink-line/40 text-ink-mute/40 hover:bg-ink-surface/40",
                  ].join(" ")}
                >
                  <span className="font-mono text-xs tracking-tight">{note.name}</span>
                  <span className="font-mono text-[9px] tabular-nums opacity-40">
                    {note.duration.toFixed(2)}s
                  </span>
                  {note.confidence < 0.4 && (
                    <span className="font-mono text-[9px] opacity-35">?</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Staff view (simple notation) ──────────────────────────────── */}
        {hasResults && notes.length > 0 && viewMode === "staff" && (
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-ink-mute/60">
              <span>Staff</span>
              {keyInfo && <span className="text-amber-gold/70">Key {keyInfo.name}</span>}
              <span className="text-ink-mute/50">{detectedBpm} BPM</span>
            </div>
            <StaffView notes={notes} keyInfo={keyInfo} chords={chords} bpm={detectedBpm} />
          </div>
        )}

        {/* ── Detailed note table ────────────────────────────────────────── */}
        {hasResults && notes.length > 0 && viewMode === "list" && (
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
                    onClick={() => setSelectedNoteId(selectedNoteId === note.id ? null : note.id)}
                    className={`cursor-pointer border-b border-ink-line/30 last:border-0 transition-colors ${
                      selectedNoteId === note.id ? "bg-amber-gold/8" : "hover:bg-ink-surface/60"
                    }`}
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

        {/* ── Note editing toolbar ──────────────────────────────────────── */}
        {hasResults && notes.length > 0 && selectedNoteId && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded bg-ink-surface/40 px-3 py-2">
            <span className="text-[10px] text-ink-mute/50">Selected:</span>
            <span className="font-mono text-xs text-amber-gold">
              {notes.find(n => n.id === selectedNoteId)?.name ?? "—"}
            </span>
            <button onClick={() => editNotePitch(selectedNoteId, 1)}
              className="rounded bg-ink-surface/60 px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink-text" title="Pitch up">
              +1
            </button>
            <button onClick={() => editNotePitch(selectedNoteId, -1)}
              className="rounded bg-ink-surface/60 px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink-text" title="Pitch down">
              -1
            </button>
            <button onClick={() => splitNote(selectedNoteId)}
              className="rounded bg-ink-surface/60 px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink-text" title="Split note">
              Split
            </button>
            <button onClick={() => mergeWithNext(selectedNoteId)}
              className="rounded bg-ink-surface/60 px-2 py-0.5 text-[10px] text-ink-mute hover:text-ink-text" title="Merge with next">
              Merge
            </button>
            <button onClick={() => deleteNote(selectedNoteId)}
              className="rounded bg-ink-surface/60 px-2 py-0.5 text-[10px] text-red-400/70 hover:text-red-400" title="Delete note">
              Delete
            </button>
            <button onClick={() => setSelectedNoteId(null)}
              className="ml-auto text-[10px] text-ink-mute/40 hover:text-ink-mute">
              Deselect
            </button>
          </div>
        )}

        {/* ── Export / action row ────────────────────────────────────────── */}
        {hasResults && notes.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2">
            <button
              onClick={exportMidi}
              className="border border-amber-gold/30 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-amber-gold/80 transition-colors hover:border-amber-gold hover:text-amber-gold"
            >
              Export MIDI
            </button>
            <button
              onClick={exportMusicXml}
              className="border border-amber-gold/30 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-amber-gold/80 transition-colors hover:border-amber-gold hover:text-amber-gold"
            >
              MusicXML
            </button>
            <button
              onClick={printLeadSheet}
              className="border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Print Lead Sheet
            </button>
            <button
              onClick={exportJson}
              className="border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Export JSON
            </button>
            <button
              onClick={exportCsv}
              className="border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Export CSV
            </button>
            <button
              onClick={() => void copyNotes()}
              className="border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Copy Notes
            </button>
            <button
              onClick={() => void copySequenceFormatted()}
              className="border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-amber-gold/50 hover:text-amber-gold"
            >
              Copy Formatted
            </button>
          </div>
        )}

        {/* ── Error retry ───────────────────────────────────────────────── */}
        {recState === "error" && (
          <button
            onClick={fullReset}
            className="mb-6 border border-ink-line/40 px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors hover:border-ink-text/50 hover:text-ink-text"
          >
            Try Again
          </button>
        )}

        {/* ── Tips for better capture (collapsible) ─────────────────────── */}
        <div className="border-t border-ink-line/40 pt-5">
          <button
            onClick={() => setTipsOpen((v) => !v)}
            className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute/50 transition-colors hover:text-ink-mute"
            aria-expanded={tipsOpen}
          >
            <span
              className="inline-block transition-transform duration-150"
              style={{ transform: tipsOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              ▶
            </span>
            Tips for better capture
          </button>
          {tipsOpen && (
            <ul className="mb-4 space-y-1.5 pl-4 font-mono text-[11px] text-ink-mute/60">
              <li>Sing one clear melody line — no harmonies</li>
              <li>Use headphones to avoid mic feedback from playback</li>
              <li>Avoid background music playing — it confuses pitch detection</li>
              <li>Hold notes slightly longer for better detection accuracy</li>
              <li>Record in a quiet room — background noise degrades results</li>
              <li>Humming works just as well as singing, sometimes better</li>
            </ul>
          )}
          <p className="font-mono text-[10px] text-ink-mute/35">
            Melody sketch, not notation. Max {MAX_DURATION}s · All processing is client-side.
          </p>
        </div>

      </div>
    </div>
  );
}
