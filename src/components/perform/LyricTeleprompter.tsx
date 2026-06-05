"use client";

import { useMemo } from "react";
import type { useSmartLyrics } from "@/hooks/useSmartLyrics";

type Smart = ReturnType<typeof useSmartLyrics>;

// Renders one lyric line word-by-word, brightening words already sung.
function renderLine(line: string, upTo: number) {
  if (upTo < 0) return line;
  const out: React.ReactNode[] = [];
  const re = /[A-Za-z0-9']+/g;
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    out.push(
      <span key={m.index} className={idx <= upTo ? "text-accent" : "text-ink-text/55"}>{m[0]}</span>,
    );
    last = m.index + m[0].length;
    idx++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2f7] focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

/**
 * Compact karaoke-style teleprompter. Shows a 3-line window (faint previous /
 * bold active with word highlight / faint next) in a slim glassy strip pinned to
 * the bottom of the stage, so the camera/performance stays the hero. Live-only —
 * it's a DOM overlay, never part of the captured canvas, so recordings are clean.
 */
export function LyricTeleprompter({ smart, onClose }: { smart: Smart; onClose: () => void }) {
  const { lines, activeLine, activeWord, mode, status, supported, smartError } = smart;

  // nearest non-empty neighbours, for context without clutter
  const { prevIdx, nextIdx } = useMemo(() => {
    let p = activeLine - 1;
    while (p >= 0 && lines[p]?.trim() === "") p--;
    let n = activeLine + 1;
    while (n < lines.length && lines[n]?.trim() === "") n++;
    return { prevIdx: p, nextIdx: n };
  }, [activeLine, lines]);

  const hasLyrics = lines.some((l) => l.trim() !== "");

  const statusDot =
    smartError ? "bg-danger"
    : status === "listening" ? "bg-success"
    : status === "low" ? "bg-accent"
    : status === "stalled" ? "bg-accent/70"
    : "bg-ink-mute/50";
  const statusText =
    mode === "pace" ? "Pace"
    : status === "listening" ? "Listening"
    : status === "low" ? "Listening (faint)"
    : status === "stalled" ? "Listening — sing up"
    : "Ready";

  const seg = (active: boolean) =>
    `px-3 py-1 text-[11px] font-medium transition-colors ${FOCUS} ${active ? "bg-accent/20 text-accent" : "text-ink-mute hover:text-ink-text"}`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-bg via-bg/85 to-transparent px-3 pt-12 pb-[max(0.6rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-3xl">
        {/* control bar */}
        <div className="pointer-events-auto mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {/* mode segmented control */}
          <div role="group" aria-label="Lyric follow mode" className="flex overflow-hidden rounded-lg border border-line/60 bg-bg/70 backdrop-blur">
            <button
              type="button"
              onClick={() => smart.setMode("smart")}
              aria-pressed={mode === "smart"}
              disabled={!supported}
              title={supported ? "Mic-driven auto-follow — the lyrics track your voice" : "This browser doesn't support speech recognition"}
              className={`${seg(mode === "smart" && !smartError)} disabled:cursor-not-allowed disabled:opacity-40`}
            >Smart</button>
            <button
              type="button"
              onClick={() => smart.setMode("pace")}
              aria-pressed={mode === "pace"}
              title="Timed auto-scroll"
              className={seg(mode === "pace")}
            >Pace</button>
          </div>

          {/* status */}
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-mute">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusDot} ${status === "listening" ? "motion-safe:animate-pulse" : ""}`} />
            {statusText}
          </span>

          {/* pace tempo */}
          {mode === "pace" && (
            <label className="flex items-center gap-1.5 text-[10px] text-ink-mute">
              <span className="sr-only">Seconds per line</span>
              <input
                type="range" min={1.5} max={8} step={0.5} value={smart.secondsPerLine}
                onChange={(e) => smart.setSecondsPerLine(parseFloat(e.target.value))}
                className={`h-1 w-20 accent-accent ${FOCUS}`} aria-label="Seconds per line"
              />
              <span className="tabular-nums">{smart.secondsPerLine.toFixed(1)}s</span>
            </label>
          )}

          {/* smart-unavailable notice + retry */}
          {smartError && (
            <span className="flex items-center gap-1.5 text-[10px] text-danger">
              Smart unavailable
              <button type="button" onClick={smart.retrySmart} className={`rounded-md bg-accent/15 px-2 py-0.5 text-accent hover:bg-accent/25 ${FOCUS}`}>
                Retry
              </button>
            </span>
          )}

          {/* nudge + hide */}
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => smart.nudge(-1)} aria-label="Previous line"
              className={`flex h-8 w-8 items-center justify-center rounded-md bg-surface-2/80 text-ink-mute hover:text-ink-text ${FOCUS}`}>↑</button>
            <button type="button" onClick={() => smart.nudge(1)} aria-label="Next line"
              className={`flex h-8 w-8 items-center justify-center rounded-md bg-surface-2/80 text-ink-mute hover:text-ink-text ${FOCUS}`}>↓</button>
            <button type="button" onClick={onClose} aria-label="Hide lyrics"
              className={`ml-0.5 flex h-8 items-center rounded-md bg-surface-2/80 px-2.5 text-[11px] text-ink-mute hover:text-ink-text ${FOCUS}`}>Hide</button>
          </div>
        </div>

        {/* 3-line karaoke window */}
        <div
          aria-live="off"
          className="pointer-events-none select-none text-center font-serif leading-snug [text-shadow:0_1px_10px_rgba(0,0,0,0.7)]"
        >
          {hasLyrics ? (
            <>
              <div className="truncate text-[13px] text-ink-text/35 transition-opacity duration-300 motion-reduce:transition-none">
                {prevIdx >= 0 ? lines[prevIdx] : " "}
              </div>
              <div className="truncate text-xl font-semibold text-ink-text transition-all duration-300 motion-reduce:transition-none sm:text-2xl">
                {activeWord >= 0 ? renderLine(lines[activeLine] || "", activeWord) : (lines[activeLine]?.trim() ? lines[activeLine] : " ")}
              </div>
              <div className="truncate text-[13px] text-ink-text/35 transition-opacity duration-300 motion-reduce:transition-none">
                {nextIdx < lines.length ? lines[nextIdx] : " "}
              </div>
            </>
          ) : (
            <p className="font-sans text-[12px] text-ink-mute">Write lyrics in the editor and they&apos;ll follow you here.</p>
          )}
        </div>
      </div>
    </div>
  );
}
