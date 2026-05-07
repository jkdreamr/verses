"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import {
  audibleTracks,
  decodeTrack,
  emptySession,
  newTrackId,
  studioStore,
  totalSessionBytes,
} from "@/lib/studio";
import { formatBytes, formatDuration } from "@/lib/takes";
import type { StudioSession, StudioTrack } from "@/lib/types";

type RecState = "idle" | "preparing" | "recording";

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
    } catch {}
  }
  return undefined;
};

const defaultTrackLabel = (n: number) => `track ${n}`;

export function StudioModal({
  open,
  songId,
  songTitle,
  onClose,
}: {
  open: boolean;
  songId: string;
  songTitle: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [session, setSession] = useState<StudioSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recState, setRecState] = useState<RecState>("idle");
  const [recError, setRecError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [exporting, setExporting] = useState(false);

  // Master playback state
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0); // seconds within longest track

  // Playback machinery — kept in refs so updates don't recreate Web Audio graph
  const playCtxRef = useRef<AudioContext | null>(null);
  const playSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const trackGainsRef = useRef<Map<string, GainNode>>(new Map());
  const masterGainRef = useRef<GainNode | null>(null);
  const decodedRef = useRef<Map<string, AudioBuffer>>(new Map());
  const playStartedAtRef = useRef<number>(0); // ctx.currentTime when started
  const playStartOffsetRef = useRef<number>(0); // seconds already elapsed at start
  const playRafRef = useRef<number | null>(null);

  // Recording machinery
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const meterCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recStartedAtRef = useRef<number>(0);
  const recTickRef = useRef<number | null>(null);
  const recMimeRef = useRef<string>("audio/webm");

  // Load existing session when modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const existing = await studioStore.getForSong(songId);
        if (cancelled) return;
        setSession(existing ?? emptySession(songId));
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError(msg);
        setSession(emptySession(songId));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, songId]);

  // Persist session changes (autosave).
  useEffect(() => {
    if (!open || !session) return;
    const t = window.setTimeout(() => {
      void studioStore
        .put({ ...session, updated_at: new Date().toISOString() })
        .catch(() => {});
    }, 200);
    return () => window.clearTimeout(t);
  }, [open, session]);

  const stopMaster = useCallback(() => {
    playSourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {}
      try {
        s.disconnect();
      } catch {}
    });
    playSourcesRef.current = [];
    if (playRafRef.current !== null) {
      cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
    setPlaying(false);
  }, []);

  const teardownPlay = useCallback(() => {
    stopMaster();
    trackGainsRef.current.clear();
    decodedRef.current.clear();
    masterGainRef.current = null;
    if (playCtxRef.current && playCtxRef.current.state !== "closed") {
      void playCtxRef.current.close().catch(() => {});
    }
    playCtxRef.current = null;
  }, [stopMaster]);

  const teardownRecording = useCallback(() => {
    if (meterRafRef.current !== null) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    if (recTickRef.current !== null) {
      window.clearInterval(recTickRef.current);
      recTickRef.current = null;
    }
    try {
      analyserRef.current?.disconnect();
    } catch {}
    analyserRef.current = null;
    if (meterCtxRef.current && meterCtxRef.current.state !== "closed") {
      void meterCtxRef.current.close().catch(() => {});
    }
    meterCtxRef.current = null;
    if (recStreamRef.current) {
      recStreamRef.current.getTracks().forEach((t) => t.stop());
      recStreamRef.current = null;
    }
  }, []);

  // Cleanup on close / unmount
  useEffect(() => {
    if (!open) {
      teardownPlay();
      teardownRecording();
      setRecState("idle");
      setElapsed(0);
      setLevel(0);
      setPlayPos(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    return () => {
      teardownPlay();
      teardownRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── recording ──────────────────────────────────────────────────────────────
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
        meterRafRef.current = requestAnimationFrame(tick);
      };
      meterRafRef.current = requestAnimationFrame(tick);
    } catch {}
  }, []);

  const startRecording = useCallback(async () => {
    if (recState !== "idle") return;
    setRecError(null);
    setRecState("preparing");
    // Stop master playback while we record so the mic doesn't pick it up.
    stopMaster();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      recStreamRef.current = stream;
      startMeter(stream);
      const mime = pickMime(AUDIO_CANDIDATES) ?? "audio/webm";
      recMimeRef.current = mime;
      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        audioBitsPerSecond: 192_000,
      });
      recChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const finalDuration = (Date.now() - recStartedAtRef.current) / 1000;
        const blob = new Blob(recChunksRef.current, { type: mime });
        recChunksRef.current = [];
        teardownRecording();
        setRecState("idle");
        setElapsed(0);
        setLevel(0);

        // Append the new track to the session.
        setSession((prev) => {
          const cur = prev ?? emptySession(songId);
          const nextIdx = cur.tracks.length + 1;
          const newTrack: StudioTrack = {
            id: newTrackId(),
            label: defaultTrackLabel(nextIdx),
            blob,
            mime,
            duration: finalDuration,
            volume: 1,
            muted: false,
            solo: false,
            created_at: new Date().toISOString(),
          };
          return { ...cur, tracks: [...cur.tracks, newTrack] };
        });
        toast("Track added \u2713", "ok");
      };
      recorderRef.current = recorder;
      recorder.start(250);
      recStartedAtRef.current = Date.now();
      setElapsed(0);
      recTickRef.current = window.setInterval(() => {
        setElapsed((Date.now() - recStartedAtRef.current) / 1000);
      }, 200);
      setRecState("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRecError(message || "Could not access microphone");
      setRecState("idle");
      teardownRecording();
    }
  }, [recState, songId, startMeter, stopMaster, teardownRecording, toast]);

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {}
    }
  }, []);

  // ── per-track mutations ────────────────────────────────────────────────────
  const updateTrack = useCallback(
    (id: string, patch: Partial<StudioTrack>) => {
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tracks: prev.tracks.map((t) =>
            t.id === id ? { ...t, ...patch } : t
          ),
        };
      });
      // Apply gain change immediately if we're playing.
      const gainNode = trackGainsRef.current.get(id);
      const ctx = playCtxRef.current;
      if (gainNode && ctx && patch.volume !== undefined) {
        try {
          gainNode.gain.setValueAtTime(patch.volume, ctx.currentTime);
        } catch {}
      }
    },
    []
  );

  const deleteTrack = useCallback(
    (id: string) => {
      // If playing, stop first to avoid mid-track state mismatch.
      stopMaster();
      setSession((prev) => {
        if (!prev) return prev;
        return { ...prev, tracks: prev.tracks.filter((t) => t.id !== id) };
      });
    },
    [stopMaster]
  );

  const setMasterVolume = useCallback((v: number) => {
    setSession((prev) => (prev ? { ...prev, master_volume: v } : prev));
    const g = masterGainRef.current;
    const ctx = playCtxRef.current;
    if (g && ctx) {
      try {
        g.gain.setValueAtTime(v, ctx.currentTime);
      } catch {}
    }
  }, []);

  // Apply mute/solo changes during playback by toggling per-track gain.
  const applyAudibleGains = useCallback(() => {
    if (!session) return;
    const ctx = playCtxRef.current;
    if (!ctx) return;
    const audibleIds = new Set(audibleTracks(session.tracks).map((t) => t.id));
    for (const t of session.tracks) {
      const g = trackGainsRef.current.get(t.id);
      if (!g) continue;
      const target = audibleIds.has(t.id) ? t.volume : 0;
      try {
        g.gain.setValueAtTime(target, ctx.currentTime);
      } catch {}
    }
  }, [session]);

  useEffect(() => {
    applyAudibleGains();
  }, [applyAudibleGains]);

  // ── master playback ────────────────────────────────────────────────────────
  const longestDuration = useMemo(() => {
    if (!session) return 0;
    return session.tracks.reduce((m, t) => Math.max(m, t.duration), 0);
  }, [session]);

  const startMaster = useCallback(
    async (fromSeconds: number = 0) => {
      if (!session || session.tracks.length === 0) return;
      stopMaster();
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!playCtxRef.current || playCtxRef.current.state === "closed") {
          playCtxRef.current = new Ctx();
        }
        const ctx = playCtxRef.current;

        if (!masterGainRef.current) {
          masterGainRef.current = ctx.createGain();
          masterGainRef.current.gain.value = session.master_volume;
          masterGainRef.current.connect(ctx.destination);
        } else {
          try {
            masterGainRef.current.gain.setValueAtTime(
              session.master_volume,
              ctx.currentTime
            );
          } catch {}
        }
        const masterGain = masterGainRef.current;

        // Decode any tracks we haven't seen yet.
        for (const t of session.tracks) {
          if (!decodedRef.current.has(t.id)) {
            const buf = await decodeTrack(ctx, t);
            decodedRef.current.set(t.id, buf);
          }
        }

        // Build/refresh per-track gain nodes.
        for (const t of session.tracks) {
          if (!trackGainsRef.current.has(t.id)) {
            const g = ctx.createGain();
            g.connect(masterGain);
            trackGainsRef.current.set(t.id, g);
          }
        }

        const audibleIds = new Set(
          audibleTracks(session.tracks).map((t) => t.id)
        );

        const startAt = ctx.currentTime + 0.05;
        for (const t of session.tracks) {
          const buf = decodedRef.current.get(t.id);
          const g = trackGainsRef.current.get(t.id);
          if (!buf || !g) continue;
          // Apply current gain (zero if not audible).
          const targetGain = audibleIds.has(t.id) ? t.volume : 0;
          try {
            g.gain.setValueAtTime(targetGain, ctx.currentTime);
          } catch {}
          if (fromSeconds >= buf.duration) continue;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(g);
          src.start(startAt, fromSeconds);
          playSourcesRef.current.push(src);
        }
        playStartedAtRef.current = startAt;
        playStartOffsetRef.current = fromSeconds;
        setPlaying(true);

        // Drive playPos for UI; auto-stop when we exceed longestDuration.
        const tick = () => {
          if (!playCtxRef.current) return;
          const t =
            playStartOffsetRef.current +
            (playCtxRef.current.currentTime - playStartedAtRef.current);
          setPlayPos(Math.max(0, t));
          if (longestDuration > 0 && t >= longestDuration + 0.05) {
            stopMaster();
            setPlayPos(0);
            return;
          }
          playRafRef.current = requestAnimationFrame(tick);
        };
        playRafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Couldn't start playback \u2014 ${msg}`, "error");
      }
    },
    [longestDuration, session, stopMaster, toast]
  );

  // ── export mix ─────────────────────────────────────────────────────────────
  const exportMix = useCallback(async () => {
    if (!session) return;
    const audible = audibleTracks(session.tracks);
    if (audible.length === 0) {
      toast("Nothing to export \u2014 add or unmute a track first", "error");
      return;
    }
    setExporting(true);
    try {
      const probe =
        new (window.AudioContext ||
          (
            window as unknown as {
              webkitAudioContext: typeof AudioContext;
            }
          ).webkitAudioContext)();
      const sampleRate = probe.sampleRate;
      await probe.close().catch(() => {});

      // Decode every audible track with the same offline context.
      let maxDuration = 0;
      const buffers: { track: StudioTrack; buf: AudioBuffer }[] = [];
      const offlineProbe = new OfflineAudioContext(
        2,
        Math.ceil(sampleRate * 1),
        sampleRate
      );
      for (const t of audible) {
        const buf = await decodeTrack(offlineProbe, t);
        buffers.push({ track: t, buf });
        if (buf.duration > maxDuration) maxDuration = buf.duration;
      }
      if (maxDuration <= 0) throw new Error("Empty mix");

      const offline = new OfflineAudioContext(
        2,
        Math.ceil(sampleRate * (maxDuration + 0.2)),
        sampleRate
      );
      const masterGain = offline.createGain();
      masterGain.gain.value = session.master_volume;
      masterGain.connect(offline.destination);

      for (const { track, buf } of buffers) {
        const src = offline.createBufferSource();
        src.buffer = buf;
        const g = offline.createGain();
        g.gain.value = track.volume;
        src.connect(g).connect(masterGain);
        src.start(0);
      }

      const rendered = await offline.startRendering();
      const wav = audioBufferToWav(rendered);
      const blob = new Blob([wav], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const safeTitle =
        (songTitle || "verses-mix")
          .replace(/[^a-z0-9-_]+/gi, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase() || "verses-mix";
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}-mix.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
      toast("Mix exported as .wav", "ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`Export failed \u2014 ${msg}`, "error");
    } finally {
      setExporting(false);
    }
  }, [session, songTitle, toast]);

  const sessionBytes = session ? totalSessionBytes(session) : 0;
  const tracks = session?.tracks ?? [];
  const trackCount = tracks.length;
  const anySolo = tracks.some((t) => t.solo);

  return (
    <Modal open={open} onClose={onClose} title="Studio" width="900px">
      <div className="flex flex-col gap-4">
        <div className="rounded border border-amber-gold/30 bg-amber-gold/5 px-3 py-2 text-[12px] text-ink-text">
          <div className="text-amber-gold">
            Headphones recommended — layer multiple vocal takes cleanly.
          </div>
          <div className="mt-1 text-ink-mute">
            Each channel records mic-only. Wear headphones so the previous
            tracks don&apos;t bleed into the next one. Studio autosaves; export
            mixes everything down to a single .wav.
          </div>
        </div>

        {loadError ? (
          <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
            Couldn&apos;t load saved studio session: {loadError}
          </div>
        ) : null}

        {/* ── tracks ─────────────────────────────────────────────────────── */}
        {tracks.length === 0 ? (
          <div className="rounded border border-ink-line bg-ink/40 px-4 py-8 text-center text-[12px] text-ink-mute">
            No channels yet — hit{" "}
            <span className="text-amber-gold">● record channel</span> to
            lay down your first track.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {tracks.map((t, i) => (
              <TrackRow
                key={t.id}
                index={i + 1}
                track={t}
                anySolo={anySolo}
                disabled={recState !== "idle"}
                onChange={(patch) => updateTrack(t.id, patch)}
                onDelete={() => deleteTrack(t.id)}
              />
            ))}
          </ul>
        )}

        {/* ── master strip ───────────────────────────────────────────────── */}
        {tracks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded border border-ink-line bg-ink/30 px-3 py-2 text-[12px] text-ink-mute">
            <button
              type="button"
              onClick={() => {
                if (playing) {
                  stopMaster();
                } else {
                  void startMaster(playPos < longestDuration ? playPos : 0);
                }
              }}
              disabled={recState !== "idle"}
              className="rounded border border-amber-gold/60 bg-amber-gold/10 px-3 py-1 text-amber-gold hover:bg-amber-gold/20 disabled:opacity-50"
            >
              {playing ? "\u25A0 stop" : "\u25B6 play mix"}
            </button>
            <div className="font-mono text-[11px] text-ink-mute">
              {formatDuration(playPos)} / {formatDuration(longestDuration)}
            </div>
            <label className="flex items-center gap-2">
              <span>master</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={session?.master_volume ?? 1}
                onChange={(e) =>
                  setMasterVolume(parseFloat(e.target.value))
                }
                className="w-32 accent-amber-gold"
              />
              <span className="font-mono">
                {Math.round(((session?.master_volume ?? 1) / 1.5) * 100)}%
              </span>
            </label>
            <div className="ml-auto flex items-center gap-3">
              <span>
                {trackCount} channel{trackCount === 1 ? "" : "s"} ·{" "}
                {formatBytes(sessionBytes)}
              </span>
              <button
                type="button"
                onClick={exportMix}
                disabled={exporting || recState !== "idle"}
                className="rounded border border-amber-gold/60 bg-amber-gold/10 px-3 py-1 text-amber-gold hover:bg-amber-gold/20 disabled:opacity-50"
              >
                {exporting ? "exporting\u2026" : "export mix \u2193"}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── recorder ───────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 rounded border border-ink-line bg-ink/30 px-3 py-2">
          <div className="flex-1">
            <div className="h-2 w-full overflow-hidden rounded bg-ink-line">
              <div
                className={`h-full transition-[width] duration-75 ${
                  recState === "recording" ? "bg-red-400" : "bg-amber-gold"
                }`}
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-ink-mute">
              <span>mic</span>
              <span className="font-mono">
                {recState === "recording"
                  ? `\u25CF ${formatDuration(elapsed)}`
                  : recState === "preparing"
                  ? "preparing\u2026"
                  : "ready"}
              </span>
            </div>
          </div>
          {recState === "recording" ? (
            <button
              type="button"
              onClick={stopRecording}
              className="rounded border border-red-400/70 bg-red-500/20 px-4 py-1.5 text-sm text-red-100 hover:bg-red-500/30"
            >
              ■ stop &amp; add
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={recState !== "idle"}
              className="rounded border border-red-400/60 bg-red-500/10 px-4 py-1.5 text-sm text-red-200 hover:border-red-400/80 hover:bg-red-500/20 disabled:opacity-50"
            >
              {recState === "preparing"
                ? "preparing\u2026"
                : "\u25CF record channel"}
            </button>
          )}
        </div>

        {recError ? (
          <div className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
            {recError}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function TrackRow({
  index,
  track,
  anySolo,
  disabled,
  onChange,
  onDelete,
}: {
  index: number;
  track: StudioTrack;
  anySolo: boolean;
  disabled: boolean;
  onChange: (patch: Partial<StudioTrack>) => void;
  onDelete: () => void;
}) {
  const [labelDraft, setLabelDraft] = useState(track.label);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Recompute preview URL when blob identity changes
  useEffect(() => {
    const url = URL.createObjectURL(track.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [track.blob]);

  const dimmed = anySolo && !track.solo;

  return (
    <li
      className={`rounded border border-ink-line bg-ink/40 px-3 py-2 text-[12px] ${
        dimmed ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-ink-mute">#{index}</span>
        {editing ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => {
              const v = labelDraft.trim() || track.label;
              if (v !== track.label) onChange({ label: v });
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setLabelDraft(track.label);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-ink-line bg-ink/40 px-2 py-0.5 text-ink-text outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setLabelDraft(track.label);
              setEditing(true);
            }}
            className="min-w-0 flex-1 truncate text-left text-ink-text hover:text-amber-gold"
            title="Rename channel"
          >
            {track.label}
          </button>
        )}
        <span className="font-mono text-ink-mute">
          {formatDuration(track.duration)}
        </span>
        <button
          type="button"
          onClick={() => onChange({ muted: !track.muted, solo: false })}
          disabled={disabled}
          className={`rounded border px-2 py-0.5 text-[11px] ${
            track.muted
              ? "border-amber-gold/60 bg-amber-gold/10 text-amber-gold"
              : "border-ink-line text-ink-mute hover:text-ink-text"
          } disabled:opacity-50`}
          title="Mute (M)"
        >
          M
        </button>
        <button
          type="button"
          onClick={() => onChange({ solo: !track.solo, muted: false })}
          disabled={disabled}
          className={`rounded border px-2 py-0.5 text-[11px] ${
            track.solo
              ? "border-amber-gold/60 bg-amber-gold/10 text-amber-gold"
              : "border-ink-line text-ink-mute hover:text-ink-text"
          } disabled:opacity-50`}
          title="Solo (S)"
        >
          S
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={track.volume}
          onChange={(e) => onChange({ volume: parseFloat(e.target.value) })}
          className="w-32 accent-amber-gold"
          aria-label={`${track.label} volume`}
        />
        <span className="font-mono text-[11px] text-ink-mute">
          {Math.round((track.volume / 1.5) * 100)}%
        </span>
        {previewUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio src={previewUrl} controls className="ml-auto h-7" />
        ) : null}
        {confirming ? (
          <span className="ml-2 flex items-center gap-2 text-[11px] text-red-200">
            delete?
            <button
              type="button"
              onClick={() => {
                onDelete();
                setConfirming(false);
              }}
              className="rounded border border-red-400/70 bg-red-500/20 px-2 py-0.5 text-red-100 hover:bg-red-500/30"
            >
              yes, delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-ink-line px-2 py-0.5 text-ink-mute hover:text-ink-text"
            >
              cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={disabled}
            className="rounded border border-ink-line px-2 py-0.5 text-[11px] text-ink-mute hover:text-red-300 disabled:opacity-40"
            title="Delete channel"
          >
            delete
          </button>
        )}
      </div>
    </li>
  );
}

// ── WAV encoder (16-bit PCM) ─────────────────────────────────────────────────
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(8, "WAVE");
  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  // data chunk
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channel data
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));
  let offset = headerSize;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channels[c][i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }

  return ab;
}
