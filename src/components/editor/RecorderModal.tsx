"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { takesStore, newTakeId, formatBytes, formatDuration } from "@/lib/takes";
import type { Take, YoutubeMarker } from "@/lib/types";

type RecState = "idle" | "preparing" | "recording" | "review";

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

// High export bitrates so downloads look/sound clean for social posts.
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

const defaultLabelForNow = (): string => {
  const d = new Date();
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `take ${hh}:${mm}`;
};

const splitLyricLines = (lyrics: string): string[] =>
  lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function RecorderModal({
  open,
  songId,
  hasYoutube,
  markers,
  loopStart,
  lyrics,
  onClose,
  onSaved,
}: {
  open: boolean;
  songId: string;
  hasYoutube: boolean;
  markers: YoutubeMarker[];
  loopStart: number | null;
  lyrics: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
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

  // Start-at picker state
  const [startAtSel, setStartAtSel] = useState<string>("0");
  const [customStart, setCustomStart] = useState<string>("");
  const [customStartError, setCustomStartError] = useState<string | null>(null);

  // Teleprompter state
  const [secondsPerLine, setSecondsPerLine] = useState<number>(3);
  const [manualLineOffset, setManualLineOffset] = useState<number>(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const sourceStreamsRef = useRef<MediaStream[]>([]);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const lyricLines = useMemo(() => splitLyricLines(lyrics), [lyrics]);
  const hasLyrics = lyricLines.length > 0;

  const startAtOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [
      { value: "0", label: "Beginning (0:00)" },
    ];
    for (const m of markers) {
      opts.push({
        value: String(m.time),
        label: `${m.label} (${fmt(m.time)})`,
      });
    }
    if (typeof loopStart === "number" && loopStart > 0) {
      opts.push({
        value: `loop:${loopStart}`,
        label: `Loop A (${fmt(loopStart)})`,
      });
    }
    opts.push({ value: "custom", label: "Custom\u2026" });
    return opts;
  }, [markers, loopStart]);

  const resolvedStartAt = useMemo<number | null>(() => {
    if (startAtSel === "custom") {
      return parseMmSs(customStart);
    }
    if (startAtSel.startsWith("loop:")) {
      const v = parseFloat(startAtSel.slice(5));
      return Number.isFinite(v) ? v : 0;
    }
    const v = parseFloat(startAtSel);
    return Number.isFinite(v) ? v : 0;
  }, [startAtSel, customStart]);

  const teardownStreams = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    if (meterCtxRef.current && meterCtxRef.current.state !== "closed") {
      void meterCtxRef.current.close().catch(() => {});
    }
    meterCtxRef.current = null;
    sourceStreamsRef.current.forEach((s) => {
      s.getTracks().forEach((t) => t.stop());
    });
    sourceStreamsRef.current = [];
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  }, []);

  const fullCleanup = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try {
        recorderRef.current.stop();
      } catch {}
    }
    recorderRef.current = null;
    chunksRef.current = [];
    teardownStreams();
    setState("idle");
    setElapsed(0);
    setLevel(0);
    setError(null);
    setManualLineOffset(0);
    if (reviewUrl) {
      URL.revokeObjectURL(reviewUrl);
    }
    setReviewBlob(null);
    setReviewUrl(null);
    setReviewDuration(0);
    setLabel("");
  }, [reviewUrl, teardownStreams]);

  // close on modal close
  useEffect(() => {
    if (!open) {
      fullCleanup();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // unmount cleanup
  useEffect(() => {
    return () => {
      fullCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
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
      // meter is a nice-to-have; ignore failures
    }
  }, []);

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
      // Mic — always required.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      sourceStreamsRef.current.push(micStream);

      // Camera (separate getUserMedia call so we don't double up audio).
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

      // Build final stream — mic audio + (optional) camera video.
      const finalTracks: MediaStreamTrack[] = [
        micStream.getAudioTracks()[0],
      ];
      if (camStream) {
        finalTracks.push(camStream.getVideoTracks()[0]);
      }
      const finalStream = new MediaStream(finalTracks);

      startMeter(micStream);

      const candidates = withVideo ? VIDEO_CANDIDATES : AUDIO_CANDIDATES;
      const mime =
        pickMime(candidates) ?? (withVideo ? "video/webm" : "audio/webm");
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
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        teardownStreams();
        const url = URL.createObjectURL(blob);
        setReviewBlob(blob);
        setReviewUrl(url);
        setReviewMime(mime);
        setReviewDuration(finalDuration);
        setLabel(defaultLabelForNow());
        setState("review");
      };
      recorderRef.current = recorder;
      recorder.start(250);
      startedAtRef.current = Date.now();
      setElapsed(0);
      setManualLineOffset(0);
      tickRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }, 200);
      setState("recording");

      if (autoPlayBeat && hasYoutube) {
        const startAt =
          typeof resolvedStartAt === "number" ? resolvedStartAt : 0;
        window.dispatchEvent(
          new CustomEvent("verses:beat-play", { detail: { startAt } })
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "Could not access microphone/camera");
      setState("idle");
      teardownStreams();
    }
  }, [
    autoPlayBeat,
    hasYoutube,
    resolvedStartAt,
    startAtSel,
    startMeter,
    teardownStreams,
    withVideo,
  ]);

  const stopRecording = useCallback(() => {
    if (autoPlayBeat && hasYoutube) {
      window.dispatchEvent(new CustomEvent("verses:beat-pause"));
    }
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {}
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, [autoPlayBeat, hasYoutube]);

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

  const saveTake = useCallback(async () => {
    if (!reviewBlob) return;
    const trimmed = (label || "").trim() || defaultLabelForNow();
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
  }, [
    label,
    onClose,
    onSaved,
    reviewBlob,
    reviewDuration,
    reviewMime,
    songId,
    toast,
  ]);

  const isRecording = state === "recording";
  const isReview = state === "review";
  const canStart = state === "idle";

  // Effective teleprompter line index: auto by elapsed time + manual offset.
  const autoLineIndex = useMemo(() => {
    if (!isRecording || lyricLines.length === 0) return 0;
    const idx = Math.floor(elapsed / Math.max(0.5, secondsPerLine));
    return Math.max(0, Math.min(lyricLines.length - 1, idx));
  }, [elapsed, isRecording, lyricLines.length, secondsPerLine]);

  const currentLineIndex = useMemo(() => {
    return Math.max(
      0,
      Math.min(lyricLines.length - 1, autoLineIndex + manualLineOffset)
    );
  }, [autoLineIndex, manualLineOffset, lyricLines.length]);

  // Manual nudge with arrow keys / space while recording.
  useEffect(() => {
    if (!isRecording || lyricLines.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
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

  return (
    <Modal open={open} onClose={onClose} title="Record a take" width="900px">
      <div className="flex flex-col gap-4">
        {!isReview ? (
          <>
            {hasYoutube ? (
              <div className="rounded border border-amber-gold/30 bg-amber-gold/5 px-3 py-2 text-[12px] text-ink-text">
                <div className="text-amber-gold">
                  Records what your microphone hears — like Photo Booth.
                </div>
                <div className="mt-1 text-ink-mute">
                  The YouTube beat plays through your speakers; the mic picks
                  up the beat + your vocals together. No share-screen prompt.
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-mute">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={withVideo}
                  disabled={isRecording || state === "preparing"}
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
                    disabled={isRecording || state === "preparing"}
                    onChange={(e) => setAutoPlayBeat(e.target.checked)}
                    className="accent-amber-gold"
                  />
                  auto-play YouTube beat
                </label>
              ) : null}
            </div>

            {hasYoutube && autoPlayBeat ? (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
                  <span>Start at</span>
                  <select
                    value={startAtSel}
                    onChange={(e) => setStartAtSel(e.target.value)}
                    disabled={isRecording || state === "preparing"}
                    className="rounded border border-ink-line bg-ink/40 px-2 py-1 text-sm text-ink-text outline-none"
                  >
                    {startAtOptions.map((o, i) => (
                      <option key={`${o.value}-${i}`} value={o.value}>
                        {o.label}
                      </option>
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
                      onChange={(e) => {
                        setCustomStart(e.target.value);
                        setCustomStartError(null);
                      }}
                      disabled={isRecording || state === "preparing"}
                      className={`w-24 rounded border bg-ink/40 px-2 py-1 text-sm text-ink-text outline-none ${
                        customStartError
                          ? "border-red-400/60"
                          : "border-ink-line"
                      }`}
                    />
                  </label>
                ) : null}
                {customStartError ? (
                  <div className="text-[11px] text-red-300">
                    {customStartError}
                  </div>
                ) : null}
              </div>
            ) : null}

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
                      className={`h-full transition-[width] duration-75 ${
                        isRecording ? "bg-red-400" : "bg-amber-gold"
                      }`}
                      style={{ width: `${Math.round(level * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-ink-mute">
                    <span>mic</span>
                    <span className="font-mono">
                      {isRecording
                        ? `\u25CF ${formatDuration(elapsed)}`
                        : state === "preparing"
                        ? "preparing\u2026"
                        : "ready"}
                    </span>
                  </div>
                </div>
              </div>

              <Teleprompter
                lines={lyricLines}
                hasLyrics={hasLyrics}
                isRecording={isRecording}
                currentLineIndex={currentLineIndex}
                secondsPerLine={secondsPerLine}
                onChangeSecondsPerLine={setSecondsPerLine}
                onNudge={(d) => setManualLineOffset((v) => v + d)}
              />
            </div>

            {error ? (
              <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={state === "preparing"}
                className="rounded border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink-text"
              >
                Cancel
              </button>
              {isRecording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded border border-red-400/70 bg-red-500/20 px-4 py-1.5 text-sm text-red-100 hover:bg-red-500/30"
                >
                  ■ Stop
                </button>
              ) : (
                <button
                  type="button"
                  onClick={beginRecording}
                  disabled={!canStart}
                  className="rounded border border-red-400/60 bg-red-500/10 px-4 py-1.5 text-sm text-red-200 hover:border-red-400/80 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {state === "preparing"
                    ? "preparing\u2026"
                    : "\u25CF Record"}
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

function Teleprompter({
  lines,
  hasLyrics,
  isRecording,
  currentLineIndex,
  secondsPerLine,
  onChangeSecondsPerLine,
  onNudge,
}: {
  lines: string[];
  hasLyrics: boolean;
  isRecording: boolean;
  currentLineIndex: number;
  secondsPerLine: number;
  onChangeSecondsPerLine: (v: number) => void;
  onNudge: (delta: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const el = lineRefs.current[currentLineIndex];
    const c = containerRef.current;
    if (!el || !c) return;
    const top = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
    c.scrollTo({ top, behavior: "smooth" });
  }, [currentLineIndex]);

  return (
    <div className="flex w-full flex-col gap-2 lg:w-[44%]">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-mute">
        <span>lyrics</span>
        {hasLyrics ? (
          <span className="font-mono normal-case tracking-normal text-ink-mute">
            line {Math.min(currentLineIndex + 1, lines.length)}/{lines.length}
          </span>
        ) : null}
      </div>
      <div
        ref={containerRef}
        className="font-serif leading-relaxed h-64 overflow-y-auto rounded border border-ink-line bg-ink/30 px-4 py-3 text-ink-text"
      >
        {hasLyrics ? (
          <div className="flex flex-col gap-3">
            <div className="h-20" aria-hidden />
            {lines.map((ln, i) => {
              const isCur = i === currentLineIndex;
              const dist = Math.abs(i - currentLineIndex);
              const opacity = isCur ? 1 : Math.max(0.25, 1 - dist * 0.2);
              return (
                <div
                  key={i}
                  ref={(el) => {
                    lineRefs.current[i] = el;
                  }}
                  className={
                    isCur
                      ? "text-xl font-medium text-amber-gold"
                      : "text-base text-ink-text"
                  }
                  style={{ opacity }}
                >
                  {ln}
                </div>
              );
            })}
            <div className="h-20" aria-hidden />
          </div>
        ) : (
          <div className="font-sans text-[12px] text-ink-mute">
            Write some lyrics in the editor and they&apos;ll show up here as a
            teleprompter while you record.
          </div>
        )}
      </div>
      {hasLyrics ? (
        <div className="flex items-center justify-between gap-2 text-[11px] text-ink-mute">
          <label className="flex items-center gap-2">
            <span>pace</span>
            <input
              type="range"
              min={1.2}
              max={6}
              step={0.2}
              value={secondsPerLine}
              onChange={(e) =>
                onChangeSecondsPerLine(parseFloat(e.target.value))
              }
              className="w-24 accent-amber-gold"
            />
            <span className="font-mono">
              {secondsPerLine.toFixed(1)}s/line
            </span>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onNudge(-1)}
              disabled={!isRecording}
              className="rounded border border-ink-line px-2 py-0.5 text-[11px] text-ink-mute hover:text-ink-text disabled:opacity-40"
              title="Previous line (up arrow)"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onNudge(1)}
              disabled={!isRecording}
              className="rounded border border-ink-line px-2 py-0.5 text-[11px] text-ink-mute hover:text-ink-text disabled:opacity-40"
              title="Next line (down arrow or space)"
            >
              ↓
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
      <div className="text-[12px] uppercase tracking-wider text-ink-mute">
        Review your take · {formatDuration(duration)} ·{" "}
        {formatBytes(size)}
      </div>
      {url ? (
        isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={url}
            controls
            className="aspect-video w-full rounded border border-ink-line bg-black"
          />
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio src={url} controls className="w-full" />
        )
      ) : null}

      <label className="flex flex-col gap-1 text-[12px] text-ink-mute">
        <span>label</span>
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={defaultLabelForNow()}
          className="rounded border border-ink-line bg-ink/40 px-3 py-1.5 text-sm text-ink-text outline-none"
        />
      </label>

      <div className="flex items-center justify-end gap-2">
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
  );
}
