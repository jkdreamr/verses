"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import {
  takesStore,
  newTakeId,
  formatBytes,
  formatDuration,
} from "@/lib/takes";
import type { Take } from "@/lib/types";

type Mode = "auto" | "tap";
type Phase = "configure" | "tapping" | "rendering" | "done";

const VIDEO_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

const pickMime = (candidates: string[]): string | undefined => {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {}
  }
  return undefined;
};

type CaptureStreamableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export function LyricsOverlayModal({
  open,
  takeId,
  lyrics,
  onClose,
  onSaved,
}: {
  open: boolean;
  takeId: string | null;
  lyrics: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [take, setTake] = useState<Take | null>(null);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("auto");
  const [phase, setPhase] = useState<Phase>("configure");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  // Tap-to-sync state
  const [tapTimings, setTapTimings] = useState<number[]>([]);
  const [tapCurrentIdx, setTapCurrentIdx] = useState<number>(0);

  const previewRef = useRef<HTMLVideoElement>(null);
  const tapVideoRef = useRef<HTMLVideoElement>(null);

  // Split lyrics into non-empty lines (preserve structure tags as their own lines)
  const lines = useMemo(() => {
    return lyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  }, [lyrics]);

  // Load the take when the modal opens
  useEffect(() => {
    let cancelled = false;
    if (!open || !takeId) {
      setTake(null);
      setTakeUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    (async () => {
      try {
        const t = await takesStore.get(takeId);
        if (cancelled) return;
        if (!t) {
          setError("Take not found.");
          return;
        }
        setTake(t);
        setTakeUrl(URL.createObjectURL(t.blob));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, takeId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setMode("auto");
      setPhase("configure");
      setProgress(0);
      setError(null);
      setTapTimings([]);
      setTapCurrentIdx(0);
      setOutputBlob(null);
      setOutputUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
  }, [open]);

  // Auto timings (computed from take duration / line count)
  const autoTimings = useMemo<number[]>(() => {
    if (!take || lines.length === 0) return [];
    const dur = take.duration > 0 ? take.duration : 1;
    const per = dur / lines.length;
    return lines.map((_, i) => i * per);
  }, [take, lines]);

  // Effective timings: array of seconds where each lyric line should appear.
  // Length should equal lines.length (one entry per line).
  const effectiveTimings = useMemo<number[]>(() => {
    if (mode === "auto") return autoTimings;
    // tap mode: only lines that have a tap recorded so far
    return tapTimings;
  }, [mode, autoTimings, tapTimings]);

  // ── tap-to-sync ──────────────────────────────────────────────────────────
  const startTapping = useCallback(async () => {
    if (!take || !takeUrl) return;
    setError(null);
    setTapTimings([]);
    setTapCurrentIdx(0);
    setPhase("tapping");
    // small delay to let the hidden video element mount
    setTimeout(async () => {
      const v = tapVideoRef.current;
      if (!v) return;
      try {
        v.currentTime = 0;
        await v.play();
        // First line lands at t=0 (or whenever user wants — we store on tap)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Could not play take: ${msg}`);
        setPhase("configure");
      }
    }, 50);
  }, [take, takeUrl]);

  const tapNext = useCallback(() => {
    const v = tapVideoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setTapTimings((prev) => [...prev, t]);
    setTapCurrentIdx((i) => i + 1);
  }, []);

  // When tap reaches the last line OR video ends, finalize
  useEffect(() => {
    if (phase !== "tapping") return;
    if (tapCurrentIdx >= lines.length) {
      const v = tapVideoRef.current;
      if (v) {
        try {
          v.pause();
        } catch {}
      }
      setPhase("configure");
    }
  }, [phase, tapCurrentIdx, lines.length]);

  useEffect(() => {
    if (phase !== "tapping") return;
    const v = tapVideoRef.current;
    if (!v) return;
    const onEnded = () => {
      setPhase("configure");
    };
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("ended", onEnded);
    };
  }, [phase]);

  const cancelTapping = useCallback(() => {
    const v = tapVideoRef.current;
    if (v) {
      try {
        v.pause();
        v.currentTime = 0;
      } catch {}
    }
    setTapTimings([]);
    setTapCurrentIdx(0);
    setPhase("configure");
  }, []);

  // ── render ───────────────────────────────────────────────────────────────
  const render = useCallback(async () => {
    if (!take || !takeUrl) return;
    setError(null);
    setPhase("rendering");
    setProgress(0);

    let cancelled = false;
    let raf = 0;
    let videoEl: CaptureStreamableVideo | null = null;
    let audioCtx: AudioContext | null = null;

    try {
      videoEl = document.createElement("video") as CaptureStreamableVideo;
      videoEl.src = takeUrl;
      videoEl.crossOrigin = "anonymous";
      videoEl.muted = true; // we route audio via Web Audio API
      videoEl.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        videoEl!.addEventListener("loadedmetadata", () => resolve(), {
          once: true,
        });
        videoEl!.addEventListener(
          "error",
          () => reject(new Error("Failed to load take")),
          { once: true }
        );
      });

      const vw = videoEl.videoWidth || 720;
      const vh = videoEl.videoHeight || 540;
      const totalDuration =
        Number.isFinite(videoEl.duration) && videoEl.duration > 0
          ? videoEl.duration
          : take.duration;

      // Canvas
      const canvas = document.createElement("canvas");
      canvas.width = vw;
      canvas.height = vh;
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) throw new Error("Canvas 2D context unavailable");

      // Audio routing: pull video audio through Web Audio so we can capture it
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaElementSource(videoEl);
      const audioDst = audioCtx.createMediaStreamDestination();
      src.connect(audioDst);
      // Don't connect to audioCtx.destination — we don't want playback during
      // render. The capture is silent for the user.

      // Canvas video stream
      const canvasStream = (
        canvas as HTMLCanvasElement & {
          captureStream: (fps?: number) => MediaStream;
        }
      ).captureStream(30);
      const audioTrack = audioDst.stream.getAudioTracks()[0];
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
      }

      const mime = pickMime(VIDEO_CANDIDATES) ?? "video/webm";
      const recorder = new MediaRecorder(canvasStream, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () =>
          resolve(new Blob(chunks, { type: mime }));
        recorder.onerror = (e) => reject(new Error(`Recorder error: ${e}`));
      });

      recorder.start(250);

      // Unmute the video for proper audio capture (it's routed through the
      // AudioContext, not played to speakers).
      videoEl.muted = false;
      // Some browsers won't decode audio if muted=true was set first; force
      // a second play after unmuting.
      try {
        videoEl.currentTime = 0;
      } catch {}
      await videoEl.play();

      const draw = () => {
        if (cancelled || !videoEl) return;
        const t = videoEl.currentTime;
        ctx2d.fillStyle = "#000";
        ctx2d.fillRect(0, 0, vw, vh);
        try {
          ctx2d.drawImage(videoEl, 0, 0, vw, vh);
        } catch {
          // first frame may not be ready yet
        }
        const idx = findActiveLineIndex(effectiveTimings, t, lines.length);
        if (idx >= 0 && idx < lines.length) {
          drawCaption(ctx2d, lines[idx], vw, vh);
        }
        if (totalDuration > 0) {
          setProgress(Math.min(1, t / totalDuration));
        }
        if (videoEl.ended || videoEl.currentTime >= totalDuration - 0.05) {
          // schedule a tiny delay so the recorder picks up the final frame
          window.setTimeout(() => {
            try {
              recorder.stop();
            } catch {}
          }, 80);
          return;
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);

      const blob = await finished;
      if (cancelled) return;

      const blobUrl = URL.createObjectURL(blob);
      setOutputBlob(blob);
      setOutputUrl(blobUrl);
      setPhase("done");
      setProgress(1);
    } catch (err) {
      cancelled = true;
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Render failed: ${msg}`);
      setPhase("configure");
    } finally {
      if (raf) cancelAnimationFrame(raf);
      if (videoEl) {
        try {
          videoEl.pause();
        } catch {}
        videoEl.src = "";
        videoEl.load();
      }
      if (audioCtx && audioCtx.state !== "closed") {
        void audioCtx.close().catch(() => {});
      }
    }
  }, [effectiveTimings, lines, take, takeUrl]);

  const saveAsNewTake = useCallback(async () => {
    if (!take || !outputBlob) return;
    const newId = newTakeId();
    const newLabel = `${take.label} \u00b7 with lyrics`;
    const newTake: Take = {
      id: newId,
      song_id: take.song_id,
      label: newLabel,
      mime: outputBlob.type || "video/webm",
      duration: take.duration,
      size: outputBlob.size,
      has_video: true,
      blob: outputBlob,
      created_at: new Date().toISOString(),
    };
    try {
      await takesStore.put(newTake);
      toast(`Saved "${newLabel}"`, "ok");
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Couldn't save \u2014 ${msg}`, "error");
    }
  }, [take, outputBlob, toast, onSaved]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Add lyrics overlay">
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
            {error}
          </div>
        ) : null}

        {!take ? (
          <div className="px-2 py-6 text-center text-sm text-ink-mute">
            loading take…
          </div>
        ) : phase === "rendering" ? (
          <RenderingView progress={progress} />
        ) : phase === "tapping" ? (
          <TappingView
            videoRef={tapVideoRef}
            url={takeUrl}
            lines={lines}
            currentIdx={tapCurrentIdx}
            timings={tapTimings}
            onTap={tapNext}
            onCancel={cancelTapping}
          />
        ) : phase === "done" ? (
          <DoneView
            url={outputUrl}
            blob={outputBlob}
            onSave={saveAsNewTake}
            onClose={onClose}
            onRedo={() => {
              if (outputUrl) URL.revokeObjectURL(outputUrl);
              setOutputUrl(null);
              setOutputBlob(null);
              setProgress(0);
              setPhase("configure");
            }}
          />
        ) : (
          <ConfigureView
            take={take}
            takeUrl={takeUrl}
            previewRef={previewRef}
            lines={lines}
            mode={mode}
            setMode={setMode}
            tapTimings={tapTimings}
            startTapping={startTapping}
            onRender={render}
          />
        )}
      </div>
    </Modal>
  );
}

