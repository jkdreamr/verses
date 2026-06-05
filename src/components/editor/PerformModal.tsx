"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { takesStore, newTakeId } from "@/lib/takes";
import type { Take, YoutubeSession } from "@/lib/types";
import { extractYoutubeId } from "@/lib/youtube";

declare global {
  interface Window {
    YT?: {
      Player: new (id: string, opts: Record<string, unknown>) => YouTubePlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YouTubePlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (v: number) => void;
  getVolume: () => number;
  setLoop: (loop: boolean) => void;
  loadVideoById: (id: string) => void;
  destroy: () => void;
  getPlayerState: () => number;
};

let apiLoadPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise<void>((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => resolve();
  });
  return apiLoadPromise;
}
import { useDrumEngine } from "@/hooks/perform/useDrumEngine";
import { usePerformAudioBus } from "@/hooks/perform/usePerformAudioBus";
import {
  NOTE_NAMES,
  INSTRUMENT_PRESETS,
  SLOT_PRESETS,
  chordLabel,
  useChordSynth,
} from "@/hooks/perform/useChordSynth";
import type { ChordQuality, ChordSlot } from "@/hooks/perform/useChordSynth";
import { ensureEngine, resumeEngine } from "@/lib/audio/engine";
import {
  KEY_NAMES,
  SCALES,
  type ScaleId,
  xToScaleMidi,
  midiToFreq,
  midiToLabel,
  keyToPc,
  buildScaleLadder,
  scaleIntervals,
} from "@/lib/audio/scales";
import { OneEuroFilter } from "@/lib/audio/oneEuro";
import { TouchInstrument } from "@/components/perform/TouchInstrument";
import { StepSequencer } from "@/components/perform/StepSequencer";
import { LyricTeleprompter } from "@/components/perform/LyricTeleprompter";
import { Slider } from "@/components/ui/Slider";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSmartLyrics } from "@/hooks/useSmartLyrics";
import { useLiveTrumpet, TRUMPET_PRESETS } from "@/hooks/perform/useLiveTrumpet";
import { useVocalFx } from "@/hooks/perform/useVocalFx";
import { VocalFxRack } from "@/components/perform/VocalFxRack";
import { calibrateNoiseFloor } from "@/lib/audio/calibrate";

// ─── Types ─────────────────────────────────────────────────────────────────

type GestureId = "open" | "pinch" | "two" | "fist" | "point";
type InputMode = "camera" | "touch";
type RightMode = "lead" | "chords";

type Hand = {
  present: boolean;
  x: number; // display space (0 left … 1 right of screen)
  y: number; // 0 top … 1 bottom
  pinch: boolean;
  gesture: GestureId | null;
};

const QUALITIES: ChordQuality[] = ["major","minor","maj7","min7","dom7","sus2","sus4","dim","aug","add9","6","min6"];
const ROOTS = NOTE_NAMES;

const LATCH_HOLD_MS = 380;
const LATCH_COOLDOWN_MS = 750;
// Mode B: hand height spans ± this many semitones of live pitch shift.
const VOCAL_PITCH_RANGE = 12;

/** Snap an integer semitone shift to the nearest in-scale (diatonic) transposition. */
function snapShiftToScale(semis: number, scaleId: ScaleId): number {
  const set = scaleIntervals(scaleId);
  const inScale = (s: number) => set.includes(((s % 12) + 12) % 12);
  if (inScale(semis)) return semis;
  for (let d = 1; d <= 6; d++) {
    if (inScale(semis - d)) return semis - d;
    if (inScale(semis + d)) return semis + d;
  }
  return semis;
}
const PINCH_ON = 0.45; // ratio of pinch distance / palm size
const PINCH_OFF = 0.62;

const AUDIO_MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
const VIDEO_MIME = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
const pickMime = (cands: string[]): string | undefined => {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of cands) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* */ } }
  return undefined;
};

const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dist(a: any, b: any) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function palmSize(lms: any[]) { return Math.max(0.01, dist(lms[0], lms[9])); }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pinchRatio(lms: any[]) { return dist(lms[4], lms[8]) / palmSize(lms); }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectGesture(lms: any[]): GestureId | null {
  const palm = palmSize(lms);
  if (dist(lms[4], lms[8]) < PINCH_ON * palm) return "pinch";
  const ext = (tip: number, mcp: number) => lms[tip].y < lms[mcp].y - 0.04 * palm;
  const idx = ext(8, 5), mid = ext(12, 9), ring = ext(16, 13), pinky = ext(20, 17);
  const count = [idx, mid, ring, pinky].filter(Boolean).length;
  if (count === 0) return "fist";
  if (count === 1 && idx) return "point";
  if (count === 2 && idx && mid) return "two";
  if (count >= 4) return "open";
  return null;
}

// ─── Chord-zone grid overlay (live only — never on the capture canvas) ────────

function drawChordGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  labels: string[],
  activeIdx: number,
  rh: Hand | null,
  reducedMotion: boolean,
  now: number,
) {
  ctx.clearRect(0, 0, w, h);
  const n = labels.length;
  if (n === 0) return;
  const bw = w / n;

  // active-zone fill (gentle pulse, unless reduced motion)
  if (activeIdx >= 0) {
    const pulse = reducedMotion ? 0.18 : 0.13 + 0.06 * (0.5 + 0.5 * Math.sin(now / 240));
    ctx.fillStyle = `rgba(201,168,76,${pulse})`;
    ctx.fillRect(activeIdx * bw, 0, bw, h);
  }

  // dividers
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 1;
  for (let i = 1; i < n; i++) {
    ctx.beginPath();
    ctx.moveTo(i * bw, 0);
    ctx.lineTo(i * bw, h);
    ctx.stroke();
  }

  // labels — show all when there's room, else thin out (always show active)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelEvery = n <= 12 ? 1 : Math.ceil(n / 9);
  for (let i = 0; i < n; i++) {
    const isActive = i === activeIdx;
    if (!isActive && i % labelEvery !== 0) continue;
    const x = i * bw + bw / 2;
    ctx.font = isActive ? "600 16px Inter, system-ui, sans-serif" : "12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText(labels[i], x + 1, 9);
    ctx.fillStyle = isActive ? "rgba(201,168,76,1)" : "rgba(255,255,255,0.72)";
    ctx.fillText(labels[i], x, 8);
  }

  // Y expression hint
  ctx.textAlign = "right";
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillText("brighter ↑", w - 8, 8);
  ctx.fillText("mellow ↓", w - 8, h - 18);

  // right-hand indicator (positioned in canvas space so it tracks the camera)
  if (rh && rh.present) {
    const cx = rh.x * w;
    const cy = rh.y * h;
    const r = Math.max(26, w * 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.lineWidth = 3;
    ctx.strokeStyle = rh.pinch ? "rgba(201,168,76,1)" : "rgba(201,168,76,0.55)";
    ctx.fillStyle = rh.pinch ? "rgba(201,168,76,0.28)" : "rgba(201,168,76,0.08)";
    ctx.fill();
    ctx.stroke();
    if (activeIdx >= 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 15px Inter, system-ui, sans-serif";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(labels[activeIdx], cx + 1, cy + 1);
      ctx.fillStyle = "rgba(201,168,76,1)";
      ctx.fillText(labels[activeIdx], cx, cy);
    }
  }
}

// ─── Pitch-ladder overlay for Mode B (live only — never recorded) ─────────────
function drawPitchLadder(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  semis: number, range: number,
  scaleId: ScaleId, keyLock: boolean,
  rh: Hand | null,
) {
  ctx.clearRect(0, 0, w, h);
  const set = scaleIntervals(scaleId);
  const inScale = (s: number) => set.includes(((s % 12) + 12) % 12);
  const yFor = (s: number) => h * (1 - (s + range) / (2 * range));

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (let s = -range; s <= range; s++) {
    if (keyLock && !inScale(s) && s !== 0) continue;
    const y = yFor(s);
    ctx.strokeStyle = s === 0 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.09)";
    ctx.lineWidth = s === 0 ? 1.5 : 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.font = "11px ui-monospace, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillText(s === 0 ? "0" : s > 0 ? `+${s}` : `${s}`, 8, y - 3);
  }

  // active shift band + line
  const ay = yFor(Math.max(-range, Math.min(range, semis)));
  ctx.fillStyle = "rgba(201,168,76,0.16)";
  ctx.fillRect(0, ay - 11, w, 22);
  ctx.strokeStyle = "rgba(201,168,76,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, ay); ctx.lineTo(w, ay); ctx.stroke();
  ctx.textAlign = "right";
  ctx.font = "600 14px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(201,168,76,1)";
  ctx.fillText(`${semis > 0 ? "+" : ""}${semis % 1 === 0 ? semis : semis.toFixed(1)} st`, w - 10, ay - 6);

  // hand marker
  if (rh && rh.present) {
    const cx = rh.x * w;
    ctx.beginPath();
    ctx.arc(cx, ay, Math.max(18, w * 0.035), 0, 2 * Math.PI);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(201,168,76,0.85)";
    ctx.fillStyle = "rgba(201,168,76,0.18)";
    ctx.fill();
    ctx.stroke();
  }

  ctx.textAlign = "right";
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.32)";
  ctx.fillText("raise hand ↑", w - 10, 16);
  ctx.fillText("lower hand ↓", w - 10, h - 12);
}

// ─── Piano display (chord tones) ─────────────────────────────────────────────

