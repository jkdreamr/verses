import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GestureId = "open" | "pinch" | "two" | "fist" | "point";

export type HandState = {
  gesture: GestureId | null;
  wristX: number;   // smoothed via EMA
  wristY: number;   // smoothed via EMA
  zone: number;     // 0-3, hysteresis-protected
  present: boolean;
  confident: boolean;
};

type RawLandmark = { x: number; y: number; z: number };

// ─── Smoothing constants ──────────────────────────────────────────────────────

const GESTURE_HISTORY_SIZE  = 8;   // frames kept in rolling buffer
const GESTURE_STABLE_NEEDED = 5;   // must appear in ≥5/8 frames to be reported
const WRIST_SMOOTH_ALPHA    = 0.2; // EMA weight for new value (0.8 for prev)
const ZONE_HYSTERESIS       = 0.08; // min normalised movement to change zone

// ─── Canvas helpers ───────────────────────────────────────────────────────────

const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

// ─── Gesture detection (improved) ────────────────────────────────────────────

function dist3(a: RawLandmark, b: RawLandmark): number {
  return Math.sqrt(
    (a.x - b.x) ** 2 +
    (a.y - b.y) ** 2 +
    (a.z - b.z) ** 2
  );
}

/**
 * Compute palm size as distance from wrist (0) to middle-finger MCP (9).
 * Used to normalise pinch threshold across different hand sizes / depths.
 */
function palmSize(lms: RawLandmark[]): number {
  return Math.max(0.01, dist3(lms[0], lms[9]));
}

/**
 * Detect raw gesture from a single frame of landmarks.
 * Uses palm-size normalised distances and 3D landmark coords.
 */
function detectRawGesture(lms: RawLandmark[]): GestureId | null {
  const palm = palmSize(lms);

  // ── Pinch: thumb tip to index tip ──────────────────────────────────────────
  const pinchDist = dist3(lms[4], lms[8]);
  if (pinchDist < 0.12 * palm) return "pinch";

  // ── Finger extension: tip.y < mcp.y (scaled by palm size for depth) ────────
  const fingerExtended = (tipIdx: number, mcpIdx: number): boolean =>
    lms[tipIdx].y < lms[mcpIdx].y - 0.05 * palm;

  const idxExt   = fingerExtended(8,  5);
  const midExt   = fingerExtended(12, 9);
  const ringExt  = fingerExtended(16, 13);
  const pinkyExt = fingerExtended(20, 17);

  const extCount = [idxExt, midExt, ringExt, pinkyExt].filter(Boolean).length;

  if (extCount === 0)                                         return "fist";
  if (extCount === 1 && idxExt)                              return "point";
  if (extCount === 2 && idxExt && midExt && !ringExt && !pinkyExt) return "two";
  if (extCount >= 4)                                          return "open";
  return null;
}

// ─── Per-hand smoothing state ─────────────────────────────────────────────────

type SmoothState = {
  gestureHistory: (GestureId | null)[];
  smoothedX: number;
  smoothedY: number;
  committedZone: number;
  lastRawX: number; // used for zone hysteresis movement check
};

function makeSmoothState(): SmoothState {
  return {
    gestureHistory: [],
    smoothedX: 0.5,
    smoothedY: 0.5,
    committedZone: 0,
    lastRawX: 0.5,
  };
}

/**
 * Pick the most frequent gesture in the history buffer.
 * Returns null if no gesture is stable enough.
 */
