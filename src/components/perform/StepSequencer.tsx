"use client";

import { useEffect, useRef, useState } from "react";
import type { useDrumEngine } from "@/hooks/perform/useDrumEngine";
import { DRUM_KITS, DRUM_VOICES, DRUM_VOICE_LABELS, type DrumVoice } from "@/lib/audio/drumKits";
import { DRUM_PRESETS } from "@/hooks/perform/useDrumEngine";
import { Slider } from "@/components/ui/Slider";

type Seq = ReturnType<typeof useDrumEngine>;

// Click-and-drag paintable 4×16 step grid driven by the Tone.Transport sequencer.
export function StepSequencer({ seq }: { seq: Seq }) {
  const paintRef = useRef<boolean | null>(null); // value being painted while dragging
  const [saveName, setSaveName] = useState("");

  // End any drag when the pointer is released anywhere.
  useEffect(() => {
    const up = () => { paintRef.current = null; };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const onCellDown = (voice: DrumVoice, step: number) => {
    const next = !seq.grid[voice][step];
    paintRef.current = next;
    seq.setStep(voice, step, next);
  };
  const onCellEnter = (voice: DrumVoice, step: number, e: React.PointerEvent) => {
    if (paintRef.current === null || e.buttons === 0) return;
    seq.setStep(voice, step, paintRef.current);
  };

  return (
    <div className="space-y-4 select-none">
      {/* Kit */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-ink-mute/60">Kit</span>
          {seq.kitLoading && <span className="text-[9px] text-accent">loading…</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DRUM_KITS.map((k) => (
            <button key={k.id} onClick={() => seq.setKit(k.id)} title={k.blurb}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${seq.kitId === k.id ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
              {k.name}
            </button>
          ))}
        </div>
      </div>

      {/* Templates */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-ink-mute/60">Template</span>
          <button onClick={seq.clearPattern} className="text-[10px] text-ink-mute hover:text-danger">clear</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DRUM_PRESETS.map((p) => (
            <button key={p.name} onClick={() => seq.loadPreset(p.name)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${seq.presetName === p.name ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tempo + swing */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1 text-[9px] uppercase tracking-widest text-ink-mute/60">Tempo · {seq.currentBpm}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => seq.setBpm(seq.currentBpm - 1)} className="h-7 w-7 rounded-md bg-surface-2 text-ink-mute hover:text-ink-text" aria-label="Slower">−</button>
            <span className="min-w-[2rem] text-center font-mono text-sm tabular-nums text-ink-text">{seq.currentBpm}</span>
            <button onClick={() => seq.setBpm(seq.currentBpm + 1)} className="h-7 w-7 rounded-md bg-surface-2 text-ink-mute hover:text-ink-text" aria-label="Faster">+</button>
          </div>
        </div>
        <Slider label="Swing" value={seq.swing} max={0.7} onChange={seq.setSwing} valueLabel={`${Math.round((seq.swing / 0.7) * 100)}%`} />
      </div>

      {/* The grid */}
      <div className="overflow-x-auto">
        <div className="min-w-[260px] space-y-1">
          {DRUM_VOICES.map((voice) => {
            const muted = seq.mutes[voice];
            const soloed = seq.solos[voice];
            return (
              <div key={voice} className="flex items-center gap-1.5">
                {/* row label + M/S */}
                <div className="flex w-[58px] shrink-0 items-center gap-1">
                  <span className="w-9 text-[10px] text-ink-mute">{DRUM_VOICE_LABELS[voice]}</span>
                  <button onClick={() => seq.toggleMute(voice)} aria-pressed={muted} aria-label={`Mute ${voice}`}
                    className={`h-5 w-5 rounded text-[9px] font-bold ${muted ? "bg-danger/20 text-danger" : "bg-surface-2 text-ink-mute/60 hover:text-ink-text"}`}>M</button>
                  <button onClick={() => seq.toggleSolo(voice)} aria-pressed={soloed} aria-label={`Solo ${voice}`}
                    className={`h-5 w-5 rounded text-[9px] font-bold ${soloed ? "bg-accent/25 text-accent" : "bg-surface-2 text-ink-mute/60 hover:text-ink-text"}`}>S</button>
                </div>
                {/* 16 cells, grouped in 4 */}
                <div className="flex flex-1 gap-[2px]">
                  {Array.from({ length: 16 }, (_, step) => {
                    const on = seq.grid[voice][step];
                    const isPlayhead = seq.currentStep === step;
                    const beatStart = step % 4 === 0;
                    return (
                      <button
                        key={step}
                        onPointerDown={(e) => { e.preventDefault(); onCellDown(voice, step); }}
                        onPointerEnter={(e) => onCellEnter(voice, step, e)}
                        aria-label={`${voice} step ${step + 1} ${on ? "on" : "off"}`}
                        className={`h-8 flex-1 rounded-[3px] border transition-colors duration-75 touch-none ${
                          beatStart ? "ml-[2px] first:ml-0" : ""
                        } ${
                          on
                            ? "border-accent/60 bg-accent shadow-[inset_0_-2px_4px_rgba(0,0,0,0.25)]"
                            : `border-line/60 ${beatStart ? "bg-surface-2" : "bg-surface-2/50"} hover:border-accent/40`
                        } ${isPlayhead ? "ring-2 ring-accent/80" : ""}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* step ruler */}
          <div className="flex items-center gap-1.5 pt-0.5">
            <div className="w-[58px] shrink-0" />
            <div className="flex flex-1 gap-[2px]">
              {Array.from({ length: 16 }, (_, step) => (
                <div key={step} className={`h-1 flex-1 rounded-full ${step % 4 === 0 ? (step === 0 ? "ml-0" : "ml-[2px]") : ""} ${seq.currentStep === step ? "bg-accent" : "bg-line/40"}`} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Per-voice levels */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {DRUM_VOICES.map((voice) => (
          <Slider key={voice} label={DRUM_VOICE_LABELS[voice]} value={seq.levels[voice]} onChange={(v) => seq.setLevel(voice, v)} valueLabel={`${Math.round(seq.levels[voice] * 100)}%`} />
        ))}
      </div>

      {/* Save / load */}
      <div>
        <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/60">My patterns</div>
        <div className="flex gap-1.5">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="name this pattern…"
            className="min-w-0 flex-1 rounded-md border border-line bg-bg/40 px-2 py-1 text-[12px] text-ink-text outline-none placeholder:text-ink-mute/40"
          />
          <button onClick={() => { seq.savePattern(saveName.trim()); setSaveName(""); }} className="btn-primary text-[11px]">Save</button>
        </div>
        {seq.savedPatterns.length > 0 && (
          <ul className="mt-2 space-y-1">
            {seq.savedPatterns.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-md bg-surface-2/60 px-2 py-1">
                <button onClick={() => seq.loadSavedPattern(p.id)} className="flex-1 truncate text-left text-[12px] text-ink-text hover:text-accent">{p.name}</button>
                <span className="font-mono text-[9px] text-ink-mute/50">{p.bpm}bpm</span>
                <button onClick={() => seq.deleteSavedPattern(p.id)} aria-label={`Delete ${p.name}`} className="text-ink-mute/40 hover:text-danger">✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
