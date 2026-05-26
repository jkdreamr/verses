import { useCallback, useEffect, useRef, useState } from "react";
import { detectPitchYIN, computeRMS } from "@/lib/pitchDetection";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrumpetPreset = {
  name: string;
  brightness: number;       // 0–1: controls formant center / harmonic content
  vibratoAmount: number;    // semitones of pitch deviation
  vibratoDelay: number;     // seconds before vibrato fades in after note onset
  outputGain: number;       // 0–1 master output level
  portamento: number;       // 0–1: pitch glide speed (0=instant, 1=slow glide)
  breathiness: number;      // 0–1: amount of noise/breath in signal
  attackBurst: number;      // 0–1: brightness burst on attack (mimics brass "blat")
  dynamicFollow: number;    // 0–1: how much output follows input dynamics
  description: string;
};

// ─── Presets (softer defaults) ───────────────────────────────────────────────

export const TRUMPET_PRESETS: TrumpetPreset[] = [
  {
    name: "Trumpet Sketch",
    brightness: 0.45,
    vibratoAmount: 0.2,
    vibratoDelay: 0.35,
    outputGain: 0.55,
    portamento: 0.06,
    breathiness: 0.12,
    attackBurst: 0.25,
    dynamicFollow: 0.5,
    description: "Clean trumpet with natural expression",
  },
  {
    name: "Muted Trumpet",
    brightness: 0.18,
    vibratoAmount: 0.12,
    vibratoDelay: 0.4,
    outputGain: 0.45,
    portamento: 0.12,
    breathiness: 0.05,
    attackBurst: 0.08,
    dynamicFollow: 0.7,
    description: "Dark harmon-mute character",
  },
  {
    name: "Brass Section",
    brightness: 0.6,
    vibratoAmount: 0.15,
    vibratoDelay: 0.25,
    outputGain: 0.55,
    portamento: 0.03,
    breathiness: 0.08,
    attackBurst: 0.35,
    dynamicFollow: 0.3,
    description: "Full brass chorus",
  },
  {
    name: "Soft Flugelhorn",
    brightness: 0.25,
    vibratoAmount: 0.3,
    vibratoDelay: 0.5,
    outputGain: 0.50,
    portamento: 0.15,
    breathiness: 0.2,
    attackBurst: 0.04,
    dynamicFollow: 0.6,
    description: "Warm, mellow, breathy horn",
  },
  {
    name: "Synth Brass",
    brightness: 0.7,
    vibratoAmount: 0.0,
    vibratoDelay: 0,
    outputGain: 0.50,
    portamento: 0.0,
    breathiness: 0.0,
    attackBurst: 0.5,
    dynamicFollow: 0.2,
    description: "Punchy electronic brass",
  },
  {
    name: "Miles Lead",
    brightness: 0.35,
    vibratoAmount: 0.18,
    vibratoDelay: 0.6,
    outputGain: 0.50,
    portamento: 0.2,
    breathiness: 0.25,
    attackBurst: 0.1,
    dynamicFollow: 0.8,
    description: "Intimate jazz trumpet, breathy & dynamic",
  },
];

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_THRESH  = 0.3;
const MIN_FREQ           = 80;
const MAX_FREQ           = 900;
const PITCH_SMOOTH_ALPHA = 0.12;
const ATTACK_TIME_S      = 0.008;
const RELEASE_TIME_S     = 0.08;
const VIBRATO_RATE_HZ    = 5.2;
const FORMANT_FREQS      = [1200, 2400, 3800];
const FORMANT_QS         = [3.5, 4.0, 3.0];
const FORMANT_GAINS      = [1.0, 0.5, 0.2];

// ─── WaveShaper curve (soft-clip / tanh approximation) ───────────────────────

