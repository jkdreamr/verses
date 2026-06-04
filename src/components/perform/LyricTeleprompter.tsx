"use client";

import { useEffect, useRef } from "react";
import type { useSmartLyrics } from "@/hooks/useSmartLyrics";

type Smart = ReturnType<typeof useSmartLyrics>;

// Renders one lyric line word-by-word, highlighting up to the word being sung.
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
      <span key={m.index} className={idx <= upTo ? "text-accent" : undefined}>{m[0]}</span>,
    );
    last = m.index + m[0].length;
    idx++;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function LyricTeleprompter({ smart, onClose }: { smart: Smart; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ease the active line toward the centre (never snap)
  useEffect(() => {
    const el = lineRefs.current[smart.activeLine];
    const c = containerRef.current;
    if (!el || !c) return;
    c.scrollTo({ top: el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
  }, [smart.activeLine]);

  const hasLyrics = smart.lines.some((l) => l.trim() !== "");
  const statusLabel =
    smart.status === "pace" ? "Pace mode"
    : smart.status === "unavailable" ? "Pace mode (no speech API)"
    : smart.status === "low" ? "● listening (low)"
    : smart.status === "listening" ? "● listening"
    : "ready";
  const statusClass =
    smart.status === "listening" ? "text-success"
    : smart.status === "low" ? "text-accent"
    : smart.status === "pace" || smart.status === "unavailable" ? "bg-accent/15 text-accent"
    : "text-ink-mute";

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex h-[46%] flex-col bg-gradient-to-t from-bg from-40% via-bg/95 to-bg/55 px-4 pb-3 pt-6 backdrop-blur-md">
      {/* controls */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.14em] text-ink-mute/60">Lyrics</span>
        <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] ${statusClass}`}>{statusLabel}</span>
        {(smart.status === "pace" || smart.status === "unavailable") && (
          <label className="flex items-center gap-1 text-[10px] text-ink-mute">
            <input type="range" min={1.5} max={8} step={0.5} value={smart.secondsPerLine}
              onChange={(e) => smart.setSecondsPerLine(parseFloat(e.target.value))}
              className="h-1 w-20 accent-accent" aria-label="Seconds per line" />
            {smart.secondsPerLine}s/line
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => smart.nudge(-1)} aria-label="Previous line" className="h-7 w-7 rounded-md bg-surface-2/80 text-ink-mute hover:text-ink-text">↑</button>
          <button onClick={() => smart.nudge(1)} aria-label="Next line" className="h-7 w-7 rounded-md bg-surface-2/80 text-ink-mute hover:text-ink-text">↓</button>
          <button onClick={onClose} aria-label="Hide lyrics" className="ml-1 h-7 rounded-md bg-surface-2/80 px-2 text-[10px] text-ink-mute hover:text-ink-text">Hide</button>
        </div>
      </div>

      {/* scrolling lyrics */}
      <div ref={containerRef} className="scrollbar-thin flex-1 overflow-y-auto font-serif leading-relaxed">
        {hasLyrics ? (
          <div className="flex flex-col gap-2 py-[35%]">
            {smart.lines.map((ln, i) => {
              const isCur = i === smart.activeLine;
              const dist = Math.abs(i - smart.activeLine);
              return (
                <div
                  key={i}
                  ref={(el) => { lineRefs.current[i] = el; }}
                  className={isCur ? "text-2xl font-semibold text-ink-text" : "text-lg text-ink-text"}
                  style={{ opacity: isCur ? 1 : Math.max(0.28, 1 - dist * 0.18) }}
                >
                  {ln.trim() === "" ? " " : isCur ? renderLine(ln, smart.activeWord) : ln}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="font-sans text-[12px] text-ink-mute">
            Write lyrics in the editor and they&apos;ll scroll here as you sing.
          </p>
        )}
      </div>
    </div>
  );
}
