"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureEngine, resumeEngine } from "@/lib/audio/engine";
import {
  KEY_NAMES,
  SCALES,
  type ScaleId,
  xToScaleMidi,
  midiToFreq,
  midiToLabel,
  buildScaleLadder,
  keyToPc,
} from "@/lib/audio/scales";
import { chordLabel, type ChordSlot } from "@/hooks/perform/useChordSynth";

// ───────────────────────────────────────────────────────────────────────────
// Multi-touch instrument — the no-camera / accessibility / mobile path.
//
//  • A scale-locked XY pad: X → in-key note, Y → expression (filter + level).
//    Each simultaneous pointer is its own gliding synth voice (true polyphony).
//  • A row of large chord pads wired to the shared sampled chord engine.
//
// The melodic voices use a small Tone synth pool on the engine's pad bus, so
// everything is captured by the recording tap just like the gesture path.
// ───────────────────────────────────────────────────────────────────────────

type Voice = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  synth: any;
  midi: number;
};

type ActivePoint = { id: number; x: number; y: number; label: string };

export function TouchInstrument({
  rootKey,
  scaleId,
  onChangeKey,
  onChangeScale,
  chordSlots,
  onChordDown,
  onChordUp,
  compact = false,
}: {
  rootKey: string;
  scaleId: ScaleId;
  onChangeKey: (k: string) => void;
  onChangeScale: (s: ScaleId) => void;
  chordSlots: ChordSlot[];
  onChordDown: (slot: ChordSlot) => void;
  onChordUp: () => void;
  compact?: boolean;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterRef = useRef<any>(null);
  const voicesRef = useRef<Map<number, Voice>>(new Map());
  const readyRef = useRef(false);
  const [audioReady, setAudioReady] = useState(false);
  const [points, setPoints] = useState<ActivePoint[]>([]);
  const [activeChordSlot, setActiveChordSlot] = useState<number | null>(null);

  const rootPc = keyToPc(rootKey);

  // Lazy Tone setup (shared filter on the pad bus).
  const ensureAudio = useCallback(async () => {
    if (readyRef.current) return;
    const engine = ensureEngine();
    await resumeEngine();
    const Tone = await engine.loadTone();
    if (!filterRef.current) {
      const filter = new Tone.Filter({ type: "lowpass", frequency: 3200, Q: 0.7 });
      filter.connect(engine.padBus);
      filterRef.current = filter;
    }
    readyRef.current = true;
    setAudioReady(true);
  }, []);

  useEffect(() => {
    const voices = voicesRef.current;
    return () => {
      voices.forEach((v) => {
        try { v.synth.triggerRelease(); v.synth.dispose(); } catch { /* */ }
      });
      voices.clear();
      try { filterRef.current?.dispose(); } catch { /* */ }
      filterRef.current = null;
      readyRef.current = false;
    };
  }, []);

  const padGeometry = useCallback((clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    return { x, y };
  }, []);

  // expression: top of pad (y→0) = bright/loud, bottom = soft/dark
  const applyExpression = useCallback((y: number) => {
    const expr = 1 - y;
    const cutoff = 350 + expr * expr * 6000;
    if (filterRef.current) {
      filterRef.current.frequency.rampTo(cutoff, 0.05);
    }
    return expr;
  }, []);

  const startVoice = useCallback(async (id: number, clientX: number, clientY: number) => {
    await ensureAudio();
    const engine = ensureEngine();
    const Tone = engine.tone;
    if (!Tone || !filterRef.current) return;
    const { x, y } = padGeometry(clientX, clientY);
    const midi = xToScaleMidi(x, rootPc, scaleId);
    const expr = applyExpression(y);
    const synth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.18, sustain: 0.72, release: 0.5 },
      portamento: 0.05,
    });
    synth.connect(filterRef.current);
    synth.triggerAttack(midiToFreq(midi), undefined, 0.4 + expr * 0.5);
    voicesRef.current.set(id, { synth, midi });
    setPoints((prev) => [
      ...prev.filter((p) => p.id !== id),
      { id, x, y, label: midiToLabel(midi) },
    ]);
  }, [applyExpression, ensureAudio, padGeometry, rootPc, scaleId]);

  const moveVoice = useCallback((id: number, clientX: number, clientY: number) => {
    const v = voicesRef.current.get(id);
    if (!v) return;
    const { x, y } = padGeometry(clientX, clientY);
    const midi = xToScaleMidi(x, rootPc, scaleId);
    const expr = applyExpression(y);
    if (midi !== v.midi) {
      v.synth.frequency.rampTo(midiToFreq(midi), 0.06);
      v.synth.volume.rampTo(Tone_db(0.45 + expr * 0.5), 0.05);
      v.midi = midi;
    }
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, x, y, label: midiToLabel(midi) } : p)),
    );
  }, [applyExpression, padGeometry, rootPc, scaleId]);

  const endVoice = useCallback((id: number) => {
    const v = voicesRef.current.get(id);
    if (v) {
      try {
        v.synth.triggerRelease();
        const syn = v.synth;
        setTimeout(() => { try { syn.dispose(); } catch { /* */ } }, 700);
      } catch { /* */ }
      voicesRef.current.delete(id);
    }
    setPoints((prev) => prev.filter((p) => p.id !== id));
  }, []);

  // Pointer handlers for the XY pad
  const onPadPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    void startVoice(e.pointerId, e.clientX, e.clientY);
  }, [startVoice]);

  const onPadPointerMove = useCallback((e: React.PointerEvent) => {
    if (!voicesRef.current.has(e.pointerId)) return;
    e.preventDefault();
    moveVoice(e.pointerId, e.clientX, e.clientY);
  }, [moveVoice]);

  const onPadPointerUp = useCallback((e: React.PointerEvent) => {
    endVoice(e.pointerId);
  }, [endVoice]);

  // Chord pad handlers
  const chordDown = useCallback(async (slot: ChordSlot) => {
    await ensureAudio();
    setActiveChordSlot(slot.slot);
    onChordDown(slot);
  }, [ensureAudio, onChordDown]);

  const chordUp = useCallback(() => {
    setActiveChordSlot(null);
    onChordUp();
  }, [onChordUp]);

  const ladderCount = buildScaleLadder(rootPc, scaleId, 48, 84).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Key + scale selectors */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-mute/60">Key</span>
        <div className="flex flex-wrap gap-1">
          {KEY_NAMES.map((k) => (
            <button
              key={k}
              onClick={() => onChangeKey(k)}
              className={`min-w-touch h-7 rounded-md px-2 text-[11px] tabular-nums transition-colors ${
                rootKey === k
                  ? "bg-accent/15 text-accent ring-1 ring-accent/40"
                  : "bg-surface-2 text-ink-mute hover:text-ink-text"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-mute/60">Scale</span>
        <select
          value={scaleId}
          onChange={(e) => onChangeScale(e.target.value as ScaleId)}
          className="h-8 rounded-md bg-surface-2 px-2 text-[12px] text-ink-text"
        >
          {SCALES.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <span className="text-[10px] text-ink-mute/50">{ladderCount} notes in range</span>
      </div>

      {/* XY pad */}
      <div
        ref={padRef}
        role="application"
        aria-label="Scale-locked expression pad. Touch and drag: left-right changes pitch, up-down changes brightness."
        onPointerDown={onPadPointerDown}
        onPointerMove={onPadPointerMove}
        onPointerUp={onPadPointerUp}
        onPointerCancel={onPadPointerUp}
        className="relative w-full touch-none select-none overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-surface-2 to-bg"
        style={{ height: compact ? 200 : 280, cursor: "crosshair" }}
      >
        {/* vertical scale guide lines */}
        <div className="pointer-events-none absolute inset-0 flex">
          {Array.from({ length: Math.min(ladderCount, 16) }).map((_, i) => (
            <div key={i} className="h-full flex-1 border-r border-line/40 last:border-r-0" />
          ))}
        </div>
        {/* expression hint */}
        <div className="pointer-events-none absolute left-3 top-2 text-[10px] uppercase tracking-wider text-ink-mute/40">
          bright
        </div>
        <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] uppercase tracking-wider text-ink-mute/40">
          mellow
        </div>
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-wider text-ink-mute/30">
          low ← pitch → high
        </div>
        {!audioReady && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-ink-mute/60">
            Touch the pad to play
          </div>
        )}
        {/* active touch points */}
        {points.map((p) => (
          <div
            key={p.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          >
            <div className="glow-accent flex h-14 w-14 items-center justify-center rounded-full bg-accent/25 ring-2 ring-accent/70">
              <span className="text-[11px] font-medium text-accent">{p.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Chord pads */}
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-ink-mute/60">Chord pads</div>
        <div className="grid grid-cols-4 gap-1.5">
          {chordSlots.map((slot) => {
            const active = activeChordSlot === slot.slot;
            return (
              <button
                key={slot.slot}
                onPointerDown={(e) => { e.preventDefault(); void chordDown(slot); }}
                onPointerUp={chordUp}
                onPointerLeave={(e) => { if (e.buttons > 0 && active) chordUp(); }}
                onPointerCancel={chordUp}
                className={`flex min-h-touch flex-col items-center justify-center rounded-xl border py-3 transition-all duration-75 touch-none select-none ${
                  active
                    ? "glow-accent-sm scale-[0.97] border-accent bg-accent/20 text-accent"
                    : "border-line bg-surface-2 text-ink-text hover:border-accent/40"
                }`}
              >
                <span className="text-[9px] text-ink-mute/50">{slot.slot}</span>
                <span className="text-base font-medium">{chordLabel(slot.root, slot.quality)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 0..1 amplitude → dB for Tone volume params
function Tone_db(amp: number): number {
  const a = Math.max(0.0001, Math.min(1, amp));
  return 20 * Math.log10(a);
}
