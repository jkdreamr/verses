"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import {
  analyzeRhymeLens,
  DEFAULT_OPTIONS,
  CLEAN_OPTIONS,
  MAX_OPTIONS,
  RHYME_LENS_DEBUG,
  type RhymeType,
  type RhymeFamily,
  type RhymeLensResult,
  type RhymeLensMetrics,
  type DensityMode,
  type RhymeLensOptions,
} from "@/lib/rhymeLens";

// ---------------------------------------------------------------------------
// Color palette — 24 distinct highlight colors (well-separated hues)
// ---------------------------------------------------------------------------

export const FAMILY_COLORS: string[] = [
  "rgba(251,191,36,0.30)",   // amber
  "rgba(96,165,250,0.28)",   // blue
  "rgba(236,72,153,0.26)",   // pink
  "rgba(52,211,153,0.26)",   // emerald
  "rgba(168,85,247,0.26)",   // purple
  "rgba(34,211,238,0.26)",   // cyan
  "rgba(251,146,60,0.28)",   // orange
  "rgba(163,230,53,0.22)",   // lime
  "rgba(248,113,113,0.24)",  // red
  "rgba(129,140,248,0.26)",  // indigo
  "rgba(232,121,249,0.22)",  // fuchsia
  "rgba(45,212,191,0.22)",   // teal
  "rgba(253,186,116,0.26)",  // light-orange
  "rgba(134,239,172,0.22)",  // light-green
  "rgba(196,181,253,0.24)",  // light-purple
  "rgba(252,211,77,0.26)",   // yellow
  "rgba(125,211,252,0.24)",  // sky
  "rgba(244,114,182,0.24)",  // rose
  "rgba(110,231,183,0.24)",  // mint
  "rgba(217,119,6,0.24)",    // ochre
  "rgba(147,197,253,0.24)",  // cornflower
  "rgba(250,204,21,0.22)",   // gold
  "rgba(192,132,252,0.23)",  // violet
  "rgba(74,222,128,0.22)",   // green
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
  "rgba(125,211,252,0.60)",
  "rgba(244,114,182,0.58)",
  "rgba(110,231,183,0.58)",
  "rgba(217,119,6,0.58)",
  "rgba(147,197,253,0.58)",
  "rgba(250,204,21,0.55)",
  "rgba(192,132,252,0.58)",
  "rgba(74,222,128,0.55)",
];

// Solid text colors for the family list
const FAMILY_TEXT_COLORS: string[] = [
  "rgb(251,191,36)",
  "rgb(96,165,250)",
  "rgb(236,72,153)",
  "rgb(52,211,153)",
  "rgb(168,85,247)",
  "rgb(34,211,238)",
  "rgb(251,146,60)",
  "rgb(163,230,53)",
  "rgb(248,113,113)",
  "rgb(129,140,248)",
  "rgb(232,121,249)",
  "rgb(45,212,191)",
  "rgb(253,186,116)",
  "rgb(134,239,172)",
  "rgb(196,181,253)",
  "rgb(252,211,77)",
  "rgb(125,211,252)",
  "rgb(244,114,182)",
  "rgb(110,231,183)",
  "rgb(217,119,6)",
  "rgb(147,197,253)",
  "rgb(250,204,21)",
  "rgb(192,132,252)",
  "rgb(74,222,128)",
];

// ---------------------------------------------------------------------------
// Exported types for Editor integration
// ---------------------------------------------------------------------------

export type HighlightLayer = {
  colorIndex: number;
  familyId: string;
  type: RhymeType;
  strength: "light" | "medium" | "strong";
  label?: string;
  explanation?: string;
};

export type CharHighlight = HighlightLayer[];

// ---------------------------------------------------------------------------
// Build character-offset highlight map from analysis result
// ---------------------------------------------------------------------------

// Types that render as secondary layers (underline, dashed etc.) rather than
// replacing the primary fill. These may coexist on the same characters as a
// stronger primary family.
const SECONDARY_LAYER_TYPES = new Set<RhymeType>([
  "assonance", "consonance", "alliteration", "eye", "repetition",
  "slant", "family", "rich",
]);

// Priority weight for choosing the dominant (fill) layer per character position
function familyPriority(f: RhymeFamily): number {
  switch (f.type) {
    case "end": case "chain": return 100;
    case "multi": case "compound": case "mosaic": return 90;
    case "perfect": return 85;
    case "rich": return 80;
    case "internal": return 70;
    case "cross": return 60;
    case "repetition": return 50;
    case "slant": return 40;
    case "family": return 35;
    case "consonance": case "assonance": return 30;
    case "alliteration": return 20;
    case "eye": return 10;
    default: return 5;
  }
}

