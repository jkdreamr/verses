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

const supportsTabAudio = (): boolean => {
  if (typeof navigator === "undefined") return false;
  if (!navigator.mediaDevices) return false;
  if (typeof navigator.mediaDevices.getDisplayMedia !== "function") return false;
  // Audio capture in getDisplayMedia is currently Chromium-only on desktop.
  // We surface a checkbox either way; if the user chose this and it fails,
  // we fall back gracefully.
  return true;
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

export function RecorderModal({
  open,
  songId,
  hasYoutube,
  markers,
  loopStart,
  onClose,
  onSaved,
}: {
  open: boolean;
  songId: string;
  hasYoutube: boolean;
  markers: YoutubeMarker[];
  loopStart: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<RecState>("idle");
  const [withVideo, setWithVideo] = useState(false);
  const [autoPlayBeat, setAutoPlayBeat] = useState(true);
  const [captureBeat, setCaptureBeat] = useState(true);
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

  const recorderRef = useRef<MediaRecorder | null>(null);
  const sourceStreamsRef = useRef<MediaStream[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const tabAudioSupported = useMemo(() => supportsTabAudio(), []);

  // Build start-at options when markers/loop change
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
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
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
    let tabAudioStream: MediaStream | null = null;

    try {
      // 1) Tab audio (optional). Done first so that if the user cancels the
      //    share dialog, we haven't already triggered other prompts.
      const wantsTabAudio =
        captureBeat && hasYoutube && autoPlayBeat && tabAudioSupported;
      if (wantsTabAudio) {
        try {
          const display = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
          });
          const aTracks = display.getAudioTracks();
          // Always stop the screen-video track; we only want audio.
          display.getVideoTracks().forEach((t) => t.stop());
          if (aTracks.length === 0) {
            aTracks.forEach((t) => t.stop());
            throw new Error(
              'Tab audio share is missing — make sure "Also share tab audio" is checked when sharing.'
            );
          }
          tabAudioStream = new MediaStream(aTracks);
          sourceStreamsRef.current.push(tabAudioStream);
        } catch (err) {
          // If user cancelled, fall back to mic-only mode silently.
          const msg = err instanceof Error ? err.message : String(err);
          if (
            /Permission denied|cancel|aborted|NotAllowed/i.test(msg) &&
            !/share tab audio/i.test(msg)
          ) {
            // user cancelled the share picker — give a clear inline error
            setError("Tab-audio share was cancelled. Recording mic only.");
          } else if (/share tab audio/i.test(msg)) {
            setError(msg);
            setState("idle");
            return;
          } else {
            setError(msg);
          }
          tabAudioStream = null;
        }
      }

      // 2) Mic
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      sourceStreamsRef.current.push(micStream);

      // 3) Camera (separate getUserMedia call so we don't duplicate audio)
      if (withVideo) {
        camStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 720 }, height: { ideal: 540 } },
        });
        sourceStreamsRef.current.push(camStream);
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = camStream;
          previewVideoRef.current.muted = true;
          await previewVideoRef.current.play().catch(() => {});
        }
      }

      // 4) Mix audio: tab audio + mic via AudioContext destination
      let outputAudioTrack: MediaStreamTrack;
      if (tabAudioStream) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ac = new Ctx();
        audioCtxRef.current = ac;
        const dst = ac.createMediaStreamDestination();
        ac.createMediaStreamSource(tabAudioStream).connect(dst);
        ac.createMediaStreamSource(micStream).connect(dst);
        outputAudioTrack = dst.stream.getAudioTracks()[0];
      } else {
        outputAudioTrack = micStream.getAudioTracks()[0];
      }

      // 5) Build final stream
      const finalTracks: MediaStreamTrack[] = [outputAudioTrack];
      if (camStream) {
        finalTracks.push(camStream.getVideoTracks()[0]);
      }
      const finalStream = new MediaStream(finalTracks);

      // 6) Mic-only level meter (so the bar reflects user's voice)
      startMeter(micStream);

      // 7) Pick MIME and start recorder
      const candidates = withVideo ? VIDEO_CANDIDATES : AUDIO_CANDIDATES;
      const mime =
        pickMime(candidates) ?? (withVideo ? "video/webm" : "audio/webm");
      const recorder = new MediaRecorder(finalStream, { mimeType: mime });
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
      tickRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }, 200);
      setState("recording");

      // 8) Auto-play YouTube beat (with seek)
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
    captureBeat,
    hasYoutube,
    resolvedStartAt,
    startAtSel,
    startMeter,
    tabAudioSupported,
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

  return (
    <Modal open={open} onClose={onClose} title="Record a take">
      <div className="flex flex-col gap-4">
        {!isReview ? (
          <>
            {hasYoutube ? (
              <div className="rounded border border-amber-gold/30 bg-amber-gold/5 px-3 py-2 text-[12px] text-ink-text">
                <div className="text-amber-gold">
                  Recording captures the beat + your mic together.
                </div>
                <div className="mt-1 text-ink-mute">
                  When the share prompt appears, pick{" "}
                  <span className="text-ink-text">this tab</span> and check{" "}
                  <span className="text-ink-text">Also share tab audio</span>{" "}
                  before clicking Share. Works in Chrome &amp; Edge.
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
                <>
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
                  <label
                    className={`flex items-center gap-2 ${
                      autoPlayBeat ? "cursor-pointer" : "opacity-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={captureBeat && autoPlayBeat}
                      disabled={
                        !autoPlayBeat ||
                        isRecording ||
                        state === "preparing"
                      }
                      onChange={(e) => setCaptureBeat(e.target.checked)}
                      className="accent-amber-gold"
                    />
                    capture beat in recording
                  </label>
                </>
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
          className="rounded border border-amber-gold/50 bg-amber-gold/10 px-4 py-1.5 text-sm text-amber-gold hover:bg-amber-gold/20"
        >
          Save take
        </button>
      </div>
    </div>
  );
}