// ─── views ──────────────────────────────────────────────────────────────────

function ConfigureView({
  take,
  takeUrl,
  previewRef,
  lines,
  mode,
  setMode,
  tapTimings,
  startTapping,
  onRender,
}: {
  take: Take;
  takeUrl: string | null;
  previewRef: React.RefObject<HTMLVideoElement>;
  lines: string[];
  mode: Mode;
  setMode: (m: Mode) => void;
  tapTimings: number[];
  startTapping: () => void;
  onRender: () => void;
}) {
  const tapsComplete =
    tapTimings.length > 0 && tapTimings.length === lines.length;
  const canRender =
    lines.length > 0 && (mode === "auto" || tapsComplete);

  return (
    <>
      <div className="text-[12px] uppercase tracking-wider text-ink-mute">
        {take.label} · {formatDuration(take.duration)} ·{" "}
        {formatBytes(take.size)}
      </div>

      {takeUrl ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={previewRef}
          src={takeUrl}
          controls
          className="aspect-video w-full rounded border border-ink-line bg-black"
        />
      ) : null}

      <div className="rounded border border-ink-line bg-ink/40 px-3 py-2 text-[12px] text-ink-mute">
        <div className="text-ink-text">
          {lines.length} lyric line{lines.length === 1 ? "" : "s"} from this
          song
        </div>
        {lines.length === 0 ? (
          <div className="mt-1">
            Write some lyrics in the editor first — then come back and
            add them as captions.
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 text-[12px] text-ink-mute">
        <span className="text-[11px] uppercase tracking-wider text-ink-mute">
          timing
        </span>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="overlay-mode"
            checked={mode === "auto"}
            onChange={() => setMode("auto")}
            className="mt-0.5 accent-amber-gold"
          />
          <span>
            <span className="text-ink-text">auto-paced</span> — lines
            divide the take duration evenly. Quick and works well for short
            takes.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="overlay-mode"
            checked={mode === "tap"}
            onChange={() => setMode("tap")}
            className="mt-0.5 accent-amber-gold"
          />
          <span>
            <span className="text-ink-text">tap to sync</span> — play the
            take and tap as each line lands. More precise.
          </span>
        </label>
      </div>

      {mode === "tap" ? (
        <div className="rounded border border-ink-line bg-ink/40 px-3 py-2 text-[12px] text-ink-mute">
          {tapTimings.length === 0 ? (
            <>
              <div className="text-ink-text">
                Tap-to-sync not recorded yet.
              </div>
              <div className="mt-1">
                Click {"\u201C"}start sync{"\u201D"} below; the take will
                play and you tap a button as each line begins.
              </div>
            </>
          ) : tapsComplete ? (
            <div className="text-amber-gold">
              ✓ timings captured ({tapTimings.length} lines)
            </div>
          ) : (
            <div>
              Captured {tapTimings.length} of {lines.length} lines so far.
            </div>
          )}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        {mode === "tap" ? (
          <button
            type="button"
            onClick={startTapping}
            disabled={lines.length === 0}
            className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-text hover:border-amber-gold/40 hover:text-amber-gold disabled:opacity-40"
          >
            {tapTimings.length > 0 ? "re-record sync" : "start sync"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRender}
          disabled={!canRender}
          className="rounded border border-amber-gold/50 bg-amber-gold/10 px-4 py-1.5 text-sm text-amber-gold hover:bg-amber-gold/20 disabled:opacity-40"
        >
          render with lyrics
        </button>
      </div>
    </>
  );
}

function TappingView({
  videoRef,
  url,
  lines,
  currentIdx,
  timings,
  onTap,
  onCancel,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  url: string | null;
  lines: string[];
  currentIdx: number;
  timings: number[];
  onTap: () => void;
  onCancel: () => void;
}) {
  const currentLine = lines[currentIdx];
  const nextLine = lines[currentIdx + 1];
  const done = currentIdx >= lines.length;

  // Spacebar / Enter triggers tap
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (done) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onTap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, onTap]);

  return (
    <>
      <div className="text-[12px] uppercase tracking-wider text-ink-mute">
        tap-to-sync · line {Math.min(currentIdx + 1, lines.length)} of{" "}
        {lines.length}
      </div>
      {url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          ref={videoRef}
          src={url}
          autoPlay
          controls
          className="aspect-video w-full rounded border border-ink-line bg-black"
        />
      ) : null}

      <div className="rounded border border-amber-gold/30 bg-amber-gold/5 px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-amber-gold/70">
          now showing
        </div>
        <div className="font-serif text-lg text-ink-text">
          {done ? "done!" : currentLine}
        </div>
        {nextLine ? (
          <>
            <div className="mt-2 text-[10px] uppercase tracking-wider text-ink-mute">
              next
            </div>
            <div className="font-serif text-sm text-ink-mute">
              {nextLine}
            </div>
          </>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink-text"
        >
          cancel
        </button>
        <div className="text-[11px] text-ink-mute">
          {timings.length}/{lines.length} captured
        </div>
        <button
          type="button"
          onClick={onTap}
          disabled={done}
          className="rounded border border-amber-gold/60 bg-amber-gold/15 px-6 py-2 text-base text-amber-gold hover:bg-amber-gold/25 disabled:opacity-40"
          title="Tap as each line begins (or press Space)"
        >
          {done ? "✓ done" : "tap → next line"}
        </button>
      </div>
      <div className="text-center text-[11px] text-ink-mute">
        keyboard: space or enter
      </div>
    </>
  );
}

function RenderingView({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col gap-3 px-2 py-6">
      <div className="text-center text-sm text-ink-text">
        rendering video with captions…
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-ink-line">
        <div
          className="h-full bg-amber-gold transition-[width] duration-150"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <div className="text-center text-[11px] text-ink-mute">
        {Math.round(progress * 100)}%
      </div>
      <div className="text-center text-[11px] text-ink-mute">
        keep this tab in the foreground for best results.
      </div>
    </div>
  );
}

function DoneView({
  url,
  blob,
  onSave,
  onClose,
  onRedo,
}: {
  url: string | null;
  blob: Blob | null;
  onSave: () => void;
  onClose: () => void;
  onRedo: () => void;
}) {
  return (
    <>
      <div className="text-[12px] uppercase tracking-wider text-ink-mute">
        rendered ✓ {blob ? `· ${formatBytes(blob.size)}` : ""}
      </div>
      {url ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video
          src={url}
          controls
          autoPlay
          className="aspect-video w-full rounded border border-ink-line bg-black"
        />
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onRedo}
          className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink-text"
        >
          redo
        </button>
        <button
          type="button"
          onClick={() => {
            onSave();
            onClose();
          }}
          className="rounded border border-amber-gold/50 bg-amber-gold/10 px-4 py-1.5 text-sm text-amber-gold hover:bg-amber-gold/20"
        >
          save as new take
        </button>
      </div>
    </>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function findActiveLineIndex(
  timings: number[],
  t: number,
  totalLines: number
): number {
  if (timings.length === 0) return -1;
  // last timing whose value <= t
  let idx = -1;
  for (let i = 0; i < timings.length && i < totalLines; i++) {
    if (timings[i] <= t) idx = i;
    else break;
  }
  return idx;
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  text: string,
  vw: number,
  vh: number
) {
  const fontSize = Math.max(18, Math.round(vh * 0.06));
  const lineHeight = Math.round(fontSize * 1.25);
  const padding = Math.round(vh * 0.045);

  ctx.font = `bold ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const maxWidth = vw * 0.88;
  const wrapped = wrapText(ctx, text, maxWidth);
  const totalH = wrapped.length * lineHeight;
  const baseY = vh - padding - (wrapped.length - 1) * lineHeight;

  // Translucent backdrop spanning the widest line
  let widest = 0;
  for (const ln of wrapped) {
    const w = ctx.measureText(ln).width;
    if (w > widest) widest = w;
  }
  const boxW = Math.min(maxWidth, widest + fontSize * 1.1);
  const boxH = totalH + fontSize * 0.6;
  const boxX = (vw - boxW) / 2;
  const boxY = baseY - lineHeight + fontSize * 0.05;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  roundRect(ctx, boxX, boxY, boxW, boxH, Math.min(16, fontSize * 0.4));
  ctx.fill();

  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.08));
  ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
  ctx.fillStyle = "#ffffff";

  let y = baseY;
  for (const ln of wrapped) {
    ctx.strokeText(ln, vw / 2, y);
    ctx.fillText(ln, vw / 2, y);
    y += lineHeight;
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/);
  const result: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      result.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) result.push(cur);
  return result;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