function PianoKeyboard({
  activeNotes,
  onNoteOn,
  onNoteOff,
  octave = 4,
}: {
  activeNotes: number[];
  onNoteOn?: (midi: number) => void;
  onNoteOff?: (midi: number) => void;
  octave?: number;
}) {
  const whiteKeys = ["C", "D", "E", "F", "G", "A", "B"];
  const blackKeys = ["C#", "D#", null, "F#", "G#", "A#"];
  const isActive = (note: string | null) => !!note && activeNotes.some((n) => NOTE_NAMES[n % 12] === note);

  // Convert note name to MIDI number for the current octave
  // Handle both sharp (#) and flat (b) notation
  const noteToMidi = (note: string) => {
    // Normalize flats to sharps for consistent MIDI mapping
    const normalized = note
      .replace("Db", "C#")
      .replace("Eb", "D#")
      .replace("Gb", "F#")
      .replace("Ab", "G#")
      .replace("Bb", "A#");
    const noteIndex = NOTE_NAMES.indexOf(normalized);
    if (noteIndex === -1) return null;
    return octave * 12 + noteIndex;
  };

  const [pressedNotes, setPressedNotes] = useState<Set<number>>(new Set());

  const handleNoteDown = (midi: number) => {
    if (!pressedNotes.has(midi)) {
      setPressedNotes(prev => new Set([...prev, midi]));
      onNoteOn?.(midi);
    }
  };

  const handleNoteUp = (midi: number) => {
    if (pressedNotes.has(midi)) {
      setPressedNotes(prev => {
        const next = new Set(prev);
        next.delete(midi);
        return next;
      });
      onNoteOff?.(midi);
    }
  };

  const isPressed = (note: string | null) => {
    const midi = note ? noteToMidi(note) : null;
    return midi !== null && pressedNotes.has(midi);
  };

  return (
    <div className="relative h-14 w-full overflow-hidden rounded-lg border border-line/60 select-none">
      {/* White keys */}
      <div className="absolute inset-0 flex gap-px bg-line/40">
        {whiteKeys.map((note) => {
          const midi = noteToMidi(note);
          const active = isActive(note) || isPressed(note);
          return (
            <div
              key={note}
              className={`flex flex-1 items-end justify-center pb-1 transition-colors duration-75 cursor-pointer ${
                active ? "bg-accent/40" : "bg-[#f5f3ef] hover:bg-[#ebe8e3]"
              }`}
              onPointerDown={() => midi && handleNoteDown(midi)}
              onPointerUp={() => midi && handleNoteUp(midi)}
              onPointerLeave={() => midi && handleNoteUp(midi)}
              onPointerCancel={() => midi && handleNoteUp(midi)}
            >
              <span className={`font-mono text-[7px] select-none ${active ? "text-amber-700" : "text-neutral-400"}`}>{note}</span>
            </div>
          );
        })}
      </div>
      {/* Black keys */}
      <div className="absolute inset-x-0 top-0 flex px-[7%] pointer-events-none z-10">
        {blackKeys.map((note, i) => {
          const midi = note ? noteToMidi(note) : null;
          const active = isActive(note) || isPressed(note);
          return (
            <div key={i} className="relative flex-1 pointer-events-auto">
              {note && (
                <div
                  className={`absolute left-1/2 top-0 h-9 w-[65%] -translate-x-1/2 rounded-b shadow-md transition-colors duration-75 cursor-pointer ${
                    active ? "bg-accent/80" : "bg-[#1a1a1a] hover:bg-[#333333]"
                  }`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (midi) handleNoteDown(midi);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    if (midi) handleNoteUp(midi);
                  }}
                  onPointerLeave={(e) => {
                    e.stopPropagation();
                    if (midi) handleNoteUp(midi);
                  }}
                  onPointerCancel={(e) => {
                    e.stopPropagation();
                    if (midi) handleNoteUp(midi);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function PerformModal({
  open,
  onClose,
  songId,
  lyrics,
  youtube,
  onYoutubeChange,
  onTakeSaved,
}: {
  open: boolean;
  onClose: () => void;
  songId: string;
  lyrics?: string;
  youtube?: YoutubeSession | null;
  onYoutubeChange?: (s: YoutubeSession | null) => void;
  onTakeSaved: () => void;
}) {
  const isMobile = useIsMobile();
  
  const fmtTime = (s: number) => {
    const rounded = Math.round(s);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  };

  // ── Camera / MediaPipe refs ──
  const videoRef = useRef<HTMLVideoElement>(null);
  // captureCanvas = the RECORDED layer (camera + skeleton + note flashes).
  // gridCanvas    = the LIVE-ONLY chord-zone overlay (never captured).
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const flashRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handLandmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const camStreamRef = useRef<MediaStream | null>(null);
  // Mic for capturing the singer's voice into the recording (+ trumpet later).
  const micStreamRef = useRef<MediaStream | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micRecGainRef = useRef<GainNode | null>(null);
  // Raw mic stream for photobooth mode (bypasses Web Audio entirely)
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  
  // ── YouTube player for beat playback in Perform ──
  const ytPlayerRef = useRef<YouTubePlayer | null>(null);
  const ytContainerId = useRef(`yt-perf-${Math.random().toString(36).slice(2, 8)}`);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [ytReady, setYtReady] = useState(false);
  const [ytTime, setYtTime] = useState(0);
  const [ytDuration, setYtDuration] = useState(0);
  const [ytVolume, setYtVolume] = useState(60);
  const [ytLoopOn, setYtLoopOn] = useState(false);
  const [ytDraftLabel, setYtDraftLabel] = useState<{ time: number; label: string } | null>(null);
  
  const ytMarkers = useMemo(() => [...(youtube?.markers ?? [])].sort((a, b) => a.time - b.time), [youtube?.markers]);
  const ytLoopStart = youtube?.loop_start ?? null;
  const ytLoopEnd = youtube?.loop_end ?? null;
  const ytHasLoopRange = ytLoopStart !== null && ytLoopEnd !== null && typeof ytLoopStart === "number" && typeof ytLoopEnd === "number" && ytLoopEnd > ytLoopStart;
  
  // Load YouTube player when youtube session is available
  useEffect(() => {
    if (!youtube || !youtube.youtube_url) return;
    const videoId = extractYoutubeId(youtube.youtube_url);
    if (!videoId) return;
    
    const loadPlayer = async () => {
      await loadYouTubeApi();
      if (!window.YT) return;
      
      const player = new window.YT.Player(ytContainerId.current, {
        height: 0,
        width: 0,
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => {
            setYtReady(true);
            ytPlayerRef.current = player;
            player.setVolume(ytVolume);
            setYtDuration(player.getDuration());
          },
          onStateChange: (e: { data: number }) => {
            if (window.YT) {
              if (e.data === window.YT.PlayerState.PLAYING) setYtPlaying(true);
              else if (e.data === window.YT.PlayerState.PAUSED || e.data === window.YT.PlayerState.ENDED) setYtPlaying(false);
              if (e.data === window.YT.PlayerState.ENDED && ytLoopOn) {
                const start = ytLoopStart ?? 0;
                player.seekTo(start, true);
                player.playVideo();
              }
            }
          },
        },
      });
    };
    
    loadPlayer();
    
    return () => {
      ytPlayerRef.current?.destroy();
      ytPlayerRef.current = null;
      setYtReady(false);
      setYtPlaying(false);
    };
  }, [youtube, ytVolume, ytLoopOn, ytLoopStart]);
  
  // Poll time and handle loop
  useEffect(() => {
    if (!ytReady) return;
    const interval = setInterval(() => {
      const p = ytPlayerRef.current;
      if (!p) return;
      try {
        const now = p.getCurrentTime();
        setYtTime(now);
        const d = p.getDuration();
        if (d && d !== ytDuration) setYtDuration(d);
        if (ytLoopOn && ytHasLoopRange) {
          if (now >= (ytLoopEnd as number) - 0.05) {
            p.seekTo(ytLoopStart as number, true);
          }
        }
      } catch {
        // player not ready
      }
    }, 250);
    return () => clearInterval(interval);
  }, [ytReady, ytLoopOn, ytHasLoopRange, ytLoopStart, ytLoopEnd, ytDuration]);
  
  const toggleYtPlayback = useCallback(() => {
    if (!ytPlayerRef.current || !ytReady) return;
    if (ytPlaying) {
      ytPlayerRef.current.pauseVideo();
    } else {
      ytPlayerRef.current.playVideo();
    }
  }, [ytPlaying, ytReady]);
  
  const ytSeek = useCallback((time: number) => {
    if (!ytPlayerRef.current || !ytReady) return;
    ytPlayerRef.current.seekTo(time, true);
  }, [ytReady]);
  
  const ytSetVolume = useCallback((vol: number) => {
    if (!ytPlayerRef.current || !ytReady) return;
    ytPlayerRef.current.setVolume(vol);
    setYtVolume(vol);
  }, [ytReady]);
  
  const ytBeginAddMarker = useCallback(() => {
    if (!ytPlayerRef.current || !ytReady) return;
    const time = ytPlayerRef.current.getCurrentTime();
    setYtDraftLabel({ time, label: "" });
  }, [ytReady]);
  
  const ytCommitMarker = useCallback(() => {
    if (!ytDraftLabel || !youtube || !onYoutubeChange) return;
    const newMarker = {
      id: `marker-${Date.now()}`,
      time: ytDraftLabel.time,
      label: ytDraftLabel.label || `mark ${fmtTime(ytDraftLabel.time)}`,
    };
    const next: YoutubeSession = {
      ...youtube,
      markers: [...(youtube.markers ?? []), newMarker],
    };
    onYoutubeChange(next);
    setYtDraftLabel(null);
  }, [ytDraftLabel, youtube, onYoutubeChange]);
  
  const ytCancelMarker = useCallback(() => {
    setYtDraftLabel(null);
  }, []);
  
  const ytRemoveMarker = useCallback((id: string) => {
    if (!youtube || !onYoutubeChange) return;
    const next: YoutubeSession = {
      ...youtube,
      markers: (youtube.markers ?? []).filter((m) => m.id !== id),
    };
    onYoutubeChange(next);
  }, [youtube, onYoutubeChange]);
  
  const ytSetLoopPoint = useCallback((which: "A" | "B", time: number) => {
    if (!youtube || !onYoutubeChange) return;
    const next: YoutubeSession = {
      ...youtube,
      loop_start: which === "A" ? time : youtube.loop_start ?? null,
      loop_end: which === "B" ? time : youtube.loop_end ?? null,
    };
    onYoutubeChange(next);
  }, [youtube, onYoutubeChange]);
  
  const ytClearLoop = useCallback(() => {
    if (!youtube || !onYoutubeChange) return;
    onYoutubeChange({ ...youtube, loop_start: null, loop_end: null });
    setYtLoopOn(false);
  }, [youtube, onYoutubeChange]);
  
  const ytLoopLabel = ytHasLoopRange ? `loop ${fmtTime(ytLoopStart as number)}↔${fmtTime(ytLoopEnd as number)}` : "loop";
  
  const rightHandRef = useRef<Hand>({ present: false, x: 0.5, y: 0.5, pinch: false, gesture: null });
  const showGridRef = useRef(true);
  const reducedMotionRef = useRef(false);
  const zonesRef = useRef<string[]>([]);

  // ── Lead synth (right-hand theremin voice) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadSynthRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadFilterRef = useRef<any>(null);
  const leadReadyRef = useRef(false);
  const rightSoundingRef = useRef(false);
  const rightSlotRef = useRef<number | null>(null);
  const rxFilterRef = useRef(new OneEuroFilter({ minCutoff: 1.4, beta: 0.03 }));
  const ryFilterRef = useRef(new OneEuroFilter({ minCutoff: 1.4, beta: 0.03 }));
  const rightPinchRef = useRef(false);

  // ── Piano click synth (for clickable piano keyboard) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pianoSynthRef = useRef<any>(null);
  const pianoReadyRef = useRef(false);
  const activePianoNotesRef = useRef<Set<number>>(new Set());

  // ── Left-hand transport latch ──
  const beatLatchRef = useRef<"stopped" | "playing" | "muted">("stopped");
  const leftTimerRef = useRef<{ gesture: GestureId | null; startMs: number }>({ gesture: null, startMs: 0 });
  const leftCooldownRef = useRef(0);

  // ── Recording ──
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recStartRef = useRef(0);

  // ── State ──
  const [inputMode, setInputMode] = useState<InputMode>("camera");
  const [rightMode, setRightMode] = useState<RightMode>("chords");
  const [camActive, setCamActive] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [rootKey, setRootKey] = useState("C");
  const [scaleId, setScaleId] = useState<ScaleId>("majorPentatonic");
  const [chordSlots, setChordSlots] = useState<ChordSlot[]>(SLOT_PRESETS["Pop"]);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [leadNote, setLeadNote] = useState<string>("—");
  const [masterVol, setMasterVol] = useState(0.85);
  const [drumVol, setDrumVol] = useState(0.75);
  const [chordVol, setChordVol] = useState(0.8);
  const [leftHand, setLeftHand] = useState<Hand>({ present: false, x: 0.5, y: 0.5, pinch: false, gesture: null });
  const [rightHand, setRightHand] = useState<Hand>({ present: false, x: 0.5, y: 0.5, pinch: false, gesture: null });
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [swapHands, setSwapHands] = useState(false);
  const [tab, setTab] = useState<"beat" | "sound" | "chords" | "guide" | "voice">("beat");
  const [beatPlaying, setBeatPlaying] = useState(false);

  // ── Smart Lyric Reader (strict line-by-line teleprompter in the stage) ──
  const smart = useSmartLyrics(lyrics ?? "");
  const { start: smartStart, stop: smartStop } = smart;
  const [showLyrics, setShowLyrics] = useState(false);
  const toggleLyrics = useCallback(() => {
    if (showLyrics) { smartStop(); setShowLyrics(false); }
    else { smartStart(); setShowLyrics(true); }
  }, [showLyrics, smartStart, smartStop]);

  // ── Voice → Trumpet (shares the recording mic) ──
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const [trumpetOn, setTrumpetOn] = useState(false);
  const [trumpetPresetName, setTrumpetPresetName] = useState("Trumpet");
  const trumpetOnRef = useRef(false);
  useEffect(() => { trumpetOnRef.current = trumpetOn; }, [trumpetOn]);
  const trumpet = useLiveTrumpet({ micStream, enabled: trumpetOn });

  // ── Performance mode: Chords & Drums (A) vs Vocal FX (B) vs Photobooth (C) ──
  const [perfMode, setPerfMode] = useState<"chords" | "vocal" | "photobooth">("chords");
  const [recordMode, setRecordMode] = useState<"processed" | "raw">("processed");
  const perfModeRef = useRef(perfMode);
  const recordModeRef = useRef(recordMode);
  useEffect(() => { perfModeRef.current = perfMode; }, [perfMode]);
  useEffect(() => { recordModeRef.current = recordMode; }, [recordMode]);
  const dryMonitorRef = useRef<GainNode | null>(null);
  // Vocal FX runs the processed voice through the chain; "raw" mode bypasses it.
  // Photobooth mode always uses raw voice (no processing).
  const vfx = useVocalFx({ micStream, enabled: perfMode === "vocal" && recordMode === "processed" });
  const livePitchRef = useRef(0);
  const [liveShift, setLiveShift] = useState(0); // throttled HUD copy of livePitchRef
  const [vocalKeyLock, setVocalKeyLock] = useState(true);
  const vocalKeyLockRef = useRef(true);
  useEffect(() => { vocalKeyLockRef.current = vocalKeyLock; }, [vocalKeyLock]);
  const pitchEuroRef = useRef(new OneEuroFilter({ minCutoff: 1.2, beta: 0.02 }));
  const vfxActiveRef = useRef(false);
  const [touchBend, setTouchBend] = useState(0); // touch pitch-bend in Mode B
  // Left-hand live effects (Mode B): wash / harmony throw / kill.
  type LiveFx = { present: boolean; space: number; harmony: boolean; bypass: boolean };
  const leftFxRef = useRef<LiveFx>({ present: false, space: 0, harmony: false, bypass: false });
  const leftFxActiveRef = useRef(false);
  const [liveFxHud, setLiveFxHud] = useState<LiveFx>({ present: false, space: 0, harmony: false, bypass: false });

  // ── Mic calibration (noise floor → gates note-on for trumpet + Vocal FX) ──
  const [calibrating, setCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(false);

  // Zone labels for the live chord/note grid — derived from the REAL X→action
  // mapping so the guide is truthful (chord mode: progression slots; lead mode:
  // the in-key scale ladder).
  const gridZones = useMemo<string[]>(() => {
    if (rightMode === "chords") return chordSlots.map((s) => chordLabel(s.root, s.quality));
    return buildScaleLadder(keyToPc(rootKey), scaleId, 48, 84).map(midiToLabel);
  }, [rightMode, chordSlots, rootKey, scaleId]);
  useEffect(() => { zonesRef.current = gridZones; }, [gridZones]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const swapRef = useRef(swapHands);
  useEffect(() => { swapRef.current = swapHands; }, [swapHands]);
  const rightModeRef = useRef(rightMode);
  useEffect(() => { rightModeRef.current = rightMode; }, [rightMode]);
  const rootKeyRef = useRef(rootKey);
  useEffect(() => { rootKeyRef.current = rootKey; }, [rootKey]);
  const scaleRef = useRef(scaleId);
  useEffect(() => { scaleRef.current = scaleId; }, [scaleId]);
  const chordSlotsRef = useRef(chordSlots);
  useEffect(() => { chordSlotsRef.current = chordSlots; }, [chordSlots]);

  // ── Hooks ──
  const audioBus = usePerformAudioBus();
  const bus = audioBus.bus;
  const drum = useDrumEngine(bus?.drumGain ?? null);
  const chord = useChordSynth();
  const ensureAudioBus = audioBus.ensureBus;
  const resumeAudioBus = audioBus.resume;
  const busSetMaster = audioBus.setMasterGain;
  const busSetDrum = audioBus.setDrumGain;
  const busSetChord = audioBus.setChordGain;
  const suspendBus = audioBus.suspend;
  const releaseChord = chord.releaseChord;
  const playChord = chord.playChord;
  const stopDrums = drum.stop;
  const playDrumsFn = drum.play;

  // Persist overlay prefs
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sk = localStorage.getItem("verses:showSkeleton");
    if (sk !== null) setShowSkeleton(sk === "true");
    const sw = localStorage.getItem("verses:swapHands");
    if (sw !== null) setSwapHands(sw === "true");
    const sg = localStorage.getItem("verses:showChordGrid");
    if (sg !== null) setShowGrid(sg === "true");
  }, []);
  useEffect(() => { localStorage.setItem("verses:showSkeleton", String(showSkeleton)); }, [showSkeleton]);
  useEffect(() => { localStorage.setItem("verses:swapHands", String(swapHands)); }, [swapHands]);
  useEffect(() => { localStorage.setItem("verses:showChordGrid", String(showGrid)); }, [showGrid]);

  // Pick default input mode based on device
  useEffect(() => {
    if (!open) return;
    setInputMode(isMobile ? "touch" : "camera");
  }, [open, isMobile]);

  // Ensure engine + sync slider gains when open
  useEffect(() => {
    if (!open) return;
    ensureAudioBus();
    void resumeAudioBus();
  }, [open, ensureAudioBus, resumeAudioBus]);
  useEffect(() => { busSetMaster(masterVol); }, [masterVol, busSetMaster, bus]);
  useEffect(() => { busSetDrum(drumVol); }, [drumVol, busSetDrum, bus]);
  useEffect(() => { busSetChord(chordVol); }, [chordVol, busSetChord, bus]);

  // ── Lead synth setup ──
  const ensureLead = useCallback(async () => {
    if (leadReadyRef.current) return;
    const engine = ensureEngine();
    await resumeEngine();
    const Tone = await engine.loadTone();
    if (!leadFilterRef.current) {
      const filter = new Tone.Filter({ type: "lowpass", frequency: 2600, Q: 0.8 });
      const vibrato = new Tone.Vibrato({ frequency: 5.2, depth: 0.08 });
      const synth = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.015, decay: 0.2, sustain: 0.8, release: 0.4 },
        portamento: 0.06,
      });
      synth.connect(vibrato);
      vibrato.connect(filter);
      filter.connect(engine.padBus);
      leadSynthRef.current = synth;
      leadFilterRef.current = filter;
    }
    leadReadyRef.current = true;
  }, []);

  // ── Piano click synth setup ──
  const ensurePianoSynth = useCallback(async () => {
    if (pianoReadyRef.current) return;
    const engine = ensureEngine();
    await resumeEngine();
    const Tone = await engine.loadTone();
    if (!pianoSynthRef.current) {
      const synth = new Tone.PolySynth(Tone.Synth);
      synth.set({
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.2 },
      });
      synth.maxPolyphony = 8;
      // Add a bit of reverb for piano-like sound
      const reverb = new Tone.Reverb({ decay: 1.5, wet: 0.3 });
      synth.connect(reverb);
      reverb.connect(engine.master);
      pianoSynthRef.current = synth;
    }
    pianoReadyRef.current = true;
  }, []);

  const playPianoNote = useCallback(async (midi: number) => {
    await ensurePianoSynth();
    if (!activePianoNotesRef.current.has(midi)) {
      activePianoNotesRef.current.add(midi);
      pianoSynthRef.current?.triggerAttack(midiToFreq(midi));
    }
  }, [ensurePianoSynth]);

  const releasePianoNote = useCallback((midi: number) => {
    if (activePianoNotesRef.current.has(midi)) {
      activePianoNotesRef.current.delete(midi);
      pianoSynthRef.current?.triggerRelease(midiToFreq(midi));
    }
  }, []);

  // ── Right-hand instrument logic ──
  const handleRight = useCallback((hand: Hand) => {
    const sounding = rightSoundingRef.current;
    if (rightModeRef.current === "lead") {
      const midi = xToScaleMidi(hand.x, keyToPc(rootKeyRef.current), scaleRef.current);
      setLeadNote(midiToLabel(midi));
      const expr = 1 - hand.y;
      const cutoff = 350 + expr * expr * 5200;
      const synth = leadSynthRef.current;
      const filter = leadFilterRef.current;
      if (hand.pinch && hand.present) {
        if (!sounding) {
          flashRef.current = performance.now();
          void ensureLead().then(() => {
            leadSynthRef.current?.triggerAttack(midiToFreq(midi), undefined, 0.4 + expr * 0.55);
          });
          rightSoundingRef.current = true;
        } else if (synth) {
          synth.frequency.rampTo(midiToFreq(midi), 0.07);
        }
        filter?.frequency.rampTo(cutoff, 0.05);
      } else if (sounding) {
        synth?.triggerRelease();
        rightSoundingRef.current = false;
      }
    } else {
      // Chord mode: X selects among the 8 progression slots; pinch strikes.
      const slots = chordSlotsRef.current;
      const idx = Math.min(slots.length - 1, Math.floor(hand.x * slots.length));
      const slot = slots[idx];
      setLeadNote(slot ? chordLabel(slot.root, slot.quality) : "—");
      if (hand.pinch && hand.present) {
        if (!sounding || rightSlotRef.current !== slot.slot) {
          flashRef.current = performance.now();
          playChord(slot);
          setActiveSlot(slot.slot);
          rightSlotRef.current = slot.slot;
          rightSoundingRef.current = true;
        }
      } else if (sounding) {
        releaseChord();
        setActiveSlot(null);
        rightSlotRef.current = null;
        rightSoundingRef.current = false;
      }
    }
  }, [ensureLead, playChord, releaseChord]);

  // ── Left-hand transport (latched) ──
  const handleLeft = useCallback((hand: Hand) => {
    if (!hand.present || !hand.gesture) {
      leftTimerRef.current = { gesture: null, startMs: 0 };
      return;
    }
    const g = hand.gesture;
    // Require the gesture to settle briefly (debounce flicker through transitions).
    if (g !== leftTimerRef.current.gesture) {
      leftTimerRef.current = { gesture: g, startMs: Date.now() };
      return;
    }
    if (Date.now() - leftTimerRef.current.startMs < LATCH_HOLD_MS) return;

    // Open palm and fist are IDEMPOTENT state transitions (no cooldown), so
    // fist → open → fist reliably stops and restarts the beat every time.
    if (g === "open") {
      if (beatLatchRef.current !== "playing") {
        playDrumsFn();
        beatLatchRef.current = "playing";
        setBeatPlaying(true);
      }
    } else if (g === "fist") {
      if (beatLatchRef.current !== "stopped") {
        stopDrums();
        beatLatchRef.current = "stopped";
        setBeatPlaying(false);
      }
    } else if (g === "pinch") {
      // Mute is a toggle on a sustained gesture, so it keeps a cooldown.
      if (Date.now() - leftCooldownRef.current > LATCH_COOLDOWN_MS) {
        if (beatLatchRef.current === "muted") { beatLatchRef.current = "playing"; busSetDrum(drumVol); }
        else if (beatLatchRef.current === "playing") { beatLatchRef.current = "muted"; busSetDrum(0); }
        leftCooldownRef.current = Date.now();
      }
    }
  }, [busSetDrum, drumVol, playDrumsFn, stopDrums]);

  // ── Mode B: right hand bends pitch, left hand performs the effects ──
  const { setManualPitch: vfxSetPitch, setManualActive: vfxSetActive, setLiveFx: vfxSetLiveFx } = vfx;
  const handleVocalHands = useCallback((right: Hand, left: Hand) => {
    // RIGHT → pitch (raise = up an octave, middle = unison, lower = down)
    if (!right.present) {
      if (vfxActiveRef.current) { vfxSetActive(false); vfxActiveRef.current = false; }
      pitchEuroRef.current.reset();
      livePitchRef.current = 0;
    } else {
      if (!vfxActiveRef.current) { vfxSetActive(true); vfxActiveRef.current = true; }
      const raw = (0.5 - right.y) * 2 * VOCAL_PITCH_RANGE;
      let semis = pitchEuroRef.current.filter(raw, performance.now());
      if (vocalKeyLockRef.current) semis = snapShiftToScale(Math.round(semis), scaleRef.current);
      livePitchRef.current = semis;
      vfxSetPitch(semis);
    }

    // LEFT → effects: height = wash, pinch = harmony throw, fist = kill (dry)
    if (left.present) {
      const bypass = left.gesture === "fist";
      const harmony = left.gesture === "pinch";
      const space = bypass ? 0 : Math.max(0, Math.min(1, 1 - left.y));
      vfxSetLiveFx({ space, harmony, bypass });
      leftFxRef.current = { present: true, space, harmony, bypass };
      leftFxActiveRef.current = true;
    } else if (leftFxActiveRef.current) {
      vfxSetLiveFx(null);
      leftFxActiveRef.current = false;
      leftFxRef.current = { present: false, space: 0, harmony: false, bypass: false };
    }
  }, [vfxSetActive, vfxSetPitch, vfxSetLiveFx]);

  // If the camera stops mid-performance the loop can't release the hand state, so
  // restore the base mix / pitch here.
  useEffect(() => {
    if (perfMode === "vocal" && !camActive) {
      if (leftFxActiveRef.current) { vfxSetLiveFx(null); leftFxActiveRef.current = false; leftFxRef.current = { present: false, space: 0, harmony: false, bypass: false }; }
      if (vfxActiveRef.current) { vfxSetActive(false); vfxActiveRef.current = false; livePitchRef.current = 0; }
    }
  }, [perfMode, camActive, vfxSetActive, vfxSetLiveFx]);

  // ── MediaPipe loader ──
  const loadMediaPipe = useCallback(async () => {
    if (handLandmarkerRef.current) return;
    setMpLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vision = await import("@mediapipe/tasks-vision" as any);
      const { HandLandmarker, FilesetResolver } = vision;
      const resolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
      );
      handLandmarkerRef.current = await HandLandmarker.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
    } catch (err) {
      console.warn("MediaPipe load failed:", err);
      setCamError("Could not load hand tracking. Use the Touch pad instead.");
    } finally {
      setMpLoading(false);
    }
  }, []);

  // ── Process landmarks → hands ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processHands = useCallback((landmarks: any[][], handedness: any[][]) => {
    let nl: Hand = { present: false, x: 0.5, y: 0.5, pinch: false, gesture: null };
    let nr: Hand = { present: false, x: 0.5, y: 0.5, pinch: false, gesture: null };
    const now = performance.now();

    for (let i = 0; i < landmarks.length; i++) {
      const lms = landmarks[i];
      let isRight = (handedness[i]?.[0]?.categoryName ?? "Right") === "Left"; // MediaPipe mirrors
      if (swapRef.current) isRight = !isRight;
      const wrist = lms[0];
      const displayX = 1 - wrist.x;
      const ratio = pinchRatio(lms);
      const gesture = detectGesture(lms);

      if (isRight) {
        const sx = rxFilterRef.current.filter(displayX, now);
        const sy = ryFilterRef.current.filter(wrist.y, now);
        // pinch hysteresis
        const wasPinch = rightPinchRef.current;
        const pinch = wasPinch ? ratio < PINCH_OFF : ratio < PINCH_ON;
        rightPinchRef.current = pinch;
        nr = { present: true, x: sx, y: sy, pinch, gesture };
      } else {
        nl = { present: true, x: displayX, y: wrist.y, pinch: ratio < PINCH_ON, gesture };
      }
    }

    if (!nr.present) {
      rxFilterRef.current.reset();
      ryFilterRef.current.reset();
      if (rightSoundingRef.current) {
        leadSynthRef.current?.triggerRelease();
        releaseChord();
        rightSoundingRef.current = false;
        rightSlotRef.current = null;
        setActiveSlot(null);
      }
    }

    rightHandRef.current = nr;
    setLeftHand(nl);
    setRightHand(nr);
    if (perfModeRef.current === "chords") {
      handleRight(nr);
      handleLeft(nl);
    } else if (perfModeRef.current === "vocal") {
      handleVocalHands(nr, nl);
    }
    // photobooth mode: no hand tracking, just raw voice + video
  }, [handleLeft, handleRight, handleVocalHands, releaseChord]);

  // ── Detection + draw loop ──
  const loop = useCallback(() => {
    const video = videoRef.current;
    const cap = captureCanvasRef.current;
    if (!video || !cap || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    const cw = video.videoWidth || 640;
    const ch = video.videoHeight || 480;
    if (cap.width !== cw) cap.width = cw;
    if (cap.height !== ch) cap.height = ch;
    const cctx = cap.getContext("2d");
    if (!cctx) { rafRef.current = requestAnimationFrame(loop); return; }

    // 1) The mirrored camera frame — this IS the recorded picture.
    cctx.save();
    cctx.translate(cw, 0);
    cctx.scale(-1, 1);
    cctx.drawImage(video, 0, 0, cw, ch);
    cctx.restore();

    const now = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let landmarks: any[][] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let handedness: any[][] = [];
    if (handLandmarkerRef.current && now - lastFrameRef.current > 33) {
      lastFrameRef.current = now;
      try {
        const res = handLandmarkerRef.current.detectForVideo(video, now);
        landmarks = res.landmarks ?? [];
        handedness = res.handedness ?? [];
        processHands(landmarks, handedness);
      } catch { /* per-frame errors ignored */ }
    }

    // 2) Skeleton — drawn in display space (1 − x) to match the mirrored frame.
    //    Part of the performance, so it stays on the capture canvas.
    //    Photobooth mode: no skeleton overlay (raw video only)
    if (showSkeleton && landmarks.length && perfModeRef.current !== "photobooth") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      landmarks.forEach((lms: any[], i: number) => {
        const isRight = (handedness[i]?.[0]?.categoryName ?? "Right") === "Left";
        cctx.strokeStyle = isRight ? "rgba(201,168,76,0.9)" : "rgba(122,162,247,0.9)";
        cctx.lineWidth = 2;
        for (const [a, b] of HAND_CONNECTIONS) {
          cctx.beginPath();
          cctx.moveTo((1 - lms[a].x) * cw, lms[a].y * ch);
          cctx.lineTo((1 - lms[b].x) * cw, lms[b].y * ch);
          cctx.stroke();
        }
        cctx.fillStyle = isRight ? "rgba(201,168,76,0.95)" : "rgba(122,162,247,0.95)";
        for (const lm of lms) {
          cctx.beginPath();
          cctx.arc((1 - lm.x) * cw, lm.y * ch, 3, 0, 2 * Math.PI);
          cctx.fill();
        }
      });
    }

    // 3) Note-trigger flash — a recorded performance visual.
    const dt = now - flashRef.current;
    if (dt >= 0 && dt < 200) {
      cctx.strokeStyle = `rgba(201,168,76,${(1 - dt / 200) * 0.55})`;
      cctx.lineWidth = 12;
      cctx.strokeRect(6, 6, cw - 12, ch - 12);
    }

    // 4) Chord-zone GRID — a SEPARATE canvas that is NEVER drawn onto the capture
    //    canvas, so the guide shows live but can never appear in a recording.
    const grid = gridCanvasRef.current;
    if (grid) {
      if (grid.width !== cw) grid.width = cw;
      if (grid.height !== ch) grid.height = ch;
      const gctx = grid.getContext("2d");
      if (gctx) {
        if (showGridRef.current && perfModeRef.current === "chords") {
          const labels = zonesRef.current;
          const rh = rightHandRef.current;
          const activeIdx = rh.present && labels.length
            ? Math.min(labels.length - 1, Math.max(0, Math.floor(rh.x * labels.length)))
            : -1;
          drawChordGrid(gctx, cw, ch, labels, activeIdx, rh, reducedMotionRef.current, now);
        } else if (showGridRef.current && perfModeRef.current === "vocal") {
          drawPitchLadder(gctx, cw, ch, livePitchRef.current, VOCAL_PITCH_RANGE, scaleRef.current, vocalKeyLockRef.current, rightHandRef.current);
        } else {
          // photobooth mode: no grid
          gctx.clearRect(0, 0, grid.width, grid.height);
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [processHands, showSkeleton]);

  useEffect(() => {
    if (camActive) {
      rafRef.current = requestAnimationFrame(loop);
    }
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [camActive, loop]);

  // ── Camera controls ──
  const startCamera = useCallback(async () => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      camStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      ensureAudioBus();
      await resumeAudioBus();
      void ensureLead();
      setCamActive(true);
      await loadMediaPipe();
    } catch (err) {
      setCamError(`Camera error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [ensureAudioBus, ensureLead, loadMediaPipe, resumeAudioBus]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    leadSynthRef.current?.triggerRelease?.();
    rightSoundingRef.current = false;
    releaseChord();
    setCamActive(false);
    setLeftHand({ present: false, x: 0.5, y: 0.5, pinch: false, gesture: null });
    setRightHand({ present: false, x: 0.5, y: 0.5, pinch: false, gesture: null });
  }, [releaseChord]);

  // ── Mic: route the singer's voice into the recording tap (not the speakers) ──
  const ensureMic = useCallback(async (): Promise<MediaStream | null> => {
    if (micStreamRef.current) return micStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
      });
      micStreamRef.current = stream;
      const engine = ensureEngine();
      const src = engine.ctx.createMediaStreamSource(stream);
      const g = engine.ctx.createGain();
      // Dry record tap (→ recordDest only, never the speakers). Ducked whenever
      // a processed voice (trumpet or Vocal FX) is what should land in the take.
      // Photobooth mode always records raw voice (no ducking).
      g.gain.value = (trumpetOnRef.current || perfModeRef.current === "vocal") && perfModeRef.current !== "photobooth" ? 0 : 1;
      src.connect(g);
      g.connect(engine.recordDest);
      micSourceRef.current = src;
      micRecGainRef.current = g;
      // Dry monitor (→ master, so it's heard AND recorded). Only live in Vocal FX
      // "raw" capture, where you want to hear + record the clean voice.
      // Photobooth mode also allows dry monitoring.
      const dm = engine.ctx.createGain();
      dm.gain.value = (perfModeRef.current === "vocal" && recordModeRef.current === "raw") || perfModeRef.current === "photobooth" ? 1 : 0;
      src.connect(dm);
      dm.connect(engine.master);
      dryMonitorRef.current = dm;
      setMicStream(stream);
      return stream;
    } catch (err) {
      setMicError(`Mic unavailable — recordings won't include your voice. ${err instanceof Error ? err.message : ""}`);
      return null;
    }
  }, []);

  // ── Raw mic for photobooth mode (bypasses Web Audio entirely) ──
  const ensureRawMic = useCallback(async (): Promise<MediaStream | null> => {
    if (rawMicStreamRef.current) return rawMicStreamRef.current;
    try {
      // Get raw mic with NO processing - just like phone/laptop video
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { 
          echoCancellation: false, 
          noiseSuppression: false, 
          autoGainControl: false 
        },
        video: false,
      });
      rawMicStreamRef.current = stream;
      setMicStream(stream);
      return stream;
    } catch (err) {
      setMicError(`Mic unavailable — recordings won't include your voice. ${err instanceof Error ? err.message : ""}`);
      return null;
    }
  }, []);

  const stopMic = useCallback(() => {
    try { micRecGainRef.current?.disconnect(); } catch { /* */ }
    try { dryMonitorRef.current?.disconnect(); } catch { /* */ }
    try { micSourceRef.current?.disconnect(); } catch { /* */ }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micSourceRef.current = null;
    micRecGainRef.current = null;
    dryMonitorRef.current = null;
    setMicStream(null);
  }, []);

  const stopRawMic = useCallback(() => {
    rawMicStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawMicStreamRef.current = null;
    setMicStream(null);
  }, []);

  // Toggle the live trumpet — acquiring the shared mic the first time it's on.
  const toggleTrumpet = useCallback(async () => {
    if (trumpetOn) { setTrumpetOn(false); return; }
    const ok = await ensureMic();
    if (ok) setTrumpetOn(true);
  }, [trumpetOn, ensureMic]);

  // Calibrate to the room: sample ~1.5s of ambient noise → note-on gate.
  const calibrateMic = useCallback(async () => {
    const stream = await ensureMic();
    if (!stream) return;
    setCalibrating(true);
    try { await calibrateNoiseFloor(stream, 1500); setCalibrated(true); }
    finally { setCalibrating(false); }
  }, [ensureMic]);

  // Route the dry voice: record-tap ducked when a processed voice (trumpet or
  // Vocal FX) is the take; dry monitor live only for Vocal-FX "raw" capture
  // or photobooth mode.
  useEffect(() => {
    const e = ensureEngine();
    const rec = micRecGainRef.current;
    const dm = dryMonitorRef.current;
    const processedVoice = (trumpetOn || perfMode === "vocal") && perfMode !== "photobooth";
    if (rec) rec.gain.setTargetAtTime(processedVoice ? 0 : 1, e.ctx.currentTime, 0.05);
    if (dm) dm.gain.setTargetAtTime((perfMode === "vocal" && recordMode === "raw") || perfMode === "photobooth" ? 1 : 0, e.ctx.currentTime, 0.05);
  }, [trumpetOn, perfMode, recordMode]);

  // Entering Vocal FX or Photobooth: get the mic, drop any held chord, and show the appropriate tab.
  useEffect(() => {
    if (perfMode === "vocal") {
      void ensureMic();
      releaseChord();
      rightSoundingRef.current = false;
      setActiveSlot(null);
      setTab("voice");
    } else if (perfMode === "photobooth") {
      void ensureRawMic();
      releaseChord();
      rightSoundingRef.current = false;
      setActiveSlot(null);
      setTab("beat");
    } else {
      setTab((t) => (t === "voice" ? "beat" : t));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfMode]);

  // Throttled HUD mirror of the live hand state (avoids per-frame re-renders).
  useEffect(() => {
    if (perfMode !== "vocal") return;
    const id = window.setInterval(() => {
      setLiveShift(livePitchRef.current);
      setLiveFxHud({ ...leftFxRef.current });
    }, 100);
    return () => window.clearInterval(id);
  }, [perfMode]);

  // Keep the trumpet's optional scale-snap locked to the performance key.
  const { setSnapKey: setTrumpetSnapKey, setSnapScale: setTrumpetSnapScale } = trumpet;
  useEffect(() => {
    if (trumpet.snapEnabled) { setTrumpetSnapKey(rootKey); setTrumpetSnapScale(scaleId); }
  }, [trumpet.snapEnabled, rootKey, scaleId, setTrumpetSnapKey, setTrumpetSnapScale]);

  // ── Recording ──
  const startRecording = useCallback(async () => {
    const isPhotobooth = perfMode === "photobooth";
    
    if (isPhotobooth) {
      // Photobooth mode: use raw mic stream directly, bypass Web Audio entirely
      await ensureRawMic();
      const rawStream = rawMicStreamRef.current;
      if (!rawStream) return;
      
      const cap = captureCanvasRef.current;
      const isVideo = inputMode === "camera" && camActive && !!cap;
      let stream: MediaStream;
      let mime: string;
      
      if (isVideo && cap) {
        const videoStream = cap.captureStream(30);
        stream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...rawStream.getAudioTracks(),
        ]);
        mime = pickMime(VIDEO_MIME) ?? "video/webm";
      } else {
        stream = rawStream;
        mime = pickMime(AUDIO_MIME) ?? "audio/webm";
      }
      
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recStartRef.current = Date.now();
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime });
        if (blob.size === 0) return;
        const take: Take = {
          id: newTakeId(),
          song_id: songId,
          label: `photobooth ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          mime: recorder.mimeType || mime,
          duration: (Date.now() - recStartRef.current) / 1000,
          size: blob.size,
          has_video: isVideo,
          created_at: new Date().toISOString(),
          blob,
        };
        await takesStore.put(take);
        onTakeSaved();
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
    } else {
      // Normal mode: use Web Audio engine for processed audio
      const engine = ensureEngine();
      await resumeEngine();
      await ensureMic(); // so the take captures the singer's voice + the instruments
      const audioStream = engine.recordDest.stream;

      // With the camera on we record the PERFORMANCE picture from the capture
      // canvas (camera + skeleton + flashes) — never the grid overlay — combined
      // with the audio tap. Otherwise (touch mode) it's an audio-only take.
      const cap = captureCanvasRef.current;
      const isVideo = inputMode === "camera" && camActive && !!cap;
      let stream: MediaStream;
      let mime: string;
      if (isVideo && cap) {
        const videoStream = cap.captureStream(30);
        stream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...audioStream.getAudioTracks(),
        ]);
        mime = pickMime(VIDEO_MIME) ?? "video/webm";
      } else {
        stream = audioStream;
        mime = pickMime(AUDIO_MIME) ?? "audio/webm";
      }

      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recStartRef.current = Date.now();
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mime });
        if (blob.size === 0) return;
        const take: Take = {
          id: newTakeId(),
          song_id: songId,
          label: `perform ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          mime: recorder.mimeType || mime,
          duration: (Date.now() - recStartRef.current) / 1000,
          size: blob.size,
          has_video: isVideo,
          created_at: new Date().toISOString(),
          blob,
        };
        await takesStore.put(take);
        onTakeSaved();
      };
      recorder.start(250);
      recorderRef.current = recorder;
      setRecording(true);
    }
  }, [onTakeSaved, songId, inputMode, camActive, ensureMic, ensureRawMic, perfMode]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* */ }
    }
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setRecElapsed(Math.floor((Date.now() - recStartRef.current) / 1000)), 500);
    return () => clearInterval(id);
  }, [recording]);

  // ── Cleanup ──
  const cleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch { /* */ }
    }
    recorderRef.current = null;
    setRecording(false);
    setRecElapsed(0);
    stopCamera();
    stopMic();
    stopRawMic();
    stopDrums();
    releaseChord();
    smartStop();
    setShowLyrics(false);
    setTrumpetOn(false);
    beatLatchRef.current = "stopped";
    setBeatPlaying(false);
    setPerfMode("chords");
    void suspendBus();
  }, [suspendBus, releaseChord, stopCamera, stopMic, stopRawMic, stopDrums, smartStop]);

  // Keep a stable ref to the latest cleanup so the close/unmount effects depend
  // only on the `open` primitive — never on `cleanup` itself (which changes when
  // its callbacks do, and would otherwise re-fire setState every render).
  const cleanupRef = useRef(cleanup);
  useEffect(() => { cleanupRef.current = cleanup; }, [cleanup]);
  const prevOpenRef = useRef(open);
  useEffect(() => {
    if (prevOpenRef.current && !open) cleanupRef.current();
    prevOpenRef.current = open;
  }, [open]);
  useEffect(() => () => cleanupRef.current(), []);

  const handleClose = useCallback(() => onClose(), [onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg print:hidden">
      {/* Hidden YouTube player container */}
      <div id={ytContainerId.current} className="hidden" />
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line/60 px-3 py-3 sm:px-5">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden font-serif text-base tracking-tight text-ink-text sm:inline">Perform</span>
          {/* Performance mode — the headline switcher */}
          <div role="group" aria-label="Performance mode" className="flex overflow-hidden rounded-lg border border-line/70">
            <button
              onClick={() => setPerfMode("chords")} aria-pressed={perfMode === "chords"}
              className={`whitespace-nowrap px-3 py-1 text-[11px] font-medium transition-colors ${perfMode === "chords" ? "bg-accent/15 text-accent" : "text-ink-mute hover:text-ink-text"}`}
            ><span className="sm:hidden">Chords</span><span className="hidden sm:inline">Chords &amp; Drums</span></button>
            <button
              onClick={() => setPerfMode("vocal")} aria-pressed={perfMode === "vocal"}
              className={`whitespace-nowrap px-3 py-1 text-[11px] font-medium transition-colors ${perfMode === "vocal" ? "bg-accent/15 text-accent" : "text-ink-mute hover:text-ink-text"}`}
            ><span className="sm:hidden">Vocal</span><span className="hidden sm:inline">Vocal FX</span></button>
            <button
              onClick={() => setPerfMode("photobooth")} aria-pressed={perfMode === "photobooth"}
              className={`whitespace-nowrap px-3 py-1 text-[11px] font-medium transition-colors ${perfMode === "photobooth" ? "bg-accent/15 text-accent" : "text-ink-mute hover:text-ink-text"}`}
            >Photobooth</button>
          </div>
          {recording && (
            <span className="flex items-center gap-1.5 rounded-full bg-danger/15 px-2.5 py-0.5 font-mono text-[10px] text-danger">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
              REC {fmtTime(recElapsed)}
            </span>
          )}
          {!recording && (camActive || inputMode === "touch") && (
            <span className="hidden rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] text-success sm:inline">Live</span>
          )}
          {((perfMode === "chords" && chord.loading) || (perfMode === "vocal" && vfx.loading)) && (
            <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[10px] text-accent">loading sound…</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Input mode toggle */}
          <div className="flex overflow-hidden rounded-lg border border-line/70">
            <button
              onClick={() => { setInputMode("camera"); }}
              className={`px-2.5 py-1 text-[11px] transition-colors ${inputMode === "camera" ? "bg-accent/15 text-accent" : "text-ink-mute hover:text-ink-text"}`}
            >Hands</button>
            <button
              onClick={() => { stopCamera(); setInputMode("touch"); }}
              className={`px-2.5 py-1 text-[11px] transition-colors ${inputMode === "touch" ? "bg-accent/15 text-accent" : "text-ink-mute hover:text-ink-text"}`}
            >Touch</button>
          </div>
          <button
            onClick={toggleLyrics}
            aria-pressed={showLyrics}
            className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${showLyrics ? "border-accent/40 bg-accent/15 text-accent" : "border-line/70 text-ink-mute hover:text-ink-text"}`}
            title="Show the smart lyric teleprompter — it follows your voice line by line"
          >Lyrics</button>
          <button onClick={handleClose} className="rounded-lg px-3 py-1 text-[12px] text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink-text">Close</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Stage */}
        <div className="flex min-w-0 flex-[3] flex-col">
          {inputMode === "camera" ? (
            <div className="relative flex-1 overflow-hidden bg-black">
              {/* hidden camera source — frames are composited onto the capture canvas */}
              <video ref={videoRef} muted playsInline aria-hidden className="pointer-events-none absolute h-px w-px opacity-0" />
              {/* RECORDED layer: camera + skeleton + flashes (captureStream source) */}
              <canvas ref={captureCanvasRef} aria-hidden className="h-full w-full" style={{ objectFit: "cover" }} />
              {/* LIVE-ONLY chord-zone grid — never part of the recording */}
              <canvas ref={gridCanvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" style={{ objectFit: "cover" }} />

              {!camActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/92 px-6 text-center">
                  {perfMode === "vocal" ? (
                    <>
                      <p className="text-sm text-ink-text/80">Sing into the mic. <span className="text-accent">Right hand</span> bends your pitch; <span className="text-accent">left hand</span> plays the effects.</p>
                      <p className="text-[12px] text-ink-mute">Raise the left hand for wash, pinch for harmony, fist to go dry. Keep both hands in frame. 🎧 use headphones.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-ink-text/80">Right hand plays {rightMode === "lead" ? "the melody" : "chords"}; left hand runs the beat.</p>
                      <p className="text-[12px] text-ink-mute">Pinch to sound a note. Keep both hands in frame.</p>
                    </>
                  )}
                  <button onClick={startCamera} className="glow-accent-sm mt-1 rounded-lg bg-accent/15 px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/25">
                    Start camera
                  </button>
                  <button onClick={() => setInputMode("touch")} className="text-[11px] text-ink-mute underline-offset-2 hover:text-ink-text hover:underline">
                    or use the touch pad instead
                  </button>
                </div>
              )}
              {mpLoading && (
                <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-bg/85 px-3 py-2 backdrop-blur"><span className="text-[11px] text-accent">Loading hand tracking…</span></div>
              )}
              {camError && (
                <div className="absolute bottom-3 left-3 right-3 rounded-lg bg-bg/90 px-3 py-2 backdrop-blur"><span className="text-[11px] text-danger">{camError}</span></div>
              )}

              {/* status badges (DOM corner — never recorded, alignment-independent) */}
              {camActive && (
                <>
                  <div className="absolute left-3 top-3 flex gap-2">
                    <span className="rounded-md bg-bg/60 px-2 py-1 font-mono text-[10px] text-[#7aa2f7] backdrop-blur-sm">
                      L · {leftHand.present ? (leftHand.gesture ?? "—").toUpperCase() : beatPlaying ? "BEAT ●" : "—"}
                    </span>
                    <span className="rounded-md bg-bg/60 px-2 py-1 font-mono text-[10px] text-accent backdrop-blur-sm">
                      R · {rightHand.pinch ? "PLAY" : "ready"}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowGrid((v) => !v)}
                    aria-pressed={showGrid}
                    className={`absolute right-3 top-3 rounded-md px-2.5 py-1 font-mono text-[10px] backdrop-blur-sm transition-colors ${showGrid ? "bg-accent/20 text-accent" : "bg-bg/60 text-ink-mute hover:text-ink-text"}`}
                    title="Show/hide the chord-zone guide (live only — never recorded)"
                  >
                    Grid {showGrid ? "on" : "off"}
                  </button>
                </>
              )}

              {showLyrics && <LyricTeleprompter smart={smart} onClose={toggleLyrics} />}
            </div>
          ) : perfMode === "vocal" ? (
            <div className={`relative flex flex-1 flex-col items-center justify-center gap-7 overflow-y-auto p-6 text-center ${showLyrics ? "pb-[46%]" : ""}`}>
              {showLyrics && <LyricTeleprompter smart={smart} onClose={toggleLyrics} />}
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-ink-mute/50">You&apos;re singing</div>
                <div className="font-serif text-6xl font-semibold text-ink-text">{vfx.detectedNote ?? "—"}</div>
              </div>
              {/* input meter */}
              <div className="h-2 w-60 max-w-[70%] overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div className="h-full rounded-full bg-success/70 transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, vfx.inputLevel) * 100)}%` }} />
              </div>
              {/* touch pitch bend */}
              <div className="w-72 max-w-[80%]">
                <div className="mb-1 flex items-center justify-between text-[11px] text-ink-mute">
                  <span>Pitch bend</span>
                  <span className="font-mono tabular-nums">{touchBend > 0 ? "+" : ""}{touchBend} st</span>
                </div>
                <input
                  type="range" min={-12} max={12} step={1} value={touchBend}
                  onChange={(e) => { const v = parseInt(e.target.value); setTouchBend(v); livePitchRef.current = v; vfx.setManualActive(true); vfx.setManualPitch(v); }}
                  className="slider-premium w-full" aria-label="Pitch bend in semitones"
                />
                <div className="mt-2 flex items-center justify-center gap-2">
                  <button
                    onClick={() => { setTouchBend(0); livePitchRef.current = 0; vfx.setManualActive(false); vfx.setManualPitch(0); }}
                    className="rounded-md bg-surface-2 px-3 py-1 text-[11px] text-ink-mute transition-colors hover:text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2f7]"
                  >↺ Back to auto-tune</button>
                </div>
              </div>
              <p className="max-w-xs text-[11px] leading-relaxed text-ink-mute/70">
                Shape autotune, harmony, delay &amp; reverb in the <span className="text-accent">Voice</span> tab. Switch to <span className="text-accent">Hands</span> to bend pitch with one hand and play the effects with the other. 🎧 use headphones.
              </p>
            </div>
          ) : (
            <div className="relative flex-1 overflow-y-auto p-4 sm:p-6">
              {showLyrics && <LyricTeleprompter smart={smart} onClose={toggleLyrics} />}
              <TouchInstrument
                rootKey={rootKey}
                scaleId={scaleId}
                onChangeKey={setRootKey}
                onChangeScale={setScaleId}
                chordSlots={chordSlots}
                onChordDown={(slot) => { playChord(slot); setActiveSlot(slot.slot); }}
                onChordUp={() => { releaseChord(); setActiveSlot(null); }}
              />
            </div>
          )}

          {/* Bottom display — chord/lead (Mode A) or Vocal-FX HUD (Mode B) or Photobooth (Mode C) */}
          {perfMode === "chords" ? (
            <div className="flex items-center gap-4 border-t border-line/50 bg-surface/40 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[9px] uppercase tracking-wider text-ink-mute/50">{rightMode === "lead" ? "Note" : "Chord"}</div>
                <div className="truncate font-serif text-2xl font-semibold text-ink-text">{leadNote}</div>
              </div>
              <div className="hidden w-44 sm:block">
                <PianoKeyboard
                  activeNotes={chord.activeNotes}
                  onNoteOn={playPianoNote}
                  onNoteOff={releasePianoNote}
                  octave={Math.floor(keyToPc(rootKey) / 12) + 4}
                />
              </div>
            </div>
          ) : perfMode === "vocal" ? (
            <div className="flex items-center gap-4 border-t border-line/50 bg-surface/40 px-5 py-3">
              <div className="min-w-0">
                <div className="text-[9px] uppercase tracking-wider text-ink-mute/50">Voice</div>
                <div className="truncate font-serif text-2xl font-semibold text-ink-text">{vfx.detectedNote ?? "—"}</div>
              </div>
              <div className="min-w-[58px]">
                <div className="text-[9px] uppercase tracking-wider text-ink-mute/50">Shift</div>
                <div className="font-mono text-lg font-semibold tabular-nums text-accent">
                  {liveShift > 0 ? "+" : ""}{liveShift.toFixed(liveShift % 1 === 0 ? 0 : 1)}
                  <span className="ml-0.5 text-[10px] text-ink-mute">st</span>
                </div>
              </div>
              {liveFxHud.present && (
                <div className="min-w-[58px]">
                  <div className="text-[9px] uppercase tracking-wider text-ink-mute/50">Hand FX</div>
                  <div className={`font-mono text-lg font-semibold tabular-nums ${liveFxHud.bypass ? "text-danger" : "text-accent"}`}>
                    {liveFxHud.bypass ? "DRY" : `${Math.round(liveFxHud.space * 100)}%`}
                    {!liveFxHud.bypass && liveFxHud.harmony && <span className="ml-1 text-[10px] text-accent">+harm</span>}
                  </div>
                </div>
              )}
              <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                {vfx.params.autotuneOn && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Auto-tune</span>}
                {vfx.params.harmonyOn && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Harmony</span>}
                {vfx.params.delayOn && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Delay</span>}
                {vfx.params.reverbOn && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Reverb</span>}
                <div className="ml-1 h-1.5 w-20 overflow-hidden rounded-full bg-bg/60" aria-hidden>
                  <div className="h-full rounded-full bg-success/70 transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, vfx.inputLevel) * 100)}%` }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 border-t border-line/50 bg-surface/40 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[9px] uppercase tracking-wider text-ink-mute/50">Photobooth</div>
                <div className="truncate font-serif text-2xl font-semibold text-ink-text">Raw voice + video</div>
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">No effects</span>
                <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] text-accent">Dry recording</span>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex w-full flex-shrink-0 flex-col border-t border-line/60 bg-surface/30 lg:w-80 lg:border-l lg:border-t-0">
          <div className="flex border-b border-line/50">
            {(perfMode === "vocal" ? (["voice", "sound", "guide"] as const) : perfMode === "photobooth" ? (["beat", "guide"] as const) : (["beat", "sound", "chords", "guide"] as const)).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${tab === t ? "bg-surface-2/60 text-accent" : "text-ink-mute hover:text-ink-text"}`}>
                {t}
              </button>
            ))}
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
            {tab === "voice" && (
              <VocalFxRack
                vfx={vfx}
                recordMode={recordMode}
                setRecordMode={setRecordMode}
                songKey={rootKey}
                songScale={scaleId}
                keyLock={vocalKeyLock}
                setKeyLock={setVocalKeyLock}
                isCameraMode={inputMode === "camera"}
                onCalibrate={() => void calibrateMic()}
                calibrating={calibrating}
                calibrated={calibrated}
              />
            )}
            {tab === "sound" && (
              <div className="space-y-5">
                {/* Voice → Trumpet */}
                <div className="rounded-xl border border-line/50 bg-surface-2/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-ink-text">Voice → Trumpet</div>
                      <div className="text-[10px] leading-snug text-ink-mute/70">Sing and a real trumpet follows your pitch. 🎧 use headphones.</div>
                    </div>
                    <button
                      role="switch" aria-checked={trumpetOn} onClick={() => void toggleTrumpet()}
                      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${trumpetOn ? "bg-accent/70" : "bg-surface-2"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink-text transition-all ${trumpetOn ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>

                  {trumpetOn && (
                    <div className="mt-3 space-y-3">
                      {trumpet.loading && <div className="text-[11px] text-accent">loading trumpet…</div>}
                      {trumpet.error && <div className="text-[11px] text-danger">{trumpet.error}</div>}

                      {/* detected note + input meter */}
                      <div className="flex items-center gap-2">
                        <span className={`min-w-[3ch] font-mono text-[13px] ${trumpet.isActive ? "text-accent" : "text-ink-mute/50"}`}>
                          {trumpet.isActive ? trumpet.detectedNote ?? "—" : "—"}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg/60">
                          <div className="h-full rounded-full bg-accent/70 transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, trumpet.inputLevel) * 100)}%` }} />
                        </div>
                        {trumpet.latencyMs != null && (
                          <span className="font-mono text-[10px] text-ink-mute/70" title="Live monitoring latency — inherent to real-time pitch→audio">~{trumpet.latencyMs} ms</span>
                        )}
                      </div>

                      {/* calibrate */}
                      <button
                        type="button" onClick={() => void calibrateMic()} disabled={calibrating}
                        title="Sample ~1.5s of room noise so silence/breath never trigger the horn"
                        className={`w-full rounded-lg px-2 py-1.5 text-[11px] transition-colors ${calibrated ? "bg-success/15 text-success" : "bg-surface-2 text-ink-mute hover:text-ink-text"} disabled:opacity-50`}
                      >
                        {calibrating ? "calibrating…" : calibrated ? "✓ mic calibrated" : "Calibrate mic to the room"}
                      </button>

                      {/* presets */}
                      <div className="flex flex-wrap gap-1.5">
                        {TRUMPET_PRESETS.map((p) => (
                          <button key={p.name} title={p.blurb}
                            onClick={() => { setTrumpetPresetName(p.name); trumpet.applyPreset(p); }}
                            className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${trumpetPresetName === p.name ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
                            {p.name}
                          </button>
                        ))}
                      </div>

                      <Slider label="Brightness" value={trumpet.brightness} onChange={trumpet.setBrightness} valueLabel={`${Math.round(trumpet.brightness * 100)}%`} />
                      <Slider label="Glide" value={trumpet.portamento} onChange={trumpet.setPortamento} valueLabel={`${Math.round(trumpet.portamento * 100)}%`} />

                      <label className="flex items-center justify-between text-[11px] text-ink-mute">
                        <span>Snap to song key ({rootKey})</span>
                        <input type="checkbox" checked={trumpet.snapEnabled} onChange={(e) => trumpet.setSnapEnabled(e.target.checked)} className="accent-accent" />
                      </label>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Slider label="Master" value={masterVol} onChange={setMasterVol} valueLabel={`${Math.round(masterVol * 100)}%`} />
                  <Slider label="Drums" value={drumVol} onChange={setDrumVol} valueLabel={`${Math.round(drumVol * 100)}%`} />
                  <Slider label="Chords" value={chordVol} onChange={setChordVol} valueLabel={`${Math.round(chordVol * 100)}%`} />
                </div>

                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/60">Chord timbre</div>
                  <div className="flex flex-wrap gap-1.5">
                    {INSTRUMENT_PRESETS.map((p) => (
                      <button key={p.id} onClick={() => chord.setInstrumentPreset(p.name)} title={p.blurb}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${chord.instrumentName === p.name ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-ink-mute/60">
                  Drum kit, tempo, swing and the step pattern live in the <span className="text-accent">Beat</span> tab.
                </p>
              </div>
            )}

            {tab === "beat" && (
              <div className="space-y-4">
                {youtube && (
                  <div className="rounded-lg border border-line/60 bg-surface-2/50 p-3">
                    <div className="mb-3 text-[9px] uppercase tracking-widest text-ink-mute/60">YouTube beat</div>
                    
                    {/* Timeline controls */}
                    <div className="mb-3 flex items-center gap-2">
                      <button
                        onClick={toggleYtPlayback}
                        disabled={!ytReady}
                        className="flex-shrink-0 rounded border border-line px-2.5 py-1 text-sm text-ink-text transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {ytPlaying ? "❚❚" : "▶"}
                      </button>
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={Math.max(1, Math.floor(ytDuration))}
                          value={Math.floor(ytTime)}
                          onChange={(e) => ytSeek(Number(e.target.value))}
                          disabled={!ytReady}
                          className="flex-1 accent-amber-gold disabled:opacity-50"
                        />
                        <span className="flex-shrink-0 font-mono text-[10px] text-ink-mute tabular-nums">
                          {fmtTime(ytTime)} / {fmtTime(ytDuration)}
                        </span>
                      </div>
                    </div>
                    
                    {/* Action buttons */}
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <button
                        onClick={ytBeginAddMarker}
                        disabled={!ytReady}
                        title="Mark this moment with a custom label"
                        className="rounded border border-line px-2 py-1 text-[10px] text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        + mark
                      </button>
                      <button
                        onClick={() => setYtLoopOn((v) => !v)}
                        disabled={!ytReady}
                        title={
                          ytHasLoopRange
                            ? "Loop between marked A and B"
                            : "Loop the whole track (set A and B markers for a custom range)"
                        }
                        className={`rounded border px-2 py-1 text-[10px] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${
                          ytLoopOn
                            ? "border-amber-gold/60 text-amber-gold"
                            : "border-line text-ink-mute hover:text-ink-text"
                        }`}
                      >
                        {ytLoopLabel}
                      </button>
                      <div className="flex items-center gap-1.5 ml-auto">
                        <span className="text-[10px] text-ink-mute">vol</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={ytVolume}
                          onChange={(e) => ytSetVolume(Number(e.target.value))}
                          disabled={!ytReady}
                          className="w-16 accent-amber-gold disabled:opacity-50"
                          title="Volume"
                        />
                      </div>
                    </div>
                    
                    {/* Markers */}
                    {ytMarkers.length > 0 || ytDraftLabel ? (
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        {ytMarkers.map((m) => {
                          const isA = ytLoopStart === m.time;
                          const isB = ytLoopEnd === m.time;
                          return (
                            <span
                              key={m.id}
                              className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors duration-150 ${
                                isA || isB
                                  ? "border-amber-gold/60 bg-amber-gold/10 text-amber-gold"
                                  : "border-line text-ink-mute hover:border-amber-gold/40 hover:text-ink-text"
                              }`}
                            >
                              <button
                                onClick={() => ytSeek(m.time)}
                                title={`Jump to ${fmtTime(m.time)}`}
                                className="font-mono text-[9px]"
                              >
                                {fmtTime(m.time)}
                              </button>
                              <button
                                onClick={() => ytSeek(m.time)}
                                title={`Jump to ${fmtTime(m.time)}`}
                                className="max-w-[8rem] truncate"
                              >
                                {m.label}
                              </button>
                              <span className="ml-1 hidden gap-0.5 group-hover:inline-flex">
                                <button
                                  onClick={() => ytSetLoopPoint("A", m.time)}
                                  title="Use as loop start"
                                  className={`rounded border border-line px-1 text-[8px] uppercase tracking-wider hover:border-amber-gold/60 hover:text-amber-gold ${
                                    isA ? "border-amber-gold/60 text-amber-gold" : ""
                                  }`}
                                >
                                  A
                                </button>
                                <button
                                  onClick={() => ytSetLoopPoint("B", m.time)}
                                  title="Use as loop end"
                                  className={`rounded border border-line px-1 text-[8px] uppercase tracking-wider hover:border-amber-gold/60 hover:text-amber-gold ${
                                    isB ? "border-amber-gold/60 text-amber-gold" : ""
                                  }`}
                                >
                                  B
                                </button>
                                <button
                                  onClick={() => ytRemoveMarker(m.id)}
                                  title="Remove marker"
                                  className="rounded px-1 text-[9px] hover:text-ink-text"
                                >
                                  ✕
                                </button>
                              </span>
                            </span>
                          );
                        })}
                        {ytDraftLabel ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              ytCommitMarker();
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-gold/60 bg-amber-gold/10 px-2 py-0.5"
                          >
                            <span className="font-mono text-[9px] text-amber-gold">
                              {fmtTime(ytDraftLabel.time)}
                            </span>
                            <input
                              autoFocus
                              value={ytDraftLabel.label}
                              onChange={(e) =>
                                setYtDraftLabel({ ...ytDraftLabel, label: e.target.value })
                              }
                              onBlur={ytCommitMarker}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  ytCancelMarker();
                                }
                              }}
                              placeholder="hook · verse 2 · drop…"
                              className="w-24 bg-transparent text-[10px] text-amber-gold outline-none placeholder:text-amber-gold/50"
                            />
                          </form>
                        ) : null}
                        {ytHasLoopRange ? (
                          <button
                            onClick={ytClearLoop}
                            title="Clear A↔B loop range"
                            className="rounded border border-line px-1.5 py-0.5 text-[9px] text-ink-mute hover:border-amber-gold/40 hover:text-ink-text"
                          >
                            clear A↔B
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    
                    {!ytReady && (
                      <div className="mt-2 text-[9px] text-ink-mute/50">
                        Loading YouTube player…
                      </div>
                    )}
                  </div>
                )}
                <StepSequencer seq={drum} />
              </div>
            )}

            {tab === "chords" && (
              <div className="space-y-5">
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/60">Right-hand mode</div>
                  <div className="flex gap-1.5">
                    {(["chords", "lead"] as const).map((m) => (
                      <button key={m} onClick={() => setRightMode(m)}
                        className={`flex-1 rounded-lg px-2.5 py-1.5 text-[11px] capitalize transition-colors ${rightMode === m ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
                        {m === "lead" ? "Lead melody" : "Chords"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/60">Key &amp; scale</div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {KEY_NAMES.map((k) => (
                      <button key={k} onClick={() => setRootKey(k)}
                        className={`h-7 min-w-[28px] rounded-md px-1.5 text-[11px] ${rootKey === k ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>{k}</button>
                    ))}
                  </div>
                  <select value={scaleId} onChange={(e) => setScaleId(e.target.value as ScaleId)}
                    className="w-full rounded-md bg-surface-2 px-2 py-1.5 text-[12px] text-ink-text">
                    {SCALES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/60">Progression</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.keys(SLOT_PRESETS).map((preset) => (
                      <button key={preset} onClick={() => setChordSlots(SLOT_PRESETS[preset])}
                        className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${chordSlots === SLOT_PRESETS[preset] ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[9px] uppercase tracking-widest text-ink-mute/60">Edit slots</div>
                  {chordSlots.map((slot) => (
                    <div key={slot.slot} className={`rounded-lg p-2 ${activeSlot === slot.slot ? "bg-accent/10 ring-1 ring-accent/40" : "bg-surface-2/60"}`}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-[9px] text-ink-mute/60">Slot {slot.slot}</span>
                        <button onClick={() => { playChord(slot); setTimeout(() => releaseChord(), 700); }} className="text-[9px] text-ink-mute hover:text-accent">preview</button>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <select value={slot.root} aria-label={`Slot ${slot.slot} root`} onChange={(e) => updateSlot(slot.slot, { root: e.target.value }, setChordSlots)} className="rounded bg-bg/60 px-1 py-1 font-mono text-[10px] text-ink-text">
                          {ROOTS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <select value={slot.quality} aria-label={`Slot ${slot.slot} quality`} onChange={(e) => updateSlot(slot.slot, { quality: e.target.value as ChordQuality }, setChordSlots)} className="rounded bg-bg/60 px-1 py-1 font-mono text-[10px] text-ink-text">
                          {QUALITIES.map((q) => <option key={q} value={q}>{q}</option>)}
                        </select>
                        <select value={slot.octave} aria-label={`Slot ${slot.slot} octave`} onChange={(e) => updateSlot(slot.slot, { octave: parseInt(e.target.value) }, setChordSlots)} className="rounded bg-bg/60 px-1 py-1 font-mono text-[10px] text-ink-text">
                          {[2, 3, 4, 5].map((o) => <option key={o} value={o}>Oct {o}</option>)}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "guide" && (
              <div className="space-y-4 text-[12px] leading-relaxed text-ink-mute">
                {perfMode === "vocal" ? (
                  <>
                    <div>
                      <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Right hand — pitch</div>
                      <ul className="space-y-1">
                        <li><span className="text-accent">Raise / lower</span> — bend your voice up &amp; down</li>
                        <li><span className="text-accent">Key-lock</span> — snaps the bend to your scale (Voice tab)</li>
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Left hand — effects</div>
                      <ul className="space-y-1">
                        <li><span className="text-[#7aa2f7]">Raise / lower</span> — more / less wash (reverb + echo)</li>
                        <li><span className="text-[#7aa2f7]">Pinch</span> — throw in a harmony</li>
                        <li><span className="text-[#7aa2f7]">Fist</span> — kill the FX (go dry)</li>
                      </ul>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Right hand — melody / chords</div>
                      <ul className="space-y-1">
                        <li><span className="text-accent">Move left↔right</span> — pick the note / chord (locked to your key)</li>
                        <li><span className="text-accent">Move up↕down</span> — brightness &amp; volume</li>
                        <li><span className="text-accent">Pinch</span> — sound it; release to stop</li>
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Left hand — beat</div>
                      <ul className="space-y-1">
                        <li><span className="text-[#7aa2f7]">Open palm</span> (hold) — start the loop</li>
                        <li><span className="text-[#7aa2f7]">Fist</span> (hold) — stop</li>
                        <li><span className="text-[#7aa2f7]">Pinch</span> — mute / unmute</li>
                      </ul>
                    </div>
                  </>
                )}
                <div className="rounded-lg bg-surface-2/60 p-2.5 text-[11px] text-ink-mute/70">
                  No camera? Switch to <span className="text-accent">Touch</span> up top — same instrument with your fingers.
                </div>
                <div className="rounded-lg bg-surface-2/60 p-2.5 text-[11px] text-ink-mute/70">
                  Camera runs entirely on your device. Nothing is uploaded.
                </div>
                <label className="flex items-center justify-between">
                  <span>Show hand skeleton</span>
                  <input type="checkbox" checked={showSkeleton} onChange={(e) => setShowSkeleton(e.target.checked)} className="accent-accent" />
                </label>
                <label className="flex items-center justify-between">
                  <span>Swap hands</span>
                  <input type="checkbox" checked={swapHands} onChange={(e) => setSwapHands(e.target.checked)} className="accent-accent" />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transport */}
      <div className="flex items-center justify-between border-t border-line/60 bg-surface/30 px-5 py-2.5">
        <div className="flex items-center gap-2">
          {inputMode === "camera" && (
            <button onClick={camActive ? stopCamera : startCamera}
              className={`rounded-lg px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${camActive ? "bg-danger/15 text-danger hover:bg-danger/25" : "bg-accent/15 text-accent hover:bg-accent/25"}`}>
              {camActive ? "Stop camera" : "Start camera"}
            </button>
          )}
          <button onClick={() => { if (beatPlaying) { stopDrums(); beatLatchRef.current = "stopped"; setBeatPlaying(false); } else { playDrumsFn(); beatLatchRef.current = "playing"; setBeatPlaying(true); } }}
            className={`rounded-lg px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${beatPlaying ? "bg-danger/15 text-danger hover:bg-danger/25" : "bg-accent/15 text-accent hover:bg-accent/25"}`}>
            {beatPlaying ? "Stop beat" : "Play beat"}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-[10px] text-ink-mute/60 sm:inline" title="Recordings capture your voice + the instruments. Use headphones so the beat doesn't bleed into your vocal.">
            {micError ? <span className="text-danger">{micError}</span> : "captures voice + music · 🎧 use headphones"}
          </span>
          <button onClick={recording ? stopRecording : () => void startRecording()}
            className={`rounded-lg px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-colors ${recording ? "bg-danger/20 text-danger hover:bg-danger/30" : "bg-accent/15 text-accent hover:bg-accent/25"}`}>
            {recording ? "Stop rec" : "● Record"}
          </button>
          <button onClick={handleClose} className="rounded-lg bg-surface-2 px-3.5 py-1.5 text-[11px] text-ink-mute transition-colors hover:text-ink-text">Done</button>
        </div>
      </div>
    </div>
  );
}

function updateSlot(
  slotNum: number,
  patch: Partial<ChordSlot>,
  setChordSlots: React.Dispatch<React.SetStateAction<ChordSlot[]>>,
) {
  setChordSlots((prev) => prev.map((s) => (s.slot === slotNum ? { ...s, ...patch } : s)));
}
