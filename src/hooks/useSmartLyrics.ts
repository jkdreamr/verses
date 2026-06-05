"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLineAligner } from "@/lib/music/lyricAlign";

// ───────────────────────────────────────────────────────────────────────────
// Smart Lyric Reader hook.
//
// Two USER-CHOSEN modes, always selectable via a toggle:
//   • "smart" — the Web Speech API listens and the strict line-by-line aligner
//     advances the teleprompter (never skips, never jumps back).
//   • "pace"  — a timed scroll (seconds-per-line) for when you'd rather not rely
//     on the mic.
//
// `mode` is the user's choice; `status` is the live health of that choice. A mic
// denial or hard recognition error flips to Pace AND raises `smartError` so the
// UI can show "Smart unavailable — using Pace" with a Retry button — Smart is
// never silently removed. A momentary stall keeps Smart running (auto-restart)
// and only surfaces a "stalled" hint.
// ───────────────────────────────────────────────────────────────────────────

export type LyricMode = "smart" | "pace";
export type LyricStatus = "idle" | "listening" | "low" | "stalled" | "pace";

function speechSupported(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

const STALL_MS = 5000;

export function useSmartLyrics(lyrics: string) {
  const lines = useMemo(() => lyrics.split(/\r?\n/), [lyrics]);
  const supported = useMemo(speechSupported, []);

  const [mode, setModeState] = useState<LyricMode>(() => (speechSupported() ? "smart" : "pace"));
  const [status, setStatus] = useState<LyricStatus>("idle");
  const [smartError, setSmartError] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeLine, setActiveLine] = useState(0);
  const [activeWord, setActiveWord] = useState(-1);
  const [secondsPerLine, setSecondsPerLine] = useState(3.5);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const alignerRef = useRef<ReturnType<typeof createLineAligner> | null>(null);
  const restartRef = useRef(false);
  const lastMatchRef = useRef(0);
  const runningRef = useRef(false);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const ensureAligner = useCallback(() => {
    if (!alignerRef.current) {
      const a = createLineAligner(lyrics);
      alignerRef.current = a;
      setActiveLine(a.line);
      setActiveWord(-1);
    }
    return alignerRef.current;
  }, [lyrics]);

  const stopRecognition = useCallback(() => {
    restartRef.current = false;
    const rec = recRef.current;
    if (rec) {
      try { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.stop(); } catch { /* */ }
      recRef.current = null;
    }
  }, []);

  const startRecognition = useCallback((): boolean => {
    if (!speechSupported()) { setSmartError(true); setStatus("pace"); setModeState("pace"); return false; }
    const aligner = ensureAligner();
    if (!aligner) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      recRef.current = rec;
      restartRef.current = true;
      lastMatchRef.current = Date.now();
      setSmartError(false);
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
        // Hard failures → fall back to Pace but keep Smart offered (retry).
        if (e?.error === "not-allowed" || e?.error === "service-not-allowed" || e?.error === "audio-capture") {
          restartRef.current = false;
          setSmartError(true);
          setModeState("pace");
          setStatus("pace");
        }
        // "no-speech" / "aborted" / "network" → let onend auto-restart.
      };
      rec.onend = () => {
        if (restartRef.current && recRef.current === rec) {
          try { rec.start(); } catch { /* already starting */ }
        }
      };
      rec.start();
      return true;
    } catch {
      setSmartError(true);
      setModeState("pace");
      setStatus("pace");
      return false;
    }
  }, [ensureAligner]);

  const start = useCallback(() => {
    ensureAligner();
    setRunning(true);
    runningRef.current = true;
    lastMatchRef.current = Date.now();
    if (modeRef.current === "smart" && speechSupported()) startRecognition();
    else setStatus("pace");
  }, [ensureAligner, startRecognition]);

  const stop = useCallback(() => {
    stopRecognition();
    setRunning(false);
    runningRef.current = false;
    alignerRef.current = null;
    setStatus("idle");
  }, [stopRecognition]);

  const setMode = useCallback((m: LyricMode) => {
    if (m === "smart" && !speechSupported()) { setSmartError(true); return; }
    setModeState(m);
    if (m === "smart") setSmartError(false);
    if (!runningRef.current) { if (m === "pace") setStatus("pace"); return; }
    if (m === "smart") { lastMatchRef.current = Date.now(); startRecognition(); }
    else { stopRecognition(); setStatus("pace"); }
  }, [startRecognition, stopRecognition]);

  const retrySmart = useCallback(() => setMode("smart"), [setMode]);

  const nudge = useCallback((delta: number) => {
    setActiveLine((l) => {
      const n = Math.max(0, Math.min(lines.length - 1, l + delta));
      alignerRef.current?.setLine(n);
      setActiveWord(-1);
      lastMatchRef.current = Date.now();
      return n;
    });
  }, [lines.length]);

  // Watchdog: surface a "stalled" hint in Smart mode, but keep listening.
  useEffect(() => {
    if (!running || mode !== "smart" || smartError) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastMatchRef.current > STALL_MS) {
        setStatus((s) => (s === "listening" || s === "low" ? "stalled" : s));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, mode, smartError]);

  // Pace timer: advance one (non-empty) line per interval.
  useEffect(() => {
    if (!running || mode !== "pace") return;
    const id = window.setInterval(() => {
      setActiveLine((l) => {
        let n = l + 1;
        while (n < lines.length - 1 && lines[n].trim() === "") n++;
        return Math.min(n, lines.length - 1);
      });
      setActiveWord(-1);
    }, Math.max(800, secondsPerLine * 1000));
    return () => window.clearInterval(id);
  }, [running, mode, secondsPerLine, lines]);

  useEffect(() => () => stop(), [stop]);

  return {
    lines, activeLine, activeWord,
    mode, setMode, status, supported, smartError, retrySmart,
    running, secondsPerLine, setSecondsPerLine,
    start, stop, nudge,
  };
}
