"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import {
  analyzeRhymeLens,
  DEFAULT_OPTIONS,
  CLEAN_OPTIONS,
  MAX_OPTIONS,
  type RhymeType,
  type RhymeFamily,
  type RhymeLensResult,
  type RhymeLensMetrics,
  type DensityMode,
  type RhymeLensOptions,
} from "@/lib/rhymeLens";

// ---------------------------------------------------------------------------
// Color palette — 16 distinct highlight colors
// ---------------------------------------------------------------------------

export const FAMILY_COLORS: string[] = [
  "rgba(251,191,36,0.32)",   // amber
  "rgba(96,165,250,0.30)",   // blue
  "rgba(236,72,153,0.28)",   // pink
  "rgba(52,211,153,0.28)",   // emerald
  "rgba(168,85,247,0.28)",   // purple
  "rgba(34,211,238,0.28)",   // cyan
  "rgba(251,146,60,0.30)",   // orange
  "rgba(163,230,53,0.24)",   // lime
  "rgba(248,113,113,0.26)",  // red
  "rgba(129,140,248,0.28)",  // indigo
  "rgba(232,121,249,0.24)",  // fuchsia
  "rgba(45,212,191,0.24)",   // teal
  "rgba(253,186,116,0.28)",  // light-orange
  "rgba(134,239,172,0.24)",  // light-green
  "rgba(196,181,253,0.26)",  // light-purple
  "rgba(252,211,77,0.28)",   // yellow
];

export const FAMILY_BORDER_COLORS: string[] = [
  "rgba(251,191,36,0.70)",
  "rgba(96,165,250,0.65)",
  "rgba(236,72,153,0.60)",
  "rgba(52,211,153,0.60)",
  "rgba(168,85,247,0.60)",
  "rgba(34,211,238,0.60)",
  "rgba(251,146,60,0.65)",
  "rgba(163,230,53,0.55)",
  "rgba(248,113,113,0.55)",
  "rgba(129,140,248,0.60)",
  "rgba(232,121,249,0.55)",
  "rgba(45,212,191,0.55)",
  "rgba(253,186,116,0.60)",
  "rgba(134,239,172,0.55)",
  "rgba(196,181,253,0.60)",
  "rgba(252,211,77,0.65)",
];

// ---------------------------------------------------------------------------
// Exported types for Editor integration
// ---------------------------------------------------------------------------

export type CharHighlight = {
  colorIndex: number;
  familyId: string;
  type: RhymeType;
  strength: "light" | "medium" | "strong";
};

// ---------------------------------------------------------------------------
// Build character-offset highlight map from analysis result
// This is used by the Editor to render a highlight layer under the textarea
// ---------------------------------------------------------------------------

