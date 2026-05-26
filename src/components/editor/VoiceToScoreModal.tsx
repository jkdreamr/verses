"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecordingState = "idle" | "recording" | "analyzing" | "results" | "error";

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
const MIN_NOTE_DURATION = 0.1; // seconds
const QUANTIZE_STEP = 0.25; // seconds
const PIANO_ROLL_ROW_H = 18; // px per note row
const PIANO_ROLL_LABEL_W = 42; // px for note name labels
const PIANO_ROLL_PX_PER_SEC = 80; // px per second
const BEAT_INTERVAL = 0.5; // seconds

// ---------------------------------------------------------------------------
// Pitch detection helpers
// ---------------------------------------------------------------------------

function detectPitch(buffer: Float32Array<ArrayBuffer>, sampleRate: number): number | null {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let best_offset = -1;
  let best_correlation = 0;
  let rms = 0;
  let found_good_correlation = false;
  let last_correlation = 1;

  for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return null;

  const correlations = new Array<number>(MAX_SAMPLES);
  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs(buffer[i] - buffer[i + offset]);
    }
    correlation = 1 - correlation / MAX_SAMPLES;
    correlations[offset] = correlation;
    if (correlation > 0.9 && correlation > last_correlation) {
      found_good_correlation = true;
      if (correlation > best_correlation) {
        best_correlation = correlation;
        best_offset = offset;
      }
    } else if (found_good_correlation) {
      const shift =
        (correlations[best_offset + 1] - correlations[best_offset - 1]) /
        (2 *
          (2 * correlations[best_offset] -
            correlations[best_offset - 1] -
            correlations[best_offset + 1]));
      return sampleRate / (best_offset + shift);
    }
    last_correlation = correlation;
  }
  if (best_correlation > 0.01 && best_offset > 0) return sampleRate / best_offset;
  return null;
}

const freqToMidi = (freq: number): number =>
  Math.round(12 * Math.log2(freq / 440) + 69);

const midiToNoteName = (midi: number): string => {
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const octave = Math.floor(midi / 12) - 1;
  return names[midi % 12] + octave;
};

// ---------------------------------------------------------------------------
// Note smoothing / segmentation
// ---------------------------------------------------------------------------

interface RawSample {
  midi: number;
  time: number;
  correlation: number;
}

