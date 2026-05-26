"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { takesStore, newTakeId } from "@/lib/takes";
import type { Take } from "@/lib/types";
import { DRUM_PRESETS, useDrumEngine } from "@/hooks/perform/useDrumEngine";
import { usePerformAudioBus } from "@/hooks/perform/usePerformAudioBus";
import {
  NOTE_NAMES,
  INSTRUMENT_PRESETS,
  SLOT_PRESETS,
  chordLabel,
  useChordSynth,
} from "@/hooks/perform/useChordSynth";
import type { ChordQuality, ChordSlot } from "@/hooks/perform/useChordSynth";

// ─── Local Types ─────────────────────────────────────────────────────────────

type GestureId = "open" | "pinch" | "two" | "fist" | "point";

type HandState = {
  gesture: GestureId | null;
  wristX: number;
  wristY: number;
  present: boolean;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const ROOTS = NOTE_NAMES;
const QUALITIES: ChordQuality[] = ["major","minor","maj7","min7","dom7","sus2","sus4","dim","aug","add9","6","min6"];
const GESTURE_LABELS: Record<GestureId, string> = {
  open: "OPEN",
  pinch: "PINCH",
  two: "TWO",
  fist: "FIST",
  point: "POINT",
};

// Latch timing constants
const LATCH_HOLD_MS = 400;
const LATCH_COOLDOWN_MS = 800;

// ─── Piano Keyboard Component ─────────────────────────────────────────────────

function PianoKeyboard({ activeNotes }: { activeNotes: number[] }) {
  const whiteKeys = ["C", "D", "E", "F", "G", "A", "B"];
  const blackKeys = ["C#", "D#", null, "F#", "G#", "A#"];

  const isWhiteActive = (note: string) => {
    return activeNotes.some((n) => NOTE_NAMES[n % 12] === note);
  };

  const isBlackActive = (note: string | null) => {
    if (!note) return false;
    return activeNotes.some((n) => NOTE_NAMES[n % 12] === note);
  };

  return (
    <div className="relative h-16 w-full overflow-hidden rounded-sm border border-ink-line/20">
      {/* White keys — clearly white/ivory */}
      <div className="absolute inset-0 flex gap-px bg-ink-line/30">
        {whiteKeys.map((note) => {
          const active = isWhiteActive(note);
          return (
            <div
              key={note}
              className={`flex flex-1 flex-col items-center justify-end pb-1 transition-colors duration-75 ${
                active
                  ? "bg-amber-400/40 shadow-[inset_0_-3px_0_rgba(251,191,36,0.7)]"
                  : "bg-[#f5f3ef]"
              }`}
            >
              <span className={`font-mono text-[7px] ${active ? "text-amber-700" : "text-neutral-400"}`}>
                {note}
              </span>
            </div>
          );
        })}
      </div>
      {/* Black keys — clearly black */}
      <div className="absolute inset-x-0 top-0 flex px-[7%]">
        {blackKeys.map((note, i) => (
          <div key={i} className="relative flex-1">
            {note && (
              <div
                className={`absolute left-1/2 top-0 h-10 w-[65%] -translate-x-1/2 rounded-b-sm shadow-md transition-colors duration-75 ${
                  isBlackActive(note)
                    ? "bg-amber-500/80 shadow-[0_2px_6px_rgba(251,191,36,0.4)]"
                    : "bg-[#1a1a1a]"
                }`}
              >
                {isBlackActive(note) && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[6px] text-amber-200">
                    {note}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PerformModal({
  open,
  onClose,
  songId,
  onTakeSaved,
  youtubeSession,
}: {
  open: boolean;
  onClose: () => void;
  songId: string;
  onTakeSaved: () => void;
  youtubeSession: {
    youtube_url: string;
    youtube_title: string | null;
    loop_start?: number | null;
    loop_end?: number | null;
  } | null;
}) {
  // MediaPipe refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handLandmarkerRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(0);
  const frameCount = useRef(0);
  const fpsTimer = useRef(0);
  const camStreamRef = useRef<MediaStream | null>(null);

  // Hand tracking refs
  const prevRightGesture = useRef<GestureId | null>(null);

  // Latched transport refs
  const beatLatchRef = useRef<'stopped' | 'playing' | 'muted'>('stopped');
  const leftGestureTimerRef = useRef<{ gesture: GestureId | null; startMs: number }>({ gesture: null, startMs: 0 });
  const leftLatchCooldownRef = useRef<number>(0);
  const lastLeftVolumeRef = useRef<number>(0.7);


  // Chord slot refs
  const prevSlotRef = useRef<number | null>(null);
  const lastChordTriggerMsRef = useRef<number>(0);
  const lastRightActionMsRef = useRef<number>(0);
  const sustainRef = useRef(false);

  // Recording refs
  const recDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStartTimeRef = useRef<number>(0);

  // State
  const [camActive, setCamActive] = useState(false);
  const [mediaPipeLoading, setMediaPipeLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_fps, setFps] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);
  const [beatSource, setBeatSource] = useState<'drums' | 'youtube'>('drums');
  const [chordSlots, setChordSlots] = useState<ChordSlot[]>(SLOT_PRESETS['Pop']);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [isSilenced, setIsSilenced] = useState(false);
  const [masterVol, setMasterVol] = useState(0.80);
  const [drumVol, setDrumVol] = useState(0.70);
  const [chordVol, setChordVol] = useState(0.55);
  const [rightZone, setRightZone] = useState(0);
  const [activeTab, setActiveTab] = useState<'sound' | 'chords' | 'guide'>('sound');
  const [leftHand, setLeftHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  const [rightHand, setRightHand] = useState<HandState>({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  const [showZoneGrid, setShowZoneGrid] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem("verses:showZones");
    return stored !== null ? stored === "true" : true;
  });
  useEffect(() => { localStorage.setItem("verses:showZones", String(showZoneGrid)); }, [showZoneGrid]);





  // Hooks
  const audioBus = usePerformAudioBus();
  const bus = audioBus.bus;
  const getBusCtx = useCallback(() => audioBus.bus?.ctx ?? null, [audioBus.bus]);
  const drum = useDrumEngine(bus?.drumGain ?? null);
  const chord = useChordSynth(bus?.chordGain ?? null, getBusCtx);
  const ensureAudioBus = audioBus.ensureBus;
  const resumeAudioBus = audioBus.resume;
  const destroyAudioBus = audioBus.destroy;
  const releaseChord = chord.releaseChord;
  const stopDrums = drum.stop;
  const busSetMaster = audioBus.setMasterGain;
  const busSetDrum = audioBus.setDrumGain;
  const busSetChord = audioBus.setChordGain;

  useEffect(() => {
    if (!open) return;
    const nextBus = ensureAudioBus();
    recDestRef.current = nextBus.recordDest;
    void resumeAudioBus();
  }, [ensureAudioBus, open, resumeAudioBus]);

  // Sync slider state → bus gain nodes
  useEffect(() => { busSetMaster(masterVol); }, [masterVol, busSetMaster]);
  useEffect(() => { busSetDrum(drumVol); }, [drumVol, busSetDrum]);
  useEffect(() => { busSetChord(chordVol); }, [chordVol, busSetChord]);

  // ── Gesture detection ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detectGesture = useCallback((landmarks: any[]): GestureId | null => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const thumbExtended = () => {
      const tip = landmarks[4], ip = landmarks[3], mcp = landmarks[2];
      return tip.y < ip.y && tip.y < mcp.y;
    };
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
  }, []);

  // ── Draw hand landmarks on canvas ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drawHandLandmarks = useCallback((ctx2d: CanvasRenderingContext2D, lms: any[], w: number, h: number, color: string) => {
    const CONNECTIONS: [number,number][] = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [5,9],[9,10],[10,11],[11,12],
      [9,13],[13,14],[14,15],[15,16],
      [13,17],[17,18],[18,19],[19,20],
      [0,17],
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

  // ── Load MediaPipe (tasks-vision) ──
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

  // ── Process gestures with latched transport and zone-based chords ──
  const processGestures = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    landmarks: any[][],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handedness: any[][]
  ) => {
    let newLeft: HandState  = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };
    let newRight: HandState = { gesture: null, wristX: 0.5, wristY: 0.5, present: false };

    for (let i = 0; i < landmarks.length; i++) {
      const lms  = landmarks[i];
      const side = handedness[i]?.[0]?.categoryName ?? "Right";
      const gesture = detectGesture(lms);
      const wrist = lms[0];
      // Mirror X to match the CSS-mirrored video display.
      // Raw MediaPipe x=0 is left of frame, but display shows it on the right.
      // displayX = 1 - rawX makes zone detection match visible screen position.
      const displayX = 1 - wrist.x;
      const state: HandState = { gesture, wristX: displayX, wristY: wrist.y, present: true };
      // MediaPipe mirrors: "Left" in camera = user's right hand
      if (side === "Left") newRight = state;
      else newLeft = state;
    }

    setLeftHand(newLeft);
    setRightHand(newRight);

    const left  = newLeft;
    const right = newRight;

    // LEFT HAND - Latched transport only (no vertical volume/filter control)
    if (left.present && left.gesture) {
      const gesture = left.gesture;
      
      // Latch logic: track how long gesture has been held
      if (gesture === leftGestureTimerRef.current.gesture) {
        const held = Date.now() - leftGestureTimerRef.current.startMs;
        const cooldownOk = Date.now() - leftLatchCooldownRef.current > LATCH_COOLDOWN_MS;
        
        if (held >= LATCH_HOLD_MS && cooldownOk) {
          // LATCH TRIGGER
          if (gesture === 'open' && beatLatchRef.current !== 'playing') {
            // Start beat
            if (beatSource === 'drums') drum.play();
            else window.dispatchEvent(new CustomEvent('verses:beat-play'));
            beatLatchRef.current = 'playing';
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          } else if (gesture === 'fist' && beatLatchRef.current === 'playing') {
            // Stop beat
            if (beatSource === 'drums') drum.stop();
            else window.dispatchEvent(new CustomEvent('verses:beat-pause'));
            beatLatchRef.current = 'stopped';
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          } else if (gesture === 'pinch') {
            // Toggle mute
            if (beatLatchRef.current === 'muted') {
              beatLatchRef.current = 'playing';
              drum.setDrumVolume(lastLeftVolumeRef.current);
            } else if (beatLatchRef.current === 'playing') {
              beatLatchRef.current = 'muted';
              drum.setDrumVolume(0);
            }
            leftLatchCooldownRef.current = Date.now();
            leftGestureTimerRef.current = { gesture: null, startMs: 0 };
          }
        }
      } else {
        // Gesture changed, reset timer
        leftGestureTimerRef.current = { gesture, startMs: Date.now() };
      }
    } else {
      // Hand absent: KEEP beat state
      leftGestureTimerRef.current = { gesture: null, startMs: 0 };
    }

    // RIGHT HAND - Zone-based chord system + vertical expression
    if (right.present && right.gesture) {
      const g = right.gesture;
      const zone = Math.min(3, Math.floor(right.wristX * 4)); // 0,1,2,3
      setRightZone(zone);
      
      if (g === 'fist') {
        // SILENCE: release all chords immediately
        chord.releaseChord();
        setActiveSlot(null);
        setIsSilenced(true);
        prevSlotRef.current = null;
      } else if (g === 'pinch') {
        const nowMs = Date.now();
        if (nowMs - lastRightActionMsRef.current < 300) return;
        lastRightActionMsRef.current = nowMs;
        sustainRef.current = !sustainRef.current;
        if (!sustainRef.current && activeSlot !== null) {
          const slot = chordSlots.find(s => s.slot === activeSlot);
          if (slot) chord.playChord(slot);
        }
      } else {
        setIsSilenced(false);

        let targetSlot: number;
        if (g === 'open') targetSlot = zone + 1; // 1,2,3,4
        else if (g === 'two') targetSlot = zone + 5; // 5,6,7,8
        else if (g === 'point') targetSlot = zone + 1; // also 1-4 for point
        else targetSlot = prevSlotRef.current ?? 1;
        
        const nowMs = Date.now();
        if (targetSlot !== prevSlotRef.current && nowMs - lastChordTriggerMsRef.current > 180) {
          // New slot — trigger chord
          const slot = chordSlots.find(s => s.slot === targetSlot);
          if (slot) {
            chord.playChord(slot);
            setActiveSlot(targetSlot);
            prevSlotRef.current = targetSlot;
            lastChordTriggerMsRef.current = nowMs;
          }
        }
      }
    } else {
      // Hand absent: freeze last expression, let chord ring
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatSource, chord, chordSlots, activeSlot, drum]);

  // Camera controls
  // ── Detection loop (RAF-based) ──
  const detectionLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(detectionLoop);
      return;
    }
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) { rafRef.current = requestAnimationFrame(detectionLoop); return; }

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const now = performance.now();
    frameCount.current++;
    if (now - fpsTimer.current > 1000) {
      setFps(Math.round((frameCount.current * 1000) / (now - fpsTimer.current)));
      frameCount.current = 0;
      fpsTimer.current = now;
    }

    if (handLandmarkerRef.current && now - lastFrameTime.current > 33) {
      lastFrameTime.current = now;
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
          if (prevRightGesture.current !== null) {
            chord.releaseChord();
            prevRightGesture.current = null;
          }
          setLeftHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
          setRightHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
        }
      } catch {}
    }
    rafRef.current = requestAnimationFrame(detectionLoop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processGestures, drawHandLandmarks, chord]);

  // Start/stop detection loop with camera
  useEffect(() => {
    if (camActive) {
      fpsTimer.current = performance.now();
      rafRef.current = requestAnimationFrame(detectionLoop);
    }
    return () => {
      if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [camActive, detectionLoop]);

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
      setCamActive(true);
      await loadMediaPipe();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCamError(`Camera error: ${msg}`);
    }
  }, [loadMediaPipe]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamActive(false);
    setLeftHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
    setRightHand({ gesture: null, wristX: 0.5, wristY: 0.5, present: false });
  }, []);

  // ── Recording controls ──
  const startRecording = useCallback(() => {
    const activeBus = ensureAudioBus();
    recDestRef.current = activeBus.recordDest;
    void resumeAudioBus();
    const dest = recDestRef.current;
    if (!dest) return;
    const audioStream = dest.stream;
    
    const recorder = new MediaRecorder(audioStream, { mimeType: "audio/webm" });
    recChunksRef.current = [];
    recStartTimeRef.current = Date.now();
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recChunksRef.current.push(e.data);
    };
    
    recorder.onstop = async () => {
      const blob = new Blob(recChunksRef.current, { type: "audio/webm" });
      const durationSec = (Date.now() - recStartTimeRef.current) / 1000;
      const take: Take = {
        id: newTakeId(),
        song_id: songId,
        label: "",
        mime: "audio/webm",
        duration: durationSec,
        size: blob.size,
        has_video: false,
        created_at: new Date().toISOString(),
        blob,
      };
      await takesStore.put(take);
      onTakeSaved();
    };
    
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
  }, [ensureAudioBus, onTakeSaved, resumeAudioBus, songId]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
    stopDrums();
    releaseChord();
    window.dispatchEvent(new CustomEvent('verses:beat-pause'));
    beatLatchRef.current = 'stopped';
  }, [recording, releaseChord, stopDrums]);

  // Update recording timer
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => {
      setRecElapsed(Math.floor((Date.now() - recStartTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [recording]);

  const fullPerformCleanup = useCallback(async () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    recChunksRef.current = [];
    setRecording(false);
    setRecElapsed(0);
    stopCamera();
    stopDrums();
    releaseChord();
    window.dispatchEvent(new CustomEvent("verses:beat-pause"));
    beatLatchRef.current = "stopped";
    leftGestureTimerRef.current = { gesture: null, startMs: 0 };
    prevSlotRef.current = null;
    sustainRef.current = false;
    setActiveSlot(null);
    setIsSilenced(false);
    await destroyAudioBus();
    recDestRef.current = null;
  }, [destroyAudioBus, releaseChord, stopCamera, stopDrums]);

  const handleClose = useCallback(() => {
    void fullPerformCleanup();
    onClose();
  }, [fullPerformCleanup, onClose]);

  useEffect(() => {
    if (!open) void fullPerformCleanup();
  }, [fullPerformCleanup, open]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void fullPerformCleanup();
    };
  }, [fullPerformCleanup]);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!open) return null;

  const currentPreset = DRUM_PRESETS.find((p) => p.name === drum.presetName) ?? DRUM_PRESETS[0];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0d0f] print:hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium tracking-tight text-ink-text/90">
            Perform
          </span>
          {recording && (
            <span className="flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-400">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              {fmtTime(recElapsed)}
            </span>
          )}
          {!recording && camActive && (
            <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowZoneGrid(!showZoneGrid)}
            className={`rounded px-2 py-1 text-[10px] transition-colors ${
              showZoneGrid ? "bg-cyan-400/10 text-cyan-400" : "text-ink-mute/40 hover:text-ink-mute/70"
            }`}
            title="Toggle zone grid overlay"
          >
            Zones
          </button>
          <button
            onClick={handleClose}
            className="rounded px-2.5 py-1 text-[11px] text-ink-mute/50 transition-colors hover:bg-ink-surface/40 hover:text-ink-text"
          >
            Close
          </button>
        </div>
      </div>

      {/* ── Main 2-column layout: Camera (hero) + Right panel ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── Left/Center: Camera stage (dominates — 60%+) ── */}
        <div className="flex min-w-0 flex-[3] flex-col">
          <div className="relative flex-1 overflow-hidden bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            <canvas
              ref={canvasRef}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ transform: "scaleX(-1)" }}
            />
            {!camActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/92">
                <span className="text-sm text-ink-mute/60">Start camera to control rhythm and harmony.</span>
                <span className="text-[11px] text-ink-mute/35">Keep both hands in frame for gesture control.</span>
              </div>
            )}
            {mediaPipeLoading && (
              <div className="absolute bottom-3 left-3 right-3 rounded bg-ink/85 px-3 py-2 backdrop-blur">
                <span className="text-[11px] text-amber-gold">Loading hand tracking…</span>
              </div>
            )}
            {camError && (
              <div className="absolute bottom-3 left-3 right-3 rounded bg-ink/90 px-3 py-2 backdrop-blur">
                <span className="text-[11px] text-red-400">{camError}</span>
              </div>
            )}
            {camActive && (
              <div className="absolute left-3 top-3 flex gap-2">
                <span className="rounded bg-ink/60 px-2 py-1 font-mono text-[10px] text-amber-gold backdrop-blur-sm">
                  L: {leftHand.present ? (GESTURE_LABELS[leftHand.gesture as GestureId] ?? "—") : "—"}
                </span>
                <span className="rounded bg-ink/60 px-2 py-1 font-mono text-[10px] text-cyan-400 backdrop-blur-sm">
                  R: {rightHand.present ? (GESTURE_LABELS[rightHand.gesture as GestureId] ?? "—") : "—"}
                </span>
              </div>
            )}

            {/* Zone overlay indicator at bottom of camera */}
            {camActive && showZoneGrid && (
              <div className="absolute bottom-3 left-3 right-3 flex gap-1">
                {[0, 1, 2, 3].map((z) => (
                  <div
                    key={z}
                    className={`flex-1 rounded py-1 text-center font-mono text-[9px] transition-all duration-100 ${
                      rightZone === z && rightHand.present
                        ? "bg-cyan-400/25 text-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.2)]"
                        : "bg-ink/40 text-ink-mute/30 backdrop-blur-sm"
                    }`}
                  >
                    {z + 1}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Bottom bar: Chord display + gesture quick-ref */}
          <div className="flex items-center gap-4 border-t border-ink-line/15 bg-ink-surface/30 px-5 py-3">
            <div className="flex-1">
              <div className="text-[9px] text-ink-mute/40">Current chord</div>
              <div className="font-serif text-2xl font-bold tracking-tight text-ink-text/90">
                {isSilenced ? <span className="text-ink-mute/40">SILENCE</span> :
                 activeSlot ? chordLabel(
                   chordSlots.find((s) => s.slot === activeSlot)?.root ?? "C",
                   chordSlots.find((s) => s.slot === activeSlot)?.quality ?? "major"
                 ) : <span className="text-ink-mute/30">—</span>}
              </div>
            </div>
            <div className="w-48">
              <PianoKeyboard activeNotes={chord.activeNotes} />
            </div>
            <div className="flex gap-3 text-[8px]">
              <div><span className="text-amber-gold/50">L Open</span> <span className="text-ink-mute/35">Play</span></div>
              <div><span className="text-amber-gold/50">L Fist</span> <span className="text-ink-mute/35">Stop</span></div>
              <div><span className="text-cyan-400/50">R Open</span> <span className="text-ink-mute/35">Chord</span></div>
              <div><span className="text-cyan-400/50">R Fist</span> <span className="text-ink-mute/35">Mute</span></div>
            </div>
          </div>
        </div>

        {/* ── Right panel: Controls ── */}
        <div className="flex w-80 flex-shrink-0 flex-col border-l border-ink-line/10 bg-ink-surface/20">
          {/* Tabs */}
          <div className="flex border-b border-ink-line/10">
            {(['sound', 'chords', 'guide'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-2.5 text-[10px] uppercase tracking-[0.15em] transition-colors ${
                  activeTab === tab
                    ? 'bg-ink-surface/40 text-amber-gold'
                    : 'text-ink-mute/40 hover:text-ink-text/70'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Beat source toggle */}
          <div className="flex border-b border-ink-line/10">
            <button
              onClick={() => {
                if (beatSource === 'youtube') {
                  window.dispatchEvent(new CustomEvent('verses:beat-pause'));
                }
                setBeatSource('drums');
                beatLatchRef.current = 'stopped';
              }}
              className={`flex-1 py-2 text-[10px] tracking-wide transition-colors ${
                beatSource === 'drums' ? 'text-amber-gold bg-amber-gold/5' : 'text-ink-mute/40'
              }`}
            >
              Drums
            </button>
            <button
              onClick={() => {
                drum.stop();
                setBeatSource('youtube');
                beatLatchRef.current = 'stopped';
              }}
              disabled={!youtubeSession}
              className={`flex-1 py-2 text-[10px] tracking-wide transition-colors ${
                beatSource === 'youtube' ? 'text-amber-gold bg-amber-gold/5' :
                youtubeSession ? 'text-ink-mute/40' : 'text-ink-mute/20 cursor-not-allowed'
              }`}
            >
              YouTube
            </button>
          </div>

          {/* Beat status compact */}
          <div className="flex items-center justify-between border-b border-ink-line/10 px-4 py-2.5">
            <div>
              <div className={`font-mono text-[10px] tracking-wider ${
                beatLatchRef.current === 'playing' ? 'text-amber-gold' :
                beatLatchRef.current === 'muted' ? 'text-amber-gold/40' : 'text-ink-mute/30'
              }`}>
                {beatLatchRef.current === 'playing' ? 'PLAYING' :
                 beatLatchRef.current === 'muted' ? 'MUTED' : 'STOPPED'}
              </div>
              <div className="text-sm text-ink-text/80">
                {currentPreset.name}
              </div>
            </div>
            <div className="font-mono text-lg text-ink-mute/50">{drum.currentBpm}</div>
          </div>

          {/* Scrollable tab content */}
          <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
            {activeTab === 'sound' && (
              <div className="space-y-4">
                {/* Drum presets */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Preset</div>
                  <div className="flex flex-wrap gap-1">
                    {DRUM_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        onClick={() => drum.setPreset(preset.name)}
                        className={`rounded px-2 py-1 text-[10px] transition-colors ${
                          drum.presetName === preset.name
                            ? 'bg-amber-gold/15 text-amber-gold'
                            : 'bg-ink-surface/40 text-ink-mute/60 hover:text-ink-text'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Volumes — bus-level gains */}
                <div className="space-y-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[9px] text-ink-mute/50">
                      <span>Master</span><span>{Math.round(masterVol * 100)}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={masterVol}
                      onChange={(e) => setMasterVol(parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[9px] text-ink-mute/50">
                      <span>Drums</span><span>{Math.round(drumVol * 100)}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={drumVol}
                      onChange={(e) => setDrumVol(parseFloat(e.target.value))} className="w-full" />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-[9px] text-ink-mute/50">
                      <span>Chords</span><span>{Math.round(chordVol * 100)}%</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={chordVol}
                      onChange={(e) => setChordVol(parseFloat(e.target.value))} className="w-full" />
                  </div>
                </div>

                {/* BPM */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">BPM</div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => drum.setBpm(drum.currentBpm - 5)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">-5</button>
                    <button onClick={() => drum.setBpm(drum.currentBpm - 1)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">-</button>
                    <span className="min-w-[2.5rem] text-center font-mono text-base text-ink-text">{drum.currentBpm}</span>
                    <button onClick={() => drum.setBpm(drum.currentBpm + 1)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">+</button>
                    <button onClick={() => drum.setBpm(drum.currentBpm + 5)}
                      className="rounded bg-ink-surface/40 px-2 py-1 text-xs text-ink-mute hover:text-ink-text">+5</button>
                    <button onClick={() => drum.setBpm(currentPreset.bpm)}
                      className="ml-auto rounded bg-ink-surface/40 px-2 py-1 text-[9px] uppercase text-ink-mute hover:text-ink-text"
                      title="Reset to preset default">rst</button>
                  </div>
                </div>



                {/* Step Sequencer (read-only visualization) */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Pattern</div>
                  <div className="space-y-0.5">
                    {['kick', 'snare', 'hihat', 'perc'].map(drum => (
                      <div key={drum} className="flex gap-0.5">
                        {currentPreset.pattern[drum as keyof typeof currentPreset.pattern].map((step, i) => (
                          <div key={i} className={`h-3 w-3 rounded-sm ${
                            step ? 'bg-amber-gold/60' : 'bg-ink-surface/30'
                          }`} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Instrument presets */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Instrument</div>
                  <div className="flex flex-wrap gap-1">
                    {INSTRUMENT_PRESETS.map(preset => (
                      <button
                        key={preset.name}
                        onClick={() => chord.setInstrumentPreset(preset.name)}
                        className={`rounded px-2 py-1 text-[10px] transition-colors ${
                          chord.instrumentName === preset.name
                            ? 'bg-amber-gold/15 text-amber-gold'
                            : 'bg-ink-surface/40 text-ink-mute/60 hover:text-ink-text'
                        }`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'chords' && (
              <div className="space-y-4">
                {/* Chord slots (compact pads) */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Chord Pads</div>
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(slot => {
                        const slotData = chordSlots.find(s => s.slot === slot);
                        return (
                          <div key={slot} className={`flex-1 rounded py-2 text-center font-mono text-[10px] transition-all duration-75 ${
                            activeSlot === slot
                              ? 'bg-amber-gold/20 text-amber-gold shadow-[0_0_6px_rgba(201,168,76,0.15)]'
                              : 'bg-ink-surface/40 text-ink-mute/60'
                          }`}>
                            {slotData ? chordLabel(slotData.root, slotData.quality) : slot}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-1">
                      {[5, 6, 7, 8].map(slot => {
                        const slotData = chordSlots.find(s => s.slot === slot);
                        return (
                          <div key={slot} className={`flex-1 rounded py-2 text-center font-mono text-[10px] transition-all duration-75 ${
                            activeSlot === slot
                              ? 'bg-amber-gold/20 text-amber-gold shadow-[0_0_6px_rgba(201,168,76,0.15)]'
                              : 'bg-ink-surface/40 text-ink-mute/60'
                          }`}>
                            {slotData ? chordLabel(slotData.root, slotData.quality) : slot}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Slot preset */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Progression</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(SLOT_PRESETS).map(preset => (
                      <button
                        key={preset}
                        onClick={() => setChordSlots(SLOT_PRESETS[preset])}
                        className={`rounded px-2 py-1 text-[10px] transition-colors ${
                          chordSlots === SLOT_PRESETS[preset]
                            ? 'bg-amber-gold/15 text-amber-gold'
                            : 'bg-ink-surface/40 text-ink-mute/60 hover:text-ink-text'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slot editor */}
                <div>
                  <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/50">Edit Slots</div>
                  <div className="space-y-1.5">
                    {chordSlots.map(slot => (
                      <div key={slot.slot} className="rounded bg-ink-surface/30 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-mono text-[9px] text-ink-mute/50">Slot {slot.slot}</span>
                          <button onClick={() => chord.playChord(slot)}
                            className="text-[9px] text-ink-mute/40 hover:text-amber-gold">Preview</button>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          <select value={slot.root} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], root: e.target.value }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            {ROOTS.map(root => (<option key={root} value={root}>{root}</option>))}
                          </select>
                          <select value={slot.quality} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], quality: e.target.value as ChordQuality }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            {QUALITIES.map(quality => (<option key={quality} value={quality}>{quality}</option>))}
                          </select>
                          <select value={slot.octave} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], octave: parseInt(e.target.value) }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            {[1, 2, 3, 4, 5].map(oct => (<option key={oct} value={oct}>O{oct}</option>))}
                          </select>
                          <select value={slot.inversion} onChange={(e) => {
                            const newSlots = [...chordSlots];
                            const idx = newSlots.findIndex(s => s.slot === slot.slot);
                            if (idx !== -1) { newSlots[idx] = { ...newSlots[idx], inversion: e.target.value as 'root' | 'first' | 'second' }; setChordSlots(newSlots); }
                          }} className="rounded border-none bg-ink/60 px-1 py-0.5 font-mono text-[10px] text-ink-text">
                            <option value="root">Root</option>
                            <option value="first">1st</option>
                            <option value="second">2nd</option>
                          </select>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'guide' && (
              <div className="space-y-4 text-[11px] text-ink-mute/70">
                <div>
                  <div className="mb-2 text-[9px] uppercase tracking-widest text-ink-mute/40">Left Hand — Rhythm</div>
                  <div className="space-y-1">
                    <div><span className="text-amber-gold/70">Open palm</span> — Start beat loop</div>
                    <div><span className="text-amber-gold/70">Fist</span> — Stop beat</div>
                    <div><span className="text-amber-gold/70">Pinch</span> — Mute toggle</div>
                    <div><span className="text-amber-gold/70">Height</span> — Volume</div>
                    <div><span className="text-amber-gold/70">X position</span> — Filter</div>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-[9px] uppercase tracking-widest text-ink-mute/40">Right Hand — Harmony</div>
                  <div className="space-y-1">
                    <div><span className="text-cyan-400/70">Open + zone</span> — Slots 1-4</div>
                    <div><span className="text-cyan-400/70">Two + zone</span> — Slots 5-8</div>
                    <div><span className="text-cyan-400/70">Fist</span> — Silence chords</div>
                    <div><span className="text-cyan-400/70">Pinch</span> — Sustain</div>
                  </div>
                </div>
                <div className="rounded bg-ink-surface/20 p-2 text-[10px] text-ink-mute/40">
                  Camera processes locally. Never leaves device.
                </div>
                {beatSource === 'youtube' && (
                  <div className="rounded bg-amber-gold/5 p-2 text-[10px] text-amber-gold/50">
                    YouTube audio cannot be captured in recordings.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Transport bar ── */}
      <div className="flex items-center justify-between border-t border-ink-line/10 bg-ink-surface/20 px-5 py-2.5">
        <div className="flex items-center gap-2">
          <button
            onClick={camActive ? stopCamera : startCamera}
            className={`rounded px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
              camActive
                ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                : 'bg-amber-gold/10 text-amber-gold hover:bg-amber-gold/20'
            }`}
          >
            {camActive ? 'Stop Camera' : 'Start Camera'}
          </button>

          {beatSource === 'drums' && (
            <button
              onClick={drum.playing ? drum.stop : drum.play}
              className={`rounded px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
                drum.playing
                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'bg-amber-gold/10 text-amber-gold hover:bg-amber-gold/20'
              }`}
            >
              {drum.playing ? 'Stop' : 'Play'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={!camActive}
            className={`rounded px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider transition-all ${
              recording
                ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                : camActive
                ? 'bg-amber-gold/10 text-amber-gold hover:bg-amber-gold/20'
                : 'text-ink-mute/30 cursor-not-allowed'
            }`}
          >
            {recording ? 'Stop Rec' : 'Record'}
          </button>

          <button
            onClick={handleClose}
            className="rounded bg-ink-surface/40 px-3 py-1.5 text-[11px] text-ink-mute transition-colors hover:text-ink-text"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
