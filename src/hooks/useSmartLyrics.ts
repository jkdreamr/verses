"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLineAligner } from "@/lib/music/lyricAlign";

// ───────────────────────────────────────────────────────────────────────────
// Smart Lyric Reader hook. Listens via the Web Speech API and advances a strict,
// line-by-line teleprompter (the aligner never skips or jumps backward). Falls
// back to a timed "Pace" scroll when recognition is unavailable or stalls, and
// always exposes a manual nudge. Reusable from Perform (and anywhere else).
// ───────────────────────────────────────────────────────────────────────────

export type LyricFollowStatus = "idle" | "listening" | "low" | "pace" | "unavailable";

export function useSmartLyrics(lyrics: string) {
  const lines = useMemo(() => lyrics.split(/\r?\n/), [lyrics]);
  const [activeLine, setActiveLine] = useState(0);
  const [activeWord, setActiveWord] = useState(-1);
  const [status, setStatus] = useState<LyricFollowStatus>("idle");
  const [running, setRunning] = useState(false);
  const [secondsPerLine, setSecondsPerLine] = useState(3.5);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const alignerRef = useRef<ReturnType<typeof createLineAligner> | null>(null);
  const restartRef = useRef(false);
  const lastMatchRef = useRef(0);

  const stop = useCallback(() => {
    restartRef.current = false;
    if (recRef.current) {
      try { recRef.current.onend = null; recRef.current.stop(); } catch { /* */ }
      recRef.current = null;
    }
    alignerRef.current = null;
    setRunning(false);
    setStatus("idle");
  }, []);

  const start = useCallback(() => {
    const aligner = createLineAligner(lyrics);
    alignerRef.current = aligner;
    setActiveLine(aligner.line);
    setActiveWord(-1);
    lastMatchRef.current = Date.now();
    setRunning(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : undefined;
    if (!Ctor) { setStatus("unavailable"); return; }

    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      recRef.current = rec;
      restartRef.current = true;
      setStatus("listening");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onresult = (evt: any) => {
        let transcript = "";
        for (let i = evt.resultIndex; i < evt.results.length; i++) transcript += evt.results[i][0].transcript + " ";
        const r = aligner.process(transcript);
        if (r.matched) {
          setActiveLine(r.lineIndex);
          setActiveWord(r.wordInLine);
          lastMatchRef.current = Date.now();
          setStatus(r.confidence >= 0.5 ? "listening" : "low");
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rec.onerror = (e: any) => {
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
          restartRef.current = false;
          setStatus("pace");
        }
      };
      rec.onend = () => {
        if (restartRef.current && recRef.current === rec) {
          try { rec.start(); } catch { /* already starting */ }
        }
      };
      rec.start();
    } catch {
      setStatus("pace");
    }
  }, [lyrics]);

  const nudge = useCallback((delta: number) => {
    setActiveLine((l) => {
      const n = Math.max(0, Math.min(lines.length - 1, l + delta));
      alignerRef.current?.setLine(n);
      setActiveWord(-1);
      lastMatchRef.current = Date.now();
      return n;
    });
  }, [lines.length]);

  // Watchdog: if recognition stalls for a few seconds, drop to Pace mode.
  useEffect(() => {
    if (!running || (status !== "listening" && status !== "low")) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastMatchRef.current > 6000) setStatus("pace");
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, status]);

  // Pace mode: advance one (non-empty) line on a timer.
  useEffect(() => {
    if (!running || status !== "pace") return;
    const id = window.setInterval(() => {
      setActiveLine((l) => {
        let n = l + 1;
        while (n < lines.length - 1 && lines[n].trim() === "") n++;
        return Math.min(n, lines.length - 1);
      });
      setActiveWord(-1);
    }, Math.max(800, secondsPerLine * 1000));
    return () => window.clearInterval(id);
  }, [running, status, secondsPerLine, lines]);

  useEffect(() => () => stop(), [stop]);

  return { lines, activeLine, activeWord, status, running, secondsPerLine, setSecondsPerLine, start, stop, nudge };
}
