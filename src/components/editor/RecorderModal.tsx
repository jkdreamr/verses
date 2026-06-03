"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { takesStore, newTakeId, formatBytes, formatDuration } from "@/lib/takes";
import type { Take, YoutubeMarker } from "@/lib/types";
import { DRUM_PRESETS, useDrumEngine } from "@/hooks/perform/useDrumEngine";
import { usePerformAudioBus } from "@/hooks/perform/usePerformAudioBus";
import {
  SLOT_PRESETS,
  chordLabel,
  useChordSynth,
} from "@/hooks/perform/useChordSynth";
import type { ChordSlot } from "@/hooks/perform/useChordSynth";
import { useLiveTrumpet, TRUMPET_PRESETS } from "@/hooks/perform/useLiveTrumpet";
import { useIsMobile } from "@/hooks/useIsMobile";
import { createLyricAligner, type LyricToken } from "@/lib/music/lyricAlign";

// ─── Recording state ──────────────────────────────────────────────────────────

type RecState = "idle" | "preparing" | "recording" | "paused" | "review";
type PerformLayer = "none" | "hand" | "trumpet" | "both";
type LyricFollowMode = "smart" | "pace" | "manual";

// ─── Media codec candidates ───────────────────────────────────────────────────

const VIDEO_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];
const AUDIO_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const VIDEO_BITS_PER_SECOND = 4_500_000;
const AUDIO_BITS_PER_SECOND = 192_000;

const pickMime = (candidates: string[]): string | undefined => {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      // ignore
    }
  }
  return undefined;
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

const fmt = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

const parseMmSs = (text: string): number | null => {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(\d+):(\d{1,2})$/);
  if (m) {
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    if (Number.isFinite(min) && Number.isFinite(sec) && sec < 60) {
      return min * 60 + sec;
    }
    return null;
  }
  const n = parseFloat(t);
  if (Number.isFinite(n) && n >= 0) return n;
  return null;
};

const splitLyricLines = (lyrics: string): string[] =>
  lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);


// ─── Local types ──────────────────────────────────────────────────────────────

type GestureId = "open" | "pinch" | "two" | "fist" | "point";

type HandState = {
  gesture: GestureId | null;
  wristX: number;
  wristY: number;
  present: boolean;
};

// ─── Latch timing ─────────────────────────────────────────────────────────────

const LATCH_HOLD_MS = 400;
const LATCH_COOLDOWN_MS = 800;








// ─── Default label helper ─────────────────────────────────────────────────────

function defaultLabelForLayer(layer: PerformLayer): string {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const prefix =
    layer === "hand" ? "gesture take"
    : layer === "trumpet" ? "trumpet take"
    : layer === "both" ? "gesture + trumpet take"
    : "take";
  return `${prefix} ${hh}:${mm}`;
}

// ─── Main RecorderModal component ─────────────────────────────────────────────

