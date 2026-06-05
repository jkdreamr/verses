"use client";

import { Slider } from "@/components/ui/Slider";
import { KEY_NAMES, SCALES, type ScaleId } from "@/lib/audio/scales";
import { useVocalFx, VOCAL_FX_PRESETS } from "@/hooks/perform/useVocalFx";

type Vfx = ReturnType<typeof useVocalFx>;

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2f7] focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

const HARMONY_INTERVALS = [
  { v: -12, label: "Oct ↓" }, { v: -5, label: "4th ↓" }, { v: 3, label: "min 3rd" },
  { v: 4, label: "maj 3rd" }, { v: 5, label: "4th" }, { v: 7, label: "5th" }, { v: 12, label: "Oct ↑" },
];

function Led({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full transition-colors ${on ? "bg-success shadow-[0_0_6px_rgba(74,222,128,0.8)]" : "bg-ink-mute/30"}`}
    />
  );
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${FOCUS} ${on ? "bg-accent/70" : "bg-surface-2"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink-text transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function EffectCard({ name, on, onToggle, children }: { name: string; on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 transition-colors ${on ? "border-accent/30 bg-surface-2/50" : "border-line/50 bg-surface-2/25"}`}>
      <div className="mb-2 flex items-center gap-2">
        <Led on={on} />
        <span className="text-[12px] font-medium text-ink-text">{name}</span>
        <div className="ml-auto"><Switch on={on} onClick={onToggle} label={`${name} on/off`} /></div>
      </div>
      <div className={`space-y-2.5 transition-opacity ${on ? "opacity-100" : "pointer-events-none opacity-40"}`}>{children}</div>
    </div>
  );
}