export function buildCharHighlights(
  analysis: RhymeLensResult | null,
  focusFamilyId?: string | null
): Map<number, CharHighlight> {
  const map = new Map<number, CharHighlight>();
  if (!analysis) return map;

  // Sort families: primary-fill families first (highest priority last so
  // they end up as the first/dominant layer), secondary types at the end.
  const sorted = [...analysis.families].sort((a, b) => familyPriority(a) - familyPriority(b));

  // If focus mode, only show the focused family
  const families = focusFamilyId
    ? sorted.filter((f) => f.id === focusFamilyId)
    : sorted;

  for (const family of families) {
    const isSecondary = SECONDARY_LAYER_TYPES.has(family.type);
    for (const span of family.spans) {
      for (let c = span.start; c < span.end; c++) {
        const layers = map.get(c) ?? [];
        if (layers.some((layer) => layer.familyId === family.id)) continue;

        // For secondary types, only add the layer if it doesn't already have
        // the same type from another family at this position (avoid spam)
        if (isSecondary && layers.some((l) => l.type === family.type)) continue;

        layers.push({
          colorIndex: family.colorIndex,
          familyId: family.id,
          type: family.type,
          strength: family.strength,
          label: family.label,
          explanation: family.explanation,
        });
        map.set(c, layers);
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
  { key: "multi", label: "Multi" },
  { key: "rich", label: "Rich" },
  { key: "slant", label: "Slant" },
  { key: "family", label: "Family" },
  { key: "assonance", label: "Assonance" },
  { key: "consonance", label: "Consonance" },
  { key: "alliteration", label: "Alliteration" },
  { key: "eye", label: "Eye" },
  { key: "repetition", label: "Repetition" },
  { key: "cross", label: "Cross" },
  { key: "chain", label: "Chain" },
];

// ---------------------------------------------------------------------------
// Sound Map Panel
// ---------------------------------------------------------------------------

function SoundMapPanel({
  metrics,
  families,
  weakLines,
  focusFamilyId,
  onFocusFamily,
}: {
  metrics: RhymeLensMetrics;
  families: RhymeFamily[];
  weakLines: number[];
  focusFamilyId: string | null;
  onFocusFamily: (id: string | null) => void;
}) {
  return (
    <div className="space-y-4 px-5 pb-6 pt-4">
      {/* Metrics grid */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: "Density", v: `${metrics.rhymeDensity}%` },
          { l: "End", v: metrics.endRhymeGroups },
          { l: "Internal", v: metrics.internalRhymeGroups },
          { l: "Multi", v: metrics.multisyllabicChains },
          { l: "Slant", v: metrics.slantGroups },
          { l: "Repeat", v: metrics.repetitionCount },
          { l: "Per line", v: metrics.averageRhymesPerLine },
          { l: "Longest", v: metrics.strongestFamilyLength },
          { l: "Weak", v: metrics.weakLineCount },
        ].map(({ l, v }) => (
          <div key={l} className="py-1.5">
            <div className="text-[10px] text-ink-mute/50">{l}</div>
            <div className="font-mono text-sm text-ink-text/90">{v}</div>
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px bg-ink-line/20" />

      {/* Family list */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-mute/60">Sound families</span>
          {focusFamilyId && (
            <button
              onClick={() => onFocusFamily(null)}
              className="text-[10px] text-amber-gold/70 transition-colors hover:text-amber-gold"
            >
              Show all
            </button>
          )}
        </div>
        {families.slice(0, 48).map((f) => {
          const isFocused = focusFamilyId === f.id;
          const isDimmed = focusFamilyId && !isFocused;
          return (
            <button
              key={f.id}
              onClick={() => onFocusFamily(isFocused ? null : f.id)}
              title={
                RHYME_LENS_DEBUG
                  ? `ID: ${f.id}\nType: ${f.type}\nConfidence: ${f.confidence.toFixed(2)}\nLabel: ${f.label}\nExplanation: ${f.explanation}\nSpans: ${f.spans.map((s) => `"${s.text}" (L${s.lineIndex + 1})`).join(", ")}${f.debugInfo ? `\nReason: ${f.debugInfo.reason}\nAnchor: ${f.debugInfo.anchorSound}` : ""}`
                  : f.explanation
              }
              className={`flex w-full items-start gap-2.5 rounded px-2 py-1.5 text-left transition-all duration-150 ${
                isFocused
                  ? "bg-ink-line/20"
                  : isDimmed
                  ? "opacity-30"
                  : "hover:bg-ink-line/10"
              }`}
            >
              <span
                className="mt-1 h-2 w-2 shrink-0 rounded-sm"
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
                <div
                  className="truncate text-[11px] leading-tight"
                  style={{
                    color: FAMILY_TEXT_COLORS[f.colorIndex % FAMILY_TEXT_COLORS.length],
                    opacity: isDimmed ? 0.4 : 0.85,
                  }}
                >
                  {f.spans.map((s) => s.text).join(" / ")}
                </div>
                <div className="mt-0.5 text-[9px] text-ink-mute/40">
                  {f.type} · {f.spans.length} · {f.strength} · {Math.round(f.confidence * 100)}%
                  {RHYME_LENS_DEBUG && ` · conf:${f.confidence.toFixed(2)}`}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {weakLines.length > 0 && (
        <>
          <div className="h-px bg-ink-line/20" />
          <div className="text-[10px] text-ink-mute/40">
            Weak lines: {weakLines.map((l) => l + 1).join(", ")}
          </div>
        </>
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
  onAnalysis,
}: {
  lyrics: string;
  open: boolean;
  onToggle: () => void;
  onAnalysis?: (result: RhymeLensResult | null, focusId?: string | null) => void;
}) {
  const debouncedLyrics = useDebounce(lyrics, 400);

  const [density, setDensity] = useState<DensityMode>("detailed");
  const [enabledFilters, setEnabledFilters] = useState<Set<RhymeType>>(
    () =>
      new Set<RhymeType>([
        "end", "internal", "multi", "compound", "mosaic", "slant",
        "rich", "family", "assonance", "consonance", "alliteration", "eye", "repetition", "cross", "chain",
      ])
  );
  const [strongOnly, setStrongOnly] = useState(false);
  const [focusFamilyId, setFocusFamilyId] = useState<string | null>(null);

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
    onAnalysis?.(open ? analysis : null, focusFamilyId);
  }, [analysis, open, onAnalysis, focusFamilyId]);

  // Reset focus when analysis changes
  useEffect(() => {
    setFocusFamilyId(null);
  }, [analysis]);

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
      {/* Toggle button */}
      <button
        onClick={onToggle}
        aria-pressed={open}
        aria-label="Toggle Rhyme Lens"
        className={`fixed bottom-[7rem] left-8 z-10 ml-[140px] px-3 py-1.5 text-[10px] tracking-wide transition-all duration-150 print:hidden ${
          open
            ? "bg-amber-gold/8 text-amber-gold border border-amber-gold/30"
            : "text-ink-mute/50 border border-transparent hover:text-ink-text/70 hover:border-ink-line/30"
        }`}
      >
        Rhyme Lens
      </button>

      {/* Side panel */}
      <aside
        ref={panelRef}
        aria-hidden={!open}
        className={`fixed bottom-0 right-0 top-0 z-30 flex w-[min(360px,42vw)] flex-col border-l border-ink-line/20 bg-ink/98 backdrop-blur-md transition-transform duration-200 print:hidden ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between px-5 py-4">
          <span className="font-serif text-[15px] text-ink-text/90">Rhyme Lens</span>
          <button
            onClick={onToggle}
            className="p-1 text-ink-mute/40 transition-colors hover:text-ink-text"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l10 10M11 1L1 11"/></svg>
          </button>
        </header>

        {/* Controls */}
        <div className="shrink-0 px-5 pb-3">
          {/* Density */}
          <div className="flex items-center gap-1">
            {(["clean", "detailed", "max"] as DensityMode[]).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`px-2.5 py-1 text-[10px] capitalize tracking-wide transition-colors ${
                  density === d
                    ? "text-amber-gold bg-amber-gold/8"
                    : "text-ink-mute/40 hover:text-ink-text/70"
                }`}
              >
                {d}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setStrongOnly((v) => !v)}
              className={`px-2 py-1 text-[10px] tracking-wide transition-colors ${
                strongOnly ? "text-amber-gold" : "text-ink-mute/40 hover:text-ink-text/70"
              }`}
            >
              Strong only
            </button>
          </div>
          {/* Type filters */}
          <div className="mt-2 flex flex-wrap gap-1">
            {FILTER_LABELS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => toggleFilter(key)}
                className={`px-2 py-0.5 text-[9px] tracking-wide transition-colors ${
                  enabledFilters.has(key)
                    ? "text-ink-text/60 bg-ink-line/25"
                    : "text-ink-mute/25 hover:text-ink-mute/50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-ink-line/15" />

        {/* Body */}
        <div className="flex-1 overflow-auto scrollbar-thin">
          {!analysis ? (
            <div className="px-5 py-12 text-center">
              <p className="text-[13px] text-ink-mute/40">
                Write a few lines to reveal sound families.
              </p>
            </div>
          ) : (
            <>
              {analysis.capped && (
                <div className="px-5 py-2 text-[10px] text-amber-gold/60">
                  Showing strongest matches.
                </div>
              )}
              <SoundMapPanel
                metrics={analysis.metrics}
                families={analysis.families}
                weakLines={analysis.weakLines}
                focusFamilyId={focusFamilyId}
                onFocusFamily={setFocusFamilyId}
              />
            </>
          )}
        </div>
      </aside>
    </>
  );
}
