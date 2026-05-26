// ---------------------------------------------------------------------------
// Shared pitch detection utilities (YIN algorithm)
// ---------------------------------------------------------------------------

/**
 * Compute root-mean-square of a float audio buffer.
 */
export function computeRMS(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * YIN pitch estimator (parameterized).
 *
 * Returns `{ freq, confidence, rms }` when a pitched signal is detected, or
 * `null` when the buffer is silent or unpitched.
 */
export function detectPitchYIN(
  buffer: Float32Array<ArrayBuffer>,
  sampleRate: number,
  params: { yinThreshold: number; silenceRms: number; noisyFallback: number },
): { freq: number; confidence: number; rms: number } | null {
  const W = buffer.length;
  const tau_max = Math.floor(W / 2);

  // RMS check for silence
  let rms = 0;
  for (let i = 0; i < W; i++) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / W);
  if (rms < params.silenceRms) return null;

  // Step 1: difference function
  const d = new Float32Array(tau_max);
  for (let tau = 1; tau < tau_max; tau++) {
    let sum = 0;
    for (let i = 0; i < tau_max; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  // Step 2: cumulative mean normalized difference
  const cmnd = new Float32Array(tau_max);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < tau_max; tau++) {
    runningSum += d[tau];
    cmnd[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 0;
  }

  // Step 3: find first dip below threshold
  const threshold = params.yinThreshold;
  let tau_estimate = -1;
  for (let tau = 2; tau < tau_max; tau++) {
    if (cmnd[tau] < threshold) {
      // local minimum search
      while (tau + 1 < tau_max && cmnd[tau + 1] < cmnd[tau]) tau++;
      tau_estimate = tau;
      break;
    }
  }

  if (tau_estimate === -1) {
    // No dip found — find global minimum
    let min = Infinity;
    for (let tau = 2; tau < tau_max; tau++) {
      if (cmnd[tau] < min) {
        min = cmnd[tau];
        tau_estimate = tau;
      }
    }
    if (min > params.noisyFallback) return null;
  }

  // Step 4: parabolic interpolation for sub-sample accuracy
  if (tau_estimate > 1 && tau_estimate < tau_max - 1) {
    const alpha = cmnd[tau_estimate - 1];
    const beta = cmnd[tau_estimate];
    const gamma = cmnd[tau_estimate + 1];
    const denom = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denom) > 1e-10) {
      const offset = (gamma - alpha) / denom;
      tau_estimate += offset;
    }
  }

  const freq = sampleRate / tau_estimate;
  const cmndAtTau = cmnd[Math.round(Math.max(1, Math.min(tau_max - 1, tau_estimate)))];
  const confidence = 1 - Math.min(1, cmndAtTau / threshold);

  // Frequency range: 75–1100 Hz (full vocal range)
  if (freq < 75 || freq > 1100) return null;

  return { freq, confidence, rms };
}

// ---------------------------------------------------------------------------
// MIDI / note helpers
// ---------------------------------------------------------------------------

export const freqToMidi = (freq: number): number =>
  Math.round(12 * Math.log2(freq / 440) + 69);

export const midiToNoteName = (midi: number): string => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return names[midi % 12] + octave;
};