export function VocalFxRack({
  vfx, recordMode, setRecordMode, songKey, songScale, keyLock, setKeyLock, isCameraMode,
  onCalibrate, calibrating, calibrated,
}: {
  vfx: Vfx;
  recordMode: "processed" | "raw";
  setRecordMode: (m: "processed" | "raw") => void;
  songKey: string;
  songScale: ScaleId;
  keyLock: boolean;
  setKeyLock: (b: boolean) => void;
  isCameraMode: boolean;
  onCalibrate: () => void;
  calibrating: boolean;
  calibrated: boolean;
}) {
  const p = vfx.params;
  const retuneSpeed = (140 - p.retuneMs) / 137; // 0 natural … 1 hard
  const seg = (active: boolean) =>
    `px-3 py-1 text-[11px] font-medium transition-colors ${FOCUS} ${active ? "bg-accent/20 text-accent" : "text-ink-mute hover:text-ink-text"}`;

  return (
    <div className="space-y-3">
      {/* record mode + latency */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] uppercase tracking-widest text-ink-mute/60">Record</span>
        <div role="group" aria-label="Record source" className="flex overflow-hidden rounded-lg border border-line/60">
          <button type="button" onClick={() => setRecordMode("processed")} aria-pressed={recordMode === "processed"} className={seg(recordMode === "processed")}>Processed</button>
          <button type="button" onClick={() => setRecordMode("raw")} aria-pressed={recordMode === "raw"} className={seg(recordMode === "raw")}>Raw voice</button>
        </div>
        <button
          type="button" onClick={onCalibrate} disabled={calibrating}
          title="Sample ~1.5s of room noise so silence/breath never trigger the effects"
          className={`ml-auto rounded-md px-2 py-1 text-[10px] transition-colors ${FOCUS} ${calibrated ? "bg-success/15 text-success" : "bg-surface-2 text-ink-mute hover:text-ink-text"} disabled:opacity-50`}
        >
          {calibrating ? "calibrating…" : calibrated ? "✓ calibrated" : "Calibrate mic"}
        </button>
        <span className="font-mono text-[10px] text-ink-mute" title="Approximate added latency of the pitch stage. Lower the window to tighten it.">
          ~{vfx.latencyMs} ms
        </span>
      </div>

      {recordMode === "raw" && (
        <p className="rounded-lg bg-surface-2/50 px-2.5 py-1.5 text-[10px] text-ink-mute">
          Raw mode bypasses the FX and captures a clean vocal you can process later.
        </p>
      )}
      {vfx.loading && <p className="text-[11px] text-accent">loading vocal FX…</p>}
      {vfx.error && <p className="text-[11px] text-danger">{vfx.error}</p>}

      {/* presets */}
      <div>
        <div className="mb-1.5 text-[9px] uppercase tracking-widest text-ink-mute/60">Presets</div>
        <div className="flex flex-wrap gap-1.5">
          {VOCAL_FX_PRESETS.map((pr) => (
            <button key={pr.name} type="button" title={pr.blurb} onClick={() => vfx.applyPreset(pr.name)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${FOCUS} ${vfx.presetName === pr.name ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
              {pr.name}
            </button>
          ))}
        </div>
      </div>

      <fieldset className={recordMode === "raw" ? "pointer-events-none space-y-3 opacity-40" : "space-y-3"} disabled={recordMode === "raw"}>
        {/* Autotune */}
        <EffectCard name="Autotune" on={p.autotuneOn} onToggle={() => vfx.update({ autotuneOn: !p.autotuneOn })}>
          <Slider label="Amount" value={p.autotuneAmount} valueLabel={`${Math.round(p.autotuneAmount * 100)}%`} onChange={(v) => vfx.update({ autotuneAmount: v })} />
          <Slider label="Retune speed" value={retuneSpeed} valueLabel={retuneSpeed > 0.66 ? "Hard" : retuneSpeed > 0.33 ? "Med" : "Natural"} onChange={(v) => vfx.update({ retuneMs: Math.round(140 - v * 137) })} />
          <div className="flex items-center gap-2">
            <select aria-label="Autotune key" value={p.key} onChange={(e) => vfx.update({ key: e.target.value })} className={`flex-1 rounded-md bg-bg/60 px-2 py-1.5 font-mono text-[11px] text-ink-text ${FOCUS}`}>
              {KEY_NAMES.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <select aria-label="Autotune scale" value={p.scale} onChange={(e) => vfx.update({ scale: e.target.value as ScaleId })} className={`flex-1 rounded-md bg-bg/60 px-2 py-1.5 text-[11px] text-ink-text ${FOCUS}`}>
              {SCALES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="button" onClick={() => vfx.update({ key: songKey, scale: songScale })} title="Match the song's key & scale"
              className={`rounded-md bg-surface-2 px-2 py-1.5 text-[10px] text-ink-mute hover:text-ink-text ${FOCUS}`}>Song key</button>
          </div>
          <button type="button" onClick={vfx.detectKey} disabled={vfx.detectingKey}
            title="Sing for ~4 seconds and Verses will set the key you're in"
            className={`w-full rounded-md px-2 py-1.5 text-[11px] transition-colors ${FOCUS} ${vfx.detectingKey ? "bg-accent/15 text-accent" : "bg-surface-2 text-ink-mute hover:text-ink-text"} disabled:opacity-60`}>
            {vfx.detectingKey ? "listening… sing now" : "🎯 Detect my key"}
          </button>
        </EffectCard>

        {/* Harmony */}
        <EffectCard name="Harmony" on={p.harmonyOn} onToggle={() => vfx.update({ harmonyOn: !p.harmonyOn })}>
          <div className="flex flex-wrap gap-1">
            {HARMONY_INTERVALS.map((it) => (
              <button key={it.v} type="button" onClick={() => vfx.update({ harmonyInterval: it.v })}
                className={`rounded-md px-2 py-1 text-[10px] ${FOCUS} ${p.harmonyInterval === it.v ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}>
                {it.label}
              </button>
            ))}
          </div>
          <Slider label="Mix" value={p.harmonyMix} valueLabel={`${Math.round(p.harmonyMix * 100)}%`} onChange={(v) => vfx.update({ harmonyMix: v })} />
        </EffectCard>

        {/* Delay */}
        <EffectCard name="Echo / Delay" on={p.delayOn} onToggle={() => vfx.update({ delayOn: !p.delayOn })}>
          <Slider label="Time" min={0.05} max={0.8} step={0.01} value={p.delayTime} valueLabel={`${Math.round(p.delayTime * 1000)} ms`} onChange={(v) => vfx.update({ delayTime: v })} />
          <Slider label="Feedback" max={0.9} value={p.delayFeedback} valueLabel={`${Math.round(p.delayFeedback * 100)}%`} onChange={(v) => vfx.update({ delayFeedback: v })} />
          <Slider label="Mix" value={p.delayMix} valueLabel={`${Math.round(p.delayMix * 100)}%`} onChange={(v) => vfx.update({ delayMix: v })} />
        </EffectCard>

        {/* Reverb */}
        <EffectCard name="Reverb" on={p.reverbOn} onToggle={() => vfx.update({ reverbOn: !p.reverbOn })}>
          <Slider label="Size" min={0.3} max={8} step={0.1} value={p.reverbDecay} valueLabel={`${p.reverbDecay.toFixed(1)} s`} onChange={(v) => vfx.update({ reverbDecay: v })} />
          <Slider label="Mix" value={p.reverbMix} valueLabel={`${Math.round(p.reverbMix * 100)}%`} onChange={(v) => vfx.update({ reverbMix: v })} />
        </EffectCard>

        {/* Output + latency */}
        <div className="space-y-2.5 rounded-xl border border-line/50 bg-surface-2/25 p-3">
          <Slider label="Output" value={p.outputGain} valueLabel={`${Math.round(p.outputGain * 100)}%`} onChange={(v) => vfx.update({ outputGain: v })} />
          <Slider label="Tighten latency" min={0.03} max={0.1} step={0.005} value={p.windowSize}
            valueLabel={`~${Math.round(p.windowSize * 1000)} ms`} onChange={(v) => vfx.update({ windowSize: v })} />
          <p className="text-[10px] leading-snug text-ink-mute/70">Smaller window = lower latency, more artefacts. Granular shifter — large shifts colour the voice.</p>
        </div>
      </fieldset>

      {/* Mode B hand pitch */}
      {isCameraMode && (
        <label className="flex items-center justify-between rounded-xl border border-line/50 bg-surface-2/30 p-3 text-[11px] text-ink-text">
          <span className="pr-2">
            Hand pitch · <span className="text-ink-mute">raise/lower your hand to bend the note</span>
            <span className="mt-0.5 block text-[10px] text-ink-mute/70">{keyLock ? "Locked to scale (clean intervals)" : "Continuous glide"}</span>
          </span>
          <Switch on={keyLock} onClick={() => setKeyLock(!keyLock)} label="Key-lock hand pitch" />
        </label>
      )}
    </div>
  );
}
