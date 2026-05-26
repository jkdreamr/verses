"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
// Color palette — 16 tasteful highlight colors (hsl-based for text readability)
// ---------------------------------------------------------------------------

const FAMILY_COLORS: string[] = [
  "rgba(251,191,36,0.35)",   // amber
  "rgba(129,140,248,0.30)",  // indigo
  "rgba(52,211,153,0.30)",   // emerald
  "rgba(248,113,113,0.28)",  // red
  "rgba(168,85,247,0.28)",   // purple
  "rgba(34,211,238,0.28)",   // cyan
  "rgba(251,146,60,0.30)",   // orange
  "rgba(163,230,53,0.25)",   // lime
  "rgba(236,72,153,0.28)",   // pink
  "rgba(96,165,250,0.28)",   // blue
  "rgba(232,121,249,0.25)",  // fuchsia
  "rgba(45,212,191,0.25)",   // teal
  "rgba(253,186,116,0.28)",  // light-orange
  "rgba(134,239,172,0.25)",  // light-green
  "rgba(196,181,253,0.28)",  // light-purple
  "rgba(252,211,77,0.30)",   // yellow
];

const FAMILY_BORDER_COLORS: string[] = [
  "rgba(251,191,36,0.70)",
  "rgba(129,140,248,0.65)",
  "rgba(52,211,153,0.60)",
  "rgba(248,113,113,0.60)",
  "rgba(168,85,247,0.60)",
  "rgba(34,211,238,0.60)",
  "rgba(251,146,60,0.65)",
  "rgba(163,230,53,0.55)",
  "rgba(236,72,153,0.60)",
  "rgba(96,165,250,0.60)",
  "rgba(232,121,249,0.55)",
  "rgba(45,212,191,0.55)",
  "rgba(253,186,116,0.60)",
  "rgba(134,239,172,0.55)",
  "rgba(196,181,253,0.60)",
  "rgba(252,211,77,0.65)",
];

// ---------------------------------------------------------------------------
// Type filter configuration
// ---------------------------------------------------------------------------

type FilterKey = RhymeType;
const FILTER_LABELS: { key: FilterKey; label: string }[] = [
  { key: "end", label: "End" },
  { key: "internal", label: "Internal" },
  { key: "multi", label: "Multis" },
  { key: "slant", label: "Slant" },
  { key: "assonance", label: "Assonance" },
  { key: "consonance", label: "Consonance" },
  { key: "alliteration", label: "Allit." },
  { key: "repetition", label: "Repeat" },
  { key: "cross", label: "Cross" },
  { key: "chain", label: "Chain" },
];

// ---------------------------------------------------------------------------
// Helper: build a highlight map from families for efficient rendering
// ---------------------------------------------------------------------------

type HighlightSegment = {
  start: number;
  end: number;
  familyIds: string[];
  colorIndex: number;
  strength: "light" | "medium" | "strong";
  type: RhymeType;
};

function buildHighlightMap(families: RhymeFamily[]): Map<number, HighlightSegment[]> {
  // Group highlights by line
  const byLine = new Map<number, HighlightSegment[]>();

  for (const family of families) {
    for (const span of family.spans) {
      if (!byLine.has(span.lineIndex)) byLine.set(span.lineIndex, []);
      byLine.get(span.lineIndex)!.push({
        start: span.startWordIndex,
        end: span.endWordIndex,
        familyIds: [family.id],
        colorIndex: family.colorIndex,
        strength: family.strength,
        type: family.type,
      });
    }
  }

  return byLine;
}

// ---------------------------------------------------------------------------
// Helper: render a single lyric line with inline highlights
// ---------------------------------------------------------------------------

