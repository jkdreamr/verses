// ───────────────────────────────────────────────────────────────────────────
// McLeod Pitch Method (MPM) AudioWorklet — optimized version
// Uses ring buffer for efficient sample storage, adds confidence smoothing,
// and provides lower CPU mode for mobile devices.
// ───────────────────────────────────────────────────────────────────────────

class PitchDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Configuration
    this.windowSize = 2048;
    this.hop = 512;
    this.clarityThreshold = 0.6;
    this.lowCpuMode = false;

    // Ring buffer for efficient sample storage (no more copyWithin!)
    this.buffer = new Float32Array(this.windowSize);
    this.writeIndex = 0;
    this.filled = 0;
    this.sinceLast = 0;

    // Confidence smoothing for stability
    this.lastClarity = 0;
    this.lastFreq = 0;
    this.claritySmoothing = 0.3;
    this.freqSmoothing = 0.1;
    this.voicedFrames = 0;
    this.unvoicedFrames = 0;

    // Handle configuration messages
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data === 'object') {
        if (e.data.windowSize) this.windowSize = Math.max(1024, Math.min(4096, e.data.windowSize));
        if (e.data.hop) this.hop = Math.max(128, Math.min(1024, e.data.hop));
        if (e.data.clarityThreshold) this.clarityThreshold = Math.max(0.3, Math.min(0.9, e.data.clarityThreshold));
        if (e.data.lowCpuMode !== undefined) this.lowCpuMode = e.data.lowCpuMode;
      }
    };
  }

  static get parameterDescriptors() {
    return [];
  }

  // Read sample from ring buffer at offset (0 = oldest, windowSize-1 = newest)
  readBuffer(offset) {
    const idx = (this.writeIndex + offset) % this.windowSize;
    return this.buffer[idx];
  }

  // Normalised Square Difference Function (McLeod) - optimized version
  detect(buf) {
    const n = this.windowSize;

    // RMS for silence gating / dynamics
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const sample = this.readBuffer(i);
      rms += sample * sample;
    }
    rms = Math.sqrt(rms / n);

    // Silence gate - lower threshold for more sensitivity
    if (rms < 0.005) {
      this.voicedFrames = 0;
      this.unvoicedFrames++;
      return { freq: 0, clarity: 0, rms };
    }

    const maxLag = n >> 1;

    // Use Float32Array for NSDF to avoid allocations in hot path
    // Reuse if possible, but create new if size changes
    if (!this.nsdf || this.nsdf.length !== maxLag) {
      this.nsdf = new Float32Array(maxLag);
    }

    // NSDF calculation with early termination for very quiet signals
    for (let tau = 0; tau < maxLag; tau++) {
      let acf = 0;
      let m = 0;

      // Inner loop - unroll slightly for performance
      const limit = n - tau;
      let i = 0;

      // Process 4 samples at a time
      for (; i <= limit - 4; i += 4) {
        const s0 = this.readBuffer(i);
        const s1 = this.readBuffer(i + 1);
        const s2 = this.readBuffer(i + 2);
        const s3 = this.readBuffer(i + 3);

        const t0 = this.readBuffer(i + tau);
        const t1 = this.readBuffer(i + tau + 1);
        const t2 = this.readBuffer(i + tau + 2);
        const t3 = this.readBuffer(i + tau + 3);

        acf += s0 * t0 + s1 * t1 + s2 * t2 + s3 * t3;
        m += s0 * s0 + t0 * t0 + s1 * s1 + t1 * t1 + s2 * s2 + t2 * t2 + s3 * s3 + t3 * t3;
      }

      // Remainder
      for (; i < limit; i++) {
        const s = this.readBuffer(i);
        const t = this.readBuffer(i + tau);
        acf += s * t;
        m += s * s + t * t;
      }

      this.nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
    }

    // Peak picking with optimized search
    const peaks = [];
    let pos = 0;

    // Skip initial descent
    while (pos < maxLag - 1 && this.nsdf[pos] > 0) pos++;
    while (pos < maxLag - 1 && this.nsdf[pos] <= 0) pos++;

    let curMaxPos = -1;
    let curMaxVal = -1;

    while (pos < maxLag - 1) {
      const val = this.nsdf[pos];
      const prev = this.nsdf[pos - 1];
      const next = pos < maxLag - 1 ? this.nsdf[pos + 1] : -1;

      if (val > prev && val >= next) {
        if (curMaxPos === -1 || val > curMaxVal) {
          curMaxPos = pos;
          curMaxVal = val;
        }
      }

      pos++;

      if (pos < maxLag - 1 && this.nsdf[pos] <= 0) {
        if (curMaxPos > 0) {
          peaks.push(curMaxPos);
        }
        curMaxPos = -1;
        curMaxVal = -1;
        while (pos < maxLag - 1 && this.nsdf[pos] <= 0) pos++;
      }
    }

    if (curMaxPos > 0) peaks.push(curMaxPos);

    if (peaks.length === 0) {
      this.voicedFrames = 0;
      this.unvoicedFrames++;
      return { freq: 0, clarity: 0, rms };
    }

    // Find highest peak
    let highestVal = -1;
    for (const p of peaks) {
      if (this.nsdf[p] > highestVal) highestVal = this.nsdf[p];
    }

    // Use cutoff at 0.8 of highest for peak selection
    const cutoff = 0.8 * highestVal;
    let chosen = peaks[0];
    for (const p of peaks) {
      if (this.nsdf[p] >= cutoff) {
        chosen = p;
        break;
      }
    }

    // Parabolic interpolation
    let tau = chosen;
    if (chosen > 0 && chosen < maxLag - 1) {
      const a = this.nsdf[chosen - 1];
      const b = this.nsdf[chosen];
      const c = this.nsdf[chosen + 1];
      const denom = a - 2 * b + c;
      if (Math.abs(denom) > 1e-9) {
        tau = chosen + (0.5 * (a - c)) / denom;
      }
    }

    let clarity = Math.max(0, Math.min(1, this.nsdf[chosen]));
    let freq = tau > 0 ? sampleRate / tau : 0;

    // Frequency range check
    if (freq < 60 || freq > 1500) {
      this.voicedFrames = 0;
      this.unvoicedFrames++;
      return { freq: 0, clarity: 0, rms };
    }

    // Confidence smoothing for stability
    // Require sustained voicing before accepting pitch
    if (clarity >= this.clarityThreshold) {
      this.voicedFrames++;
      this.unvoicedFrames = 0;
    } else {
      this.unvoicedFrames++;
      if (this.unvoicedFrames > 5) {
        this.voicedFrames = 0;
      }
    }

    // Smooth clarity to reduce jitter
    clarity = this.lastClarity * this.claritySmoothing + clarity * (1 - this.claritySmoothing);
    this.lastClarity = clarity;

    // Only report frequency if we have enough voiced frames
    if (this.voicedFrames < 2 && clarity < this.clarityThreshold) {
      freq = 0;
    } else {
      // Smooth frequency transitions
      if (this.lastFreq > 0 && freq > 0) {
        const maxDelta = this.lastFreq * 0.1; // Max 10% change per frame
        const delta = freq - this.lastFreq;
        if (Math.abs(delta) > maxDelta) {
          freq = this.lastFreq + Math.sign(delta) * maxDelta;
        }
      }
      freq = this.lastFreq * this.freqSmoothing + freq * (1 - this.freqSmoothing);
      this.lastFreq = freq;
    }

    return { freq, clarity, rms };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    // Process samples
    for (let i = 0; i < ch.length; i++) {
      // Write to ring buffer
      this.buffer[this.writeIndex] = ch[i];
      this.writeIndex = (this.writeIndex + 1) % this.windowSize;

      if (this.filled < this.windowSize) {
        this.filled++;
      }
      this.sinceLast++;
    }

    // Detect pitch when we have enough samples and hop interval
    if (this.filled >= this.windowSize && this.sinceLast >= this.hop) {
      this.sinceLast = 0;

      // In low CPU mode, skip every other detection
      if (this.lowCpuMode && this.skipFrame) {
        this.skipFrame = false;
        return true;
      }
      this.skipFrame = this.lowCpuMode;

      const { freq, clarity, rms } = this.detect(this.buffer);
      this.port.postMessage({ freq, clarity, rms });
    }

    return true;
  }
}

registerProcessor("pitch-detector", PitchDetectorProcessor);
