"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractYoutubeId, fetchYoutubeTitle } from "@/lib/youtube";
import type { YoutubeMarker, YoutubeSession } from "@/lib/types";
import { useShortcut } from "@/hooks/useShortcut";
import { useToast } from "@/components/Toast";

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

const newMarkerId = () =>
  `m-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

export function YoutubeBar({
  session,
  onChange,
}: {
  session: YoutubeSession | null;
  onChange: (s: YoutubeSession | null) => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState(session?.youtube_url ?? "");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(60);
  const [replacing, setReplacing] = useState(false);
  const [draftLabel, setDraftLabel] = useState<{
    time: number;
    label: string;
  } | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const containerId = useRef(
    `yt-player-${Math.random().toString(36).slice(2, 8)}`
  );
  const sessionRef = useRef<YoutubeSession | null>(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const markers = useMemo<YoutubeMarker[]>(
    () =>
      [...(session?.markers ?? [])].sort((a, b) => a.time - b.time),
    [session?.markers]
  );
  const loopStart = session?.loop_start ?? null;
  const loopEnd = session?.loop_end ?? null;
  const hasLoopRange =
    loopStart !== null &&
    loopEnd !== null &&
    typeof loopStart === "number" &&
    typeof loopEnd === "number" &&
    loopEnd > loopStart;
  const [loopOn, setLoopOn] = useState(false);

  useEffect(() => {
    setInput(session?.youtube_url ?? "");
  }, [session?.youtube_url]);

  // Init player on first session
  useEffect(() => {
    if (!session) return;
    const id = extractYoutubeId(session.youtube_url);
    if (!id) return;
    let cancelled = false;
    (async () => {
      await loadYouTubeApi();
      if (cancelled || !window.YT) return;
      if (!hostRef.current) return;
      let target = document.getElementById(containerId.current);
      if (!target) {
        target = document.createElement("div");
        target.id = containerId.current;
        hostRef.current.appendChild(target);
      }
      if (playerRef.current) {
        playerRef.current.loadVideoById(id);
        return;
      }
      playerRef.current = new window.YT.Player(containerId.current, {
        videoId: id,
        height: "180",
        width: "320",
        playerVars: {
          controls: 0,
          disablekb: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
        },
        events: {
          onReady: (e: { target: YouTubePlayer }) => {
            e.target.setVolume(volume);
            setDuration(e.target.getDuration());
          },
          onStateChange: (e: { data: number }) => {
            if (!window.YT) return;
            if (e.data === window.YT.PlayerState.PLAYING) setPlaying(true);
            else setPlaying(false);
            if (e.data === window.YT.PlayerState.ENDED && loopOn) {
              const s = sessionRef.current;
              const start =
                s?.loop_start !== null && s?.loop_start !== undefined
                  ? s.loop_start
                  : 0;
              playerRef.current?.seekTo(start, true);
              playerRef.current?.playVideo();
            }
          },
        },
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.youtube_url]);

  // Polling time + loop A↔B clamp
  useEffect(() => {
    const t = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const now = p.getCurrentTime();
        setTime(now);
        const d = p.getDuration();
        if (d && d !== duration) setDuration(d);
        if (loopOn && hasLoopRange) {
          if (now >= (loopEnd as number) - 0.05) {
            p.seekTo(loopStart as number, true);
          }
        }
      } catch {
        // player not ready
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [duration, loopOn, hasLoopRange, loopStart, loopEnd]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (playing) {
        p.pauseVideo();
      } else {
        // If loop is on and has a loop range, seek to loop start before playing
        if (loopOn && hasLoopRange && loopStart !== null) {
          p.seekTo(loopStart, true);
        }
        p.playVideo();
      }
    } catch {
      /* ignore */
    }
  }, [playing, loopOn, hasLoopRange, loopStart]);

  useShortcut({ key: "p", meta: true }, (e) => {
    if (!session) return;
    e.preventDefault();
    togglePlay();
  });

  // External controllers (e.g. PerformModal) can dispatch these events
  // to control the loaded YouTube beat. The play event accepts an optional
  // `detail.startAt` (seconds) to seek before playback.
  useEffect(() => {
    const onPlay = (ev: Event) => {
      const p = playerRef.current;
      if (!p) return;
      const detail = (ev as CustomEvent<{ startAt?: number }>).detail;
      const startAt = detail?.startAt;
      try {
        if (typeof startAt === "number" && Number.isFinite(startAt) && startAt >= 0) {
          p.seekTo(startAt, true);
        }
        p.playVideo();
      } catch {
        /* ignore */
      }
    };
    const onPause = () => {
      const p = playerRef.current;
      if (!p) return;
      try { p.pauseVideo(); } catch { /* ignore */ }
    };
    const onToggle = () => {
      const p = playerRef.current;
      if (!p) return;
      try {
        if (playing) p.pauseVideo();
        else p.playVideo();
      } catch { /* ignore */ }
    };
    const onVolume = (ev: Event) => {
      const p = playerRef.current;
      if (!p) return;
      const detail = (ev as CustomEvent<{ volume: number }>).detail;
      if (typeof detail?.volume === "number") {
        try {
          p.setVolume(Math.max(0, Math.min(100, detail.volume)));
          setVolume(Math.round(detail.volume));
        } catch { /* ignore */ }
      }
    };
    const onLoopOn = () => setLoopOn(true);
    const onLoopOff = () => setLoopOn(false);
    const onSeek = (ev: Event) => {
      const p = playerRef.current;
      if (!p) return;
      const detail = (ev as CustomEvent<{ time: number }>).detail;
      if (typeof detail?.time === "number") {
        try { p.seekTo(detail.time, true); } catch { /* ignore */ }
      }
    };

    window.addEventListener("verses:beat-play", onPlay);
    window.addEventListener("verses:beat-pause", onPause);
    window.addEventListener("verses:beat-toggle", onToggle);
    window.addEventListener("verses:beat-volume", onVolume);
    window.addEventListener("verses:beat-loop-on", onLoopOn);
    window.addEventListener("verses:beat-loop-off", onLoopOff);
    window.addEventListener("verses:beat-seek", onSeek);
    return () => {
      window.removeEventListener("verses:beat-play", onPlay);
      window.removeEventListener("verses:beat-pause", onPause);
      window.removeEventListener("verses:beat-toggle", onToggle);
      window.removeEventListener("verses:beat-volume", onVolume);
      window.removeEventListener("verses:beat-loop-on", onLoopOn);
      window.removeEventListener("verses:beat-loop-off", onLoopOff);
      window.removeEventListener("verses:beat-seek", onSeek);
    };
  }, [playing]);

  const onLoad = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const url = input.trim();
    if (!url) {
      onChange(null);
      return;
    }
    const id = extractYoutubeId(url);
    if (!id) {
      toast("That doesn't look like a YouTube link", "error");
      return;
    }
    const title = (await fetchYoutubeTitle(url)) ?? null;
    if (replacing) {
      onChange({
        id: `yt-${Math.random().toString(36).slice(2)}`,
        song_id: session?.song_id ?? "",
        youtube_url: url,
        youtube_title: title,
        markers: [],
        loop_start: null,
        loop_end: null,
      });
      setReplacing(false);
      toast("Beat replaced", "ok");
    } else {
      onChange({
        id: session?.id ?? `yt-${Math.random().toString(36).slice(2)}`,
        song_id: session?.song_id ?? "",
        youtube_url: url,
        youtube_title: title,
        markers: session?.markers ?? [],
        loop_start: session?.loop_start ?? null,
        loop_end: session?.loop_end ?? null,
      });
    }
    setExpanded(true);
  };

  const onSeek = (next: number) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.seekTo(next, true);
      setTime(next);
    } catch {
      /* ignore */
    }
  };

  const onVolume = (next: number) => {
    setVolume(next);
    try {
      playerRef.current?.setVolume(next);
    } catch {
      /* ignore */
    }
  };

  const beginAddMarker = () => {
    if (!session) return;
    const p = playerRef.current;
    let now = 0;
    try {
      now = p?.getCurrentTime() ?? 0;
    } catch {
      now = 0;
    }
    setDraftLabel({ time: now, label: "" });
  };

  const commitDraft = () => {
    if (!session || !draftLabel) return;
    const trimmed = draftLabel.label.trim() || fmt(draftLabel.time);
    const next: YoutubeSession = {
      ...session,
      markers: [
        ...(session.markers ?? []),
        { id: newMarkerId(), time: draftLabel.time, label: trimmed },
      ],
    };
    onChange(next);
    setDraftLabel(null);
  };

  const cancelDraft = () => setDraftLabel(null);

  const removeMarker = (id: string) => {
    if (!session) return;
    const next: YoutubeSession = {
      ...session,
      markers: (session.markers ?? []).filter((m) => m.id !== id),
    };
    onChange(next);
  };

  const setLoopPoint = (which: "A" | "B", t: number) => {
    if (!session) return;
    const next: YoutubeSession = {
      ...session,
      loop_start: which === "A" ? t : session.loop_start ?? null,
      loop_end: which === "B" ? t : session.loop_end ?? null,
    };
    onChange(next);
  };

  const clearLoopRange = () => {
    if (!session) return;
    onChange({ ...session, loop_start: null, loop_end: null });
    setLoopOn(false);
  };

  const onAnalyze = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.youtube_url);
      toast("YouTube URL copied — paste into Tunebat", "ok");
    } catch {
      toast("Opening Tunebat — paste the URL there", "info");
    }
    window.open(
      "https://tunebat.com/Analyzer",
      "_blank",
      "noopener,noreferrer"
    );
  };

  const loopLabel = hasLoopRange
    ? `loop ${fmt(loopStart as number)}↔${fmt(loopEnd as number)}`
    : "loop";

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className={`${
        session ? "fade-idle" : "fade-idle fade-idle--full"
      } fixed inset-x-0 bottom-0 z-20 border-t border-ink-line bg-ink-surface/90 backdrop-blur transition-all duration-150 print:hidden`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        ref={hostRef}
        aria-hidden
        className="pointer-events-none absolute h-[180px] w-[320px] opacity-0"
        style={{ left: "-9999px", top: "-9999px" }}
      />


      {session && (markers.length > 0 || draftLabel) ? (
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-1.5 px-4 pt-2 text-[11px]">
          {markers.map((m) => {
            const isA = loopStart === m.time;
            const isB = loopEnd === m.time;
            return (
              <span
                key={m.id}
                className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors duration-150 ${
                  isA || isB
                    ? "border-amber-gold/60 bg-amber-gold/10 text-amber-gold"
                    : "border-ink-line text-ink-mute hover:border-amber-gold/40 hover:text-ink-text"
                }`}
              >
                <button
                  onClick={() => onSeek(m.time)}
                  title={`Jump to ${fmt(m.time)}`}
                  className="font-mono text-[10px]"
                >
                  {fmt(m.time)}
                </button>
                <button
                  onClick={() => onSeek(m.time)}
                  title={`Jump to ${fmt(m.time)}`}
                  className="max-w-[12rem] truncate"
                >
                  {m.label}
                </button>
                <span className="ml-1 hidden gap-1 group-hover:inline-flex">
                  <button
                    onClick={() => setLoopPoint("A", m.time)}
                    title="Use as loop start"
                    className={`rounded border border-ink-line px-1 text-[9px] uppercase tracking-wider hover:border-amber-gold/60 hover:text-amber-gold ${
                      isA ? "border-amber-gold/60 text-amber-gold" : ""
                    }`}
                  >
                    A
                  </button>
                  <button
                    onClick={() => setLoopPoint("B", m.time)}
                    title="Use as loop end"
                    className={`rounded border border-ink-line px-1 text-[9px] uppercase tracking-wider hover:border-amber-gold/60 hover:text-amber-gold ${
                      isB ? "border-amber-gold/60 text-amber-gold" : ""
                    }`}
                  >
                    B
                  </button>
                  <button
                    onClick={() => removeMarker(m.id)}
                    title="Remove marker"
                    className="rounded px-1 text-[10px] hover:text-ink-text"
                  >
                    ✕
                  </button>
                </span>
              </span>
            );
          })}
          {draftLabel ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitDraft();
              }}
              className="inline-flex items-center gap-1 rounded-full border border-amber-gold/60 bg-amber-gold/10 px-2 py-0.5"
            >
              <span className="font-mono text-[10px] text-amber-gold">
                {fmt(draftLabel.time)}
              </span>
              <input
                autoFocus
                value={draftLabel.label}
                onChange={(e) =>
                  setDraftLabel({ ...draftLabel, label: e.target.value })
                }
                onBlur={commitDraft}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelDraft();
                  }
                }}
                placeholder="hook · verse 2 · drop…"
                className="w-32 bg-transparent text-[11px] text-amber-gold outline-none placeholder:text-amber-gold/50"
              />
            </form>
          ) : null}
          {hasLoopRange ? (
            <button
              onClick={clearLoopRange}
              title="Clear A↔B loop range"
              className="ml-1 rounded border border-ink-line px-1.5 py-0.5 text-[10px] text-ink-mute hover:border-amber-gold/40 hover:text-ink-text"
            >
              clear A↔B
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={`mx-auto flex max-w-3xl items-center gap-3 px-4 ${
          expanded || !session ? "py-3" : "py-1.5"
        }`}
      >
        {!session ? (
          <form
            onSubmit={onLoad}
            className="flex w-full items-center gap-2"
          >
            <span className="hidden text-[11px] uppercase tracking-wider text-amber-gold sm:inline">
              ♪ Add music
            </span>
            <span className="text-[11px] uppercase tracking-wider text-amber-gold sm:hidden">
              ♪
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="paste a YouTube link to write to the beat…"
              className="flex-1 rounded border border-ink-line bg-ink/60 px-3 py-1.5 text-sm focus:border-amber-gold/60"
            />
            <button
              type="submit"
              className="rounded border border-amber-gold/40 bg-amber-gold/5 px-3 py-1.5 text-xs text-amber-gold transition-colors duration-150 hover:bg-amber-gold/15"
            >
              load
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={togglePlay}
              title="Play / pause (⌘P)"
              className="rounded border border-ink-line px-3 py-1 text-sm text-ink-text transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration))}
              value={Math.floor(time)}
              onChange={(e) => onSeek(Number(e.target.value))}
              className="flex-1 accent-amber-gold"
            />
            <span className="hidden font-mono text-[11px] text-ink-mute sm:inline">
              {fmt(time)} / {fmt(duration)}
            </span>
            <button
              onClick={beginAddMarker}
              title="Mark this moment with a custom label"
              className="rounded border border-ink-line px-2 py-1 text-[11px] text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
            >
              + mark
            </button>
            <button
              onClick={() => setLoopOn((v) => !v)}
              title={
                hasLoopRange
                  ? "Loop between marked A and B"
                  : "Loop the whole track (set A and B markers for a custom range)"
              }
              className={`rounded border px-2 py-1 text-[11px] transition-colors duration-150 ${
                loopOn
                  ? "border-amber-gold/60 text-amber-gold"
                  : "border-ink-line text-ink-mute hover:text-ink-text"
              }`}
            >
              {loopLabel}
            </button>
            <button
              onClick={onAnalyze}
              title="Copy URL + open Tunebat analyzer"
              className="rounded border border-ink-line px-2 py-1 text-[11px] text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
            >
              analyze ↗
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              className="w-20 accent-amber-gold"
              title="Volume"
            />
            <button
              onClick={() => setReplacing(true)}
              title="Replace beat"
              className="rounded border border-ink-line px-2 py-1 text-[11px] text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
            >
              replace
            </button>
            <button
              onClick={() => {
                try { playerRef.current?.pauseVideo(); } catch {}
                onChange(null);
                toast("Beat cleared", "ok");
              }}
              title="Clear beat"
              className="rounded p-1 text-[11px] text-ink-mute transition-colors duration-150 hover:text-ink-text"
            >
              ✕
            </button>
          </>
        )}
      </div>
      {replacing && session ? (
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 pb-2">
          <input
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="paste a new YouTube link…"
            className="flex-1 rounded border border-ink-line bg-ink/60 px-3 py-1.5 text-sm focus:border-amber-gold/60"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setReplacing(false);
              }
            }}
          />
          <button
            onClick={() => onLoad()}
            className="rounded border border-amber-gold/40 bg-amber-gold/5 px-3 py-1.5 text-xs text-amber-gold transition-colors duration-150 hover:bg-amber-gold/15"
          >
            Load
          </button>
          <button
            onClick={() => setReplacing(false)}
            className="rounded border border-ink-line px-3 py-1.5 text-xs text-ink-mute transition-colors duration-150 hover:text-ink-text"
          >
            Cancel
          </button>
        </div>
      ) : null}
      {session?.youtube_title && expanded ? (
        <div className="mx-auto max-w-3xl truncate px-4 pb-2 text-[11px] text-ink-mute">
          {session.youtube_title}
        </div>
      ) : null}
    </div>
  );
}

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