function samplesToNotes(samples: RawSample[]): NoteEvent[] {
  if (samples.length === 0) return [];

  const segments: RawSample[][] = [];
  let current: RawSample[] = [samples[0]];

  for (let i = 1; i < samples.length; i++) {
    const prev = current[current.length - 1];
    if (Math.abs(samples[i].midi - prev.midi) <= 1) {
      current.push(samples[i]);
    } else {
      segments.push(current);
      current = [samples[i]];
    }
  }
  segments.push(current);

  const notes: NoteEvent[] = [];
  for (const seg of segments) {
    if (seg.length === 0) continue;
    const startTime = seg[0].time;
    const endTime = seg[seg.length - 1].time + SAMPLE_INTERVAL_MS / 1000;
    const rawDuration = endTime - startTime;
    if (rawDuration < MIN_NOTE_DURATION) continue;

    // quantize duration
    const duration =
      Math.round(rawDuration / QUANTIZE_STEP) * QUANTIZE_STEP || QUANTIZE_STEP;

    // median MIDI pitch
    const midis = seg.map((s) => s.midi).sort((a, b) => a - b);
    const midi = midis[Math.floor(midis.length / 2)];

    // average confidence
    const confidence =
      seg.reduce((sum, s) => sum + s.correlation, 0) / seg.length;

    notes.push({
      midi,
      name: midiToNoteName(midi),
      startTime: Math.round(startTime * 1000) / 1000,
      duration,
      confidence,
    });
  }

  return notes;
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

  // Determine MIDI range
  const midiValues = notes.map((n) => n.midi);
  const rawMin = midiValues.length > 0 ? Math.min(...midiValues) : 60;
  const rawMax = midiValues.length > 0 ? Math.max(...midiValues) : 72;
  const rangeNeeded = Math.max(12, rawMax - rawMin + 10);
  const midiMin = Math.max(0, Math.floor(rawMin - (rangeNeeded - (rawMax - rawMin)) / 2));
  const midiMax = midiMin + rangeNeeded;
  const noteCount = midiMax - midiMin + 1;

  const W = PIANO_ROLL_LABEL_W + Math.max(totalDuration, 1) * PIANO_ROLL_PX_PER_SEC;
  const H = noteCount * PIANO_ROLL_ROW_H;

  canvas.width = W;
  canvas.height = H;

  // Background
  ctx.fillStyle = "#0e0e0e";
  ctx.fillRect(0, 0, W, H);

  // Row backgrounds (alternating; black keys slightly darker)
  for (let m = midiMin; m <= midiMax; m++) {
    const row = midiMax - m;
    const y = row * PIANO_ROLL_ROW_H;
    const isBlack = [1, 3, 6, 8, 10].includes(m % 12);
    ctx.fillStyle = isBlack ? "#111111" : "#161616";
    ctx.fillRect(PIANO_ROLL_LABEL_W, y, W - PIANO_ROLL_LABEL_W, PIANO_ROLL_ROW_H);

    // Row divider
    ctx.fillStyle = "#252525";
    ctx.fillRect(PIANO_ROLL_LABEL_W, y + PIANO_ROLL_ROW_H - 1, W - PIANO_ROLL_LABEL_W, 1);
  }

  // Beat grid lines
  ctx.fillStyle = "#2a2a2a";
  for (let t = 0; t <= totalDuration; t += BEAT_INTERVAL) {
    const x = PIANO_ROLL_LABEL_W + t * PIANO_ROLL_PX_PER_SEC;
    ctx.fillRect(x, 0, 1, H);
  }

  // Second labels along top
  ctx.fillStyle = "#555555";
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "center";
  for (let t = 0; t <= totalDuration; t += 1) {
    const x = PIANO_ROLL_LABEL_W + t * PIANO_ROLL_PX_PER_SEC;
    ctx.fillText(String(t) + "s", x, 10);
  }

  // Note blocks
  for (const note of notes) {
    const row = midiMax - note.midi;
    const y = row * PIANO_ROLL_ROW_H;
    const x = PIANO_ROLL_LABEL_W + note.startTime * PIANO_ROLL_PX_PER_SEC;
    const w = Math.max(4, note.duration * PIANO_ROLL_PX_PER_SEC - 2);
    const h = PIANO_ROLL_ROW_H - 2;

    // Color: amber → gray by confidence
    const conf = Math.max(0, Math.min(1, note.confidence));
    // High confidence: amber-gold rgb(214,165,84); low: muted gray rgb(80,80,80)
    const r = Math.round(80 + conf * (214 - 80));
    const g = Math.round(80 + conf * (165 - 80));
    const b = Math.round(80 + conf * (84 - 80));

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y + 1, w, h);

    // Note label inside block if wide enough
    if (w > 28) {
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.font = "bold 9px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(note.name, x + 3, y + PIANO_ROLL_ROW_H - 5);
    }
  }

  // Note name labels on left
  ctx.textAlign = "right";
  for (let m = midiMin; m <= midiMax; m++) {
    const row = midiMax - m;
    const y = row * PIANO_ROLL_ROW_H;
    const name = midiToNoteName(m);
    const isC = m % 12 === 0;
    ctx.fillStyle = isC ? "#d6a554" : "#555555";
    ctx.font = `${isC ? "bold " : ""}10px ui-monospace, monospace`;
    ctx.fillText(name, PIANO_ROLL_LABEL_W - 4, y + PIANO_ROLL_ROW_H - 5);
  }

  // Playhead
  if (playheadTime !== null) {
    const px = PIANO_ROLL_LABEL_W + playheadTime * PIANO_ROLL_PX_PER_SEC;
    ctx.fillStyle = "rgba(214,165,84,0.85)";
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

  // State
  const [recState, setRecState] = useState<RecordingState>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [elapsed, setElapsed] = useState(0); // recording elapsed seconds
  const [level, setLevel] = useState(0); // mic level 0–1
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  const [playheadTime, setPlayheadTime] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // Refs for audio pipeline
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pitchBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rawSamplesRef = useRef<RawSample[]>([]);
  const recordingStartRef = useRef<number>(0);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackSourcesRef = useRef<OscillatorNode[]>([]);

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

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
  }, []);

  const stopPlayback = useCallback(() => {
    for (const osc of playbackSourcesRef.current) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    }
    playbackSourcesRef.current = [];
    setIsPlaying(false);
    setPlayheadTime(null);
  }, []);

  const fullReset = useCallback(() => {
    stopMicPipeline();
    stopPlayback();
    rawSamplesRef.current = [];
    pitchBufferRef.current = null;
    setRecState("idle");
    setErrorMsg("");
    setElapsed(0);
    setLevel(0);
    setNotes([]);
    setTotalDuration(0);
    setPlayheadTime(null);
    setIsPlaying(false);
  }, [stopMicPipeline, stopPlayback]);

  // Cleanup on modal close / unmount
  useEffect(() => {
    if (!open) fullReset();
  }, [open, fullReset]);

  useEffect(() => {
    return () => {
      fullReset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Piano Roll: redraw when notes change
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!canvasRef.current || notes.length === 0) return;
    drawPianoRoll(canvasRef.current, notes, totalDuration, playheadTime);
  }, [notes, totalDuration, playheadTime]);

  // -------------------------------------------------------------------------
  // Level meter (RAF loop)
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  const startRecording = useCallback(async () => {
    setErrorMsg("");

    // Browser check
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      setErrorMsg(
        "This feature requires a modern browser with WebAudio support.",
      );
      setRecState("error");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErrorMsg(
        "Microphone access required. Enable it in browser settings.",
      );
      setRecState("error");
      return;
    }

    streamRef.current = stream;

    const Ctx =
      window.AudioContext ||
      (
        window as unknown as {
          webkitAudioContext: typeof AudioContext;
        }
      ).webkitAudioContext;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const src = ctx.createMediaStreamSource(stream);
    src.connect(analyser);

    const bufferLength = analyser.fftSize;
    pitchBufferRef.current = new Float32Array(bufferLength);

    rawSamplesRef.current = [];
    recordingStartRef.current = performance.now();
    setElapsed(0);
    setRecState("recording");

    // Level meter
    startMeterLoop(analyser);

    // Elapsed timer
    timerIntervalRef.current = setInterval(() => {
      const elapsed =
        (performance.now() - recordingStartRef.current) / 1000;
      setElapsed(elapsed);
      if (elapsed >= MAX_DURATION) {
        // auto-stop
        stopRecording();
      }
    }, 200);

    // Pitch sampling
    sampleIntervalRef.current = setInterval(() => {
      if (!analyserRef.current || !pitchBufferRef.current || !audioCtxRef.current) return;
      analyserRef.current.getFloatTimeDomainData(pitchBufferRef.current);
      const sampleRate = audioCtxRef.current.sampleRate;
      const freq = detectPitch(pitchBufferRef.current, sampleRate);
      if (freq !== null && freq > 60 && freq < 2000) {
        const midi = freqToMidi(freq);
        if (midi >= 36 && midi <= 96) {
          const time =
            (performance.now() - recordingStartRef.current) / 1000;
          // Simple correlation proxy: use rms as confidence proxy
          const rms = Math.sqrt(
            pitchBufferRef.current.reduce((s, v) => s + v * v, 0) /
              pitchBufferRef.current.length,
          );
          const confidence = Math.min(1, rms * 8);
          rawSamplesRef.current.push({ midi, time, correlation: confidence });
        }
      }
    }, SAMPLE_INTERVAL_MS);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMeterLoop]);

  // Use a stable ref for stopRecording to avoid circular deps
  const stopRecordingRef = useRef<() => void>(() => {});

  const stopRecording = useCallback(() => {
    if (recState !== "recording") return;

    const duration = (performance.now() - recordingStartRef.current) / 1000;
    setTotalDuration(duration);
    setRecState("analyzing");
    setLevel(0);

    stopMicPipeline();

    // Analyze on next tick to let state update
    setTimeout(() => {
      const samples = rawSamplesRef.current;
      const detected = samplesToNotes(samples);
      setNotes(detected);
      setRecState("results");
    }, 50);
  }, [recState, stopMicPipeline]);

  // Keep ref in sync
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  const playMelody = useCallback(() => {
    if (notes.length === 0 || isPlaying) return;

    const Ctx =
      window.AudioContext ||
      (
        window as unknown as {
          webkitAudioContext: typeof AudioContext;
        }
      ).webkitAudioContext;
    const ctx = new Ctx();

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
      gain.gain.setValueAtTime(0.3, startTime + note.startTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        startTime + note.startTime + Math.max(0.05, note.duration - 0.05),
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime + note.startTime);
      osc.stop(startTime + note.startTime + note.duration + 0.05);
      oscs.push(osc);
    }

    playbackSourcesRef.current = oscs;

    // Playhead tracking
    const endTime = notes.reduce(
      (max, n) => Math.max(max, n.startTime + n.duration),
      0,
    );

    const playheadRaf = () => {
      const t = ctx.currentTime - startTime;
      if (t >= endTime) {
        setPlayheadTime(null);
        setIsPlaying(false);
        void ctx.close().catch(() => {});
        return;
      }
      setPlayheadTime(t);
      requestAnimationFrame(playheadRaf);
    };
    requestAnimationFrame(playheadRaf);
  }, [notes, isPlaying]);

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  const exportJson = useCallback(() => {
    const data = {
      notes,
      duration: totalDuration,
      recordedAt: new Date().toISOString(),
      songId,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
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
    const text = notes.map((n) => n.name).join(" ");
    try {
      await navigator.clipboard.writeText(text);
      toast("Note sequence copied", "ok");
    } catch {
      toast("Couldn't copy to clipboard", "error");
    }
  }, [notes, toast]);

  // -------------------------------------------------------------------------
  // Derived UI values
  // -------------------------------------------------------------------------

  const remaining = Math.max(0, MAX_DURATION - elapsed);

  const statusMessage = (() => {
    switch (recState) {
      case "idle":
        return "Ready to record your melody.";
      case "recording":
        return `Recording… ${fmtTime(elapsed)} / ${fmtTime(MAX_DURATION)}`;
      case "analyzing":
        return "Analyzing pitch…";
      case "results":
        if (notes.length === 0)
          return "No clear pitch found. Try singing closer to the mic with no background noise.";
        return `Melody sketch complete — ${notes.length} note${notes.length !== 1 ? "s" : ""} detected.`;
      case "error":
        return errorMsg;
    }
  })();

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-ink/95 print:hidden">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-ink-line px-5 py-3">
        <span className="font-mono text-xs uppercase tracking-widest text-amber-gold">
          Voice to Score
        </span>
        <button
          onClick={() => {
            fullReset();
            onClose();
          }}
          className="rounded border border-ink-line px-2.5 py-1 font-mono text-xs text-ink-mute transition-colors duration-150 hover:border-ink-text/50 hover:text-ink-text"
          aria-label="Close"
        >
          ✕ close
        </button>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Hint */}
        <p className="mb-4 max-w-xl font-sans text-sm text-ink-mute">
          Works best with{" "}
          <span className="text-ink-text">one clear monophonic vocal line</span>{" "}
          sung without accompaniment. Pitch detection runs entirely in your
          browser.
        </p>

        {/* ── Controls row ── */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            disabled={recState === "recording" || recState === "analyzing"}
            onClick={() => void startRecording()}
            className={[
              "flex items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors duration-150",
              recState === "recording"
                ? "border-red-500/60 bg-red-500/10 text-red-400 opacity-70 cursor-not-allowed"
                : recState === "analyzing"
                  ? "border-ink-line text-ink-mute cursor-not-allowed opacity-50"
                  : "border-ink-line text-ink-mute hover:border-amber-gold/60 hover:text-amber-gold",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block h-2 w-2 rounded-full",
                recState === "recording"
                  ? "animate-pulse bg-red-500"
                  : "bg-ink-mute",
              ].join(" ")}
            />
            {recState === "recording"
              ? `Recording… ${fmtTime(remaining)} left`
              : "Record"}
          </button>

          <button
            disabled={recState !== "recording"}
            onClick={stopRecording}
            className={[
              "rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors duration-150",
              recState === "recording"
                ? "border-ink-line text-ink-text hover:border-amber-gold/60 hover:text-amber-gold"
                : "border-ink-line text-ink-mute cursor-not-allowed opacity-40",
            ].join(" ")}
          >
            ■ Stop
          </button>

          <button
            disabled={notes.length === 0 || isPlaying || recState === "recording" || recState === "analyzing"}
            onClick={playMelody}
            className={[
              "rounded border px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors duration-150",
              notes.length > 0 && !isPlaying && recState !== "recording" && recState !== "analyzing"
                ? "border-ink-line text-ink-mute hover:border-amber-gold/60 hover:text-amber-gold"
                : "border-ink-line text-ink-mute cursor-not-allowed opacity-40",
            ].join(" ")}
          >
            {isPlaying ? "▶ Playing…" : "▶ Play back"}
          </button>

          {isPlaying && (
            <button
              onClick={stopPlayback}
              className="rounded border border-ink-line px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-mute transition-colors duration-150 hover:border-ink-text/50 hover:text-ink-text"
            >
              ■ Stop playback
            </button>
          )}
        </div>

        {/* ── Level meter ── */}
        <div className="mb-3">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-ink-mute">
            Input level
          </div>
          <div className="relative h-2 w-full max-w-sm overflow-hidden rounded-sm bg-ink-line">
            <div
              className="absolute inset-y-0 left-0 bg-amber-gold/70 transition-all duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
        </div>

        {/* ── Status ── */}
        <div
          className={[
            "mb-4 font-mono text-xs",
            recState === "error"
              ? "text-red-400"
              : recState === "recording"
                ? "text-red-400/80"
                : recState === "results" && notes.length === 0
                  ? "text-ink-mute"
                  : "text-ink-mute",
          ].join(" ")}
        >
          {statusMessage}
        </div>

        {/* ── Piano Roll ── */}
        {recState === "results" && notes.length > 0 && (
          <div className="mb-5">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              Piano Roll
            </div>
            <div
              ref={canvasWrapRef}
              className="overflow-x-auto rounded border border-ink-line bg-[#0e0e0e]"
              style={{ maxHeight: 340 }}
            >
              <canvas ref={canvasRef} style={{ display: "block" }} />
            </div>
            <div className="mt-1 flex items-center gap-4 font-mono text-[10px] text-ink-mute">
              <span>
                <span
                  className="mr-1 inline-block h-2 w-3 rounded-sm"
                  style={{ background: "rgb(214,165,84)" }}
                />
                high confidence
              </span>
              <span>
                <span
                  className="mr-1 inline-block h-2 w-3 rounded-sm"
                  style={{ background: "rgb(80,80,80)" }}
                />
                low confidence
              </span>
            </div>
          </div>
        )}

        {/* ── Analyzing spinner placeholder ── */}
        {recState === "analyzing" && (
          <div className="mb-5 flex items-center gap-2 text-ink-mute">
            <svg
              className="h-4 w-4 animate-spin text-amber-gold"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <span className="font-mono text-xs">Analyzing pitch data…</span>
          </div>
        )}

        {/* ── Note list ── */}
        {recState === "results" && notes.length > 0 && (
          <div className="mb-5">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              Note Sequence
            </div>
            <div className="flex flex-wrap gap-1.5">
              {notes.map((note, i) => (
                <span
                  key={i}
                  title={`Start: ${note.startTime.toFixed(2)}s · Duration: ${note.duration.toFixed(2)}s · Confidence: ${Math.round(note.confidence * 100)}%`}
                  className={[
                    "rounded border px-2 py-0.5 font-mono text-xs",
                    note.confidence < 0.5
                      ? "border-ink-line text-ink-mute opacity-60"
                      : "border-amber-gold/30 text-amber-gold",
                  ].join(" ")}
                >
                  {note.name}
                  <span className="ml-1 text-[10px] opacity-60">
                    {note.duration.toFixed(2)}s
                  </span>
                  {note.confidence < 0.5 && (
                    <span className="ml-1 text-[10px] opacity-50">?</span>
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Detailed note table ── */}
        {recState === "results" && notes.length > 0 && (
          <div className="mb-5 overflow-x-auto">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              Detected Notes
            </div>
            <table className="w-full border-collapse font-mono text-xs text-ink-mute">
              <thead>
                <tr className="border-b border-ink-line">
                  <th className="py-1.5 pr-4 text-left font-normal uppercase tracking-wider text-[10px]">
                    Note
                  </th>
                  <th className="py-1.5 pr-4 text-left font-normal uppercase tracking-wider text-[10px]">
                    Start
                  </th>
                  <th className="py-1.5 pr-4 text-left font-normal uppercase tracking-wider text-[10px]">
                    Duration
                  </th>
                  <th className="py-1.5 text-left font-normal uppercase tracking-wider text-[10px]">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {notes.map((note, i) => (
                  <tr
                    key={i}
                    className="border-b border-ink-line/40 last:border-0"
                  >
                    <td
                      className={[
                        "py-1.5 pr-4",
                        note.confidence >= 0.5
                          ? "text-ink-text"
                          : "text-ink-mute",
                      ].join(" ")}
                    >
                      {note.name}
                    </td>
                    <td className="py-1.5 pr-4">{note.startTime.toFixed(2)}s</td>
                    <td className="py-1.5 pr-4">{note.duration.toFixed(2)}s</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-sm bg-ink-line">
                          <div
                            className="h-full bg-amber-gold/60"
                            style={{
                              width: `${Math.round(note.confidence * 100)}%`,
                            }}
                          />
                        </div>
                        <span
                          className={
                            note.confidence < 0.5 ? "text-ink-mute/50" : ""
                          }
                        >
                          {Math.round(note.confidence * 100)}%
                          {note.confidence < 0.5 && (
                            <span className="ml-1 text-[10px] opacity-60">
                              uncertain
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Export row ── */}
        {recState === "results" && notes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={exportJson}
              className="rounded border border-ink-line px-3 py-1.5 font-mono text-xs text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
            >
              Export JSON
            </button>
            <button
              onClick={() => void copyNotes()}
              className="rounded border border-ink-line px-3 py-1.5 font-mono text-xs text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
            >
              Copy note sequence
            </button>
            <button
              onClick={fullReset}
              className="rounded border border-ink-line px-3 py-1.5 font-mono text-xs text-ink-mute transition-colors duration-150 hover:border-ink-text/50 hover:text-ink-text"
            >
              Record again
            </button>
          </div>
        )}

        {/* ── Error state retry ── */}
        {recState === "error" && (
          <button
            onClick={fullReset}
            className="mt-2 rounded border border-ink-line px-3 py-1.5 font-mono text-xs text-ink-mute transition-colors duration-150 hover:border-ink-text/50 hover:text-ink-text"
          >
            Try again
          </button>
        )}

        {/* ── Footer hint ── */}
        <p className="mt-6 font-mono text-[10px] text-ink-mute/50">
          Works best with a clear monophonic vocal line. Max {MAX_DURATION}s recording.
          All processing is client-side.
        </p>
      </div>
    </div>
  );
}