export function RecorderModal({
  open,
  songId,
  hasYoutube,
  markers,
  loopStart,
  lyrics,
  onClose,
  onSaved,
  youtubeSession,
}: {
  open: boolean;
  songId: string;
  hasYoutube: boolean;
  markers: YoutubeMarker[];
  loopStart: number | null;
  lyrics: string;
  onClose: () => void;
  onSaved: () => void;
  youtubeSession?: {
    youtube_url: string;
    youtube_title: string | null;
    loop_start?: number | null;
    loop_end?: number | null;
  } | null;
}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  // ── Core recording state ──
  const [state, setState] = useState<RecState>("idle");
  const [withVideo, setWithVideo] = useState(false);
  const [autoPlayBeat, setAutoPlayBeat] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [reviewBlob, setReviewBlob] = useState<Blob | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewMime, setReviewMime] = useState<string>("audio/webm");
  const [reviewDuration, setReviewDuration] = useState<number>(0);
  const [label, setLabel] = useState<string>("");

  // ── Start-at picker ──
  const [startAtSel, setStartAtSel] = useState<string>("0");
  const [customStart, setCustomStart] = useState<string>("");
  const [customStartError, setCustomStartError] = useState<string | null>(null);

  // ── Performance layer state ──
  const [performLayer, setPerformLayer] = useState<PerformLayer>("none");
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);

  // ── Hand layer setup ──
  const [beatSource, setBeatSource] = useState<"drums" | "youtube">("drums");
  const [drumPresetName, setDrumPresetName] = useState("Boom Bap");
  const [chordPresetName, setChordPresetName] = useState("Pop");
  const [chordSlots, setChordSlots] = useState<ChordSlot[]>(SLOT_PRESETS["Pop"]);
  const [showZoneOverlay, setShowZoneOverlay] = useState(true);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  // ── Trumpet layer setup ──
  const [trumpetPresetName, setTrumpetPresetName] = useState("Trumpet");

  // ── Lyric follow ──
  const [lyricFollowMode, setLyricFollowMode] = useState<LyricFollowMode>("smart");
  const [secondsPerLine, setSecondsPerLine] = useState<number>(3);
  const [manualLineOffset, setManualLineOffset] = useState<number>(0);
  const [smartLineIndex, setSmartLineIndex] = useState(0);
  const [activeTokenIndex, setActiveTokenIndex] = useState(0);
  const [smartStatus, setSmartStatus] = useState<"listening" | "low" | "fallback" | "unavailable">("unavailable");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speechRecognitionRef = useRef<any>(null);
  const lastMatchTimeRef = useRef<number>(0);
  const alignerRef = useRef<ReturnType<typeof createLyricAligner> | null>(null);
  const recRestartRef = useRef(true);
  const lyricTokens = useMemo<LyricToken[]>(() => createLyricAligner(lyrics).tokens, [lyrics]);

  // ── MediaStream refs ──
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sourceStreamsRef = useRef<MediaStream[]>([]);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const pausedElapsedRef = useRef<number>(0); // accumulated time before current pause
  const tickRef = useRef<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const capturedMicStreamRef = useRef<MediaStream | null>(null);
  const recDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recordMixDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // ── Gesture camera refs ──
  const gestureVideoRef = useRef<HTMLVideoElement | null>(null);
  const gestureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handLandmarkerRef = useRef<any>(null);
  const gestureRafRef = useRef<number | null>(null);
  const gestureStreamRef = useRef<MediaStream | null>(null);
  const [camActive, setCamActive] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [mediaPipeLoading, setMediaPipeLoading] = useState(false);
  const lastGestureFrameTime = useRef(0);

  // ── Gesture hand state ──
  const [leftHand, setLeftHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  const [rightHand, setRightHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  const [rightZone, setRightZone] = useState(0); // eslint-disable-line @typescript-eslint/no-unused-vars
  const prevRightGestureRef = useRef<GestureId | null>(null);
  const prevSlotRef = useRef<number | null>(null);
  const sustainRef = useRef(false);
  const [isSilenced, setIsSilenced] = useState(false);
  const beatLatchRef = useRef<"stopped" | "playing" | "muted">("stopped");
  const leftGestureTimerRef = useRef<{ gesture: GestureId | null; startMs: number }>({ gesture: null, startMs: 0 });
  const leftLatchCooldownRef = useRef<number>(0);
  const lastLeftVolumeRef = useRef<number>(0.7);
  const lastLeftFilterRef = useRef<number>(4000);
  const [beatLatchState, setBeatLatchState] = useState<"stopped" | "playing" | "muted">("stopped");

  // ── Recording destination node ──
  const [recDestNode, setRecDestNode] = useState<AudioNode | null>(null);

  // ── Drum + chord engines ──
  const audioBus = usePerformAudioBus();
  const bus = audioBus.bus;
  const drum = useDrumEngine(bus?.drumGain ?? recDestNode);
  const chord = useChordSynth();
  const ensureAudioBus = audioBus.ensureBus;
  const resumeAudioBus = audioBus.resume;
  const destroyAudioBus = audioBus.destroy;
  const releaseChord = chord.releaseChord;
  const stopDrums = drum.stop;
  const playDrums = drum.play;

  // ── Trumpet synth (shared bus context — no cross-context crash) ──
  const trumpetEnabled =
    (performLayer === "trumpet" || performLayer === "both") && state === "recording";
  const trumpet = useLiveTrumpet({
    micStream: capturedMicStreamRef.current,
    enabled: trumpetEnabled,
  });
  const trumpetState = {
    active: trumpet.isActive,
    noteName: trumpet.detectedNote ?? "--",
    confidence: trumpet.confidence,
    inputLevel: trumpet.inputLevel,
  };

  // ─── Lyric data ───────────────────────────────────────────────────────────
  const lyricLines = useMemo(() => splitLyricLines(lyrics), [lyrics]);
  const hasLyrics = lyricLines.length > 0;

  // ─── Start-at options ─────────────────────────────────────────────────────
  const startAtOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "0", label: "Beginning (0:00)" },
    ];
    for (const m of markers) {
      opts.push({ value: String(m.time), label: `${m.label} (${fmt(m.time)})` });
    }
    if (typeof loopStart === "number" && loopStart > 0) {
      opts.push({ value: `loop:${loopStart}`, label: `Loop A (${fmt(loopStart)})` });
    }
    opts.push({ value: "custom", label: "Custom\u2026" });
    return opts;
  }, [markers, loopStart]);

  const resolvedStartAt = useMemo<number | null>(() => {
    if (startAtSel === "custom") return parseMmSs(customStart);
    if (startAtSel.startsWith("loop:")) {
      const v = parseFloat(startAtSel.slice(5));
      return Number.isFinite(v) ? v : 0;
    }
    const v = parseFloat(startAtSel);
    return Number.isFinite(v) ? v : 0;
  }, [startAtSel, customStart]);

  // ─── Recording dest setup ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const nextBus = ensureAudioBus();
    recDestRef.current = nextBus.recordDest;
    setRecDestNode(nextBus.recordDest);
    void resumeAudioBus();
  }, [ensureAudioBus, open, resumeAudioBus]);

  // ─── Sync drum preset ─────────────────────────────────────────────────────
  useEffect(() => {
    drum.setPreset(drumPresetName);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drumPresetName]);

  // ─── Sync chord preset ────────────────────────────────────────────────────
  useEffect(() => {
    const slots = SLOT_PRESETS[chordPresetName];
    if (slots) setChordSlots(slots);
  }, [chordPresetName]);

  // ─── Gesture detection ────────────────────────────────────────────────────
  const detectGesture = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (landmarks: any[]): GestureId | null => {
      const indexExtended  = () => landmarks[8].y  < landmarks[6].y;
      const middleExtended = () => landmarks[12].y < landmarks[10].y;
      const ringExtended   = () => landmarks[16].y < landmarks[14].y;
      const pinkyExtended  = () => landmarks[20].y < landmarks[18].y;
      const extCount = [indexExtended(), middleExtended(), ringExtended(), pinkyExtended()].filter(Boolean).length;
      const thumbTip = landmarks[4], indexTip = landmarks[8];
      const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
      if (pinchDist < 0.05) return "pinch";
      if (extCount === 0) return "fist";
      if (extCount === 1 && indexExtended()) return "point";
      if (extCount === 2 && indexExtended() && middleExtended()) return "two";
      if (extCount >= 4) return "open";
      return null;
    },
    []
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawHandLandmarks = useCallback((ctx2d: CanvasRenderingContext2D, lms: any[], w: number, h: number, color: string) => {
    const CONNECTIONS: [number, number][] = [
      [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],[0,17],
    ];
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 1.5;
    for (const [a, b] of CONNECTIONS) {
      ctx2d.beginPath();
      ctx2d.moveTo(lms[a].x * w, lms[a].y * h);
      ctx2d.lineTo(lms[b].x * w, lms[b].y * h);
      ctx2d.stroke();
    }
    ctx2d.fillStyle = color;
    for (const lm of lms) {
      ctx2d.beginPath();
      ctx2d.arc(lm.x * w, lm.y * h, 3, 0, 2 * Math.PI);
      ctx2d.fill();
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const processGestures = useCallback((landmarks: any[][], handedness: any[][]) => {
    let newLeft: HandState  = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };
    let newRight: HandState = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };

    for (let i = 0; i < landmarks.length; i++) {
      const lms  = landmarks[i];
      const side = handedness[i]?.[0]?.categoryName ?? "Right";
      const gesture = detectGesture(lms);
      const wrist = lms[0];
      const hs: HandState = { gesture, wristX: 1 - wrist.x, wristY: wrist.y, present: true };
      if (side === "Left") newRight = hs; // MediaPipe mirrors
      else newLeft = hs;
    }

    setLeftHand(newLeft);
    setRightHand(newRight);

    const left = newLeft;
    const right = newRight;

    // LEFT HAND — latched transport
    if (left.present && left.gesture) {
      const gesture = left.gesture;
      const vol = 1 - left.wristY;
      lastLeftVolumeRef.current = vol;
      lastLeftFilterRef.current = 200 + left.wristX * 7800;
      if (beatLatchRef.current !== "muted") {
        drum.setDrumVolume(vol);
        if (beatSource === "youtube") {
          window.dispatchEvent(new CustomEvent("verses:beat-volume", { detail: { volume: vol * 100 } }));
        }
      }
      drum.setFilterCutoff(lastLeftFilterRef.current);

      if (gesture === leftGestureTimerRef.current.gesture) {
        const held = Date.now() - leftGestureTimerRef.current.startMs;
        const cooldownOk = Date.now() - leftLatchCooldownRef.current > LATCH_COOLDOWN_MS;
        if (held >= LATCH_HOLD_MS && cooldownOk) {
          if (gesture === "open" && beatLatchRef.current !== "playing") {
            if (beatSource === "drums") drum.play();
            else window.dispatchEvent(new CustomEvent("verses:beat-play"));
            beatLatchRef.current = "playing";
            setBeatLatchState("playing");
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          } else if (gesture === "fist" && beatLatchRef.current === "playing") {
            if (beatSource === "drums") drum.stop();
            else window.dispatchEvent(new CustomEvent("verses:beat-pause"));
            beatLatchRef.current = "stopped";
            setBeatLatchState("stopped");
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          } else if (gesture === "pinch") {
            if (beatLatchRef.current === "muted") {
              beatLatchRef.current = "playing";
              setBeatLatchState("playing");
              drum.setDrumVolume(lastLeftVolumeRef.current);
            } else if (beatLatchRef.current === "playing") {
              beatLatchRef.current = "muted";
              setBeatLatchState("muted");
              drum.setDrumVolume(0);
            }
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          }
        }
      } else {
        leftGestureTimerRef.current = { gesture, startMs: Date.now() };
      }
    } else {
      leftGestureTimerRef.current = { gesture: null, startMs: 0 };
    }

    // RIGHT HAND — zone-based chords
    if (right.present && right.gesture) {
      const g = right.gesture;
      const zone = Math.min(3, Math.floor(right.wristX * 4));
      setRightZone(zone);

      if (g === "fist") {
        chord.releaseChord();
        setActiveSlot(null);
        setIsSilenced(true);
        prevSlotRef.current = null;
      } else if (g === "pinch") {
        sustainRef.current = !sustainRef.current;
        if (!sustainRef.current && activeSlot !== null) {
          const slot = chordSlots.find((s) => s.slot === activeSlot);
          if (slot) chord.playChord(slot);
        }
      } else {
        setIsSilenced(false);
        let targetSlot: number;
        if (g === "open" || g === "point") targetSlot = zone + 1;
        else if (g === "two") targetSlot = zone + 5;
        else targetSlot = prevSlotRef.current ?? 1;
        if (targetSlot !== prevSlotRef.current) {
          const slot = chordSlots.find((s) => s.slot === targetSlot);
          if (slot) {
            chord.playChord(slot);
            setActiveSlot(targetSlot);
            prevSlotRef.current = targetSlot;
          }
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatSource, chord, chordSlots, activeSlot, drum]);

  // ─── MediaPipe loading ────────────────────────────────────────────────────
  const loadMediaPipe = useCallback(async () => {
    if (handLandmarkerRef.current) return;
    setMediaPipeLoading(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vision = await import("@mediapipe/tasks-vision" as any);
      const { HandLandmarker, FilesetResolver } = vision;
      const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
      );
      const handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
      handLandmarkerRef.current = handLandmarker;
    } catch (err) {
      console.warn("MediaPipe load failed:", err);
      setCamError("Could not load hand tracking. Camera will show without gesture detection.");
    } finally {
      setMediaPipeLoading(false);
    }
  }, []);

  // ─── Gesture detection loop ───────────────────────────────────────────────
  const gestureDetectionLoop = useCallback(() => {
    const video = gestureVideoRef.current;
    const canvas = gestureCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      gestureRafRef.current = requestAnimationFrame(gestureDetectionLoop);
      return;
    }
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) { gestureRafRef.current = requestAnimationFrame(gestureDetectionLoop); return; }

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    if (showZoneOverlay) {
      // Draw zone dividers
      const w = canvas.width; const h = canvas.height;
      ctx2d.strokeStyle = "rgba(201,168,76,0.25)";
      ctx2d.lineWidth = 1;
      for (let z = 1; z < 4; z++) {
        ctx2d.beginPath();
        ctx2d.moveTo(z * w / 4, 0);
        ctx2d.lineTo(z * w / 4, h);
        ctx2d.stroke();
      }
      const zoneLabels = ["1","2","3","4"];
      ctx2d.fillStyle = "rgba(201,168,76,0.5)";
      ctx2d.font = "11px monospace";
      for (let z = 0; z < 4; z++) {
        ctx2d.fillText(zoneLabels[z], z * w / 4 + 6, 16);
      }
    }

    const now = performance.now();
    if (handLandmarkerRef.current && now - lastGestureFrameTime.current > 33) {
      lastGestureFrameTime.current = now;
      try {
        const result = handLandmarkerRef.current.detectForVideo(video, now);
        if (result.landmarks?.length) {
          processGestures(result.landmarks, result.handedness);
          result.landmarks.forEach((lms: { x: number; y: number; z: number }[], i: number) => {
            const side = result.handedness[i]?.[0]?.categoryName;
            const color = side === "Left" ? "#f59e0b" : "#6366f1";
            drawHandLandmarks(ctx2d, lms, canvas.width, canvas.height, color);
          });
        } else {
          if (prevRightGestureRef.current !== null) {
            chord.releaseChord();
            prevRightGestureRef.current = null;
          }
          setLeftHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
          setRightHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
        }
      } catch {}
    }
    gestureRafRef.current = requestAnimationFrame(gestureDetectionLoop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processGestures, drawHandLandmarks, chord, showZoneOverlay]);

  // ─── Camera start / stop ──────────────────────────────────────────────────
  const startGestureCamera = useCallback(async () => {
    setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      gestureStreamRef.current = stream;
      if (gestureVideoRef.current) {
        gestureVideoRef.current.srcObject = stream;
        await gestureVideoRef.current.play().catch(() => {});
      }
      setCamActive(true);
      await loadMediaPipe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCamError(`Camera error: ${msg}`);
    }
  }, [loadMediaPipe]);

  const stopGestureCamera = useCallback(() => {
    if (gestureRafRef.current !== null) { cancelAnimationFrame(gestureRafRef.current); gestureRafRef.current = null; }
    if (gestureStreamRef.current) {
      gestureStreamRef.current.getTracks().forEach((t) => t.stop());
      gestureStreamRef.current = null;
    }
    if (gestureVideoRef.current) gestureVideoRef.current.srcObject = null;
    setCamActive(false);
    setLeftHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
    setRightHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  }, []);

  // Start gesture detection loop when camera comes online
  useEffect(() => {
    if (camActive) {
      gestureRafRef.current = requestAnimationFrame(gestureDetectionLoop);
    }
    return () => {
      if (gestureRafRef.current !== null) { cancelAnimationFrame(gestureRafRef.current); gestureRafRef.current = null; }
    };
  }, [camActive, gestureDetectionLoop]);

  // ─── Smart lyric follow (forced alignment) ────────────────────────────────
  // We know the written lyrics, so we align the recogniser's drifting tail
  // against a forward window of upcoming tokens (fuzzy: Levenshtein + Soundex),
  // advance a word-level pointer, and auto-restart when the API stops on silence.
  const initSmartFollow = useCallback(() => {
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
        : undefined;

    if (!SpeechRecognitionCtor) {
      setSmartStatus("unavailable");
      setLyricFollowMode("pace");
      return;
    }

    const aligner = createLyricAligner(lyrics);
    alignerRef.current = aligner;
    setSmartLineIndex(0);
    setActiveTokenIndex(0);

    try {
      const rec = new SpeechRecognitionCtor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      speechRecognitionRef.current = rec;
      lastMatchTimeRef.current = Date.now();
      recRestartRef.current = true;
      setSmartStatus("listening");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (evt: any) => {
        let transcript = "";
        for (let i = evt.resultIndex; i < evt.results.length; i++) {
          transcript += evt.results[i][0].transcript + " ";
        }
        const res = aligner.process(transcript);
        if (res.matched) {
          setSmartLineIndex(res.lineIndex);
          setActiveTokenIndex(res.tokenIndex);
          lastMatchTimeRef.current = Date.now();
          setSmartStatus(res.confidence >= 0.5 ? "listening" : "low");
        } else {
          setSmartStatus("low");
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (e: any) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          recRestartRef.current = false;
          setSmartStatus("fallback");
        }
        // 'no-speech' / 'aborted' are benign — onend will restart.
      };

      // The Web Speech API stops on silence; transparently restart it.
      rec.onend = () => {
        if (recRestartRef.current && speechRecognitionRef.current === rec) {
          try { rec.start(); } catch { /* already starting */ }
        }
      };

      rec.start();
    } catch {
      setSmartStatus("unavailable");
      setLyricFollowMode("pace");
    }
  }, [lyrics]);

  const stopSmartFollow = useCallback(() => {
    recRestartRef.current = false;
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.stop();
      } catch { /* ignore */ }
      speechRecognitionRef.current = null;
    }
    alignerRef.current = null;
  }, []);

  // Smart follow fallback watchdog
  useEffect(() => {
    if (state !== "recording" || lyricFollowMode !== "smart") return;
    const id = setInterval(() => {
      const silence = Date.now() - lastMatchTimeRef.current;
      if (silence > 5000) {
        setSmartStatus("fallback");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [state, lyricFollowMode]);

  // ─── Effective teleprompter line ──────────────────────────────────────────
  const isRecording = state === "recording";
  const isPaused = state === "paused";
  const isReview = state === "review";
  const canStart = state === "idle";

  const autoLineIndex = useMemo(() => {
    if (!isRecording || lyricLines.length === 0) return 0;
    const idx = Math.floor(elapsed / Math.max(0.5, secondsPerLine));
    return Math.max(0, Math.min(lyricLines.length - 1, idx));
  }, [elapsed, isRecording, lyricLines.length, secondsPerLine]);

  const currentLineIndex = useMemo(() => {
    if (lyricFollowMode === "smart" && smartStatus !== "fallback" && smartStatus !== "unavailable") {
      return Math.max(0, Math.min(lyricLines.length - 1, smartLineIndex + manualLineOffset));
    }
    return Math.max(0, Math.min(lyricLines.length - 1, autoLineIndex + manualLineOffset));
  }, [lyricFollowMode, smartStatus, smartLineIndex, autoLineIndex, manualLineOffset, lyricLines.length]);

  // Arrow key nudge
  useEffect(() => {
    if (!isRecording || lyricLines.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowDown" || e.key === " ") {
        e.preventDefault();
        setManualLineOffset((v) => v + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setManualLineOffset((v) => v - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isRecording, lyricLines.length]);

  // ─── Meter ────────────────────────────────────────────────────────────────
  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      meterCtxRef.current = ctx;
      analyserRef.current = analyser;
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
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // meter is nice-to-have; ignore
    }
  }, []);

  // ─── Teardown ─────────────────────────────────────────────────────────────
  const teardownStreams = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (tickRef.current !== null) { window.clearInterval(tickRef.current); tickRef.current = null; }
    try { analyserRef.current?.disconnect(); } catch {}
    if (recordMixDestRef.current && bus) {
      try { bus.masterGain.disconnect(recordMixDestRef.current); } catch {}
      recordMixDestRef.current = null;
    }
    analyserRef.current = null;
    if (meterCtxRef.current && meterCtxRef.current.state !== "closed") {
      void meterCtxRef.current.close().catch(() => {});
    }
    meterCtxRef.current = null;
    sourceStreamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    sourceStreamsRef.current = [];
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
    capturedMicStreamRef.current = null;
  }, [bus]);

  const fullCleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;
    chunksRef.current = [];
    teardownStreams();
    // Drum + chord + gesture cleanup
    stopDrums();
    releaseChord();
    void destroyAudioBus();
    recDestRef.current = null;
    setRecDestNode(null);
    stopGestureCamera();
    stopSmartFollow();
    // Beat latch reset
    beatLatchRef.current = "stopped";
    setBeatLatchState("stopped");
    setState("idle");
    setElapsed(0);
    setLevel(0);
    setError(null);
    setManualLineOffset(0);
    setSmartLineIndex(0);
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewBlob(null);
    setReviewUrl(null);
    setReviewDuration(0);
    setLabel("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    destroyAudioBus,
    releaseChord,
    reviewUrl,
    stopDrums,
    stopGestureCamera,
    stopSmartFollow,
    teardownStreams,
  ]);

  useEffect(() => {
    if (!open) fullCleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => { fullCleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── When layer changes, show the panel ──────────────────────────────────
  useEffect(() => {
    if (performLayer !== "none") setLayerPanelOpen(true);
  }, [performLayer]);

  useEffect(() => {
    if (!isMobile) return;
    if (performLayer !== "none") setPerformLayer("none");
    if (layerPanelOpen) setLayerPanelOpen(false);
  }, [isMobile, layerPanelOpen, performLayer]);

  // ─── Begin recording ──────────────────────────────────────────────────────
  const beginRecording = useCallback(async () => {
    setError(null);
    setState("preparing");

    if (startAtSel === "custom" && resolvedStartAt === null) {
      setCustomStartError("Use mm:ss (e.g. 0:42)");
      setState("idle");
      return;
    }
    setCustomStartError(null);

    let micStream: MediaStream | null = null;
    let camStream: MediaStream | null = null;

    try {
      // RAW capture — no browser DSP. Noise suppression / AGC muffle vocals and
      // wreck pitch detection; echo-cancellation strips the beat the mic is
      // meant to hear (Photo-Booth style). We want exactly what was sung.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      sourceStreamsRef.current.push(micStream);
      capturedMicStreamRef.current = micStream;

      if (withVideo) {
        camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        sourceStreamsRef.current.push(camStream);
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = camStream;
          previewVideoRef.current.muted = true;
          await previewVideoRef.current.play().catch(() => {});
        }
      }

      // If hand or both layer and no video cam, start gesture camera separately
      if ((performLayer === "hand" || performLayer === "both") && !camActive) {
        await startGestureCamera();
      }

      startMeter(micStream);

      // Build final stream
      let finalTracks: MediaStreamTrack[] = [];

      if (performLayer !== "none" && recDestRef.current) {
        // Mixed audio from recDest (drum + chord + optional mic tap)
        const activeBus = ensureAudioBus();
        await resumeAudioBus();
        const ctx = activeBus.ctx;
        const mixDest = ctx.createMediaStreamDestination();
        recordMixDestRef.current = mixDest;
        // Connect mic directly
        const micSrc = ctx.createMediaStreamSource(micStream);
        const micGain = ctx.createGain();
        micGain.gain.value = 0.9;
        micSrc.connect(micGain);
        micGain.connect(mixDest);
        try { activeBus.masterGain.connect(mixDest); } catch {}
        finalTracks = [mixDest.stream.getAudioTracks()[0]];
        sourceStreamsRef.current.push(mixDest.stream);
      } else {
        finalTracks = [micStream.getAudioTracks()[0]];
      }

      if (withVideo && camStream) {
        finalTracks.push(camStream.getVideoTracks()[0]);
      }

      const finalStream = new MediaStream(finalTracks.filter(Boolean));
      const isVideo = withVideo && !!camStream;
      const candidates = isVideo ? VIDEO_CANDIDATES : AUDIO_CANDIDATES;
      const mime = pickMime(candidates) ?? (isVideo ? "video/webm" : "audio/webm");

      const recorder = new MediaRecorder(finalStream, {
        mimeType: mime,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const finalDuration = (Date.now() - startedAtRef.current) / 1000;
        // Build with the recorder's *actual* mime, accumulate from chunks.
        const blobType = recorder.mimeType || mime;
        const blob = new Blob(chunksRef.current, { type: blobType });
        chunksRef.current = [];
        stopDrums();
        releaseChord();
        window.dispatchEvent(new CustomEvent("verses:beat-pause"));
        teardownStreams();
        stopSmartFollow();

        // Self-test 1: a non-empty blob actually exists.
        if (!blob || blob.size < 256) {
          setError("Recording came back empty — no audio was captured. Check microphone permissions and try again.");
          setState("idle");
          return;
        }
        const url = URL.createObjectURL(blob);
        // Self-test 2: the blob loads as playable media (metadata resolves).
        const probe = document.createElement("audio");
        probe.preload = "metadata";
        probe.onloadedmetadata = () => {
          if (probe.duration === 0) {
            console.warn("[recorder] captured blob reports zero duration");
          }
        };
        probe.onerror = () => console.warn("[recorder] captured blob failed to load as audio");
        probe.src = url;

        setReviewBlob(blob);
        setReviewUrl(url);
        setReviewMime(blobType);
        setReviewDuration(finalDuration);
        setLabel(defaultLabelForLayer(performLayer));
        setState("review");
      };
      recorderRef.current = recorder;
      recorder.start(250);
      startedAtRef.current = Date.now();
      pausedElapsedRef.current = 0;
      setElapsed(0);
      setManualLineOffset(0);
      setSmartLineIndex(0);
      tickRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }, 200);
      setState("recording");

      // Auto-play beat — works for ALL performLayer values
      if (autoPlayBeat && hasYoutube) {
        // Don't double-play: if hand layer with youtube beat source, this covers it
        // If hand layer with drums beat source, still play youtube if autoPlayBeat is on
        const startAt = typeof resolvedStartAt === "number" ? resolvedStartAt : 0;
        window.dispatchEvent(new CustomEvent("verses:beat-play", { detail: { startAt } }));
      }

      // Smart lyric follow
      if (lyricFollowMode === "smart" && hasLyrics) {
        initSmartFollow();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "Could not access microphone/camera");
      setState("idle");
      teardownStreams();
    }
  }, [
    autoPlayBeat, hasYoutube, resolvedStartAt, startAtSel, startMeter,
    teardownStreams, withVideo, performLayer, camActive,
    ensureAudioBus, hasLyrics, initSmartFollow, lyricFollowMode,
    releaseChord, resumeAudioBus, startGestureCamera, stopDrums, stopSmartFollow,
  ]);

  // ─── Pause / Resume recording ─────────────────────────────────────────────
  const pauseRecording = useCallback(() => {
    if (state !== "recording") return;
    const r = recorderRef.current;
    if (r && r.state === "recording") {
      try { r.pause(); } catch {}
    }
    // Accumulate elapsed time so far
    pausedElapsedRef.current = (Date.now() - startedAtRef.current) / 1000;
    if (tickRef.current !== null) { window.clearInterval(tickRef.current); tickRef.current = null; }
    // Pause beat if playing
    if (autoPlayBeat && hasYoutube) {
      window.dispatchEvent(new CustomEvent("verses:beat-pause"));
    }
    if (performLayer === "hand" || performLayer === "both") {
      stopDrums();
    }
    setState("paused");
  }, [autoPlayBeat, hasYoutube, performLayer, state, stopDrums]);

  const resumeRecording = useCallback(() => {
    if (state !== "paused") return;
    const r = recorderRef.current;
    if (r && r.state === "paused") {
      try { r.resume(); } catch {}
    }
    // Restart elapsed timer from accumulated offset
    startedAtRef.current = Date.now() - pausedElapsedRef.current * 1000;
    tickRef.current = window.setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 200);
    // Resume beat
    if (autoPlayBeat && hasYoutube) {
      window.dispatchEvent(new CustomEvent("verses:beat-play"));
    }
    if (performLayer === "hand" || performLayer === "both") {
      playDrums();
    }
    setState("recording");
  }, [autoPlayBeat, hasYoutube, performLayer, playDrums, state]);

  // ─── Stop recording ───────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (autoPlayBeat && hasYoutube) {
      window.dispatchEvent(new CustomEvent("verses:beat-pause"));
    }
    if (performLayer === "hand" || performLayer === "both") {
      stopDrums();
      releaseChord();
      beatLatchRef.current = "stopped";
      setBeatLatchState("stopped");
    }
    stopSmartFollow();
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try { r.stop(); } catch {}
    }
    if (tickRef.current !== null) { window.clearInterval(tickRef.current); tickRef.current = null; }
  }, [autoPlayBeat, hasYoutube, performLayer, releaseChord, stopDrums, stopSmartFollow]);

  // ─── Discard review ───────────────────────────────────────────────────────
  const discardReview = useCallback(() => {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewBlob(null);
    setReviewUrl(null);
    setReviewDuration(0);
    setLabel("");
    setElapsed(0);
    setManualLineOffset(0);
    setState("idle");
  }, [reviewUrl]);

  // ─── Save take ────────────────────────────────────────────────────────────
  const saveTake = useCallback(async () => {
    if (!reviewBlob) return;
    const trimmed = (label || "").trim() || defaultLabelForLayer(performLayer);
    const take: Take = {
      id: newTakeId(),
      song_id: songId,
      label: trimmed,
      mime: reviewMime,
      duration: reviewDuration,
      size: reviewBlob.size,
      has_video: reviewMime.startsWith("video/"),
      blob: reviewBlob,
      created_at: new Date().toISOString(),
    };
    try {
      await takesStore.put(take);
      toast(`Saved take \u201C${trimmed}\u201D`, "ok");
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Couldn't save take \u2014 ${message}`, "error");
    }
  }, [label, onClose, onSaved, reviewBlob, reviewDuration, reviewMime, songId, toast, performLayer]);

  // ─── Layer selector helpers ───────────────────────────────────────────────
  const allLayerOptions: { value: PerformLayer; label: string }[] = [
    { value: "none",     label: "Normal" },
    { value: "hand",     label: "Hand Gestures" },
    { value: "trumpet",  label: "Live Trumpet" },
    { value: "both",     label: "Gestures + Trumpet" },
  ];
  // On mobile, restrict to Normal only — gesture/trumpet layers require desktop
  const layerOptions = isMobile
    ? allLayerOptions.filter(o => o.value === "none")
    : allLayerOptions;

  const GESTURE_LABELS: Record<GestureId, string> = {
    open: "OPEN", pinch: "PINCH", two: "TWO", fist: "FIST", point: "POINT",
  };

  const chordPresetKeys = Object.keys(SLOT_PRESETS);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Modal open={open} onClose={onClose} title="Record a take" width={(performLayer === "hand" || performLayer === "both") ? "1200px" : "960px"}>
      <div className="flex flex-col gap-4">
        {!isReview ? (
          <>
            {/* ── YouTube info banner ── */}
            {hasYoutube ? (
              <div className="rounded border border-amber-gold/30 bg-amber-gold/5 px-3 py-2 text-[12px] text-ink-text">
                <div className="text-amber-gold">Records what your microphone hears — like Photo Booth.</div>
                <div className="mt-1 text-ink-mute">
                  The YouTube beat plays through your speakers; the mic picks up the beat + your vocals together. No share-screen prompt.
                </div>
              </div>
            ) : null}

            {/* ── Basic controls row ── */}
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-mute">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={withVideo}
                  disabled={isRecording || isPaused || state === "preparing"}
                  onChange={(e) => setWithVideo(e.target.checked)}
                  className="accent-amber-gold"
                />
                record video
              </label>
              {hasYoutube ? (
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoPlayBeat}
                    disabled={isRecording || isPaused || state === "preparing"}
                    onChange={(e) => setAutoPlayBeat(e.target.checked)}
                    className="accent-amber-gold"
                  />
                  auto-play YouTube beat
                </label>
              ) : null}
            </div>

            {/* ── Start-at picker ── */}
            {hasYoutube && autoPlayBeat ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
                  <span>Start at</span>
                  <select
                    value={startAtSel}
                    onChange={(e) => setStartAtSel(e.target.value)}
                    disabled={isRecording || isPaused || state === "preparing"}
                    className="rounded border border-ink-line bg-ink/40 px-2 py-1 text-sm text-ink-text outline-none"
                  >
                    {startAtOptions.map((o, i) => (
                      <option key={`${o.value}-${i}`} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
                {startAtSel === "custom" ? (
                  <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
                    <span>mm:ss</span>
                    <input
                      type="text"
                      placeholder="0:42"
                      value={customStart}
                      onChange={(e) => { setCustomStart(e.target.value); setCustomStartError(null); }}
                      disabled={isRecording || isPaused || state === "preparing"}
                      className={`w-24 rounded border bg-ink/40 px-2 py-1 text-sm text-ink-text outline-none ${
                        customStartError ? "border-red-400/60" : "border-ink-line"
                      }`}
                    />
                  </label>
                ) : null}
                {customStartError ? <div className="text-[11px] text-red-300">{customStartError}</div> : null}
              </div>
            ) : null}

            {/* ── PERFORMANCE LAYERS section ── */}
            <div className={isMobile ? "hidden" : "rounded border border-ink-line"}>
              {/* Header */}
              <button
                type="button"
                onClick={() => setLayerPanelOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
              >
                <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
                  Performance Layers
                </span>
                <span className="font-mono text-[10px] text-ink-mute">
                  {layerPanelOpen ? "▲" : "▼"}
                </span>
              </button>

              {layerPanelOpen ? (
                <div className="border-t border-ink-line px-3 pb-3 pt-2">
                  {/* Mode button group */}
                  <div className="mb-3 flex flex-wrap gap-1">
                    {layerOptions.map((opt) => {
                      const active = performLayer === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={isRecording || isPaused || state === "preparing"}
                          onClick={() => setPerformLayer(opt.value)}
                          className={`rounded border px-3 py-1 font-mono text-[11px] transition-colors ${
                            active
                              ? "border-amber-gold bg-amber-gold/10 text-amber-gold"
                              : "border-ink-line text-ink-mute hover:text-ink-text disabled:opacity-40"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Hand gesture sub-panel */}
                  {(performLayer === "hand" || performLayer === "both") ? (
                    <div className="mb-3 rounded border border-ink-line/60 bg-ink-surface/30 p-3">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-amber-gold">
                        Hand Gestures
                      </div>

                      {/* Beat source */}
                      <div className="mb-2">
                        <div className="mb-1 font-mono text-[10px] text-ink-mute uppercase tracking-wider">Beat source</div>
                        <div className="flex gap-1">
                          {(["drums", "youtube"] as const).map((src) => {
                            const active = beatSource === src;
                            const disabled = src === "youtube" && !hasYoutube;
                            return (
                              <button
                                key={src}
                                type="button"
                                disabled={disabled || isRecording}
                                onClick={() => setBeatSource(src)}
                                className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                  active
                                    ? "border-amber-gold bg-amber-gold/10 text-amber-gold"
                                    : "border-ink-line text-ink-mute hover:text-ink-text disabled:opacity-30"
                                }`}
                              >
                                {src === "drums" ? "DRUMS" : "YOUTUBE BEAT"}
                              </button>
                            );
                          })}
                        </div>
                        {beatSource === "youtube" && !hasYoutube ? (
                          <div className="mt-1 font-mono text-[10px] text-ink-mute">(no beat loaded)</div>
                        ) : beatSource === "youtube" && youtubeSession?.youtube_title ? (
                          <div className="mt-1 font-mono text-[10px] text-ink-mute truncate">
                            {youtubeSession.youtube_title}
                          </div>
                        ) : null}
                      </div>

                      {/* Drum preset */}
                      <div className="mb-2">
                        <div className="mb-1 font-mono text-[10px] text-ink-mute uppercase tracking-wider">Drum preset</div>
                        <div className="flex flex-wrap gap-1">
                          {DRUM_PRESETS.map((p) => (
                            <button
                              key={p.name}
                              type="button"
                              disabled={isRecording || isPaused}
                              onClick={() => setDrumPresetName(p.name)}
                              className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                drumPresetName === p.name
                                  ? "border-amber-gold bg-amber-gold/10 text-amber-gold"
                                  : "border-ink-line text-ink-mute hover:text-ink-text disabled:opacity-40"
                              }`}
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* BPM controls */}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">BPM</span>
                        <button
                          type="button"
                          onClick={() => drum.setBpm(drum.currentBpm - 1)}
                          className="rounded border border-ink-line px-2 py-0.5 font-mono text-[11px] text-ink-mute hover:text-ink-text"
                        >
                          −
                        </button>
                        <span className="w-8 text-center font-mono text-sm text-ink-text tabular-nums">
                          {drum.currentBpm}
                        </span>
                        <button
                          type="button"
                          onClick={() => drum.setBpm(drum.currentBpm + 1)}
                          className="rounded border border-ink-line px-2 py-0.5 font-mono text-[11px] text-ink-mute hover:text-ink-text"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => drum.setBpm(DRUM_PRESETS.find(p => p.name === drumPresetName)?.bpm ?? 88)}
                          className="font-mono text-[10px] text-ink-mute hover:text-ink-text"
                          title="Reset to preset default"
                        >
                          reset
                        </button>
                        <span className="font-mono text-[10px] text-ink-mute/60">
                          {drum.playing ? "● looping" : "◌ stopped"}
                        </span>
                      </div>

                      {/* Chord progression */}
                      <div className="mb-2">
                        <div className="mb-1 font-mono text-[10px] text-ink-mute uppercase tracking-wider">Chord progression</div>
                        <div className="flex flex-wrap gap-1">
                          {chordPresetKeys.map((key) => (
                            <button
                              key={key}
                              type="button"
                              disabled={isRecording || isPaused}
                              onClick={() => setChordPresetName(key)}
                              className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                chordPresetName === key
                                  ? "border-amber-gold bg-amber-gold/10 text-amber-gold"
                                  : "border-ink-line text-ink-mute hover:text-ink-text disabled:opacity-40"
                              }`}
                            >
                              {key}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Chord grid preview */}
                      <div className="mb-2">
                        <div className="mb-1 font-mono text-[10px] text-ink-mute uppercase tracking-wider">Chord slots</div>
                        <div className="grid grid-cols-4 gap-1">
                          {chordSlots.map((slot) => (
                            <div
                              key={slot.slot}
                              className={`rounded border px-1.5 py-1 text-center font-mono text-[10px] ${
                                activeSlot === slot.slot
                                  ? "border-amber-gold bg-amber-gold/10 text-amber-gold"
                                  : "border-ink-line text-ink-mute"
                              }`}
                            >
                              <div className="text-[9px] text-ink-mute/60">{slot.slot}</div>
                              <div>{chordLabel(slot.root, slot.quality)}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Camera preview in setup */}
                      {!isRecording ? (
                        <div className="mt-2">
                          {!camActive ? (
                            <button
                              type="button"
                              onClick={startGestureCamera}
                              className="rounded border border-ink-line px-3 py-1 font-mono text-[11px] text-ink-mute hover:text-ink-text"
                            >
                              Start camera preview
                            </button>
                          ) : (
                            <div className="font-mono text-[10px] text-green-400">● Camera active</div>
                          )}
                          {camError ? <div className="mt-1 font-mono text-[10px] text-red-400">{camError}</div> : null}
                        </div>
                      ) : null}

                      {/* Options */}
                      <div className="flex flex-wrap gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-ink-mute">
                          <input
                            type="checkbox"
                            checked={showZoneOverlay}
                            onChange={(e) => setShowZoneOverlay(e.target.checked)}
                            className="accent-amber-gold"
                          />
                          show zone overlay
                        </label>
                      </div>

                      <div className="mt-2 font-mono text-[10px] text-ink-mute/70">
                        Camera will be used for gesture tracking. Enable &apos;record video&apos; to include it in the recording.
                      </div>
                    </div>
                  ) : null}

                  {/* Trumpet sub-panel */}
                  {(performLayer === "trumpet" || performLayer === "both") ? (
                    <div className="rounded border border-ink-line/60 bg-ink-surface/30 p-3">
                      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-amber-gold">
                        Sampled Trumpet
                      </div>

                      {/* Mode */}
                      <div className="mb-3">
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">Mode</div>
                        <div className="flex gap-1">
                          {([["live", "Live Monitor"], ["convert", "Sing → Convert"]] as const).map(([m, label]) => (
                            <button key={m} type="button" disabled={isRecording || isPaused}
                              onClick={() => trumpet.setMode(m)}
                              className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                trumpet.mode === m ? "border-amber-gold bg-amber-gold/10 text-amber-gold" : "border-ink-line text-ink-mute hover:text-ink-text disabled:opacity-40"}`}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-ink-mute/70">
                          {trumpet.mode === "live"
                            ? "Plays as you sing. ~30–100 ms latency is inherent and can't be fully removed."
                            : "Records dry, then plays a perfectly-tracked trumpet line — cleaner, no latency."}
                        </div>
                      </div>

                      {/* Preset selector */}
                      <div className="mb-3">
                        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-mute">Voice</div>
                        <div className="flex flex-wrap gap-1">
                          {TRUMPET_PRESETS.map((p) => (
                            <button key={p.name} type="button" title={p.blurb}
                              onClick={() => { setTrumpetPresetName(p.name); trumpet.applyPreset(p); }}
                              className={`rounded border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                                trumpetPresetName === p.name ? "border-amber-gold bg-amber-gold/10 text-amber-gold" : "border-ink-line text-ink-mute hover:text-ink-text"}`}>
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Sliders */}
                      <div className="grid grid-cols-3 gap-3">
                        <label className="flex flex-col gap-1">
                          <span className="font-mono text-[10px] text-ink-mute">Brightness {Math.round(trumpet.brightness * 100)}%</span>
                          <input type="range" min="0" max="1" step="0.01" value={trumpet.brightness}
                            onChange={(e) => trumpet.setBrightness(parseFloat(e.target.value))} className="w-full accent-amber-gold" />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="font-mono text-[10px] text-ink-mute">Glide {Math.round(trumpet.portamento * 100)}%</span>
                          <input type="range" min="0" max="1" step="0.01" value={trumpet.portamento}
                            onChange={(e) => trumpet.setPortamento(parseFloat(e.target.value))} className="w-full accent-amber-gold" />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="font-mono text-[10px] text-ink-mute">Output {Math.round(trumpet.outputGain * 100)}%</span>
                          <input type="range" min="0" max="1" step="0.01" value={trumpet.outputGain}
                            onChange={(e) => trumpet.setOutputGain(parseFloat(e.target.value))} className="w-full accent-amber-gold" />
                        </label>
                      </div>

                      {/* Options */}
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-ink-mute">
                          <input type="checkbox" checked={trumpet.snapEnabled}
                            onChange={(e) => trumpet.setSnapEnabled(e.target.checked)} className="accent-amber-gold" />
                          Snap to key
                        </label>
                        {trumpet.snapEnabled && (
                          <>
                            <select value={trumpet.snapKey} onChange={(e) => trumpet.setSnapKey(e.target.value)}
                              className="rounded border border-ink-line bg-ink/40 px-1 py-0.5 font-mono text-[11px] text-ink-text">
                              {["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"].map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                            <select value={trumpet.snapScale} onChange={(e) => trumpet.setSnapScale(e.target.value as typeof trumpet.snapScale)}
                              className="rounded border border-ink-line bg-ink/40 px-1 py-0.5 font-mono text-[11px] text-ink-text">
                              {["major","minor","majorPentatonic","minorPentatonic","dorian","mixolydian","blues"].map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </>
                        )}
                        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-ink-mute">
                          <input type="checkbox" checked={trumpet.rawVoiceMonitor}
                            onChange={(e) => trumpet.setRawVoiceMonitor(e.target.checked)} className="accent-amber-gold" />
                          Monitor raw voice
                        </label>
                      </div>

                      {/* Sing-then-Convert controls */}
                      {trumpet.mode === "convert" && (
                        <div className="mt-3 rounded border border-ink-line/60 bg-ink/20 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {trumpet.captureState === "idle" && (
                              <button type="button" onClick={trumpet.startCapture}
                                className="rounded border border-amber-gold/50 bg-amber-gold/10 px-2 py-0.5 font-mono text-[11px] text-amber-gold">● Sing a phrase</button>
                            )}
                            {trumpet.captureState === "capturing" && (
                              <button type="button" onClick={trumpet.finishCapture}
                                className="rounded border border-red-400/60 bg-red-500/10 px-2 py-0.5 font-mono text-[11px] text-red-200">■ Stop &amp; convert</button>
                            )}
                            {trumpet.captureState === "converting" && (
                              <span className="font-mono text-[11px] text-ink-mute">converting…</span>
                            )}
                            {trumpet.captureState === "ready" && (
                              <>
                                <button type="button" onClick={() => void trumpet.playConverted()}
                                  className="rounded border border-amber-gold/50 bg-amber-gold/10 px-2 py-0.5 font-mono text-[11px] text-amber-gold">▶ Play trumpet</button>
                                <button type="button" onClick={trumpet.clearConvert}
                                  className="rounded border border-ink-line px-2 py-0.5 font-mono text-[11px] text-ink-mute">clear</button>
                                <span className="font-mono text-[10px] text-ink-mute">{trumpet.convertNoteCount} notes</span>
                              </>
                            )}
                          </div>
                          <div className="mt-1 font-mono text-[10px] text-ink-mute/70">
                            Tip: while a take is recording, press Play to capture the clean trumpet into it.
                          </div>
                        </div>
                      )}

                      {trumpet.error && <div className="mt-2 font-mono text-[10px] text-red-400">{trumpet.error}</div>}
                      <div className="mt-2 font-mono text-[10px] text-amber-gold/70">
                        Headphones recommended to prevent feedback.
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* ── Recording area ── */}
            {(performLayer === "hand" || performLayer === "both") && isRecording ? (
              /* Gesture recording layout */
              <div className="flex flex-col gap-3 lg:flex-row">
                {/* LEFT: gesture camera feed */}
                <div className="flex flex-col gap-2 lg:w-[500px] lg:flex-shrink-0">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
                    Camera / Gestures
                    {mediaPipeLoading ? <span className="ml-2 text-amber-gold/60">loading...</span> : null}
                    {camError ? <span className="ml-2 text-red-400">{camError}</span> : null}
                  </div>
                  <div className="mb-1 font-mono text-[10px] text-ink-mute/60">Keep both hands inside the frame</div>
                  <div className="relative aspect-video w-full overflow-hidden rounded border border-ink-line bg-black">
                    {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                    <video
                      ref={gestureVideoRef}
                      className="h-full w-full object-cover"
                      playsInline
                      muted
                    />
                    <canvas
                      ref={gestureCanvasRef}
                      className="pointer-events-none absolute inset-0 h-full w-full"
                    />
                    {!camActive ? (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <button
                          type="button"
                          onClick={startGestureCamera}
                          className="rounded border border-ink-line px-3 py-1.5 font-mono text-[11px] text-ink-mute hover:text-ink-text"
                        >
                          Enable Camera
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {/* Hand status */}
                  {camActive ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded border border-ink-line bg-ink-surface/40 p-2">
                        <div className="mb-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-gold">Left</div>
                        <div className="font-mono text-sm">
                          {leftHand.present && leftHand.gesture ? GESTURE_LABELS[leftHand.gesture] : "—"}
                        </div>
                        <div className="mt-0.5 font-mono text-[9px] text-ink-mute">
                          {beatLatchState === "playing" ? "LOOPING" : beatLatchState === "muted" ? "MUTED" : "STOPPED"}
                        </div>
                      </div>
                      <div className="rounded border border-ink-line bg-ink-surface/40 p-2">
                        <div className="mb-0.5 font-mono text-[9px] uppercase tracking-widest text-indigo-400">Right</div>
                        <div className="font-mono text-sm">
                          {rightHand.present && rightHand.gesture ? GESTURE_LABELS[rightHand.gesture] : "—"}
                        </div>
                        <div className="mt-0.5 font-mono text-[9px] text-ink-mute">
                          {activeSlot ? `Slot ${activeSlot}` : "—"}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* CENTER: meters + teleprompter */}
                <div className="flex flex-1 flex-col gap-3">
                  {/* Beat / chord status */}
                  <div className="flex items-center gap-2 rounded border border-ink-line bg-ink-surface/30 px-3 py-2">
                    <span className="font-mono text-[10px] text-ink-mute uppercase tracking-wider">Beat</span>
                    <span className={`font-mono text-[10px] ${beatLatchState === "playing" ? "text-amber-gold" : "text-ink-mute"}`}>
                      {beatLatchState === "playing" ? "● PLAYING" : beatLatchState === "muted" ? "◌ MUTED" : "◌ STOPPED"}
                    </span>
                    {activeSlot ? (
                      <>
                        <span className="font-mono text-[10px] text-ink-mute">|</span>
                        <span className="font-mono text-[10px] text-indigo-400">
                          Slot {activeSlot}: {chord.currentChord ?? "—"}
                        </span>
                      </>
                    ) : null}
                    {isSilenced ? <span className="font-mono text-[10px] text-red-400">SILENCED</span> : null}
                  </div>

                  {/* Mic meter */}
                  <div>
                    <div className="h-2 w-full overflow-hidden rounded bg-ink-line">
                      <div
                        className="h-full bg-red-400 transition-[width] duration-75"
                        style={{ width: `${Math.round(level * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-ink-mute">
                      <span>mic</span>
                      <span className="font-mono">{isRecording ? `\u25CF ${formatDuration(elapsed)}` : "ready"}</span>
                    </div>
                  </div>

                  <SmartTeleprompter
                    lines={lyricLines}
                    hasLyrics={hasLyrics}
                    isRecording={isRecording}
                    currentLineIndex={currentLineIndex}
                    tokens={lyricTokens}
                    activeTokenIndex={activeTokenIndex}
                    smartActive={lyricFollowMode === "smart" && (smartStatus === "listening" || smartStatus === "low")}
                    lyricFollowMode={lyricFollowMode}
                    smartStatus={smartStatus}
                    secondsPerLine={secondsPerLine}
                    onChangeSecondsPerLine={setSecondsPerLine}
                    onNudge={(d) => setManualLineOffset((v) => v + d)}
                    onChangeMode={setLyricFollowMode}
                  />
                </div>
              </div>
            ) : (
              /* Default recording layout */
              <div className="flex flex-col gap-3 lg:flex-row">
                <div className="flex flex-1 flex-col gap-3">
                  {withVideo ? (
                    <div className="aspect-video w-full overflow-hidden rounded border border-ink-line bg-black">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video
                        ref={previewVideoRef}
                        className="h-full w-full object-cover"
                        playsInline
                        muted
                      />
                    </div>
                  ) : (
                    <div className="rounded border border-ink-line bg-ink/40 px-3 py-6 text-center text-[12px] text-ink-mute">
                      audio-only take
                    </div>
                  )}

                  <div>
                    <div className="h-2 w-full overflow-hidden rounded bg-ink-line">
                      <div
                        className={`h-full transition-[width] duration-75 ${isRecording ? "bg-red-400" : "bg-amber-gold"}`}
                        style={{ width: `${Math.round(level * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-ink-mute">
                      <span>mic</span>
                      <span className="font-mono">
                        {isRecording ? `\u25CF ${formatDuration(elapsed)}` : isPaused ? `\u275A\u275A ${formatDuration(elapsed)}` : state === "preparing" ? "preparing\u2026" : "ready"}
                      </span>
                    </div>
                  </div>

                  {/* Trumpet status bar */}
                  {(performLayer === "trumpet" || performLayer === "both") && isRecording ? (
                    trumpet.error ? (
                      <div className="rounded border border-red-400/50 bg-red-400/5 px-3 py-2 font-mono text-[11px] text-red-400">
                        {trumpet.error}
                      </div>
                    ) : (
                      <div className={`flex items-center gap-3 rounded border px-3 py-2 text-[11px] ${
                        trumpetState.active
                          ? "border-amber-gold/50 bg-amber-gold/5"
                          : "border-ink-line"
                      }`}>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">Trumpet</span>
                        {trumpetState.active ? (
                          <>
                            <span className="font-mono text-amber-gold">{trumpetState.noteName}</span>
                            <div className="flex h-2 flex-1 overflow-hidden rounded bg-ink-line">
                              <div
                                className="h-full bg-amber-gold/70 transition-[width] duration-75"
                                style={{ width: `${Math.round(trumpetState.confidence * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-[10px] text-amber-gold">ACTIVE</span>
                          </>
                        ) : (
                          <span className="font-mono text-ink-mute">listening...</span>
                        )}
                        <div className="h-2 w-16 overflow-hidden rounded bg-ink-line">
                          <div
                            className="h-full bg-indigo-400/60 transition-[width] duration-75"
                            style={{ width: `${Math.round(trumpetState.inputLevel * 100)}%` }}
                          />
                        </div>
                      </div>
                    )
                  ) : null}
                </div>

                <SmartTeleprompter
                  lines={lyricLines}
                  hasLyrics={hasLyrics}
                  isRecording={isRecording}
                  currentLineIndex={currentLineIndex}
                  tokens={lyricTokens}
                  activeTokenIndex={activeTokenIndex}
                  smartActive={lyricFollowMode === "smart" && (smartStatus === "listening" || smartStatus === "low")}
                  lyricFollowMode={lyricFollowMode}
                  smartStatus={smartStatus}
                  secondsPerLine={secondsPerLine}
                  onChangeSecondsPerLine={setSecondsPerLine}
                  onNudge={(d) => setManualLineOffset((v) => v + d)}
                  onChangeMode={setLyricFollowMode}
                />
              </div>
            )}

            {/* ── YouTube capture note ── */}
            {(performLayer === "hand" || performLayer === "both") && beatSource === "youtube" ? (
              <div className="rounded border border-amber-gold/30 bg-amber-gold/5 px-3 py-2 font-mono text-[10px] text-amber-gold/80">
                Note: YouTube audio cannot be captured in recordings due to browser security restrictions.
              </div>
            ) : null}

            {/* ── Error ── */}
            {error ? (
              <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
                {error}
              </div>
            ) : null}

            {/* ── Actions ── */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={state === "preparing"}
                className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink-text"
              >
                Cancel
              </button>
              {isRecording || isPaused ? (
                <div className="flex items-center gap-2">
                  {isRecording ? (
                    <button
                      type="button"
                      onClick={pauseRecording}
                      className="rounded border border-amber-gold/50 bg-amber-gold/10 px-3 py-1.5 text-sm text-amber-gold hover:bg-amber-gold/20"
                    >
                      &#9646;&#9646; Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={resumeRecording}
                      className="rounded border border-emerald-400/50 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-500/20"
                    >
                      &#9654; Resume
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="rounded border border-red-400/70 bg-red-500/20 px-3 py-1.5 text-sm text-red-100 hover:bg-red-500/30"
                  >
                    &#9632; Stop
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={beginRecording}
                  disabled={!canStart}
                  className="rounded border border-red-400/60 bg-red-500/10 px-4 py-1.5 text-sm text-red-200 hover:border-red-400/80 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {state === "preparing" ? "preparing\u2026" : "\u25CF Record"}
                </button>
              )}
            </div>
          </>
        ) : (
          <ReviewView
            url={reviewUrl}
            mime={reviewMime}
            duration={reviewDuration}
            size={reviewBlob?.size ?? 0}
            label={label}
            setLabel={setLabel}
            onDiscard={discardReview}
            onSave={saveTake}
          />
        )}
      </div>
    </Modal>
  );
}

// ─── SmartTeleprompter component ──────────────────────────────────────────────

// Render a lyric line word-by-word, highlighting the word currently being sung
// (and gently dimming the words already passed).
function renderWordHighlighted(line: string, ordinal: number) {
  const parts: ReactNode[] = [];
  const re = /[A-Za-z0-9']+/g;
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const word = m[0];
    if (idx === ordinal) {
      parts.push(<span key={m.index} className="rounded bg-amber-gold/25 px-0.5 text-amber-gold">{word}</span>);
    } else if (idx < ordinal) {
      parts.push(<span key={m.index} className="text-amber-gold/50">{word}</span>);
    } else {
      parts.push(<span key={m.index}>{word}</span>);
    }
    last = m.index + word.length;
    idx++;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

function SmartTeleprompter({
  lines,
  hasLyrics,
  isRecording,
  currentLineIndex,
  tokens = [],
  activeTokenIndex = 0,
  smartActive = false,
  lyricFollowMode,
  smartStatus,
  secondsPerLine,
  onChangeSecondsPerLine,
  onNudge,
  onChangeMode,
}: {
  lines: string[];
  hasLyrics: boolean;
  isRecording: boolean;
  currentLineIndex: number;
  tokens?: LyricToken[];
  activeTokenIndex?: number;
  smartActive?: boolean;
  lyricFollowMode: LyricFollowMode;
  smartStatus: "listening" | "low" | "fallback" | "unavailable";
  secondsPerLine: number;
  onChangeSecondsPerLine: (v: number) => void;
  onNudge: (delta: number) => void;
  onChangeMode: (m: LyricFollowMode) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Active word position for word-by-word highlighting (Smart mode only).
  const activeTok = tokens[activeTokenIndex];
  const activeLine = smartActive && activeTok ? activeTok.line : -1;
  const activeWordOrdinal =
    smartActive && activeTok
      ? tokens.filter((t) => t.line === activeTok.line && t.index <= activeTokenIndex).length - 1
      : -1;

  useEffect(() => {
    const el = lineRefs.current[currentLineIndex];
    const c = containerRef.current;
    if (!el || !c) return;
    const top = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
    c.scrollTo({ top, behavior: "smooth" });
  }, [currentLineIndex]);

  const statusLabel = (): string => {
    if (!isRecording) return "";
    if (lyricFollowMode === "smart") {
      switch (smartStatus) {
        case "listening": return "● Listening";
        case "low":       return "◌ Low confidence";
        case "fallback":  return "◌ Pace fallback";
        case "unavailable": return "◌ Unavailable";
      }
    }
    return "";
  };

  const statusColor = (): string => {
    if (smartStatus === "listening") return "text-green-400";
    if (smartStatus === "low")       return "text-yellow-400";
    return "text-ink-mute";
  };

  return (
    <div className="flex w-full flex-col gap-2 lg:w-[44%]">
      {/* Header */}
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-mute">
        <span>lyrics</span>
        {hasLyrics ? (
          <span className="font-mono normal-case tracking-normal text-ink-mute">
            line {Math.min(currentLineIndex + 1, lines.length)}/{lines.length}
          </span>
        ) : null}
      </div>

      {/* Mode controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5">
          {(["smart", "pace", "manual"] as LyricFollowMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChangeMode(m)}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                lyricFollowMode === m
                  ? "border-amber-gold bg-amber-gold/10 text-amber-gold"
                  : "border-ink-line text-ink-mute hover:text-ink-text"
              }`}
            >
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        {isRecording && lyricFollowMode === "smart" ? (
          <span className={`font-mono text-[10px] ${statusColor()}`}>{statusLabel()}</span>
        ) : null}
        {isRecording && smartStatus === "unavailable" && lyricFollowMode === "smart" ? (
          <span className="font-mono text-[10px] text-ink-mute">Smart follow unavailable — using pace</span>
        ) : null}
        {/* Nudge buttons */}
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={() => onNudge(-1)}
            className="rounded border border-ink-line px-2 py-0.5 font-mono text-[10px] text-ink-mute hover:text-ink-text"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onNudge(1)}
            className="rounded border border-ink-line px-2 py-0.5 font-mono text-[10px] text-ink-mute hover:text-ink-text"
          >
            ↓
          </button>
        </div>
      </div>

      {/* Pace slider (pace mode only) */}
      {lyricFollowMode === "pace" ? (
        <div className="flex items-center gap-2 text-[11px] text-ink-mute">
          <span className="font-mono text-[10px]">{secondsPerLine}s/line</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={secondsPerLine}
            onChange={(e) => onChangeSecondsPerLine(parseFloat(e.target.value))}
            className="flex-1 accent-amber-gold"
          />
        </div>
      ) : null}

      {/* Lyrics scroll box */}
      <div
        ref={containerRef}
        className="font-serif h-56 overflow-y-auto rounded border border-ink-line bg-ink/30 px-4 py-3 leading-relaxed text-ink-text"
      >
        {hasLyrics ? (
          <div className="flex flex-col gap-3">
            <div className="h-16" aria-hidden />
            {lines.map((ln, i) => {
              const isCur = i === currentLineIndex;
              const dist = Math.abs(i - currentLineIndex);
              const opacity = isCur ? 1 : Math.max(0.25, 1 - dist * 0.2);
              const wordHighlight = i === activeLine && activeWordOrdinal >= 0;
              return (
                <div
                  key={i}
                  ref={(el) => { lineRefs.current[i] = el; }}
                  className={isCur ? "text-xl font-medium text-amber-gold" : "text-base text-ink-text"}
                  style={{ opacity }}
                >
                  {wordHighlight ? renderWordHighlighted(ln, activeWordOrdinal) : ln}
                </div>
              );
            })}
            <div className="h-16" aria-hidden />
          </div>
        ) : (
          <div className="font-sans text-[12px] text-ink-mute">
            Write some lyrics in the editor and they&apos;ll show up here as a teleprompter.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ReviewView component ─────────────────────────────────────────────────────

function ReviewView({
  url,
  mime,
  duration,
  size,
  label,
  setLabel,
  onDiscard,
  onSave,
}: {
  url: string | null;
  mime: string;
  duration: number;
  size: number;
  label: string;
  setLabel: (v: string) => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const isVideo = mime.startsWith("video/");
  return (
    <div className="flex flex-col gap-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-amber-gold">
        Review take
      </div>

      {url ? (
        isVideo ? (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <video
            src={url}
            controls
            className="w-full rounded border border-ink-line bg-black"
            style={{ maxHeight: 360 }}
          />
        ) : (
          /* eslint-disable-next-line jsx-a11y/media-has-caption */
          <audio src={url} controls className="w-full" />
        )
      ) : null}

      <div className="flex items-center gap-4 text-[12px] text-ink-mute">
        <span className="font-mono">{formatDuration(duration)}</span>
        <span className="font-mono">{formatBytes(size)}</span>
        <span className="font-mono uppercase">{mime.split(";")[0]}</span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">Label</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="name this take…"
          className="rounded border border-ink-line bg-ink/40 px-3 py-1.5 text-sm text-ink-text outline-none placeholder:text-ink-mute"
        />
      </label>

      <div className="flex items-center justify-between">
        {url ? (
          <a
            href={url}
            download={`${label || "take"}.${isVideo ? "webm" : "webm"}`}
            className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink-text"
          >
            Download
          </a>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink-text"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded border border-amber-gold/60 bg-amber-gold/10 px-4 py-1.5 text-sm text-amber-gold hover:bg-amber-gold/20"
          >
            Save take
          </button>
        </div>
      </div>
    </div>
  );
}