function HighlightedLine({
  line,
  lineIndex,
  highlights,
  families,
  isWeak,
  onSpanClick,
}: {
  line: string;
  lineIndex: number;
  highlights: HighlightSegment[];
  families: RhymeFamily[];
  isWeak: boolean;
  onSpanClick: (familyId: string, rect: DOMRect) => void;
}) {
  const lineRef = useRef<HTMLDivElement>(null);

  // Tokenize the line to match word indices
  const wordRegex = /[a-zA-Z\u2018\u2019'']+(?:'[a-zA-Z]+)*/g;
  const words: { text: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  wordRegex.lastIndex = 0;
  while ((match = wordRegex.exec(line)) !== null) {
    words.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }

  // Build character-level highlight assignment
  // For each word, check if it's in a highlight
  const wordHighlights: (HighlightSegment | null)[] = words.map((_, wIdx) => {
    // Find strongest highlight covering this word
    const covering = highlights.filter((h) => wIdx >= h.start && wIdx <= h.end);
    if (covering.length === 0) return null;
    // Prefer: strong > medium > light, then multi > end > internal...
    covering.sort((a, b) => {
      const str = (s: string) => s === "strong" ? 3 : s === "medium" ? 2 : 1;
      return str(b.strength) - str(a.strength);
    });
    return covering[0];
  });

  // Render the line with highlights
  const segments: React.ReactNode[] = [];
  let cursor = 0;

  for (let wIdx = 0; wIdx < words.length; wIdx++) {
    const word = words[wIdx];
    // Add any text before this word (spaces, punctuation)
    if (word.start > cursor) {
      segments.push(
        <span key={`gap-${wIdx}`} className="text-ink-text/80">
          {line.slice(cursor, word.start)}
        </span>
      );
    }

    const hl = wordHighlights[wIdx];
    if (hl) {
      // Check if this is start of a multi-word span
      const isSpanStart = wIdx === 0 || wordHighlights[wIdx - 1]?.colorIndex !== hl.colorIndex ||
        wordHighlights[wIdx - 1]?.familyIds[0] !== hl.familyIds[0];
      const isSpanEnd = wIdx === words.length - 1 || wordHighlights[wIdx + 1]?.colorIndex !== hl.colorIndex ||
        wordHighlights[wIdx + 1]?.familyIds[0] !== hl.familyIds[0];

      const bgColor = FAMILY_COLORS[hl.colorIndex % FAMILY_COLORS.length];
      const borderColor = FAMILY_BORDER_COLORS[hl.colorIndex % FAMILY_BORDER_COLORS.length];

      const isRepetition = hl.type === "repetition";
      const style: React.CSSProperties = isRepetition
        ? { borderBottom: `1.5px dashed ${borderColor}`, paddingBottom: "1px" }
        : {
            backgroundColor: bgColor,
            borderRadius: isSpanStart && isSpanEnd ? "3px" : isSpanStart ? "3px 0 0 3px" : isSpanEnd ? "0 3px 3px 0" : "0",
            padding: "1px 0",
            borderBottom: hl.strength === "strong" ? `2px solid ${borderColor}` : undefined,
          };

      segments.push(
        <span
          key={`w-${wIdx}`}
          className="cursor-pointer transition-opacity hover:opacity-80"
          style={style}
          onClick={(e) => {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            onSpanClick(hl.familyIds[0], rect);
          }}
          title={families.find((f) => f.id === hl.familyIds[0])?.label}
        >
          {word.text}
        </span>
      );
    } else {
      segments.push(
        <span key={`w-${wIdx}`} className="text-ink-text/80">
          {word.text}
        </span>
      );
    }

    cursor = word.end;
  }

  // Trailing text
  if (cursor < line.length) {
    segments.push(
      <span key="trail" className="text-ink-text/80">
        {line.slice(cursor)}
      </span>
    );
  }

  return (
    <div
      ref={lineRef}
      className={`group relative flex items-baseline gap-2 px-3 py-[3px] ${
        isWeak ? "border-l-2 border-ink-mute/30" : ""
      }`}
    >
      <span className="w-5 shrink-0 select-none text-right font-mono text-[9px] text-ink-mute/50">
        {lineIndex + 1}
      </span>
      <span className="min-w-0 flex-1 font-sans text-[13px] leading-[1.7]">
        {line.trim() === "" ? <span className="text-ink-mute/30">&nbsp;</span> : segments}
      </span>
      {isWeak && (
        <span className="shrink-0 font-mono text-[8px] uppercase tracking-widest text-ink-mute/40">
          weak
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popover component
// ---------------------------------------------------------------------------

function FamilyPopover({
  family,
  position,
  onClose,
}: {
  family: RhymeFamily;
  position: { top: number; left: number };
  onClose: () => void;
}) {
  const bgColor = FAMILY_COLORS[family.colorIndex % FAMILY_COLORS.length];

  return (
    <div
      className="fixed z-[100] max-w-[280px] rounded border border-ink-line bg-ink-surface shadow-lg"
      style={{ top: position.top + 8, left: position.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: bgColor }}
          />
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-text">
            {family.label}
          </span>
        </div>
        <div className="mt-1.5 font-mono text-[9px] uppercase tracking-wider text-ink-mute">
          {family.type} · {family.strength} · {Math.round(family.confidence * 100)}%
        </div>
        <div className="mt-1.5 text-[11px] leading-snug text-ink-text/70">
          {family.explanation}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {family.spans.map((span) => (
            <span
              key={span.id}
              className="rounded border border-ink-line bg-ink/30 px-1.5 py-0.5 font-mono text-[10px] text-ink-text/80"
            >
              {span.text}
            </span>
          ))}
        </div>
      </div>
      <button
        onClick={onClose}
        className="absolute right-1.5 top-1.5 rounded p-0.5 text-[10px] text-ink-mute hover:text-ink-text"
      >
        x
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sound Map Panel
// ---------------------------------------------------------------------------

function SoundMapPanel({ metrics, families, weakLines }: {
  metrics: RhymeLensMetrics;
  families: RhymeFamily[];
  weakLines: number[];
}) {
  const [expanded, setExpanded] = useState(true);

  const strongest = families.slice(0, 5);
  const multis = families.filter((f) => f.type === "multi" || f.type === "compound");
  const endings = families.filter((f) => f.type === "end" || f.type === "chain");
  const internals = families.filter((f) => f.type === "internal" || f.type === "cross");
  const reps = families.filter((f) => f.type === "repetition");

  return (
    <div className="border-t border-ink-line">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-ink-line/30"
      >
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
          Sound Map
        </span>
        <span className="text-[10px] text-ink-mute">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          {/* Metrics grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "Density", value: `${metrics.rhymeDensity}%` },
              { label: "End groups", value: metrics.endRhymeGroups },
              { label: "Internal", value: metrics.internalRhymeGroups },
              { label: "Multis", value: metrics.multisyllabicChains },
              { label: "Slant", value: metrics.slantGroups },
              { label: "Assonance", value: metrics.assonanceGroups },
              { label: "Consonance", value: metrics.consonanceGroups },
              { label: "Allit.", value: metrics.alliterationGroups },
              { label: "Repeats", value: metrics.repetitionCount },
              { label: "Avg/line", value: metrics.averageRhymesPerLine },
              { label: "Longest chain", value: metrics.strongestFamilyLength },
              { label: "Weak lines", value: metrics.weakLineCount },
            ].map(({ label, value }) => (
              <div key={label} className="rounded border border-ink-line/50 bg-ink/20 px-2 py-1.5">
                <div className="font-mono text-[8px] uppercase tracking-widest text-ink-mute">
                  {label}
                </div>
                <div className="mt-0.5 font-mono text-sm text-ink-text">{value}</div>
              </div>
            ))}
          </div>

          {/* Strongest chains */}
          {strongest.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-ink-mute">
                Strongest chains
              </div>
              <div className="space-y-1">
                {strongest.map((f) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: FAMILY_COLORS[f.colorIndex % FAMILY_COLORS.length] }}
                    />
                    <span className="font-mono text-[10px] text-ink-text/70">
                      {f.label}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-ink-mute">
                      {f.spans.length} spans
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Multisyllabic */}
          {multis.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-ink-mute">
                Multis
              </div>
              <div className="flex flex-wrap gap-1">
                {multis.slice(0, 6).map((f) => (
                  <span key={f.id} className="rounded border border-ink-line bg-ink/30 px-1.5 py-0.5 font-mono text-[9px] text-ink-text/70">
                    {f.spans.map((s) => s.text).join(" / ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Endings */}
          {endings.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-ink-mute">
                Endings
              </div>
              <div className="flex flex-wrap gap-1">
                {endings.slice(0, 6).map((f) => (
                  <span key={f.id} className="rounded border border-ink-line bg-ink/30 px-1.5 py-0.5 font-mono text-[9px] text-ink-text/70">
                    {f.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Internal echoes */}
          {internals.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-ink-mute">
                Internal echoes
              </div>
              <div className="flex flex-wrap gap-1">
                {internals.slice(0, 6).map((f) => (
                  <span key={f.id} className="rounded border border-ink-line bg-ink/30 px-1.5 py-0.5 font-mono text-[9px] text-ink-text/70">
                    {f.spans.map((s) => s.text).join(" / ")}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Repetition */}
          {reps.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-ink-mute">
                Hook / repetition moments
              </div>
              <div className="flex flex-wrap gap-1">
                {reps.slice(0, 5).map((f) => (
                  <span key={f.id} className="rounded border border-ink-line bg-ink/30 px-1.5 py-0.5 font-mono text-[9px] text-ink-text/70">
                    {f.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Weak lines */}
          {weakLines.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-ink-mute">
                Weak lines
              </div>
              <div className="font-mono text-[10px] text-ink-mute/70">
                Lines {weakLines.map((l) => l + 1).join(", ")} — few or no sound connections
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RhymeLens component
// ---------------------------------------------------------------------------

export function RhymeLens({
  lyrics,
  open,
  onToggle,
}: {
  lyrics: string;
  open: boolean;
  onToggle: () => void;
}) {
  const debouncedLyrics = useDebounce(lyrics, 400);

  // State
  const [density, setDensity] = useState<DensityMode>("detailed");
  const [enabledFilters, setEnabledFilters] = useState<Set<RhymeType>>(
    () => new Set<RhymeType>(["end", "internal", "multi", "compound", "mosaic", "slant", "assonance", "consonance", "alliteration", "repetition", "cross", "chain"])
  );
  const [strongOnly, setStrongOnly] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [popover, setPopover] = useState<{ familyId: string; position: { top: number; left: number } } | null>(null);

  // Build options from state
  const options = useMemo<RhymeLensOptions>(() => {
    const base = density === "clean" ? CLEAN_OPTIONS : density === "max" ? MAX_OPTIONS : DEFAULT_OPTIONS;
    return {
      ...base,
      density,
      enabledTypes: enabledFilters,
      strongOnly,
    };
  }, [density, enabledFilters, strongOnly]);

  // Run analysis
  const analysis = useMemo<RhymeLensResult | null>(() => {
    if (!debouncedLyrics.trim()) return null;
    return analyzeRhymeLens(debouncedLyrics, options);
  }, [debouncedLyrics, options]);

  // Build highlight map
  const highlightMap = useMemo(() => {
    if (!analysis) return new Map<number, HighlightSegment[]>();
    return buildHighlightMap(analysis.families);
  }, [analysis]);

  // Family lookup
  const familyMap = useMemo(() => {
    if (!analysis) return new Map<string, RhymeFamily>();
    const m = new Map<string, RhymeFamily>();
    for (const f of analysis.families) m.set(f.id, f);
    return m;
  }, [analysis]);

  // Popover handler
  const handleSpanClick = useCallback((familyId: string, rect: DOMRect) => {
    setPopover({ familyId, position: { top: rect.bottom, left: rect.left } });
  }, []);

  const toggleFilter = useCallback((key: RhymeType) => {
    setEnabledFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Close popover on click outside
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {/* Toggle button — bottom-left, above YouTube bar */}
      <button
        onClick={onToggle}
        aria-pressed={open}
        aria-label="Toggle Rhyme Lens"
        className={`fixed bottom-24 left-4 z-10 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors duration-150 print:hidden ${
          open
            ? "border-amber-gold text-amber-gold"
            : "border-transparent text-ink-mute hover:text-ink-text"
        }`}
      >
        Rhyme Lens
      </button>

      {/* Analysis panel — slides in from the right */}
      <aside
        ref={panelRef}
        aria-hidden={!open}
        className={`fixed bottom-0 right-0 top-0 z-30 flex w-[min(480px,52vw)] flex-col border-l border-ink-line bg-ink-surface transition-transform duration-150 print:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        onClick={() => setPopover(null)}
      >
        {/* Panel header */}
        <header className="flex shrink-0 items-center justify-between border-b border-ink-line px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
              Rhyme Lens
            </div>
            <div className="mt-0.5 font-serif text-base text-ink-text">
              sound architecture
            </div>
          </div>
          <button
            onClick={onToggle}
            className="rounded p-1 text-ink-mute transition-colors duration-150 hover:bg-ink-line hover:text-ink-text"
            aria-label="Close Rhyme Lens"
          >
            x
          </button>
        </header>

        {/* Controls bar */}
        <div className="shrink-0 border-b border-ink-line px-4 py-2.5">
          {/* Density selector */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-ink-mute">
              Density:
            </span>
            {(["clean", "detailed", "max"] as DensityMode[]).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                  density === d
                    ? "border-amber-gold/60 text-amber-gold"
                    : "border-ink-line text-ink-mute hover:text-ink-text"
                }`}
              >
                {d}
              </button>
            ))}
            <span className="mx-1 text-ink-line">|</span>
            <button
              onClick={() => setStrongOnly((v) => !v)}
              className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                strongOnly
                  ? "border-amber-gold/60 text-amber-gold"
                  : "border-ink-line text-ink-mute hover:text-ink-text"
              }`}
            >
              strong only
            </button>
            <button
              onClick={() => setShowLabels((v) => !v)}
              className={`rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                showLabels
                  ? "border-amber-gold/60 text-amber-gold"
                  : "border-ink-line text-ink-mute hover:text-ink-text"
              }`}
            >
              labels
            </button>
          </div>

          {/* Type filters */}
          <div className="mt-2 flex flex-wrap gap-1">
            {FILTER_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => toggleFilter(key)}
                className={`rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider transition-colors ${
                  enabledFilters.has(key)
                    ? "border-ink-text/30 text-ink-text/80"
                    : "border-ink-line/50 text-ink-mute/50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Panel body — scrollable */}
        <div className="flex-1 overflow-auto">
          {!analysis ? (
            <div className="px-4 py-8 text-center text-sm text-ink-mute">
              Start writing to see sound analysis.
            </div>
          ) : (
            <>
              {/* Capped notice */}
              {analysis.capped && (
                <div className="border-b border-ink-line bg-amber-gold/5 px-4 py-2 font-mono text-[10px] text-amber-gold/80">
                  Showing strongest matches (draft is long)
                </div>
              )}

              {/* Legend */}
              <div className="border-b border-ink-line px-4 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {analysis.families.slice(0, 8).map((f) => (
                    <span
                      key={f.id}
                      className="flex items-center gap-1 rounded border border-ink-line/50 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-ink-mute"
                    >
                      <span
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: FAMILY_COLORS[f.colorIndex % FAMILY_COLORS.length] }}
                      />
                      {showLabels ? f.label : f.type}
                    </span>
                  ))}
                  {analysis.families.length > 8 && (
                    <span className="font-mono text-[8px] text-ink-mute/50">
                      +{analysis.families.length - 8} more
                    </span>
                  )}
                </div>
              </div>

              {/* Highlighted lyric mirror */}
              <div className="py-2">
                {analysis.lines.map((line, i) => (
                  <HighlightedLine
                    key={i}
                    line={line}
                    lineIndex={i}
                    highlights={highlightMap.get(i) ?? []}
                    families={analysis.families}
                    isWeak={analysis.weakLines.includes(i)}
                    onSpanClick={handleSpanClick}
                  />
                ))}
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

      {/* Popover */}
      {popover && familyMap.get(popover.familyId) && (
        <FamilyPopover
          family={familyMap.get(popover.familyId)!}
          position={popover.position}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  );
}
