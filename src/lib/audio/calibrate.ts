"use client";

import { ensureEngine } from "./engine";

// ───────────────────────────────────────────────────────────────────────────
// Mic calibration (Dubler-2 lesson: calibrating to the room/voice massively
// improves accuracy). We measure the ambient NOISE FLOOR for ~1.5 s and use it
// to gate note-on in the live pitch features, so room hiss / breath never
// triggers the trumpet or autotune. Stored module-globally (+ localStorage) so
// both useLiveTrumpet and useVocalFx read the same value with no prop threading.
// ───────────────────────────────────────────────────────────────────────────

const STORE_KEY = "verses.mic.noiseFloor.v1";
const MAX_FLOOR = 0.05; // clamp so a noisy calibration can never mute soft singing

let _noiseFloor = typeof window !== "undefined"
  ? (() => { try { return Math.min(MAX_FLOOR, parseFloat(window.localStorage.getItem(STORE_KEY) || "0") || 0); } catch { return 0; } })()
  : 0;

export function getNoiseFloor(): number { return _noiseFloor; }

export function setNoiseFloor(v: number): void {
  _noiseFloor = Math.max(0, Math.min(MAX_FLOOR, v || 0));
  try { window.localStorage.setItem(STORE_KEY, String(_noiseFloor)); } catch { /* */ }
}

/** True if `rms` is loud enough to be a real voiced sound (always true if uncalibrated). */
export function aboveNoiseFloor(rms: number, mult = 1.5): boolean {
  return _noiseFloor <= 0 || rms > _noiseFloor * mult;
}

/**
 * Listen to the mic for `ms` of *ambient* sound and return the 90th-percentile
 * RMS — a robust noise floor. Run this while the user is quiet.
 */
export async function calibrateNoiseFloor(stream: MediaStream, ms = 1500): Promise<number> {
  const engine = ensureEngine();
  const src = engine.ctx.createMediaStreamSource(stream);
  const analyser = engine.ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const samples: number[] = [];
  const start = performance.now();

  await new Promise<void>((resolve) => {
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      samples.push(Math.sqrt(sum / buf.length));
      if (performance.now() - start < ms) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

  try { src.disconnect(); analyser.disconnect(); } catch { /* */ }
  samples.sort((a, b) => a - b);
  const p90 = samples[Math.floor(samples.length * 0.9)] ?? 0;
  setNoiseFloor(p90);
  return _noiseFloor;
}
