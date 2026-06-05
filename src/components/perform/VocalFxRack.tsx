"use client";

import { useState, useCallback, useEffect } from "react";
import { Slider } from "@/components/ui/Slider";
import { KEY_NAMES, SCALES, type ScaleId } from "@/lib/audio/scales";
import { useVocalFx, VOCAL_FX_PRESETS } from "@/hooks/perform/useVocalFx";
import type { YoutubeSession } from "@/lib/types";

type Vfx = ReturnType<typeof useVocalFx>;
type StartSource = "marker" | "loopStart" | "currentTime" | "manual" | "zero";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7aa2f7] focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

const HARMONY_INTERVALS = [
  { v: -12, label: "Oct \u2193" }, { v: -5, label: "4th \u2193" }, { v: 3, label: "min 3rd" },
  { v: 4, label: "maj 3rd" }, { v: 5, label: "4th" }, { v: 7, label: "5th" }, { v: 12, label: "Oct \u2191" },
];

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function Led({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 rounded-full transition-colors ${
        on ? "bg-success shadow-[0_0_6px_rgba(74,222,128,0.8)]" : "bg-ink-mute/30"
      }`}
    />
  );
}

function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${FOCUS} ${
        on ? "bg-accent/70" : "bg-surface-2"
      }`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink-text transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function MeterBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-10 flex-shrink-0 text-[9px] text-ink-mute">{label}</span>}
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-all duration-75"
          style={{ width: `${Math.round(clamp01(value) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function EffectCard({
  name, on, onToggle, children, meter,
}: {
  name: string; on: boolean; onToggle: () => void; children: React.ReactNode; meter?: number;
}) {
  return (
    <div className={`rounded-xl border p-3 transition-colors ${
      on ? "border-accent/30 bg-surface-2/50" : "border-line/50 bg-surface-2/25"
    }`}>
      <div className="mb-2 flex items-center gap-2">
        <Led on={on} />
        <span className="text-[12px] font-medium text-ink-text">{name}</span>
        {meter !== undefined && on && (
          <div className="ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent/60 transition-all duration-75"
              style={{ width: `${Math.round(clamp01(meter) * 100)}%` }}
            />
          </div>
        )}
        <div className="ml-auto">
          <Switch on={on} onClick={onToggle} label={`${name} on/off`} />
        </div>
      </div>
      <div className={`space-y-2.5 transition-opacity ${on ? "opacity-100" : "pointer-events-none opacity-40"}`}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Headphones Required Panel — gates live monitoring + recording in Vocal FX mode.
// Confirmation is per-session only (reset on modal close via parent).
// ─────────────────────────────────────────────────────────────────────────────
function HeadphonesGate({
  confirmed, onConfirm,
}: {
  confirmed: boolean; onConfirm: () => void;
}) {
  if (confirmed) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-[11px] text-success">
        <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span>Headphones confirmed &mdash; live monitoring active.</span>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
      <div className="flex items-start gap-3">
        <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div className="flex-1">
          <p className="text-[12px] font-semibold text-ink-text">Headphones required</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-ink-mute">
            Vocal FX monitors your mic live. Wear headphones to prevent feedback. Recording and live monitoring are blocked until confirmed.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded"
              onChange={(e) => { if (e.target.checked) onConfirm(); }}
            />
            <span className="text-[11px] text-ink-text">I am wearing headphones</span>
          </label>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// YouTube Beat Strip — shows in Vocal FX rack, lets user pick recording start.
// Beat audio is NOT recorded into the vocal blob. Instead, linked_beat metadata
// is saved with the take so TakesPanel can recreate vocal+beat playback.
// ─────────────────────────────────────────────────────────────────────────────
function BeatStrip({
  session,
  startTime,
  startSource,
  onSetStart,
}: {
  session: YoutubeSession | null;
  startTime: number;
  startSource: StartSource;
  onSetStart: (t: number, src: StartSource) => void;
}) {
  const [liveTime, setLiveTime] = useState(0);

  // Poll current beat time via custom event to the YoutubeBar player
  const refreshTime = useCallback(() => {
    const ev = new CustomEvent("verses:beat-get-time", { detail: { onTime: (t: number) => setLiveTime(t) } });
    window.dispatchEvent(ev);
  }, []);

  useEffect(() => {
    const id = window.setInterval(refreshTime, 500);
    return () => window.clearInterval(id);
  }, [refreshTime]);

  if (!session) {
    return (
      <div className="rounded-lg border border-line/40 bg-surface-2/25 px-3 py-2.5">
        <p className="text-[11px] text-ink-mute">
          No beat loaded &mdash; add a YouTube beat below to record vocals over it.
        </p>
      </div>
    );
  }

  const markers = [...(session.markers ?? [])].sort((a, b) => a.time - b.time);
  const hasLoop = session.loop_start != null && session.loop_end != null;

  return (
    <div className="rounded-lg border border-accent/25 bg-surface-2/40 p-3">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-red-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0C.488 3.45.029 5.804 0 12c.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0C23.512 20.55 23.971 18.196 24 12c-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
        </svg>
        <span className="flex-1 truncate text-[11px] font-medium text-ink-text" title={session.youtube_title ?? session.youtube_url}>
          {session.youtube_title ?? "YouTube Beat"}
        </span>
        <span className="font-mono text-[10px] text-ink-mute/60">{fmt(liveTime)}</span>
      </div>

      {/* Vocal starts at indicator */}
      <div className="mb-2 flex items-center gap-2 rounded bg-accent/10 px-2 py-1.5">
        <span className="text-[9px] uppercase tracking-wider text-ink-mute/60">Vocal starts at</span>
        <span className="font-mono text-[13px] font-semibold text-accent">{fmt(startTime)}</span>
        <span className="text-[9px] text-ink-mute/60">of beat</span>
      </div>

      {/* Start point buttons */}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onSetStart(0, "zero")}
          className={`rounded px-2 py-1 text-[10px] transition-colors ${FOCUS} ${
            startSource === "zero" ? "bg-accent text-white" : "bg-surface-2 text-ink-mute hover:text-ink-text"
          }`}
        >
          0:00
        </button>
        <button
          type="button"
          onClick={() => onSetStart(liveTime, "currentTime")}
          className={`rounded px-2 py-1 text-[10px] transition-colors ${FOCUS} ${
            startSource === "currentTime" ? "bg-accent text-white" : "bg-surface-2 text-ink-mute hover:text-ink-text"
          }`}
        >
          Current ({fmt(liveTime)})
        </button>
        {hasLoop && session.loop_start != null && (
          <button
            type="button"
            onClick={() => onSetStart(session.loop_start!, "loopStart")}
            className={`rounded px-2 py-1 text-[10px] transition-colors ${FOCUS} ${
              startSource === "loopStart" ? "bg-accent text-white" : "bg-surface-2 text-ink-mute hover:text-ink-text"
            }`}
          >
            Loop A ({fmt(session.loop_start)})
          </button>
        )}
        {markers.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onSetStart(m.time, "marker")}
            title={`Marker: ${m.label} at ${fmt(m.time)}`}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors ${FOCUS} ${
              startSource === "marker" && startTime === m.time
                ? "bg-accent text-white"
                : "bg-surface-2 text-ink-mute hover:text-ink-text"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
            {m.label || fmt(m.time)}
          </button>
        ))}
      </div>

      {hasLoop && (
        <p className="mt-1.5 text-[9px] text-ink-mute/50">
          Loop: {fmt(session.loop_start ?? 0)} &rarr; {fmt(session.loop_end ?? 0)}
        </p>
      )}
      <p className="mt-1.5 text-[9px] text-ink-mute/50">
        YouTube beat plays as reference. Vocal blob only is recorded; beat is linked in the take.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main VocalFxRack
// ─────────────────────────────────────────────────────────────────────────────
export function VocalFxRack({
  vfx,
  recordMode,
  setRecordMode,
  songKey,
  songScale,
  keyLock,
  setKeyLock,
  isCameraMode,
  onCalibrate,
  calibrating,
  calibrated,
  headphonesConfirmed,
  onConfirmHeadphones,
  youtubeSession,
  beatStartTime,
  beatStartSource,
  onSetBeatStart,
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
  headphonesConfirmed: boolean;
  onConfirmHeadphones: () => void;
  youtubeSession: YoutubeSession | null;
  beatStartTime: number;
  beatStartSource: StartSource;
  onSetBeatStart: (t: number, src: StartSource) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const p = vfx.params;
  const retuneSpeed = (140 - p.retuneMs) / 137;

  const seg = (active: boolean) =>
    `px-3 py-1 text-[11px] font-medium transition-colors ${FOCUS} ${
      active ? "bg-accent/20 text-accent" : "text-ink-mute hover:text-ink-text"
    }`;

  return (
    <div className="space-y-3">
      {/* 1. Headphones gate */}
      <HeadphonesGate confirmed={headphonesConfirmed} onConfirm={onConfirmHeadphones} />

      {/* 2. YouTube Beat strip */}
      <BeatStrip
        session={youtubeSession}
        startTime={beatStartTime}
        startSource={beatStartSource}
        onSetStart={onSetBeatStart}
      />

      {/* 3. Record mode + latency */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] uppercase tracking-widest text-ink-mute/60">Record</span>
        <div role="group" aria-label="Record source" className="flex overflow-hidden rounded-lg border border-line/60">
          <button type="button" onClick={() => setRecordMode("processed")} aria-pressed={recordMode === "processed"} className={seg(recordMode === "processed")}>Processed</button>
          <button type="button" onClick={() => setRecordMode("raw")} aria-pressed={recordMode === "raw"} className={seg(recordMode === "raw")}>Raw voice</button>
        </div>
        <span className="text-[10px] text-ink-mute/60">
          {recordMode === "processed" ? "Records the FX chain" : "Records clean mic"}
        </span>
        <button
          type="button" onClick={onCalibrate} disabled={calibrating}
          className={`ml-auto rounded-md px-2 py-1 text-[10px] transition-colors ${FOCUS} ${
            calibrated ? "bg-success/15 text-success" : "bg-surface-2 text-ink-mute hover:text-ink-text"
          } disabled:opacity-50`}
        >
          {calibrating ? "calibrating\u2026" : calibrated ? "\u2713 calibrated" : "Calibrate mic"}
        </button>
        <span className="font-mono text-[10px] text-ink-mute" title="Approx pitch-stage latency">
          ~{vfx.latencyMs}\u202fms
        </span>
      </div>

      {recordMode === "raw" && (
        <p className="rounded-lg bg-surface-2/50 px-2.5 py-1.5 text-[10px] text-ink-mute">
          Raw records your clean mic. YouTube beat is still linked in the take.
        </p>
      )}

      {/* 4. Input / output meters */}
      <div className="space-y-1.5 rounded-lg border border-line/40 bg-surface-2/20 p-2">
        <MeterBar value={vfx.inputLevel} label="In" />
        <MeterBar value={vfx.outputLevel} label="Out" />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-accent">{vfx.detectedNote ?? "\u2014"}</span>
          <span className="font-mono text-[9px] text-ink-mute/60">{Math.round(vfx.confidence * 100)}% conf</span>
        </div>
      </div>

      {vfx.loading && <p className="text-[11px] text-accent">loading vocal FX\u2026</p>}
      {vfx.error && <p className="text-[11px] text-danger">{vfx.error}</p>}

      {/* 5. Presets */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-widest text-ink-mute/60">Presets</span>
          <button
            type="button"
            onClick={() => setAdvanced((v) => !v)}
            className={`text-[10px] text-ink-mute hover:text-ink-text ${FOCUS}`}
          >
            {advanced ? "Simple \u25b2" : "Advanced \u25bc"}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {VOCAL_FX_PRESETS.map((pr) => (
            <button
              key={pr.name} type="button" title={pr.blurb}
              onClick={() => vfx.applyPreset(pr.name)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${FOCUS} ${
                vfx.presetName === pr.name
                  ? "bg-accent/15 text-accent ring-1 ring-accent/40"
                  : "bg-surface-2 text-ink-mute hover:text-ink-text"
              }`}
            >
              {pr.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Simple macro view ─────────────────────────────────────────────── */}
      {!advanced && (
        <fieldset className={recordMode === "raw" ? "pointer-events-none space-y-3 opacity-40" : "space-y-3"} disabled={recordMode === "raw"}>
          {/* Tune */}
          <div className="rounded-xl border border-line/50 bg-surface-2/25 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-text">Tune</span>
              <Switch on={p.autotuneOn} onClick={() => vfx.update({ autotuneOn: !p.autotuneOn })} label="Autotune on/off" />
            </div>
            {p.autotuneOn && (
              <>
                <Slider label="Amount" value={p.autotuneAmount} valueLabel={`${Math.round(p.autotuneAmount * 100)}%`} onChange={(v) => vfx.update({ autotuneAmount: v })} />
                <Slider label="Speed" value={retuneSpeed} valueLabel={retuneSpeed > 0.66 ? "Hard" : retuneSpeed > 0.33 ? "Med" : "Natural"} onChange={(v) => vfx.update({ retuneMs: Math.round(140 - v * 137) })} />
                <div className="mt-2 flex items-center gap-2">
                  <select aria-label="Key" value={p.key} onChange={(e) => vfx.update({ key: e.target.value })} className={`flex-1 rounded-md bg-bg/60 px-2 py-1.5 font-mono text-[11px] text-ink-text ${FOCUS}`}>
                    {KEY_NAMES.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <select aria-label="Scale" value={p.scale} onChange={(e) => vfx.update({ scale: e.target.value as ScaleId })} className={`flex-1 rounded-md bg-bg/60 px-2 py-1.5 text-[11px] text-ink-text ${FOCUS}`}>
                    {SCALES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" onClick={() => vfx.update({ key: songKey, scale: songScale })} className={`rounded-md bg-surface-2 px-2 py-1.5 text-[10px] text-ink-mute hover:text-ink-text ${FOCUS}`}>Song key</button>
                </div>
              </>
            )}
          </div>

          {/* Space macro */}
          <div className="rounded-xl border border-line/50 bg-surface-2/25 p-3">
            <Slider
              label="Space"
              value={(p.reverbMix + p.delayMix) / 1.2}
              valueLabel={p.reverbMix + p.delayMix > 0.6 ? "Big" : p.reverbMix + p.delayMix > 0.25 ? "Medium" : "Dry"}
              onChange={(v) => vfx.update({ reverbMix: v * 0.45, delayMix: v * 0.28, reverbOn: v > 0.05, delayOn: v > 0.15 })}
            />
          </div>

          {/* Width macro */}
          <div className="rounded-xl border border-line/50 bg-surface-2/25 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium text-ink-text">Width (doubler)</span>
              <Switch on={p.doublerOn} onClick={() => vfx.update({ doublerOn: !p.doublerOn })} label="Doubler on/off" />
            </div>
            {p.doublerOn && (
              <Slider label="Amount" value={p.doublerAmount} valueLabel={`${Math.round(p.doublerAmount * 100)}%`} onChange={(v) => vfx.update({ doublerAmount: v })} />
            )}
          </div>

          {/* Key detect */}
          <button type="button" onClick={vfx.detectKey} disabled={vfx.detectingKey}
            className={`w-full rounded-md px-2 py-1.5 text-[11px] transition-colors ${FOCUS} ${
              vfx.detectingKey ? "bg-accent/15 text-accent" : "bg-surface-2 text-ink-mute hover:text-ink-text"
            } disabled:opacity-60`}
          >
            {vfx.detectingKey ? "listening\u2026 sing now" : "Detect my key (4s)"}
          </button>

          {/* Latency toggle */}
          <div className="space-y-1 rounded-xl border border-line/50 bg-surface-2/25 p-3">
            <Slider label="Tighten latency" min={0.03} max={0.1} step={0.005} value={p.windowSize}
              valueLabel={`~${Math.round(p.windowSize * 1000)}\u202fms`}
              onChange={(v) => vfx.update({ windowSize: v })} />
            <p className="text-[9px] text-ink-mute/60">Smaller window = lower latency, more artefacts.</p>
          </div>
        </fieldset>
      )}

      {/* ── Advanced full rack ─────────────────────────────────────────────── */}
      {advanced && (
        <fieldset className={recordMode === "raw" ? "pointer-events-none space-y-3 opacity-40" : "space-y-3"} disabled={recordMode === "raw"}>

          {/* Gate */}
          <EffectCard name="Noise Gate" on={p.gateOn} onToggle={() => vfx.update({ gateOn: !p.gateOn })} meter={vfx.gateActivity}>
            <Slider label="Threshold" min={-60} max={-20} step={1} value={p.gateThresholdDb} valueLabel={`${p.gateThresholdDb}\u202fdB`} onChange={(v) => vfx.update({ gateThresholdDb: v })} />
            <Slider label="Depth" value={p.gateDepth} valueLabel={`${Math.round(p.gateDepth * 100)}%`} onChange={(v) => vfx.update({ gateDepth: v })} />
            <Slider label="High-pass" min={60} max={180} step={5} value={p.highPassHz} valueLabel={`${p.highPassHz}\u202fHz`} onChange={(v) => vfx.update({ highPassHz: v })} />
          </EffectCard>

          {/* EQ */}
          <EffectCard name="EQ" on={p.eqOn} onToggle={() => vfx.update({ eqOn: !p.eqOn })}>
            <Slider label="Body" min={-6} max={6} step={0.5} value={p.eqBodyDb} valueLabel={`${p.eqBodyDb > 0 ? "+" : ""}${p.eqBodyDb}\u202fdB`} onChange={(v) => vfx.update({ eqBodyDb: v })} />
            <Slider label="Presence" min={-6} max={6} step={0.5} value={p.eqPresenceDb} valueLabel={`${p.eqPresenceDb > 0 ? "+" : ""}${p.eqPresenceDb}\u202fdB`} onChange={(v) => vfx.update({ eqPresenceDb: v })} />
            <Slider label="Air" min={-6} max={6} step={0.5} value={p.eqAirDb} valueLabel={`${p.eqAirDb > 0 ? "+" : ""}${p.eqAirDb}\u202fdB`} onChange={(v) => vfx.update({ eqAirDb: v })} />
          </EffectCard>

          {/* Autotune */}
          <EffectCard name="Autotune / Pitch" on={p.autotuneOn} onToggle={() => vfx.update({ autotuneOn: !p.autotuneOn })}>
            <Slider label="Amount" value={p.autotuneAmount} valueLabel={`${Math.round(p.autotuneAmount * 100)}%`} onChange={(v) => vfx.update({ autotuneAmount: v })} />
            <Slider label="Retune speed" value={retuneSpeed} valueLabel={retuneSpeed > 0.66 ? "Hard" : retuneSpeed > 0.33 ? "Med" : "Natural"} onChange={(v) => vfx.update({ retuneMs: Math.round(140 - v * 137) })} />
            <div className="flex items-center gap-2">
              <select aria-label="Key" value={p.key} onChange={(e) => vfx.update({ key: e.target.value })} className={`flex-1 rounded-md bg-bg/60 px-2 py-1.5 font-mono text-[11px] text-ink-text ${FOCUS}`}>
                {KEY_NAMES.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <select aria-label="Scale" value={p.scale} onChange={(e) => vfx.update({ scale: e.target.value as ScaleId })} className={`flex-1 rounded-md bg-bg/60 px-2 py-1.5 text-[11px] text-ink-text ${FOCUS}`}>
                {SCALES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" onClick={() => vfx.update({ key: songKey, scale: songScale })} className={`rounded-md bg-surface-2 px-2 py-1.5 text-[10px] text-ink-mute hover:text-ink-text ${FOCUS}`}>Song key</button>
            </div>
            <button type="button" onClick={vfx.detectKey} disabled={vfx.detectingKey}
              className={`w-full rounded-md px-2 py-1.5 text-[11px] transition-colors ${FOCUS} ${vfx.detectingKey ? "bg-accent/15 text-accent" : "bg-surface-2 text-ink-mute hover:text-ink-text"} disabled:opacity-60`}
            >
              {vfx.detectingKey ? "listening\u2026 sing now" : "Detect my key (4s)"}
            </button>
          </EffectCard>

          {/* De-esser */}
          <EffectCard name="De-esser" on={p.deEsserOn} onToggle={() => vfx.update({ deEsserOn: !p.deEsserOn })} meter={vfx.deEsserActivity}>
            <Slider label="Amount" value={p.deEsserAmount} valueLabel={`${Math.round(p.deEsserAmount * 100)}%`} onChange={(v) => vfx.update({ deEsserAmount: v })} />
            <Slider label="Freq" min={5} max={12} step={0.5} value={p.deEsserFreq} valueLabel={`${p.deEsserFreq}\u202fkHz`} onChange={(v) => vfx.update({ deEsserFreq: v })} />
          </EffectCard>

          {/* Compressor */}
          <EffectCard name="Compressor" on={p.compressorOn} onToggle={() => vfx.update({ compressorOn: !p.compressorOn })} meter={vfx.compressorReduction}>
            <Slider label="Threshold" min={-40} max={-10} step={1} value={p.compressorThresholdDb} valueLabel={`${p.compressorThresholdDb}\u202fdB`} onChange={(v) => vfx.update({ compressorThresholdDb: v })} />
            <Slider label="Ratio" min={1} max={20} step={0.5} value={p.compressorRatio} valueLabel={`${p.compressorRatio}:1`} onChange={(v) => vfx.update({ compressorRatio: v })} />
            <Slider label="Makeup" min={0} max={12} step={0.5} value={p.compressorMakeupDb} valueLabel={`+${p.compressorMakeupDb}\u202fdB`} onChange={(v) => vfx.update({ compressorMakeupDb: v })} />
            <Slider label="Mix" value={p.compressorMix} valueLabel={`${Math.round(p.compressorMix * 100)}%`} onChange={(v) => vfx.update({ compressorMix: v })} />
          </EffectCard>

          {/* Saturation */}
          <EffectCard name="Saturation" on={p.saturationOn} onToggle={() => vfx.update({ saturationOn: !p.saturationOn })}>
            <Slider label="Drive" value={p.saturationDrive} valueLabel={`${Math.round(p.saturationDrive * 100)}%`} onChange={(v) => vfx.update({ saturationDrive: v })} />
            <Slider label="Mix" value={p.saturationMix} valueLabel={`${Math.round(p.saturationMix * 100)}%`} onChange={(v) => vfx.update({ saturationMix: v })} />
          </EffectCard>

          {/* Doubler */}
          <EffectCard name="Doubler" on={p.doublerOn} onToggle={() => vfx.update({ doublerOn: !p.doublerOn })}>
            <Slider label="Amount" value={p.doublerAmount} valueLabel={`${Math.round(p.doublerAmount * 100)}%`} onChange={(v) => vfx.update({ doublerAmount: v })} />
            <Slider label="Width" value={p.doublerWidth} valueLabel={`${Math.round(p.doublerWidth * 100)}%`} onChange={(v) => vfx.update({ doublerWidth: v })} />
          </EffectCard>

          {/* Harmony */}
          <EffectCard name="Harmony" on={p.harmonyOn} onToggle={() => vfx.update({ harmonyOn: !p.harmonyOn })}>
            <div className="flex flex-wrap gap-1">
              {HARMONY_INTERVALS.map((it) => (
                <button key={it.v} type="button" onClick={() => vfx.update({ harmonyInterval: it.v })}
                  className={`rounded-md px-2 py-1 text-[10px] ${FOCUS} ${p.harmonyInterval === it.v ? "bg-accent/15 text-accent ring-1 ring-accent/40" : "bg-surface-2 text-ink-mute hover:text-ink-text"}`}
                >
                  {it.label}
                </button>
              ))}
            </div>
            <Slider label="Mix" value={p.harmonyMix} valueLabel={`${Math.round(p.harmonyMix * 100)}%`} onChange={(v) => vfx.update({ harmonyMix: v })} />
          </EffectCard>

          {/* Delay */}
          <EffectCard name="Echo / Delay" on={p.delayOn} onToggle={() => vfx.update({ delayOn: !p.delayOn })}>
            <Slider label="Time" min={0.05} max={0.8} step={0.01} value={p.delayTime} valueLabel={`${Math.round(p.delayTime * 1000)}\u202fms`} onChange={(v) => vfx.update({ delayTime: v })} />
            <Slider label="Feedback" max={0.9} value={p.delayFeedback} valueLabel={`${Math.round(p.delayFeedback * 100)}%`} onChange={(v) => vfx.update({ delayFeedback: v })} />
            <Slider label="Mix" value={p.delayMix} valueLabel={`${Math.round(p.delayMix * 100)}%`} onChange={(v) => vfx.update({ delayMix: v })} />
            <Slider label="Low cut" min={100} max={800} step={50} value={p.delayLowCutHz} valueLabel={`${p.delayLowCutHz}\u202fHz`} onChange={(v) => vfx.update({ delayLowCutHz: v })} />
          </EffectCard>

          {/* Reverb */}
          <EffectCard name="Reverb" on={p.reverbOn} onToggle={() => vfx.update({ reverbOn: !p.reverbOn })}>
            <Slider label="Size" min={0.3} max={8} step={0.1} value={p.reverbDecay} valueLabel={`${p.reverbDecay.toFixed(1)}\u202fs`} onChange={(v) => vfx.update({ reverbDecay: v })} />
            <Slider label="Mix" value={p.reverbMix} valueLabel={`${Math.round(p.reverbMix * 100)}%`} onChange={(v) => vfx.update({ reverbMix: v })} />
            <Slider label="Pre-delay" min={0} max={0.1} step={0.005} value={p.reverbPreDelay} valueLabel={`${Math.round(p.reverbPreDelay * 1000)}\u202fms`} onChange={(v) => vfx.update({ reverbPreDelay: v })} />
            <Slider label="Low cut" min={100} max={800} step={50} value={p.reverbLowCutHz} valueLabel={`${p.reverbLowCutHz}\u202fHz`} onChange={(v) => vfx.update({ reverbLowCutHz: v })} />
          </EffectCard>

          {/* Output */}
          <div className="space-y-2.5 rounded-xl border border-line/50 bg-surface-2/25 p-3">
            <Slider label="Output" value={p.outputGain} valueLabel={`${Math.round(p.outputGain * 100)}%`} onChange={(v) => vfx.update({ outputGain: v })} />
            <Slider label="Tighten latency" min={0.03} max={0.1} step={0.005} value={p.windowSize}
              valueLabel={`~${Math.round(p.windowSize * 1000)}\u202fms`} onChange={(v) => vfx.update({ windowSize: v })} />
            <p className="text-[9px] leading-snug text-ink-mute/60">Smaller window = lower latency, more artefacts. Granular shifter \u2014 large shifts colour the voice.</p>
          </div>
        </fieldset>
      )}

      {/* Hand pitch mode hint */}
      {isCameraMode && (
        <label className="flex items-center justify-between rounded-xl border border-line/50 bg-surface-2/30 p-3 text-[11px] text-ink-text">
          <span className="pr-2">
            Hand pitch &middot; <span className="text-ink-mute">raise/lower hand to bend the note</span>
            <span className="mt-0.5 block text-[10px] text-ink-mute/70">
              {keyLock ? "Locked to scale (clean intervals)" : "Continuous glide"}
            </span>
          </span>
          <Switch on={keyLock} onClick={() => setKeyLock(!keyLock)} label="Key-lock hand pitch" />
        </label>
      )}
    </div>
  );
}
