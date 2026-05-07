"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { takesStore, newTakeId, formatBytes, formatDuration } from "@/lib/takes";
import type { Take } from "@/lib/types";

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

export function RecorderModal({
  open,
  songId,
  hasYoutube,
  onClose,
  onSaved,
}: {
  open: boolean;
  songId: string;
  hasYoutube: boolean;
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

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const teardownStream = useCallback(() => {
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
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
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
    teardownStream();
    setState("idle");
    setElapsed(0);
    setLevel(0);
    setError(null);
    if (reviewUrl) {
      URL.revokeObjectURL(reviewUrl);
    }
    setReviewBlob(null);
    setReviewUrl(null);
    setReviewDuration(0);
    setLabel("");
  }, [reviewUrl, teardownStream]);

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
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      audioCtxRef.current = ctx;
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
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: withVideo
          ? { width: { ideal: 720 }, height: { ideal: 540 } }
          : false,
      });
      streamRef.current = stream;
      if (withVideo && previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        previewVideoRef.current.muted = true;
        await previewVideoRef.current.play().catch(() => {});
      }
      startMeter(stream);
      const candidates = withVideo ? VIDEO_CANDIDATES : AUDIO_CANDIDATES;
      const mime = pickMime(candidates) ?? (withVideo ? "video/webm" : "audio/webm");
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const finalDuration = (Date.now() - startedAtRef.current) / 1000;
        const blob = new Blob(chunksRef.current, { type: mime });
        chunksRef.current = [];
        teardownStream();
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
      tickRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }, 200);
      setState("recording");
      if (autoPlayBeat && hasYoutube) {
        window.dispatchEvent(new CustomEvent("verses:beat-play"));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || "Could not access microphone/camera");
      setState("idle");
      teardownStream();
    }
  }, [autoPlayBeat, hasYoutube, startMeter, teardownStream, withVideo]);

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
  const canStart = state === "idle" && !error;

  return (
    <Modal open={open} onClose={onClose} title="Record a take">
      <div className="flex flex-col gap-4">
        {!isReview ? (
          <>
            <div className="rounded border border-amber-gold/30 bg-amber-gold/5 px-3 py-2 text-[12px] text-ink-text">
              <div className="text-amber-gold">Headphones recommended.</div>
              <div className="mt-1 text-ink-mute">
                Browsers can&apos;t capture YouTube&apos;s audio directly, so
                wear headphones to keep the beat out of your mic.
              </div>
            </div>

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

            <div className="flex items-center gap-3">
              <div className="flex-1">
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
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="take 1 · verse 2 idea · hook …"
          className="rounded border border-ink-line bg-ink/60 px-3 py-1.5 text-sm text-ink-text focus:border-amber-gold/60"
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
          className="rounded border border-amber-gold/50 bg-amber-gold/10 px-3 py-1.5 text-sm text-amber-gold hover:bg-amber-gold/20"
        >
          Save take
        </button>
      </div>
    </div>
  );
}

function defaultLabelForNow(): string {
  const d = new Date();
  const time = `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
  return `Take \u00b7 ${time}`;
}