function stableGesture(history: (GestureId | null)[]): GestureId | null {
  const counts = new Map<GestureId | null, number>();
  for (const g of history) {
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  let best: GestureId | null = null;
  let bestCount = 0;
  for (const [g, c] of counts) {
    if (c > bestCount) { bestCount = c; best = g; }
  }
  if (bestCount >= GESTURE_STABLE_NEEDED) return best;
  return null;
}

// ─── Hook config ──────────────────────────────────────────────────────────────

export type UseHandTrackingConfig = {
  onGestureFrame: (left: HandState, right: HandState) => void;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHandTracking({ onGestureFrame }: UseHandTrackingConfig) {
  // DOM refs
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // MediaPipe refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handLandmarkerRef = useRef<any>(null);
  const rafRef            = useRef<number | null>(null);
  const lastFrameTimeRef  = useRef<number>(0);
  const camStreamRef      = useRef<MediaStream | null>(null);

  // FPS accounting
  const frameCountRef = useRef(0);
  const fpsTimerRef   = useRef(0);

  // Smoothing state (mutable, not reactive)
  const leftSmoothRef  = useRef<SmoothState>(makeSmoothState());
  const rightSmoothRef = useRef<SmoothState>(makeSmoothState());

  // Callback ref (keeps onGestureFrame fresh without triggering re-renders)
  const onGestureFrameRef = useRef(onGestureFrame);
  useEffect(() => { onGestureFrameRef.current = onGestureFrame; }, [onGestureFrame]);

  // State
  const [camActive,        setCamActive]        = useState(false);
  const [camError,         setCamError]         = useState<string | null>(null);
  const [mediaPipeLoading, setMediaPipeLoading] = useState(false);
  const [fps,              setFps]              = useState(0);
  const [swapHands,        setSwapHands]        = useState(false);
  const [showSkeleton,     setShowSkeleton]     = useState(true);
  const [showZones,        setShowZones]        = useState(true);

  // ── Smoothing ───────────────────────────────────────────────────────────────

  function updateSmooth(
    state: SmoothState,
    rawX: number,
    rawY: number,
    rawGesture: GestureId | null
  ): { x: number; y: number; zone: number; gesture: GestureId | null; confident: boolean } {
    // Gesture history
    state.gestureHistory.push(rawGesture);
    if (state.gestureHistory.length > GESTURE_HISTORY_SIZE) {
      state.gestureHistory.shift();
    }

    // EMA wrist position
    state.smoothedX = WRIST_SMOOTH_ALPHA * rawX + (1 - WRIST_SMOOTH_ALPHA) * state.smoothedX;
    state.smoothedY = WRIST_SMOOTH_ALPHA * rawY + (1 - WRIST_SMOOTH_ALPHA) * state.smoothedY;

    // Zone hysteresis
    const rawZone = Math.min(3, Math.floor(state.smoothedX * 4));
    const moved   = Math.abs(state.smoothedX - state.lastRawX);
    if (rawZone !== state.committedZone && moved > ZONE_HYSTERESIS) {
      state.committedZone = rawZone;
    }
    state.lastRawX = state.smoothedX;

    const gesture   = stableGesture(state.gestureHistory);
    const confident = gesture !== null && state.smoothedX !== 0 && state.smoothedY !== 0;

    return {
      x:     state.smoothedX,
      y:     state.smoothedY,
      zone:  state.committedZone,
      gesture,
      confident,
    };
  }

  // ── Canvas drawing ──────────────────────────────────────────────────────────

  const drawOverlay = useCallback((
    ctx2d: CanvasRenderingContext2D,
    w: number,
    h: number,
    lmsList: RawLandmark[][],
    sides: string[],
    leftState: HandState,
    rightState: HandState
  ) => {
    // Zone dividers + labels
    if (showZones) {
      const zoneLabels = ["Z1", "Z2", "Z3", "Z4"];
      for (let z = 0; z < 4; z++) {
        const x = (z / 4) * w;

        // Determine active zone (right hand is the chord hand)
        const activeZone = rightState.present ? rightState.zone : -1;
        if (z === activeZone) {
          // Subtle amber fill for active zone
          ctx2d.fillStyle = "rgba(245, 158, 11, 0.10)";
          ctx2d.fillRect(x, 0, w / 4, h);
        }

        // Divider line
        ctx2d.strokeStyle = "rgba(255,255,255,0.15)";
        ctx2d.lineWidth   = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(x, 0);
        ctx2d.lineTo(x, h);
        ctx2d.stroke();

        // Zone label
        ctx2d.fillStyle = "rgba(255,255,255,0.30)";
        ctx2d.font      = "10px monospace";
        ctx2d.fillText(zoneLabels[z], x + 4, 14);
      }
    }

    // Skeleton + gesture labels
    lmsList.forEach((lms, i) => {
      // Determine colour: MediaPipe mirrors camera, "Left" = user's right
      const mpSide  = sides[i] ?? "Right";
      const isRight = mpSide === "Left"; // mirrored
      const color   = isRight ? "#6366f1" : "#f59e0b";
      const label   = isRight ? "R" : "L";
      const state   = isRight ? rightState : leftState;

      if (showSkeleton) {
        // Connections
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth   = 1.5;
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx2d.beginPath();
          ctx2d.moveTo(lms[a].x * w, lms[a].y * h);
          ctx2d.lineTo(lms[b].x * w, lms[b].y * h);
          ctx2d.stroke();
        }
        // Joints
        ctx2d.fillStyle = color;
        for (const lm of lms) {
          ctx2d.beginPath();
          ctx2d.arc(lm.x * w, lm.y * h, 3, 0, 2 * Math.PI);
          ctx2d.fill();
        }
      }

      // L/R + gesture label near wrist
      const wrist = lms[0];
      ctx2d.fillStyle = color;
      ctx2d.font      = "bold 11px monospace";
      const gestureText = state.gesture ? state.gesture.toUpperCase() : "—";
      ctx2d.fillText(`${label}: ${gestureText}`, wrist.x * w + 6, wrist.y * h - 6);
    });
  }, [showSkeleton, showZones]);

  // ── MediaPipe loader ────────────────────────────────────────────────────────

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

  // ── Detection / render loop ─────────────────────────────────────────────────

  const detectionLoop = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(detectionLoop);
      return;
    }

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) {
      rafRef.current = requestAnimationFrame(detectionLoop);
      return;
    }

    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    // FPS counter
    const now = performance.now();
    frameCountRef.current++;
    if (now - fpsTimerRef.current > 1000) {
      setFps(Math.round((frameCountRef.current * 1000) / (now - fpsTimerRef.current)));
      frameCountRef.current = 0;
      fpsTimerRef.current   = now;
    }

    // Run MediaPipe at ~30 fps
    if (handLandmarkerRef.current && now - lastFrameTimeRef.current > 33) {
      lastFrameTimeRef.current = now;

      try {
        const result = handLandmarkerRef.current.detectForVideo(video, now);
        const landmarks: RawLandmark[][]  = result.landmarks  ?? [];
        const handedness: { categoryName: string }[][] = result.handedness ?? [];

        // Build left / right states with smoothing
        let leftState:  HandState = {
          gesture: null, wristX: 0.5, wristY: 0.5, zone: 0, present: false, confident: false,
        };
        let rightState: HandState = {
          gesture: null, wristX: 0.5, wristY: 0.5, zone: 0, present: false, confident: false,
        };

        const sides: string[] = [];

        for (let i = 0; i < landmarks.length; i++) {
          const lms     = landmarks[i];
          const mpSide  = handedness[i]?.[0]?.categoryName ?? "Right";
          sides.push(mpSide);

          // MediaPipe mirrors camera: "Left" in API = user's right hand
          let isRight = mpSide === "Left";
          if (swapHands) isRight = !isRight;

          const rawGesture = detectRawGesture(lms);
          const rawX       = lms[0].x;
          const rawY       = lms[0].y;
          const smooth     = updateSmooth(
            isRight ? rightSmoothRef.current : leftSmoothRef.current,
            rawX, rawY, rawGesture
          );

          const state: HandState = {
            gesture:   smooth.gesture,
            wristX:    smooth.x,
            wristY:    smooth.y,
            zone:      smooth.zone,
            present:   true,
            confident: smooth.confident,
          };

          if (isRight) rightState = state;
          else         leftState  = state;
        }

        // Draw canvas overlay
        drawOverlay(ctx2d, canvas.width, canvas.height, landmarks, sides, leftState, rightState);

        // Fire callback with fresh states
        onGestureFrameRef.current(leftState, rightState);

        // If no hands, reset smooth state so next appearance starts fresh
        if (landmarks.length === 0) {
          leftSmoothRef.current  = makeSmoothState();
          rightSmoothRef.current = makeSmoothState();
          onGestureFrameRef.current(
            { gesture: null, wristX: 0.5, wristY: 0.5, zone: 0, present: false, confident: false },
            { gesture: null, wristX: 0.5, wristY: 0.5, zone: 0, present: false, confident: false }
          );
        }
      } catch (err) {
        // Silently ignore single-frame errors (e.g. video not ready)
        console.debug("Hand detection error:", err);
      }
    }

    rafRef.current = requestAnimationFrame(detectionLoop);
  // drawOverlay is stable; swapHands captured via ref update pattern below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawOverlay]);

  // Keep swapHands accessible inside the loop without recreating it
  const swapHandsRef = useRef(swapHands);
  useEffect(() => { swapHandsRef.current = swapHands; }, [swapHands]);

  // Restart loop when camActive changes
  useEffect(() => {
    if (camActive) {
      fpsTimerRef.current = performance.now();
      rafRef.current      = requestAnimationFrame(detectionLoop);
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [camActive, detectionLoop]);

  // ── Camera controls ─────────────────────────────────────────────────────────

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
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;

    // Reset smoothing state
    leftSmoothRef.current  = makeSmoothState();
    rightSmoothRef.current = makeSmoothState();

    setCamActive(false);
    // Fire callback with absent hands
    onGestureFrameRef.current(
      { gesture: null, wristX: 0.5, wristY: 0.5, zone: 0, present: false, confident: false },
      { gesture: null, wristX: 0.5, wristY: 0.5, zone: 0, present: false, confident: false }
    );
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    // DOM refs (attach to <video> and <canvas>)
    videoRef,
    canvasRef,
    // State
    camActive,
    camError,
    mediaPipeLoading,
    fps,
    // Controls
    startCamera,
    stopCamera,
    // Display options
    swapHands,
    setSwapHands,
    showSkeleton,
    setShowSkeleton,
    showZones,
    setShowZones,
  };
}
