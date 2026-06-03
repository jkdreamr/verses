import { useCallback, useState } from "react";
import {
  ensureEngine,
  getEngine,
  resumeEngine,
  setBusLevel,
  setMasterLevel,
} from "@/lib/audio/engine";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Back-compat view of the singleton audio engine. The node names mirror the old
 * hand-rolled bus so existing consumers (RecorderModal) keep compiling while the
 * graph itself is now the shared, persistent {@link ensureEngine} singleton.
 */
export type PerformAudioBus = {
  ctx: AudioContext;
  masterGain: GainNode;
  drumGain: GainNode;
  chordGain: GainNode;
  trumpetGain: GainNode;
  padGain: GainNode;
  recordDest: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
};

function toBus(): PerformAudioBus {
  const e = ensureEngine();
  return {
    ctx: e.ctx,
    masterGain: e.master,
    drumGain: e.drumBus,
    chordGain: e.chordBus,
    trumpetGain: e.trumpetBus,
    padGain: e.padBus,
    recordDest: e.recordDest,
    analyser: e.analyser,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Thin React surface over the persistent engine singleton. `ensureBus()` is
 * synchronous (the native graph needs no async work); Tone + samplers load
 * lazily the first time chords/trumpet are triggered. The graph is created once
 * and reused — closing a modal suspends, it does not tear the graph down.
 */
export function usePerformAudioBus() {
  const [bus, setBus] = useState<PerformAudioBus | null>(null);

  const ensureBus = useCallback((): PerformAudioBus => {
    const b = toBus();
    setBus((prev) => prev ?? b);
    return b;
  }, []);

  const resume = useCallback(async () => {
    await resumeEngine();
  }, []);

  const suspend = useCallback(async () => {
    const e = getEngine();
    if (e && e.ctx.state === "running") {
      await e.ctx.suspend().catch(() => {});
    }
  }, []);

  // Soft teardown: keep the singleton alive (avoids context-count exhaustion and
  // re-fetching samples), just suspend to save power until reopened.
  const destroy = useCallback(async () => {
    await suspend();
  }, [suspend]);

  const setMasterGain = useCallback((v: number) => setMasterLevel(v), []);
  const setDrumGain = useCallback((v: number) => setBusLevel("drum", v), []);
  const setChordGain = useCallback((v: number) => setBusLevel("chord", v), []);
  const setTrumpetGain = useCallback((v: number) => setBusLevel("trumpet", v), []);

  return {
    bus,
    ready: !!bus,
    ensureBus,
    resume,
    suspend,
    destroy,
    setMasterGain,
    setDrumGain,
    setChordGain,
    setTrumpetGain,
  };
}
