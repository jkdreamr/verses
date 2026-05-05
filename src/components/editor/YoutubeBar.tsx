"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractYoutubeId, fetchYoutubeTitle } from "@/lib/youtube";
import type { YoutubeSession } from "@/lib/types";
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
  const [loop, setLoop] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const containerId = useRef(
    `yt-player-${Math.random().toString(36).slice(2, 8)}`
  );

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
      // Make sure we have a target element
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
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: (e: { target: YouTubePlayer }) => {
            e.target.setVolume(volume);
            setDuration(e.target.getDuration());
          },
          onStateChange: (e: { data: number }) => {
            if (!window.YT) return;
            if (e.data === window.YT.PlayerState.PLAYING) setPlaying(true);
            else setPlaying(false);
            if (e.data === window.YT.PlayerState.ENDED && loop) {
              playerRef.current?.seekTo(0, true);
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

  // Polling time
  useEffect(() => {
    const t = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        setTime(p.getCurrentTime());
        const d = p.getDuration();
        if (d && d !== duration) setDuration(d);
      } catch {
        // player not ready
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [duration]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (playing) p.pauseVideo();
      else p.playVideo();
    } catch {
      /* ignore */
    }
  }, [playing]);

  useShortcut({ key: "p", meta: true }, (e) => {
    if (!session) return;
    e.preventDefault();
    togglePlay();
  });

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
    onChange({
      id: session?.id ?? `yt-${Math.random().toString(36).slice(2)}`,
      song_id: session?.song_id ?? "",
      youtube_url: url,
      youtube_title: title,
    });
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

  return (
    <div
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      className="fade-idle fixed inset-x-0 bottom-0 z-20 border-t border-ink-line bg-ink-surface/85 backdrop-blur transition-all duration-150 print:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div
        ref={hostRef}
        aria-hidden
        className="pointer-events-none absolute h-[180px] w-[320px] opacity-0"
        style={{ left: "-9999px", top: "-9999px" }}
      />
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
            <span className="text-[11px] uppercase tracking-wider text-ink-mute">
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
              className="rounded border border-ink-line px-3 py-1.5 text-xs text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
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
              onClick={() => setLoop((v) => !v)}
              title="Loop"
              className={`rounded border px-2 py-1 text-[11px] transition-colors duration-150 ${
                loop
                  ? "border-amber-gold/60 text-amber-gold"
                  : "border-ink-line text-ink-mute hover:text-ink-text"
              }`}
            >
              loop
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
              onClick={() => onChange(null)}
              title="Remove"
              className="rounded p-1 text-[11px] text-ink-mute transition-colors duration-150 hover:text-ink-text"
            >
              ✕
            </button>
          </>
        )}
      </div>
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
