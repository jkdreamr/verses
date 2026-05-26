import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PerformAudioBus = {
  ctx: AudioContext;
  masterGain: GainNode;
  drumGain: GainNode;
  chordGain: GainNode;
  trumpetGain: GainNode;
  compressor: DynamicsCompressorNode;
  recordDest: MediaStreamAudioDestinationNode;
  analyser: AnalyserNode;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Creates and manages a single shared AudioContext bus for all Perform engines.
 *
 * Routing:
 *   drumGain ──┐
 *   chordGain ─┤──► masterGain ──► compressor ──► ctx.destination
 *   trumpetGain┘                          └──► recordDest
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
    masterGain.gain.value = 1.0;

    const drumGain = ctx.createGain();
    drumGain.gain.value = 1.0;

    const chordGain = ctx.createGain();
    chordGain.gain.value = 1.0;

    const trumpetGain = ctx.createGain();
    trumpetGain.gain.value = 1.0;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    const recordDest = ctx.createMediaStreamDestination();

    // Wire sub-buses into master
    drumGain.connect(masterGain);
    chordGain.connect(masterGain);
    trumpetGain.connect(masterGain);

    // Master → compressor → destination + recordDest
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);
    compressor.connect(recordDest);

    // Analyser taps the master
    masterGain.connect(analyser);

    const bus: PerformAudioBus = {
      ctx,
      masterGain,
      drumGain,
      chordGain,
      trumpetGain,
      compressor,
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
          bus.analyser.disconnect();
        } catch { /* ok */ }
        if (bus.ctx.state !== "closed") {
          bus.ctx.close().catch(() => {});
        }
        busRef.current = null;
      }
    };
  }, []);

  return {
    bus: busRef.current,
    ready,
    ensureBus,
    resume,
    suspend,
    destroy,
  };
}
