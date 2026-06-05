// ───────────────────────────────────────────────────────────────────────────
// McLeod Pitch Method (MPM) AudioWorklet — professional upgrade
//
// Changes vs previous version:
//  • Separate attack / release clarity thresholds (hysteresis) so the gate
//    doesn't chatter at the boundary.
//  • Posts a pitchStatus string alongside freq/clarity/rms so the UI can
//    display "too quiet", "no clear pitch", "out of range", "tracking" etc.
//  • Configurable via port.postMessage({...}) with all params.
//  • No JS-side frequency smoothing (smoothing done in hook via OneEuroFilter)
//    so fast note changes arrive quickly; hook controls how much to smooth.
//  • Ring buffer retained for efficient sample storage.
// ───────────────────────────────────────────────────────────────────────────

class PitchDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Configurable via port messages
    this.windowSize      = 2048;
    this.hop             = 512;
    this.attackThresh    = 0.55;  // clarity needed to open the gate
    this.releaseThresh   = 0.42;  // clarity needed to stay open (hysteresis)
    this.rmsGate         = 0.006; // absolute silence floor
    this.lowCpuMode      = false;

    // Ring buffer
    this.buffer     = new Float32Array(this.windowSize);
    this.writeIndex = 0;
    this.filled     = 0;
    this.sinceLast  = 0;

    // Gate state (hysteresis)
    this.gateOpen      = false;
    this.voicedFrames  = 0;
    this.unvoicedFrames = 0;

    // Low-CPU frame skipping
    this.skipNext = false;

    this.port.onmessage = (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      const d = e.data;
      if (d.windowSize)      this.windowSize     = Math.max(512, Math.min(8192, d.windowSize));
      if (d.hop)             this.hop            = Math.max(64,  Math.min(2048, d.hop));
      if (d.attackThresh)    this.attackThresh   = Math.max(0.2, Math.min(0.95, d.attackThresh));
      if (d.releaseThresh)   this.releaseThresh  = Math.max(0.1, Math.min(0.9,  d.releaseThresh));
      if (d.rmsGate != null) this.rmsGate        = Math.max(0,   Math.min(0.1,  d.rmsGate));
      if (d.lowCpuMode != null) this.lowCpuMode  = !!d.lowCpuMode;

      // Resize ring buffer if windowSize changed
      if (d.windowSize) {
        this.buffer     = new Float32Array(this.windowSize);
        this.writeIndex = 0;
        this.filled     = 0;
        this.sinceLast  = 0;
        this.gateOpen   = false;
      }
    };
  }

  static get parameterDescriptors() { return []; }

  readBuffer(offset) {
    return this.buffer[(this.writeIndex + offset) % this.windowSize];
  }

  detect() {
    const n       = this.windowSize;
    const maxLag  = n >> 1;

    // RMS
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const s = this.readBuffer(i);
      rms += s * s;
    }
    rms = Math.sqrt(rms / n);

    if (rms < this.rmsGate) {
      this.gateOpen       = false;
      this.voicedFrames   = 0;
      this.unvoicedFrames++;
      return { freq: 0, clarity: 0, rms, pitchStatus: 'too_quiet' };
    }

    // NSDF
    if (!this.nsdf || this.nsdf.length !== maxLag) {
      this.nsdf = new Float32Array(maxLag);
    }
    for (let tau = 0; tau < maxLag; tau++) {
      let acf = 0, m = 0;
      const limit = n - tau;
      let i = 0;
      for (; i <= limit - 4; i += 4) {
        const s0 = this.readBuffer(i),     t0 = this.readBuffer(i + tau);
        const s1 = this.readBuffer(i + 1), t1 = this.readBuffer(i + tau + 1);
        const s2 = this.readBuffer(i + 2), t2 = this.readBuffer(i + tau + 2);
        const s3 = this.readBuffer(i + 3), t3 = this.readBuffer(i + tau + 3);
        acf += s0*t0 + s1*t1 + s2*t2 + s3*t3;
        m   += s0*s0 + t0*t0 + s1*s1 + t1*t1 + s2*s2 + t2*t2 + s3*s3 + t3*t3;
      }
      for (; i < limit; i++) {
        const s = this.readBuffer(i), t = this.readBuffer(i + tau);
        acf += s * t; m += s * s + t * t;
      }
      this.nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
    }

    // Peak picking
    const peaks = [];
    let pos = 0;
    while (pos < maxLag - 1 && this.nsdf[pos] > 0)  pos++;
    while (pos < maxLag - 1 && this.nsdf[pos] <= 0) pos++;
    let curMaxPos = -1, curMaxVal = -1;
    while (pos < maxLag - 1) {
      const val  = this.nsdf[pos];
      const prev = this.nsdf[pos - 1];
      const next = pos < maxLag - 1 ? this.nsdf[pos + 1] : -1;
      if (val > prev && val >= next) {
        if (curMaxPos === -1 || val > curMaxVal) { curMaxPos = pos; curMaxVal = val; }
      }
      pos++;
      if (pos < maxLag - 1 && this.nsdf[pos] <= 0) {
        if (curMaxPos > 0) peaks.push(curMaxPos);
        curMaxPos = -1; curMaxVal = -1;
        while (pos < maxLag - 1 && this.nsdf[pos] <= 0) pos++;
      }
    }
    if (curMaxPos > 0) peaks.push(curMaxPos);

    if (peaks.length === 0) {
      this.unvoicedFrames++;
      if (this.unvoicedFrames > 3) { this.gateOpen = false; this.voicedFrames = 0; }
      return { freq: 0, clarity: 0, rms, pitchStatus: 'no_pitch' };
    }

    let highestVal = -1;
    for (const p of peaks) { if (this.nsdf[p] > highestVal) highestVal = this.nsdf[p]; }
    const cutoff = 0.8 * highestVal;
    let chosen = peaks[0];
    for (const p of peaks) { if (this.nsdf[p] >= cutoff) { chosen = p; break; } }

    // Parabolic interpolation
    let tau = chosen;
    if (chosen > 0 && chosen < maxLag - 1) {
      const a = this.nsdf[chosen - 1], b = this.nsdf[chosen], c = this.nsdf[chosen + 1];
      const denom = a - 2 * b + c;
      if (Math.abs(denom) > 1e-9) tau = chosen + (0.5 * (a - c)) / denom;
    }

    const clarity = Math.max(0, Math.min(1, this.nsdf[chosen]));
    const freq    = tau > 0 ? sampleRate / tau : 0;

    if (freq < 60 || freq > 1600) {
      this.unvoicedFrames++;
      if (this.unvoicedFrames > 3) { this.gateOpen = false; this.voicedFrames = 0; }
      return { freq: 0, clarity: 0, rms, pitchStatus: 'out_of_range' };
    }

    // Hysteresis gating
    const threshold = this.gateOpen ? this.releaseThresh : this.attackThresh;
    if (clarity >= threshold) {
      this.voicedFrames++;
      this.unvoicedFrames = 0;
      if (this.voicedFrames >= 2) this.gateOpen = true;
    } else {
      this.unvoicedFrames++;
      if (this.unvoicedFrames >= 4) {
        this.gateOpen     = false;
        this.voicedFrames = 0;
      }
    }

    if (!this.gateOpen) {
      return { freq: 0, clarity, rms, pitchStatus: 'no_pitch' };
    }

    return { freq, clarity, rms, pitchStatus: 'tracking' };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    for (let i = 0; i < ch.length; i++) {
      this.buffer[this.writeIndex] = ch[i];
      this.writeIndex = (this.writeIndex + 1) % this.windowSize;
      if (this.filled < this.windowSize) this.filled++;
      this.sinceLast++;
    }

    if (this.filled >= this.windowSize && this.sinceLast >= this.hop) {
      this.sinceLast = 0;
      if (this.lowCpuMode && this.skipNext) { this.skipNext = false; return true; }
      this.skipNext = this.lowCpuMode;
      const result = this.detect();
      this.port.postMessage(result);
    }
    return true;
  }
}

registerProcessor('pitch-detector', PitchDetectorProcessor);
