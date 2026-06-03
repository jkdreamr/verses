// ───────────────────────────────────────────────────────────────────────────
// One-Euro filter (Casiez, Roussel & Vogel 2012). Low-lag adaptive smoothing:
// heavy smoothing when the hand is slow (kills jitter), light smoothing when it
// moves fast (kills lag). Used to tame MediaPipe landmark noise on the XY pad.
// ───────────────────────────────────────────────────────────────────────────

class LowPass {
  private y = 0;
  private s = 0;
  private initialized = false;

  filter(x: number, alpha: number): number {
    if (!this.initialized) {
      this.s = x;
      this.initialized = true;
    } else {
      this.s = alpha * x + (1 - alpha) * this.s;
    }
    this.y = x;
    return this.s;
  }

  last(): number {
    return this.s;
  }

  reset() {
    this.initialized = false;
    this.y = 0;
    this.s = 0;
  }
}

export class OneEuroFilter {
  private freq: number;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private x = new LowPass();
  private dx = new LowPass();
  private lastTime: number | null = null;

  constructor(opts: { minCutoff?: number; beta?: number; dCutoff?: number; freq?: number } = {}) {
    this.freq = opts.freq ?? 60;
    this.minCutoff = opts.minCutoff ?? 1.2;
    this.beta = opts.beta ?? 0.02;
    this.dCutoff = opts.dCutoff ?? 1.0;
  }

  private alpha(cutoff: number): number {
    const te = 1 / this.freq;
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / te);
  }

  /** `timestampMs` is optional; when given, the sample rate adapts to it. */
  filter(value: number, timestampMs?: number): number {
    if (timestampMs != null) {
      if (this.lastTime != null && timestampMs > this.lastTime) {
        this.freq = 1000 / (timestampMs - this.lastTime);
      }
      this.lastTime = timestampMs;
    }
    const prev = this.x.last();
    const dxVal = (value - prev) * this.freq;
    const edx = this.dx.filter(dxVal, this.alpha(this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, this.alpha(cutoff));
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}
