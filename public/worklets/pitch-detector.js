// ───────────────────────────────────────────────────────────────────────────
// McLeod Pitch Method (MPM) AudioWorklet — the same algorithm pitchy implements,
// inlined here so it can run off the main thread without a bundler step. Buffers
// mic samples, runs MPM per hop, and posts { freq, clarity, rms } to the main
// thread, which drives the sampled trumpet. clarity ∈ [0,1] gates note-on.
// ───────────────────────────────────────────────────────────────────────────

class PitchDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.windowSize = 2048;
    this.hop = 512;
    this.buffer = new Float32Array(this.windowSize);
    this.filled = 0;
    this.sinceLast = 0;
    this.clarityThreshold = 0.6;
  }

  static get parameterDescriptors() {
    return [];
  }

  // Normalised Square Difference Function (McLeod).
  detect(buf) {
    const n = buf.length;

    // RMS for silence gating / dynamics.
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.008) return { freq: 0, clarity: 0, rms };

    const maxLag = n >> 1;
    const nsdf = new Float32Array(maxLag);
    for (let tau = 0; tau < maxLag; tau++) {
      let acf = 0;
      let m = 0;
      for (let i = 0; i < n - tau; i++) {
        acf += buf[i] * buf[i + tau];
        m += buf[i] * buf[i] + buf[i + tau] * buf[i + tau];
      }
      nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
    }

    // Pick peaks: first positively-sloped zero crossing, then local maxima.
    const peaks = [];
    let pos = 0;
    // skip the initial descent from lag 0
    while (pos < maxLag - 1 && nsdf[pos] > 0) pos++;
    while (pos < maxLag - 1 && nsdf[pos] <= 0) pos++;
    let curMaxPos = 0;
    while (pos < maxLag - 1) {
      if (nsdf[pos] > nsdf[pos - 1] && nsdf[pos] >= nsdf[pos + 1]) {
        if (curMaxPos === 0 || nsdf[pos] > nsdf[curMaxPos]) curMaxPos = pos;
      }
      pos++;
      if (pos < maxLag - 1 && nsdf[pos] <= 0) {
        if (curMaxPos > 0) peaks.push(curMaxPos);
        curMaxPos = 0;
        while (pos < maxLag - 1 && nsdf[pos] <= 0) pos++;
      }
    }
    if (curMaxPos > 0) peaks.push(curMaxPos);
    if (peaks.length === 0) return { freq: 0, clarity: 0, rms };

    let highest = 0;
    for (const p of peaks) if (nsdf[p] > highest) highest = nsdf[p];

    const cutoff = 0.8 * highest;
    let chosen = peaks[0];
    for (const p of peaks) {
      if (nsdf[p] >= cutoff) { chosen = p; break; }
    }

    // Parabolic interpolation around the chosen peak.
    let tau = chosen;
    if (chosen > 0 && chosen < maxLag - 1) {
      const a = nsdf[chosen - 1];
      const b = nsdf[chosen];
      const c = nsdf[chosen + 1];
      const denom = a - 2 * b + c;
      if (Math.abs(denom) > 1e-9) tau = chosen + (0.5 * (a - c)) / denom;
    }

    const clarity = Math.max(0, Math.min(1, nsdf[chosen]));
    const freq = tau > 0 ? sampleRate / tau : 0;
    if (freq < 70 || freq > 1200) return { freq: 0, clarity, rms };
    return { freq, clarity, rms };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    for (let i = 0; i < ch.length; i++) {
      // shift-in (ring-ish): drop oldest when full
      if (this.filled < this.windowSize) {
        this.buffer[this.filled++] = ch[i];
      } else {
        this.buffer.copyWithin(0, 1);
        this.buffer[this.windowSize - 1] = ch[i];
      }
      this.sinceLast++;
    }

    if (this.filled >= this.windowSize && this.sinceLast >= this.hop) {
      this.sinceLast = 0;
      const { freq, clarity, rms } = this.detect(this.buffer);
      this.port.postMessage({ freq, clarity, rms });
    }
    return true;
  }
}

registerProcessor("pitch-detector", PitchDetectorProcessor);