function makeSaturationCurve(amount = 200): Float32Array<ArrayBuffer> {
  const n     = 256;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const deg   = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function freqToNoteName(freq: number): string {
  if (freq <= 0) return "--";
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const NOTES = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"];
  const name = NOTES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

// ─── Hook config ──────────────────────────────────────────────────────────────

export type UseLiveTrumpetConfig = {
  micStream: MediaStream | null;
  destNode: AudioNode | null;
  enabled: boolean;
};

// ─── Synth node bundle ─────────────────────────────────────────────────────

type SynthNodes = {
  ctx: AudioContext;
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  osc3: OscillatorNode;
  noiseSource: AudioBufferSourceNode;
  noiseGain: GainNode;
  envGain: GainNode;
  formants: BiquadFilterNode[];
  formantGains: GainNode[];
  bandpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  attackFilter: BiquadFilterNode;
  shaper: WaveShaperNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
  vibratoEnvGain: GainNode;
  reverbInput: GainNode;
  reverbOutput: GainNode;
  masterGain: GainNode;
  voicePassGain: GainNode;
  safetyLimiter: GainNode;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLiveTrumpet({
  micStream,
  destNode,
  enabled,
}: UseLiveTrumpetConfig) {
  // ── Params ──
  const [brightness,      setBrightness]      = useState(0.45);
  const [vibratoAmount,   setVibratoAmount]   = useState(0.2);
  const [outputGain,      setOutputGain]      = useState(0.55);
  const [portamento,      setPortamento]      = useState(0.06);
  const [breathiness,     setBreathiness]     = useState(0.12);
  const [attackBurst,     setAttackBurst]     = useState(0.25);
  const [dynamicFollow,   setDynamicFollow]   = useState(0.5);
  const [vibratoDelay,    setVibratoDelay]    = useState(0.35);
  const [rawVoiceMonitor, setRawVoiceMonitor] = useState(false);

  // ── Detected pitch state ──
  const [detectedNote, setDetectedNote] = useState<string | null>(null);
  const [detectedFreq, setDetectedFreq] = useState<number>(0);
  const [confidence,   setConfidence]   = useState<number>(0);
  const [inputLevel,   setInputLevel]   = useState<number>(0);
  const [isActive,     setIsActive]     = useState<boolean>(false);
  const [error,        setError]        = useState<string | null>(null);

  // ── Internal refs ──
  const ctxRef         = useRef<AudioContext | null>(null);
  const synthRef       = useRef<SynthNodes | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const micSourceRef   = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef         = useRef<number | null>(null);

  const smoothedFreqRef = useRef<number>(0);
  const soundingRef     = useRef<boolean>(false);
  const noteOnsetRef    = useRef<number>(0);
  const smoothedRmsRef  = useRef<number>(0);
  const brightnessRef    = useRef(brightness);
  const vibratoRef       = useRef(vibratoAmount);
  const outputGainRef    = useRef(outputGain);
  const voiceMonRef      = useRef(rawVoiceMonitor);
  const portamentoRef    = useRef(portamento);
  const breathinessRef   = useRef(breathiness);
  const attackBurstRef   = useRef(attackBurst);
  const dynamicFollowRef = useRef(dynamicFollow);
  const vibratoDelayRef  = useRef(vibratoDelay);

  useEffect(() => { brightnessRef.current    = brightness;      }, [brightness]);
  useEffect(() => { vibratoRef.current       = vibratoAmount;   }, [vibratoAmount]);
  useEffect(() => { outputGainRef.current    = outputGain;      }, [outputGain]);
  useEffect(() => { voiceMonRef.current      = rawVoiceMonitor; }, [rawVoiceMonitor]);
  useEffect(() => { portamentoRef.current    = portamento;      }, [portamento]);
  useEffect(() => { breathinessRef.current   = breathiness;     }, [breathiness]);
  useEffect(() => { attackBurstRef.current   = attackBurst;     }, [attackBurst]);
  useEffect(() => { dynamicFollowRef.current = dynamicFollow;   }, [dynamicFollow]);
  useEffect(() => { vibratoDelayRef.current  = vibratoDelay;    }, [vibratoDelay]);

  // ── Build impulse-response reverb ─────────────────────────────────────────

  function buildReverb(ctx: AudioContext, wet: number): { input: GainNode; output: GainNode } {
    const input   = ctx.createGain();
    const dry     = ctx.createGain();
    const wetG    = ctx.createGain();
    const output  = ctx.createGain();
    dry.gain.value  = 1 - wet;
    wetG.gain.value = wet;

    const sr     = ctx.sampleRate;
    const len    = sr * 1.2;
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
    const osc1 = ctx.createOscillator();
    osc1.type  = "sawtooth";

    const osc2 = ctx.createOscillator();
    osc2.type  = "triangle"; // softer than square
    osc2.detune.value = 7;

    const osc3 = ctx.createOscillator();
    osc3.type  = "sawtooth";

    const osc1Gain = ctx.createGain();
    osc1Gain.gain.value = 0.40;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.20;
    const osc3Gain = ctx.createGain();
    osc3Gain.gain.value = 0.08;

    const envGain = ctx.createGain();
    envGain.gain.value = 0;

    const formants: BiquadFilterNode[] = [];
    const formantGains: GainNode[] = [];
    const formantMix = ctx.createGain();
    formantMix.gain.value = 1;

    for (let f = 0; f < FORMANT_FREQS.length; f++) {
      const bp = ctx.createBiquadFilter();
      bp.type = "peaking";
      bp.frequency.value = FORMANT_FREQS[f];
      bp.Q.value = FORMANT_QS[f];
      bp.gain.value = FORMANT_GAINS[f] * 6;
      formants.push(bp);
      const g = ctx.createGain();
      g.gain.value = FORMANT_GAINS[f];
      formantGains.push(g);
    }

    const bandpass = ctx.createBiquadFilter();
    bandpass.type  = "bandpass";
    bandpass.frequency.value = 1600;
    bandpass.Q.value = 1.0;

    const attackFilter = ctx.createBiquadFilter();
    attackFilter.type = "lowpass";
    attackFilter.frequency.value = 2500;
    attackFilter.Q.value = 0.7;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type  = "lowpass";
    lowpass.frequency.value = 4000;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(40);
    shaper.oversample = "2x";

    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = VIBRATO_RATE_HZ;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    const vibratoEnvGain = ctx.createGain();
    vibratoEnvGain.gain.value = 0;

    lfo.connect(lfoGain);
    lfoGain.connect(vibratoEnvGain);
    vibratoEnvGain.connect(osc1.frequency);
    vibratoEnvGain.connect(osc2.frequency);
    vibratoEnvGain.connect(osc3.frequency);

    // Breath noise
    const noiseLen    = ctx.sampleRate * 2;
    const noiseBuf    = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData   = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuf;
    noiseSource.loop   = true;
    const noiseFilter1  = ctx.createBiquadFilter();
    noiseFilter1.type   = "bandpass";
    noiseFilter1.frequency.value = 1200;
    noiseFilter1.Q.value = 0.6;
    const noiseFilter2  = ctx.createBiquadFilter();
    noiseFilter2.type   = "highpass";
    noiseFilter2.frequency.value = 600;
    noiseFilter2.Q.value = 0.4;
    const noiseGain    = ctx.createGain();
    noiseGain.gain.value = breathinessRef.current * 0.10;
    noiseSource.connect(noiseFilter1);
    noiseFilter1.connect(noiseFilter2);
    noiseFilter2.connect(noiseGain);

    // Reverb
    const reverb = buildReverb(ctx, 0.12);

    // Master output with safety limiter gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = outputGainRef.current;

    const safetyLimiter = ctx.createGain();
    safetyLimiter.gain.value = 0.7; // safety ceiling

    // Voice pass-through (for rawVoiceMonitor)
    const voicePassGain = ctx.createGain();
    voicePassGain.gain.value = 0;

    // Wire signal chain
    osc1.connect(osc1Gain);
    osc2.connect(osc2Gain);
    osc3.connect(osc3Gain);
    osc1Gain.connect(envGain);
    osc2Gain.connect(envGain);
    osc3Gain.connect(envGain);
    noiseGain.connect(envGain);

    // Formants in parallel
    for (let f = 0; f < formants.length; f++) {
      envGain.connect(formants[f]);
      formants[f].connect(formantGains[f]);
      formantGains[f].connect(formantMix);
    }
    envGain.connect(formantMix);

    formantMix.connect(bandpass);
    bandpass.connect(attackFilter);
    attackFilter.connect(lowpass);
    lowpass.connect(shaper);
    shaper.connect(reverb.input);
    reverb.output.connect(masterGain);
    masterGain.connect(safetyLimiter);
    safetyLimiter.connect(dest);

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
      formants, formantGains,
      bandpass, lowpass,
      attackFilter,
      shaper,
      lfo, lfoGain, vibratoEnvGain,
      reverbInput: reverb.input, reverbOutput: reverb.output,
      masterGain,
      voicePassGain,
      safetyLimiter,
    };
  }

  // ── Apply synth params per-frame ────────────────────────────────────────

  const applySynthParams = useCallback((nodes: SynthNodes, freq: number, conf: number, rms: number) => {
    const { ctx, osc1, osc2, osc3, envGain, noiseGain, lfoGain, vibratoEnvGain, bandpass, attackFilter, lowpass, masterGain } = nodes;
    const now = ctx.currentTime;

    // Dynamic follow — blend between fixed output and input-dependent gain
    const dynFollow = dynamicFollowRef.current;
    const rmsAlpha = 0.15;
    smoothedRmsRef.current = rmsAlpha * rms + (1 - rmsAlpha) * smoothedRmsRef.current;
    const dynGain = (1 - dynFollow) + dynFollow * Math.min(1, smoothedRmsRef.current * 5);

    // Master output — apply output gain scaled by dynamic follow
    const targetMaster = outputGainRef.current * dynGain;
    masterGain.gain.setTargetAtTime(targetMaster, now, 0.03);

    // Breath noise level
    noiseGain.gain.setTargetAtTime(breathinessRef.current * 0.10, now, 0.05);

    // Brightness — controls filter cutoff and osc3 mix level
    const bright = brightnessRef.current;
    bandpass.frequency.setTargetAtTime(1000 + bright * 1600, now, 0.04);
    lowpass.frequency.setTargetAtTime(2500 + bright * 2500, now, 0.04);

    // Pitch: smooth portamento
    if (conf >= CONFIDENCE_THRESH && freq >= MIN_FREQ && freq <= MAX_FREQ) {
      const port = portamentoRef.current;
      const tc = 0.005 + port * 0.12;

      osc1.frequency.setTargetAtTime(freq, now, tc);
      osc2.frequency.setTargetAtTime(freq, now, tc);
      osc3.frequency.setTargetAtTime(freq * 2, now, tc);

      if (!soundingRef.current) {
        // Note ON
        soundingRef.current = true;
        noteOnsetRef.current = now;
        envGain.gain.cancelScheduledValues(now);
        envGain.gain.setTargetAtTime(0.45, now, ATTACK_TIME_S);
        // Attack burst — open filter wide briefly
        const burst = attackBurstRef.current;
        if (burst > 0) {
          attackFilter.frequency.cancelScheduledValues(now);
          attackFilter.frequency.setValueAtTime(3000 + burst * 3000, now);
          attackFilter.frequency.setTargetAtTime(2500, now + 0.06, 0.04);
        }
      }

      // Vibrato: delayed onset after note start
      const elapsed = now - noteOnsetRef.current;
      const vibDelay = vibratoDelayRef.current;
      const vibAmt = vibratoRef.current;
      if (elapsed > vibDelay && vibAmt > 0) {
        const fadeIn = Math.min(1, (elapsed - vibDelay) / 0.5);
        lfoGain.gain.setTargetAtTime(vibAmt * 20 * fadeIn, now, 0.05);
        vibratoEnvGain.gain.setTargetAtTime(1, now, 0.05);
      } else {
        vibratoEnvGain.gain.setTargetAtTime(0, now, 0.02);
      }
    } else {
      // Note OFF — smooth fade
      if (soundingRef.current) {
        soundingRef.current = false;
        envGain.gain.cancelScheduledValues(now);
        envGain.gain.setTargetAtTime(0, now, RELEASE_TIME_S);
        vibratoEnvGain.gain.setTargetAtTime(0, now, 0.02);
      }
    }
  }, []);

  // ── Pitch detection loop ─────────────────────────────────────────────────

  const runPitchLoop = useCallback(() => {
    const analyser = analyserRef.current;
    const nodes = synthRef.current;
    if (!analyser || !nodes) return;

    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);

    const rms = computeRMS(buf);
    setInputLevel(Math.min(1, rms * 6));

    if (rms > 0.005) {
      const result = detectPitchYIN(buf as Float32Array<ArrayBuffer>, nodes.ctx.sampleRate, {
        yinThreshold: 0.15,
        silenceRms: 0.005,
        noisyFallback: 0.4,
      });
      const freq = result?.freq ?? 0;
      const conf = result?.confidence ?? 0;

      if (conf > 0 && freq > 0) {
        smoothedFreqRef.current =
          PITCH_SMOOTH_ALPHA * freq + (1 - PITCH_SMOOTH_ALPHA) * (smoothedFreqRef.current || freq);
      }

      setConfidence(conf);
      if (conf >= CONFIDENCE_THRESH && smoothedFreqRef.current >= MIN_FREQ && smoothedFreqRef.current <= MAX_FREQ) {
        setDetectedFreq(smoothedFreqRef.current);
        setDetectedNote(freqToNoteName(smoothedFreqRef.current));
        setIsActive(true);
      } else {
        setIsActive(false);
      }

      applySynthParams(nodes, smoothedFreqRef.current, conf, rms);
    } else {
      // Silence
      setIsActive(false);
      applySynthParams(nodes, 0, 0, rms);
    }

    rafRef.current = requestAnimationFrame(runPitchLoop);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySynthParams]);

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
        try { nodes.osc1.stop(); } catch { /* ok */ }
        try { nodes.osc2.stop(); } catch { /* ok */ }
        try { nodes.osc3.stop(); } catch { /* ok */ }
        try { nodes.lfo.stop(); } catch { /* ok */ }
        try { nodes.noiseSource.stop(); } catch { /* ok */ }
        synthRef.current = null;
      }
      // Only close the context if WE created it (not the shared bus)
      if (ctxRef.current && ctxRef.current !== (destNode as AudioNode | null)?.context) {
        try { ctxRef.current.close(); } catch { /* ok */ }
      }
      ctxRef.current = null;
      analyserRef.current  = null;
      micSourceRef.current = null;
      setIsActive(false);
      setError(null);
      return;
    }

    // ── KEY FIX: Use the same AudioContext as the destNode (shared bus) ──
    // This prevents cross-context AudioNode connection errors.
    let ctx: AudioContext;
    try {
      if (destNode.context && "currentTime" in destNode.context) {
        // Reuse shared bus context
        ctx = destNode.context as AudioContext;
      } else {
        // Fallback: create own context (standalone mode)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new Ctx();
      }
      ctxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume();
    } catch (e) {
      setError("Could not initialize audio. Please check browser permissions.");
      console.warn("[useLiveTrumpet] AudioContext init failed:", e);
      return;
    }

    let analyser: AnalyserNode;
    let micSource: MediaStreamAudioSourceNode;
    let nodes: SynthNodes;

    try {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0;
      analyserRef.current = analyser;

      micSource = ctx.createMediaStreamSource(micStream);
      micSourceRef.current = micSource;
      micSource.connect(analyser);

      // Build synth and connect to destNode (same context, safe to connect)
      nodes = buildSynth(ctx, destNode);
      synthRef.current = nodes;

      // Connect mic to voice pass-through
      micSource.connect(nodes.voicePassGain);

      // Start pitch loop
      rafRef.current = requestAnimationFrame(runPitchLoop);
      setError(null);
    } catch (e) {
      setError("Audio setup failed. Try closing other audio apps.");
      console.warn("[useLiveTrumpet] Audio graph build failed:", e);
      return;
    }

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
      // Don't close shared bus context
      if (ctx !== (destNode as AudioNode | null)?.context) {
        try { ctx.close(); } catch { /* ok */ }
      }
      ctxRef.current       = null;
      synthRef.current     = null;
      analyserRef.current  = null;
      micSourceRef.current = null;
      setIsActive(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, micStream, destNode]);

  // ── Apply preset ────────────────────────────────────────────────────────

  const applyPreset = useCallback((preset: TrumpetPreset) => {
    setBrightness(preset.brightness);
    setVibratoAmount(preset.vibratoAmount);
    setVibratoDelay(preset.vibratoDelay);
    setOutputGain(preset.outputGain);
    setPortamento(preset.portamento);
    setBreathiness(preset.breathiness);
    setAttackBurst(preset.attackBurst);
    setDynamicFollow(preset.dynamicFollow);
  }, []);

  return {
    // Detected pitch info
    detectedNote,
    detectedFreq,
    confidence,
    inputLevel,
    isActive,
    error,
    // Parameters
    brightness,
    setBrightness,
    vibratoAmount,
    setVibratoAmount,
    outputGain,
    setOutputGain,
    portamento,
    setPortamento,
    breathiness,
    setBreathiness,
    attackBurst,
    setAttackBurst,
    dynamicFollow,
    setDynamicFollow,
    vibratoDelay,
    setVibratoDelay,
    // Voice monitoring
    rawVoiceMonitor,
    setRawVoiceMonitor,
    // Preset helper
    applyPreset,
  };
}
