import { useCallback, useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrumpetPreset = {
  name: string;
  brightness: number;       // 0–1: controls bandpass center frequency
  vibratoAmount: number;    // semitones of pitch deviation
  outputGain: number;       // 0–1 master output level
  description: string;
};

// ─── Presets ──────────────────────────────────────────────────────────────────

export const TRUMPET_PRESETS: TrumpetPreset[] = [
  {
    name: "Trumpet Sketch",
    brightness: 0.6,
    vibratoAmount: 0.3,
    outputGain: 0.8,
    description: "Clean bright trumpet",
  },
  {
    name: "Muted Trumpet",
    brightness: 0.2,
    vibratoAmount: 0.1,
    outputGain: 0.6,
    description: "Dark, muted character",
  },
  {
    name: "Brass Section",
    brightness: 0.8,
    vibratoAmount: 0.2,
    outputGain: 0.9,
    description: "Full brass chorus",
  },
  {
    name: "Soft Flugelhorn",
    brightness: 0.3,
    vibratoAmount: 0.4,
    outputGain: 0.7,
    description: "Warm, mellow horn",
  },
  {
    name: "Synth Brass",
    brightness: 1.0,
    vibratoAmount: 0.0,
    outputGain: 0.85,
    description: "Electronic brass",
  },
];

// ─── YIN pitch detection constants ───────────────────────────────────────────

const YIN_THRESHOLD      = 0.15;
const SILENCE_RMS_THRESH = 0.02;
const CONFIDENCE_THRESH  = 0.3;
const MIN_FREQ           = 80;   // Hz — low end of singing range
const MAX_FREQ           = 900;  // Hz — high end
const PITCH_SMOOTH_ALPHA = 0.15; // EMA weight for new pitch value
const ATTACK_TIME_S      = 0.008; // 8 ms
const RELEASE_TIME_S     = 0.08;  // 80 ms
const VIBRATO_RATE_HZ    = 5;

// ─── YIN algorithm implementation ────────────────────────────────────────────

function computeRMS(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * Simplified YIN pitch estimator.
 * Returns { freq, confidence } or { freq: 0, confidence: 0 } when silent / unpitched.
 */
function yinPitch(
  buffer: Float32Array,
  sampleRate: number
): { freq: number; confidence: number } {
  const N     = buffer.length;
  const half  = Math.floor(N / 2);
  const d     = new Float32Array(half);

  // Step 1 & 2: difference function
  for (let tau = 1; tau < half; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) {
      const diff = buffer[i] - buffer[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }

  // Step 3: cumulative mean normalised difference
  d[0] = 1;
  let cumSum = 0;
  const cmnd = new Float32Array(half);
  cmnd[0] = 1;
  for (let tau = 1; tau < half; tau++) {
    cumSum += d[tau];
    cmnd[tau] = d[tau] * tau / cumSum;
  }

  // Step 4: absolute threshold — find first tau where cmnd < threshold
  let tau = -1;
  for (let t = 2; t < half; t++) {
    if (cmnd[t] < YIN_THRESHOLD) {
      // Find local minimum in this dip
      while (t + 1 < half && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }

  if (tau === -1) return { freq: 0, confidence: 0 };

  // Step 5: Parabolic interpolation
  let betterTau = tau;
  if (tau > 0 && tau < half - 1) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = 2 * s1 - s2 - s0;
    if (Math.abs(denom) > 0.001) {
      betterTau = tau + (s2 - s0) / (2 * denom);
    }
  }

  const freq       = sampleRate / betterTau;
  const confidence = 1 - cmnd[tau];

  return { freq, confidence };
}

// ─── WaveShaper curve (soft-clip / tanh approximation) ───────────────────────

function makeSaturationCurve(amount = 200): Float32Array<ArrayBuffer> {
  const n      = 256;
  const curve  = new Float32Array(new ArrayBuffer(n * 4));
  const deg    = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// ─── Hook config ──────────────────────────────────────────────────────────────

export type UseLiveTrumpetConfig = {
  micStream: MediaStream | null;
  destNode: AudioNode | null;
  enabled: boolean;
};

// ─── Synth node bundle (recreated on AudioContext init) ───────────────────────

type SynthNodes = {
  ctx: AudioContext;
  // Oscillators
  osc1: OscillatorNode;   // primary sawtooth
  osc2: OscillatorNode;   // slightly detuned square
  osc3: OscillatorNode;   // octave-up sawtooth (brightness)
  // Noise / breath
  noiseSource: AudioBufferSourceNode;
  noiseGain: GainNode;
  // Envelope gain
  envGain: GainNode;
  // Filters
  bandpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  // Saturation
  shaper: WaveShaperNode;
  // Vibrato LFO
  lfo: OscillatorNode;
  lfoGain: GainNode;
  // Reverb
  reverbInput: GainNode;
  reverbOutput: GainNode;
  // Master out
  masterGain: GainNode;
  // Optional voice pass-through
  voicePassGain: GainNode;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveTrumpet({
  micStream,
  destNode,
  enabled,
}: UseLiveTrumpetConfig) {
  // ── Params ──
  const [brightness,      setBrightness]      = useState(0.6);
  const [vibratoAmount,   setVibratoAmount]   = useState(0.3);
  const [outputGain,      setOutputGain]      = useState(0.8);
  const [rawVoiceMonitor, setRawVoiceMonitor] = useState(false);

  // ── Detected pitch state ──
  const [detectedNote, setDetectedNote] = useState<string | null>(null);
  const [detectedFreq, setDetectedFreq] = useState<number>(0);
  const [confidence,   setConfidence]   = useState<number>(0);
  const [inputLevel,   setInputLevel]   = useState<number>(0);
  const [isActive,     setIsActive]     = useState<boolean>(false);

  // ── Internal refs ──
  const ctxRef         = useRef<AudioContext | null>(null);
  const synthRef       = useRef<SynthNodes | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const micSourceRef   = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef         = useRef<number | null>(null);

  // Smoothed pitch EMA
  const smoothedFreqRef = useRef<number>(0);
  // Track whether trumpet is currently sounding (for envelope management)
  const soundingRef     = useRef<boolean>(false);
  // Param refs for hot-update without rebuilding graph
  const brightnessRef   = useRef(brightness);
  const vibratoRef      = useRef(vibratoAmount);
  const outputGainRef   = useRef(outputGain);
  const voiceMonRef     = useRef(rawVoiceMonitor);

  useEffect(() => { brightnessRef.current  = brightness;      }, [brightness]);
  useEffect(() => { vibratoRef.current     = vibratoAmount;   }, [vibratoAmount]);
  useEffect(() => { outputGainRef.current  = outputGain;      }, [outputGain]);
  useEffect(() => { voiceMonRef.current    = rawVoiceMonitor; }, [rawVoiceMonitor]);

  // ── Build impulse-response reverb ─────────────────────────────────────────

  function buildReverb(ctx: AudioContext, wet: number): { input: GainNode; output: GainNode } {
    const input   = ctx.createGain();
    const dry     = ctx.createGain();
    const wetG    = ctx.createGain();
    const output  = ctx.createGain();
    dry.gain.value  = 1 - wet;
    wetG.gain.value = wet;

    const sr     = ctx.sampleRate;
    const len    = sr * 1.2; // shorter than chord reverb for responsiveness
    const buf    = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.0);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;

    input.connect(dry);
    input.connect(conv);
    conv.connect(wetG);
    dry.connect(output);
    wetG.connect(output);
    return { input, output };
  }

  // ── Build synth graph ─────────────────────────────────────────────────────

  function buildSynth(ctx: AudioContext, dest: AudioNode): SynthNodes {
    // --- Oscillators ---
    const osc1 = ctx.createOscillator();
    osc1.type  = "sawtooth";

    const osc2 = ctx.createOscillator();
    osc2.type  = "square";
    osc2.detune.value = 8; // +8 cents

    const osc3 = ctx.createOscillator();
    osc3.type  = "sawtooth";
    // osc3 frequency will be set to 2× osc1 dynamically

    const osc1Gain = ctx.createGain();
    osc1Gain.gain.value = 0.6;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.3;
    const osc3Gain = ctx.createGain();
    osc3Gain.gain.value = 0.15;

    // --- Envelope gain ---
    const envGain = ctx.createGain();
    envGain.gain.value = 0;

    // --- Filters ---
    const bandpass = ctx.createBiquadFilter();
    bandpass.type  = "bandpass";
    bandpass.frequency.value = 1800; // will be updated from brightness
    bandpass.Q.value = 1.5;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type  = "lowpass";
    lowpass.frequency.value = 4000;

    // --- WaveShaper (soft saturation) ---
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(80);
    shaper.oversample = "2x";

    // --- Vibrato LFO ---
    const lfo     = ctx.createOscillator();
    lfo.type      = "sine";
    lfo.frequency.value = VIBRATO_RATE_HZ;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0; // set dynamically from vibratoAmount

    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfoGain.connect(osc2.frequency);
    lfoGain.connect(osc3.frequency);

    // --- Breath noise ---
    const noiseLen    = ctx.sampleRate * 2;
    const noiseBuf    = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData   = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuf;
    noiseSource.loop   = true;
    const noiseFilter  = ctx.createBiquadFilter();
    noiseFilter.type   = "bandpass";
    noiseFilter.frequency.value = 800;
    noiseFilter.Q.value = 0.8;
    const noiseGain    = ctx.createGain();
    noiseGain.gain.value = 0.03;
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);

    // --- Reverb ---
    const reverb = buildReverb(ctx, 0.18);

    // --- Master output ---
    const masterGain = ctx.createGain();
    masterGain.gain.value = outputGainRef.current;

    // --- Voice pass-through (for rawVoiceMonitor) ---
    const voicePassGain = ctx.createGain();
    voicePassGain.gain.value = 0; // off by default

    // --- Wire signal chain ---
    // Oscs → osc gains → envGain → bandpass → lowpass → shaper → reverb → master → dest
    osc1.connect(osc1Gain);
    osc2.connect(osc2Gain);
    osc3.connect(osc3Gain);
    osc1Gain.connect(envGain);
    osc2Gain.connect(envGain);
    osc3Gain.connect(envGain);
    noiseGain.connect(envGain);

    envGain.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(shaper);
    shaper.connect(reverb.input);
    reverb.output.connect(masterGain);
    masterGain.connect(dest);

    voicePassGain.connect(dest);

    // Start oscillators + noise
    osc1.start();
    osc2.start();
    osc3.start();
    lfo.start();
    noiseSource.start();

    return {
      ctx, osc1, osc2, osc3,
      noiseSource, noiseGain,
      envGain,
      bandpass, lowpass, shaper,
      lfo, lfoGain,
      reverbInput: reverb.input, reverbOutput: reverb.output,
      masterGain, voicePassGain,
    };
  }

  // ── Pitch→note name ──────────────────────────────────────────────────────

  function freqToNoteName(freq: number): string {
    if (freq <= 0) return "—";
    const midi    = Math.round(12 * Math.log2(freq / 440) + 69);
    const names   = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
    const octave  = Math.floor(midi / 12) - 1;
    return names[((midi % 12) + 12) % 12] + octave;
  }

  // ── Update synth parameters (hot-path, called every detected frame) ───────

  function applySynthParams(nodes: SynthNodes, freq: number, conf: number) {
    const ctx  = nodes.ctx;
    const now  = ctx.currentTime;

    // Bandpass center: 1200 Hz at brightness=0, 3500 Hz at brightness=1
    const bpFreq = 1200 + brightnessRef.current * 2300;
    nodes.bandpass.frequency.setTargetAtTime(bpFreq, now, 0.05);

    // Vibrato LFO gain — convert semitones to Hz at current frequency
    const semitoneHz   = freq * (Math.pow(2, 1 / 12) - 1);
    const vibratoDepth = vibratoRef.current * semitoneHz;
    nodes.lfoGain.gain.setTargetAtTime(vibratoDepth, now, 0.1);

    // Master gain
    nodes.masterGain.gain.setTargetAtTime(outputGainRef.current, now, 0.05);

    // Voice monitor
    nodes.voicePassGain.gain.setTargetAtTime(voiceMonRef.current ? 0.2 : 0, now, 0.05);

    // Confidence / silence → envelope
    if (conf >= CONFIDENCE_THRESH && freq >= MIN_FREQ && freq <= MAX_FREQ) {
      // Update oscillator frequencies
      nodes.osc1.frequency.setTargetAtTime(freq, now, 0.01);
      nodes.osc2.frequency.setTargetAtTime(freq, now, 0.01);
      nodes.osc3.frequency.setTargetAtTime(freq * 2, now, 0.01); // octave up

      if (!soundingRef.current) {
        // Attack
        nodes.envGain.gain.cancelScheduledValues(now);
        nodes.envGain.gain.setValueAtTime(nodes.envGain.gain.value, now);
        nodes.envGain.gain.linearRampToValueAtTime(1, now + ATTACK_TIME_S);
        soundingRef.current = true;
        setIsActive(true);
      }
    } else {
      // Release — fade out
      if (soundingRef.current) {
        nodes.envGain.gain.cancelScheduledValues(now);
        nodes.envGain.gain.setValueAtTime(nodes.envGain.gain.value, now);
        nodes.envGain.gain.linearRampToValueAtTime(0, now + RELEASE_TIME_S);
        soundingRef.current = false;
        setIsActive(false);
      }
    }
  }

  // ── Pitch detection RAF loop ──────────────────────────────────────────────

  const runPitchLoop = useCallback(() => {
    const analyser = analyserRef.current;
    const nodes    = synthRef.current;
    if (!analyser || !nodes) return;

    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);

    const rms = computeRMS(buf);
    setInputLevel(rms);

    if (rms < SILENCE_RMS_THRESH) {
      // Silence — fade out
      applySynthParams(nodes, smoothedFreqRef.current, 0);
      setConfidence(0);
      setDetectedNote(null);
      setDetectedFreq(0);
    } else {
      const { freq, confidence: conf } = yinPitch(buf, nodes.ctx.sampleRate);

      if (conf > 0) {
        // EMA smooth
        smoothedFreqRef.current =
          PITCH_SMOOTH_ALPHA * freq + (1 - PITCH_SMOOTH_ALPHA) * (smoothedFreqRef.current || freq);
      }

      setConfidence(conf);
      if (conf >= CONFIDENCE_THRESH && smoothedFreqRef.current >= MIN_FREQ && smoothedFreqRef.current <= MAX_FREQ) {
        setDetectedFreq(smoothedFreqRef.current);
        setDetectedNote(freqToNoteName(smoothedFreqRef.current));
      }

      applySynthParams(nodes, smoothedFreqRef.current, conf);
    }

    rafRef.current = requestAnimationFrame(runPitchLoop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wire up mic stream ────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled || !micStream || !destNode) {
      // Tear down if disabled
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (synthRef.current) {
        const nodes = synthRef.current;
        nodes.osc1.stop();
        nodes.osc2.stop();
        nodes.osc3.stop();
        nodes.lfo.stop();
        nodes.noiseSource.stop();
        synthRef.current = null;
      }
      if (ctxRef.current) {
        ctxRef.current.close();
        ctxRef.current = null;
      }
      analyserRef.current  = null;
      micSourceRef.current = null;
      setIsActive(false);
      return;
    }

    // Build new context + graph
    const ctx      = new AudioContext();
    ctxRef.current = ctx;

    const analyser         = ctx.createAnalyser();
    analyser.fftSize       = 2048;
    analyser.smoothingTimeConstant = 0; // we do our own smoothing
    analyserRef.current    = analyser;

    const micSource          = ctx.createMediaStreamSource(micStream);
    micSourceRef.current     = micSource;
    micSource.connect(analyser);

    // Connect mic to voice pass-through as well (wired in buildSynth)
    const nodes = buildSynth(ctx, destNode);
    synthRef.current = nodes;

    // Also connect mic directly to voicePassGain (for rawVoiceMonitor)
    micSource.connect(nodes.voicePassGain);

    // Start pitch loop
    rafRef.current = requestAnimationFrame(runPitchLoop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      try {
        nodes.osc1.stop();
        nodes.osc2.stop();
        nodes.osc3.stop();
        nodes.lfo.stop();
        nodes.noiseSource.stop();
      } catch { /* already stopped */ }
      ctx.close();
      ctxRef.current       = null;
      synthRef.current     = null;
      analyserRef.current  = null;
      micSourceRef.current = null;
      setIsActive(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, micStream, destNode]);

  return {
    // Detected pitch info
    detectedNote,
    detectedFreq,
    confidence,
    inputLevel,
    isActive,
    // Parameters
    brightness,
    setBrightness,
    vibratoAmount,
    setVibratoAmount,
    outputGain,
    setOutputGain,
    // Voice monitoring
    rawVoiceMonitor,
    setRawVoiceMonitor,
  };
}
