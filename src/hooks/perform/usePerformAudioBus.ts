import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PerformAudioBus = {
  ctx: AudioContext;
  masterGain: GainNode;
  drumGain: GainNode;
  chordGain: GainNode;
  trumpetGain: GainNode;
  compressor: DynamicsCompressorNode;
  limiter: DynamicsCompressorNode;
  recordDest: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Creates and manages a single shared AudioContext bus for all Perform engines.
 *
 * Routing:
 *   drumGain ──┐
 *   chordGain ─┤──► masterGain ──► compressor ──► limiter ──► ctx.destination
 *   trumpetGain┘                                      └──► recordDest
 *
 * The recordDest provides a MediaStream suitable for MediaRecorder capture.
 */
export function usePerformAudioBus() {
  const busRef = useRef<PerformAudioBus | null>(null);
  const [ready, setReady] = useState(false);

  /** Lazily create or return the bus. Safe to call multiple times. */
  const ensureBus = useCallback((): PerformAudioBus => {
    if (busRef.current) return busRef.current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx() as AudioContext;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.80;

    const drumGain = ctx.createGain();
    drumGain.gain.value = 0.70;

    const chordGain = ctx.createGain();
    chordGain.gain.value = 0.55;

    const trumpetGain = ctx.createGain();
    trumpetGain.gain.value = 0.50;

    // Gentle glue compressor — not harsh
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 16;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;

    // Safety limiter — prevents clipping
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.06;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    const recordDest = ctx.createMediaStreamDestination();

    // Wire sub-buses into master
    drumGain.connect(masterGain);
    chordGain.connect(masterGain);
    trumpetGain.connect(masterGain);

    // Master → compressor → limiter → destination + recordDest
    masterGain.connect(compressor);
    compressor.connect(limiter);
    limiter.connect(ctx.destination);
    limiter.connect(recordDest);

    // Analyser taps the master
    masterGain.connect(analyser);

    const bus: PerformAudioBus = {
      ctx,
      masterGain,
      drumGain,
      chordGain,
      trumpetGain,
      compressor,
      limiter,
      recordDest,
      analyser,
    };

    busRef.current = bus;
    setReady(true);
    return bus;
  }, []);

  /** Resume the AudioContext (required after user gesture). */
  const resume = useCallback(async () => {
    const bus = busRef.current;
    if (bus && bus.ctx.state === "suspended") {
      await bus.ctx.resume();
    }
  }, []);

  /** Suspend the AudioContext (power saving when idle). */
  const suspend = useCallback(async () => {
    const bus = busRef.current;
    if (bus && bus.ctx.state === "running") {
      await bus.ctx.suspend();
    }
  }, []);

  /** Tear down everything. After this, ensureBus() will create a fresh bus. */
  const destroy = useCallback(async () => {
    const bus = busRef.current;
    if (!bus) return;
    busRef.current = null;
    setReady(false);

    try {
      // Disconnect all sub-buses
      bus.drumGain.disconnect();
      bus.chordGain.disconnect();
      bus.trumpetGain.disconnect();
      bus.masterGain.disconnect();
      bus.compressor.disconnect();
      bus.limiter.disconnect();
      bus.analyser.disconnect();
    } catch { /* already disconnected */ }

    if (bus.ctx.state !== "closed") {
      await bus.ctx.close().catch(() => {});
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      const bus = busRef.current;
      if (bus) {
        try {
          bus.drumGain.disconnect();
          bus.chordGain.disconnect();
          bus.trumpetGain.disconnect();
          bus.masterGain.disconnect();
          bus.compressor.disconnect();
          bus.limiter.disconnect();
          bus.analyser.disconnect();
        } catch { /* ok */ }
        if (bus.ctx.state !== "closed") {
          bus.ctx.close().catch(() => {});
        }
        busRef.current = null;
      }
    };
  }, []);

  /** Smoothly set bus master gain (0-1). */
  const setMasterGain = useCallback((vol: number) => {
    const bus = busRef.current;
    if (!bus) return;
    const v = Math.max(0, Math.min(1, vol));
    bus.masterGain.gain.setTargetAtTime(v, bus.ctx.currentTime, 0.02);
  }, []);

  /** Smoothly set bus drum gain (0-1). */
  const setDrumGain = useCallback((vol: number) => {
    const bus = busRef.current;
    if (!bus) return;
    const v = Math.max(0, Math.min(1, vol));
    bus.drumGain.gain.setTargetAtTime(v, bus.ctx.currentTime, 0.02);
  }, []);

  /** Smoothly set bus chord gain (0-1). */
  const setChordGain = useCallback((vol: number) => {
    const bus = busRef.current;
    if (!bus) return;
    const v = Math.max(0, Math.min(1, vol));
    bus.chordGain.gain.setTargetAtTime(v, bus.ctx.currentTime, 0.02);
  }, []);

  return {
    bus: busRef.current,
    ready,
    ensureBus,
    resume,
    suspend,
    destroy,
    setMasterGain,
    setDrumGain,
    setChordGain,
  };
}
