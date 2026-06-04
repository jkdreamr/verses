"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { takesStore, newTakeId } from "@/lib/takes";
import type { Take } from "@/lib/types";
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
} from "@/lib/audio/scales";
import { OneEuroFilter } from "@/lib/audio/oneEuro";
import { TouchInstrument } from "@/components/perform/TouchInstrument";
import { StepSequencer } from "@/components/perform/StepSequencer";
import { LyricTeleprompter } from "@/components/perform/LyricTeleprompter";
import { Slider } from "@/components/ui/Slider";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSmartLyrics } from "@/hooks/useSmartLyrics";

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

// ─── Piano display (chord tones) ─────────────────────────────────────────────

function PianoKeyboard({ activeNotes }: { activeNotes: number[] }) {
  const whiteKeys = ["C", "D", "E", "F", "G", "A", "B"];
  const blackKeys = ["C#", "D#", null, "F#", "G#", "A#"];
  const isActive = (note: string | null) => !!note && activeNotes.some((n) => NOTE_NAMES[n % 12] === note);
  return (
    <div className="relative h-14 w-full overflow-hidden rounded-lg border border-line/60">
      <div className="absolute inset-0 flex gap-px bg-line/40">
        {whiteKeys.map((note) => (
          <div key={note} className={`flex flex-1 items-end justify-center pb-1 transition-colors duration-75 ${
            isActive(note) ? "bg-accent/40" : "bg-[#f5f3ef]"}`}>
            <span className={`font-mono text-[7px] ${isActive(note) ? "text-amber-700" : "text-neutral-400"}`}>{note}</span>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 top-0 flex px-[7%]">
        {blackKeys.map((note, i) => (
          <div key={i} className="relative flex-1">
            {note && (
              <div className={`absolute left-1/2 top-0 h-9 w-[65%] -translate-x-1/2 rounded-b shadow-md transition-colors duration-75 ${
                isActive(note) ? "bg-accent/80" : "bg-[#1a1a1a]"}`} />
            )}
          </div>
        ))}
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
  onTakeSaved,
}: {
  open: boolean;
  onClose: () => void;
  songId: string;
  lyrics?: string;
  onTakeSaved: () => void;
}) {
  const isMobile = useIsMobile();

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
  const [tab, setTab] = useState<"beat" | "sound" | "chords" | "guide">("beat");
  const [beatPlaying, setBeatPlaying] = useState(false);

  // ── Smart Lyric Reader (strict line-by-line teleprompter in the stage) ──
  const smart = useSmartLyrics(lyrics ?? "");
  const { start: smartStart, stop: smartStop } = smart;
  const [showLyrics, setShowLyrics] = useState(false);
  const toggleLyrics = useCallback(() => {
    if (showLyrics) { smartStop(); setShowLyrics(false); }
    else { smartStart(); setShowLyrics(true); }
  }, [showLyrics, smartStart, smartStop]);

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
    if (g === leftTimerRef.current.gesture) {
      const held = Date.now() - leftTimerRef.current.startMs;
      const cooled = Date.now() - leftCooldownRef.current > LATCH_COOLDOWN_MS;
      if (held >= LATCH_HOLD_MS && cooled) {
        if (g === "open" && beatLatchRef.current !== "playing") {
          playDrumsFn();
          beatLatchRef.current = "playing";
          setBeatPlaying(true);
          leftCooldownRef.current = Date.now();
          leftTimerRef.current = { gesture: null, startMs: 0 };
        } else if (g === "fist" && beatLatchRef.current === "playing") {
          stopDrums();
          beatLatchRef.current = "stopped";
          setBeatPlaying(false);
          leftCooldownRef.current = Date.now();
          leftTimerRef.current = { gesture: null, startMs: 0 };
        } else if (g === "pinch") {
          if (beatLatchRef.current === "muted") {
            beatLatchRef.current = "playing";
            busSetDrum(drumVol);
          } else if (beatLatchRef.current === "playing") {
            beatLatchRef.current = "muted";
            busSetDrum(0);
          }
          leftCooldownRef.current = Date.now();
          leftTimerRef.current = { gesture: null, startMs: 0 };
        }
      }
    } else {
      leftTimerRef.current = { gesture: g, startMs: Date.now() };
    }
  }, [busSetDrum, drumVol, playDrumsFn, stopDrums]);

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
    handleRight(nr);
    handleLeft(nl);
  }, [handleLeft, handleRight, releaseChord]);

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
    if (showSkeleton && landmarks.length) {
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
        if (showGridRef.current) {
          const labels = zonesRef.current;
          const rh = rightHandRef.current;
          const activeIdx = rh.present && labels.length
            ? Math.min(labels.length - 1, Math.max(0, Math.floor(rh.x * labels.length)))
            : -1;
          drawChordGrid(gctx, cw, ch, labels, activeIdx, rh, reducedMotionRef.current, now);
        } else {
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
      g.gain.value = 1;
      src.connect(g);
      g.connect(engine.recordDest); // captured in takes, never sent to the speakers
      micSourceRef.current = src;
      micRecGainRef.current = g;
      return stream;
    } catch (err) {
      setMicError(`Mic unavailable — recordings won't include your voice. ${err instanceof Error ? err.message : ""}`);
      return null;
    }
  }, []);

  const stopMic = useCallback(() => {
    try { micRecGainRef.current?.disconnect(); } catch { /* */ }
    try { micSourceRef.current?.disconnect(); } catch { /* */ }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micSourceRef.current = null;
    micRecGainRef.current = null;
  }, []);

  // ── Recording ──
  const startRecording = useCallback(async () => {
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
  }, [onTakeSaved, songId, inputMode, camActive, ensureMic]);

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
    stopDrums();
    releaseChord();
    smartStop();
    setShowLyrics(false);
    beatLatchRef.current = "stopped";
    setBeatPlaying(false);
    void suspendBus();
  }, [suspendBus, releaseChord, stopCamera, stopMic, stopDrums, smartStop]);

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

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg print:hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line/60 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-serif text-base tracking-tight text-ink-text">Perform</span>
          {recording && (
            <span className="flex items-center gap-1.5 rounded-full bg-danger/15 px-2.5 py-0.5 font-mono text-[10px] text-danger">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
              REC {fmtTime(recElapsed)}
            </span>
          )}
          {!recording && (camActive || inputMode === "touch") && (
            <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[10px] text-success">Live</span>
          )}
          {chord.loading && (
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
                  <p className="text-sm text-ink-text/80">Right hand plays {rightMode === "lead" ? "the melody" : "chords"}; left hand runs the beat.</p>
                  <p className="text-[12px] text-ink-mute">Pinch to sound a note. Keep both hands in frame.</p>
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

          {/* Bottom chord/lead display */}
          <div className="flex items-center gap-4 border-t border-line/50 bg-surface/40 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[9px] uppercase tracking-wider text-ink-mute/50">{rightMode === "lead" ? "Note" : "Chord"}</div>
              <div className="truncate font-serif text-2xl font-semibold text-ink-text">{leadNote}</div>
            </div>
            <div className="hidden w-44 sm:block"><PianoKeyboard activeNotes={chord.activeNotes} /></div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex w-full flex-shrink-0 flex-col border-t border-line/60 bg-surface/30 lg:w-80 lg:border-l lg:border-t-0">
          <div className="flex border-b border-line/50">
            {(["beat", "sound", "chords", "guide"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 px-3 py-2.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${tab === t ? "bg-surface-2/60 text-accent" : "text-ink-mute hover:text-ink-text"}`}>
                {t}
              </button>
            ))}
          </div>

          <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
            {tab === "sound" && (
              <div className="space-y-5">
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

            {tab === "beat" && <StepSequencer seq={drum} />}

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