export function buildCharHighlights(
  analysis: RhymeLensResult | null
): Map<number, CharHighlight> {
  const map = new Map<number, CharHighlight>();
  if (!analysis) return map;

  // Sort families so stronger ones overwrite weaker ones last (stronger wins)
  const sorted = [...analysis.families].sort((a, b) => {
    const str = (s: string) => (s === "strong" ? 3 : s === "medium" ? 2 : 1);
    return str(a.strength) - str(b.strength); // weakest first, strongest overwrites
  });

  for (const family of sorted) {
    for (const span of family.spans) {
      for (let c = span.start; c < span.end; c++) {
        map.set(c, {
          colorIndex: family.colorIndex,
          familyId: family.id,
          type: family.type,
          strength: family.strength,
        });
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Type filter config
// ---------------------------------------------------------------------------

const FILTER_LABELS: { key: RhymeType; label: string }[] = [
  { key: "end", label: "End" },
  { key: "internal", label: "Internal" },
  { key: "multi", label: "Multis" },
  { key: "slant", label: "Slant" },
  { key: "assonance", label: "Assn." },
  { key: "consonance", label: "Cons." },
  { key: "alliteration", label: "Allit." },
  { key: "repetition", label: "Repeat" },
  { key: "cross", label: "Cross" },
  { key: "chain", label: "Chain" },
];

// ---------------------------------------------------------------------------
// Sound Map Panel (compact)
// ---------------------------------------------------------------------------

function SoundMapPanel({
  metrics,
  families,
  weakLines,
}: {
  metrics: RhymeLensMetrics;
  families: RhymeFamily[];
  weakLines: number[];
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border-t border-ink-line/50">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left transition-colors hover:bg-ink-line/20"
      >
        <span className="font-mono text-[9px] uppercase tracking-widest text-ink-mute">
          Sound Map
        </span>
        <span className="text-[9px] text-ink-mute/60">{expanded ? "\u25B2" : "\u25BC"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {/* Metrics */}
          <div className="grid grid-cols-3 gap-1">
            {[
              { l: "Density", v: `${metrics.rhymeDensity}%` },
              { l: "End", v: metrics.endRhymeGroups },
              { l: "Internal", v: metrics.internalRhymeGroups },
              { l: "Multis", v: metrics.multisyllabicChains },
              { l: "Slant", v: metrics.slantGroups },
              { l: "Repeat", v: metrics.repetitionCount },
              { l: "Avg/ln", v: metrics.averageRhymesPerLine },
              { l: "Longest", v: metrics.strongestFamilyLength },
              { l: "Weak", v: metrics.weakLineCount },
            ].map(({ l, v }) => (
              <div key={l} className="rounded bg-ink/30 px-2 py-1">
                <div className="font-mono text-[7px] uppercase tracking-widest text-ink-mute/60">{l}</div>
                <div className="font-mono text-xs text-ink-text">{v}</div>
              </div>
            ))}
          </div>

          {/* Family list */}
          {families.slice(0, 12).map((f) => (
            <div key={f.id} className="flex items-start gap-2">
              <span
                className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{
                  backgroundColor:
                    f.type === "repetition"
                      ? "transparent"
                      : FAMILY_COLORS[f.colorIndex % FAMILY_COLORS.length],
                  border:
                    f.type === "repetition"
                      ? `1.5px dashed ${FAMILY_BORDER_COLORS[f.colorIndex % FAMILY_BORDER_COLORS.length]}`
                      : undefined,
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[10px] text-ink-text/80">
                  {f.spans.map((s) => s.text).join(" / ")}
                </div>
                <div className="font-mono text-[8px] text-ink-mute/60">
                  {f.type} · {f.spans.length} spans · {f.strength}
                </div>
              </div>
            </div>
          ))}

          {weakLines.length > 0 && (
            <div className="font-mono text-[9px] text-ink-mute/50">
              Weak lines: {weakLines.map((l) => l + 1).join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RhymeLens component
// Now exports analysis via onAnalysis callback for Editor inline highlights
// ---------------------------------------------------------------------------

export function RhymeLens({
  lyrics,
  open,
  onToggle,
  onAnalysis,
}: {
  lyrics: string;
  open: boolean;
  onToggle: () => void;
  onAnalysis?: (result: RhymeLensResult | null) => void;
}) {
  const debouncedLyrics = useDebounce(lyrics, 400);

  const [density, setDensity] = useState<DensityMode>("detailed");
  const [enabledFilters, setEnabledFilters] = useState<Set<RhymeType>>(
    () =>
      new Set<RhymeType>([
        "end", "internal", "multi", "compound", "mosaic", "slant",
        "assonance", "consonance", "alliteration", "repetition", "cross", "chain",
      ])
  );
  const [strongOnly, setStrongOnly] = useState(false);

  const options = useMemo<RhymeLensOptions>(() => {
    const base =
      density === "clean"
        ? CLEAN_OPTIONS
        : density === "max"
        ? MAX_OPTIONS
        : DEFAULT_OPTIONS;
    return { ...base, density, enabledTypes: enabledFilters, strongOnly };
  }, [density, enabledFilters, strongOnly]);

  const analysis = useMemo<RhymeLensResult | null>(() => {
    if (!debouncedLyrics.trim()) return null;
    return analyzeRhymeLens(debouncedLyrics, options);
  }, [debouncedLyrics, options]);

  // Push analysis to parent (Editor) for inline highlights
  useEffect(() => {
    onAnalysis?.(open ? analysis : null);
  }, [analysis, open, onAnalysis]);

  const toggleFilter = useCallback((key: RhymeType) => {
    setEnabledFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* Toggle button — bottom-left */}
      <button
        onClick={onToggle}
        aria-pressed={open}
        aria-label="Toggle Rhyme Lens"
        className={`fixed bottom-24 left-4 z-10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-all duration-150 print:hidden ${
          open
            ? "border border-amber-gold/50 text-amber-gold bg-amber-gold/5"
            : "border border-transparent text-ink-mute/60 hover:text-ink-text hover:border-ink-line/50"
        }`}
      >
        Rhyme Lens
      </button>

      {/* Side panel */}
      <aside
        ref={panelRef}
        aria-hidden={!open}
        className={`fixed bottom-0 right-0 top-0 z-30 flex w-[min(380px,44vw)] flex-col border-l border-ink-line/40 bg-ink-surface/95 backdrop-blur-sm transition-transform duration-200 print:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-ink-line/30">
          <div>
            <span className="font-serif text-sm text-ink-text">Sound Map</span>
          </div>
          <button
            onClick={onToggle}
            className="p-1 text-ink-mute/60 transition-colors hover:text-ink-text"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2l10 10M12 2L2 12"/></svg>
          </button>
        </header>

        {/* Controls */}
        <div className="shrink-0 px-4 py-2.5 border-b border-ink-line/30">
          <div className="flex items-center gap-1">
            {(["clean", "detailed", "max"] as DensityMode[]).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                  density === d
                    ? "text-amber-gold bg-amber-gold/8"
                    : "text-ink-mute/60 hover:text-ink-text"
                }`}
              >
                {d}
              </button>
            ))}
            <span className="mx-1 h-3 w-px bg-ink-line/30" />
            <button
              onClick={() => setStrongOnly((v) => !v)}
              className={`px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                strongOnly ? "text-amber-gold" : "text-ink-mute/60 hover:text-ink-text"
              }`}
            >
              strong
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-0.5">
            {FILTER_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => toggleFilter(key)}
                className={`px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider transition-colors ${
                  enabledFilters.has(key)
                    ? "text-ink-text/70 bg-ink-line/30"
                    : "text-ink-mute/30 hover:text-ink-mute/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {!analysis ? (
            <div className="px-4 py-8 text-center text-sm text-ink-mute/50">
              Write lyrics to see analysis.
            </div>
          ) : (
            <>
              {analysis.capped && (
                <div className="px-4 py-1.5 font-mono text-[9px] text-amber-gold/70 border-b border-ink-line/30">
                  Capped — showing strongest matches
                </div>
              )}

              {/* Legend */}
              <div className="px-4 py-2 border-b border-ink-line/30">
                <div className="flex flex-wrap gap-1">
                  {analysis.families.slice(0, 10).map((f) => (
                    <span
                      key={f.id}
                      className="flex items-center gap-1 px-1 py-0.5 font-mono text-[7px] uppercase tracking-wider text-ink-mute/70"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-sm"
                        style={{
                          backgroundColor:
                            f.type === "repetition"
                              ? "transparent"
                              : FAMILY_COLORS[f.colorIndex % FAMILY_COLORS.length],
                          border:
                            f.type === "repetition"
                              ? `1px dashed ${FAMILY_BORDER_COLORS[f.colorIndex % FAMILY_BORDER_COLORS.length]}`
                              : undefined,
                        }}
                      />
                      {f.type}
                    </span>
                  ))}
                </div>
              </div>

              {/* Sound Map */}
              <SoundMapPanel
                metrics={analysis.metrics}
                families={analysis.families}
                weakLines={analysis.weakLines}
              />
            </>
          )}
        </div>
      </aside>
    </>
  );
}
