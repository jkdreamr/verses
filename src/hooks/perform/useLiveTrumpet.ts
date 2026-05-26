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

// ─── Presets ──────────────────────────────────────────────────────────────────

export const TRUMPET_PRESETS: TrumpetPreset[] = [
  {
    name: "Trumpet Sketch",
    brightness: 0.6,
    vibratoAmount: 0.25,
    vibratoDelay: 0.3,
    outputGain: 0.8,
    portamento: 0.05,
    breathiness: 0.15,
    attackBurst: 0.4,
    dynamicFollow: 0.5,
    description: "Clean bright trumpet with natural expression",
  },
  {
    name: "Muted Trumpet",
    brightness: 0.2,
    vibratoAmount: 0.15,
    vibratoDelay: 0.4,
    outputGain: 0.6,
    portamento: 0.1,
    breathiness: 0.05,
    attackBurst: 0.1,
    dynamicFollow: 0.7,
    description: "Dark harmon-mute character",
  },
  {
    name: "Brass Section",
    brightness: 0.8,
    vibratoAmount: 0.2,
    vibratoDelay: 0.2,
    outputGain: 0.9,
    portamento: 0.02,
    breathiness: 0.1,
    attackBurst: 0.6,
    dynamicFollow: 0.3,
    description: "Full brass chorus with bite",
  },
  {
    name: "Soft Flugelhorn",
    brightness: 0.3,
    vibratoAmount: 0.35,
    vibratoDelay: 0.5,
    outputGain: 0.7,
    portamento: 0.15,
    breathiness: 0.25,
    attackBurst: 0.05,
    dynamicFollow: 0.6,
    description: "Warm, mellow, breathy horn",
  },
  {
    name: "Synth Brass",
    brightness: 1.0,
    vibratoAmount: 0.0,
    vibratoDelay: 0,
    outputGain: 0.85,
    portamento: 0.0,
    breathiness: 0.0,
    attackBurst: 0.8,
    dynamicFollow: 0.2,
    description: "Punchy electronic brass",
  },
  {
    name: "Miles Lead",
    brightness: 0.45,
    vibratoAmount: 0.2,
    vibratoDelay: 0.6,
    outputGain: 0.75,
    portamento: 0.2,
    breathiness: 0.3,
    attackBurst: 0.15,
    dynamicFollow: 0.8,
    description: "Intimate jazz trumpet, breathy & dynamic",
  },
];

// ─── YIN pitch detection constants ───────────────────────────────────────────

const CONFIDENCE_THRESH  = 0.3;
const MIN_FREQ           = 80;   // Hz — low end of singing range
const MAX_FREQ           = 900;  // Hz — high end
const PITCH_SMOOTH_ALPHA = 0.12; // EMA weight for new pitch value (lower = smoother)
const ATTACK_TIME_S      = 0.006; // 6 ms — fast brass attack
const RELEASE_TIME_S     = 0.06;  // 60 ms
const VIBRATO_RATE_HZ    = 5.2;  // slightly above 5 for realism
const FORMANT_FREQS      = [1200, 2400, 3800]; // trumpet formant resonances
const FORMANT_QS         = [3.5, 4.0, 3.0];    // Q factors for formants
const FORMANT_GAINS      = [1.0, 0.5, 0.2];    // relative gains

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
  // Formant filters (parallel resonances)
  formants: BiquadFilterNode[];
  formantGains: GainNode[];
  // Filters
  bandpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  // Attack brightness filter (opens on note onset)
  attackFilter: BiquadFilterNode;
  // Saturation
  shaper: WaveShaperNode;
  // Vibrato LFO
  lfo: OscillatorNode;
  lfoGain: GainNode;
  // Vibrato envelope (delayed onset)
  vibratoEnvGain: GainNode;
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
  const [vibratoAmount,   setVibratoAmount]   = useState(0.25);
  const [outputGain,      setOutputGain]      = useState(0.8);
  const [portamento,      setPortamento]      = useState(0.05);
  const [breathiness,     setBreathiness]     = useState(0.15);
  const [attackBurst,     setAttackBurst]     = useState(0.4);
  const [dynamicFollow,   setDynamicFollow]   = useState(0.5);
  const [vibratoDelay,    setVibratoDelay]    = useState(0.3);
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
  // Note onset time (for vibrato delay)
  const noteOnsetRef    = useRef<number>(0);
  // Input RMS tracking for dynamic follow
  const smoothedRmsRef  = useRef<number>(0);
  // Param refs for hot-update without rebuilding graph
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
    osc2.detune.value = 7; // subtle detune for richness

    const osc3 = ctx.createOscillator();
    osc3.type  = "sawtooth";
    // osc3 frequency will be set to 2× osc1 dynamically (brightness overtone)

    const osc1Gain = ctx.createGain();
    osc1Gain.gain.value = 0.55;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.25;
    const osc3Gain = ctx.createGain();
    osc3Gain.gain.value = 0.12;

    // --- Envelope gain ---
    const envGain = ctx.createGain();
    envGain.gain.value = 0;

    // --- Formant resonances (parallel band-peaks that shape brass timbre) ---
    const formants: BiquadFilterNode[] = [];
    const formantGains: GainNode[] = [];
    const formantMix = ctx.createGain(); // sums formant outputs
    formantMix.gain.value = 1;

    for (let f = 0; f < FORMANT_FREQS.length; f++) {
      const bp = ctx.createBiquadFilter();
      bp.type = "peaking";
      bp.frequency.value = FORMANT_FREQS[f];
      bp.Q.value = FORMANT_QS[f];
      bp.gain.value = FORMANT_GAINS[f] * 8; // boost in dB-like range
      formants.push(bp);
      const g = ctx.createGain();
      g.gain.value = FORMANT_GAINS[f];
      formantGains.push(g);
    }

    // --- Main bandpass (overall tonal shaping) ---
    const bandpass = ctx.createBiquadFilter();
    bandpass.type  = "bandpass";
    bandpass.frequency.value = 1800;
    bandpass.Q.value = 1.2;

    // --- Attack brightness filter (opens wide on note onset, then narrows) ---
    const attackFilter = ctx.createBiquadFilter();
    attackFilter.type = "lowpass";
    attackFilter.frequency.value = 3000; // will spike on attack
    attackFilter.Q.value = 0.7;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type  = "lowpass";
    lowpass.frequency.value = 5000;

    // --- WaveShaper (soft saturation) ---
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(60);
    shaper.oversample = "2x";

    // --- Vibrato LFO with envelope (delayed onset) ---
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = VIBRATO_RATE_HZ;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    // Vibrato envelope gain — controls delayed fade-in of vibrato
    const vibratoEnvGain = ctx.createGain();
    vibratoEnvGain.gain.value = 0;

    lfo.connect(lfoGain);
    lfoGain.connect(vibratoEnvGain);
    vibratoEnvGain.connect(osc1.frequency);
    vibratoEnvGain.connect(osc2.frequency);
    vibratoEnvGain.connect(osc3.frequency);

    // --- Breath noise (shaped for realism) ---
    const noiseLen    = ctx.sampleRate * 2;
    const noiseBuf    = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData   = noiseBuf.getChannelData(0);
    // Pink-ish noise (filtered white)
    for (let i = 0; i < noiseLen; i++) noiseData[i] = Math.random() * 2 - 1;
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuf;
    noiseSource.loop   = true;
    // Two-stage breath shaping: bandpass then highpass for air
    const noiseFilter1  = ctx.createBiquadFilter();
    noiseFilter1.type   = "bandpass";
    noiseFilter1.frequency.value = 1200;
    noiseFilter1.Q.value = 0.6;
    const noiseFilter2  = ctx.createBiquadFilter();
    noiseFilter2.type   = "highpass";
    noiseFilter2.frequency.value = 600;
    noiseFilter2.Q.value = 0.4;
    const noiseGain    = ctx.createGain();
    noiseGain.gain.value = breathinessRef.current * 0.15;
    noiseSource.connect(noiseFilter1);
    noiseFilter1.connect(noiseFilter2);
    noiseFilter2.connect(noiseGain);

    // --- Reverb ---
    const reverb = buildReverb(ctx, 0.15);

    // --- Master output ---
    const masterGain = ctx.createGain();
    masterGain.gain.value = outputGainRef.current;

    // --- Voice pass-through (for rawVoiceMonitor) ---
    const voicePassGain = ctx.createGain();
    voicePassGain.gain.value = 0;

    // --- Wire signal chain ---
    // Oscs → osc gains → envGain → formant chain → bandpass → attackFilter → lowpass → shaper → reverb → master → dest
    osc1.connect(osc1Gain);
    osc2.connect(osc2Gain);
    osc3.connect(osc3Gain);
    osc1Gain.connect(envGain);
    osc2Gain.connect(envGain);
    osc3Gain.connect(envGain);
    noiseGain.connect(envGain);

    // Formants in parallel from envGain → formantMix
    for (let f = 0; f < formants.length; f++) {
      envGain.connect(formants[f]);
      formants[f].connect(formantGains[f]);
      formantGains[f].connect(formantMix);
    }
    // Also pass direct signal (blend with formants)
    envGain.connect(formantMix);

    formantMix.connect(bandpass);
    bandpass.connect(attackFilter);
    attackFilter.connect(lowpass);
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
      formants, formantGains,
      bandpass, lowpass,
      attackFilter,
      shaper,
      lfo, lfoGain, vibratoEnvGain,
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

  function applySynthParams(nodes: SynthNodes, freq: number, conf: number, rms: number) {
    const ctx  = nodes.ctx;
    const now  = ctx.currentTime;

    // Smooth RMS for dynamics
    smoothedRmsRef.current = 0.3 * rms + 0.7 * smoothedRmsRef.current;
    const dynamicLevel = Math.min(1, smoothedRmsRef.current * 8); // normalize to ~0-1

    // Bandpass center: 1000 Hz at brightness=0, 4000 Hz at brightness=1
    const bpFreq = 1000 + brightnessRef.current * 3000;
    nodes.bandpass.frequency.setTargetAtTime(bpFreq, now, 0.05);

    // Formant resonances shift slightly with brightness
    const bShift = 1 + (brightnessRef.current - 0.5) * 0.3;
    for (let f = 0; f < nodes.formants.length; f++) {
      nodes.formants[f].frequency.setTargetAtTime(FORMANT_FREQS[f] * bShift, now, 0.08);
    }

    // Vibrato LFO gain — convert semitones to Hz at current frequency
    const semitoneHz   = freq * (Math.pow(2, 1 / 12) - 1);
    const vibratoDepth = vibratoRef.current * semitoneHz;
    nodes.lfoGain.gain.setTargetAtTime(vibratoDepth, now, 0.08);

    // Vibrato delayed onset — ramp vibratoEnvGain based on time since note onset
    if (soundingRef.current && vibratoDelayRef.current > 0) {
      const elapsed = now - noteOnsetRef.current;
      const vibratoEnv = Math.min(1, Math.max(0, (elapsed - vibratoDelayRef.current) / 0.3));
      nodes.vibratoEnvGain.gain.setTargetAtTime(vibratoEnv, now, 0.05);
    } else {
      nodes.vibratoEnvGain.gain.setTargetAtTime(soundingRef.current ? 1 : 0, now, 0.05);
    }

    // Breath noise follows breathiness param
    nodes.noiseGain.gain.setTargetAtTime(breathinessRef.current * 0.15, now, 0.05);

    // Master gain with dynamic follow
    const baseGain    = outputGainRef.current;
    const dynAmount   = dynamicFollowRef.current;
    const dynamicGain = baseGain * (1 - dynAmount + dynAmount * dynamicLevel);
    nodes.masterGain.gain.setTargetAtTime(dynamicGain, now, 0.03);

    // Voice monitor
    nodes.voicePassGain.gain.setTargetAtTime(voiceMonRef.current ? 0.2 : 0, now, 0.05);

    // Portamento: pitch glide speed (time constant for frequency changes)
    const pitchTC = 0.005 + portamentoRef.current * 0.08; // 5ms to 85ms

    // Confidence / silence → envelope
    if (conf >= CONFIDENCE_THRESH && freq >= MIN_FREQ && freq <= MAX_FREQ) {
      // Update oscillator frequencies with portamento
      nodes.osc1.frequency.setTargetAtTime(freq, now, pitchTC);
      nodes.osc2.frequency.setTargetAtTime(freq, now, pitchTC);
      nodes.osc3.frequency.setTargetAtTime(freq * 2, now, pitchTC);

      if (!soundingRef.current) {
        // Note onset — attack with brightness burst
        noteOnsetRef.current = now;
        nodes.envGain.gain.cancelScheduledValues(now);
        nodes.envGain.gain.setValueAtTime(nodes.envGain.gain.value, now);
        nodes.envGain.gain.linearRampToValueAtTime(1, now + ATTACK_TIME_S);

        // Attack burst: temporarily open the attack filter wider
        const burstAmount = attackBurstRef.current;
        const burstFreq = 4000 + burstAmount * 6000; // up to 10kHz on attack
        nodes.attackFilter.frequency.cancelScheduledValues(now);
        nodes.attackFilter.frequency.setValueAtTime(burstFreq, now);
        nodes.attackFilter.frequency.setTargetAtTime(
          3000 + brightnessRef.current * 2000, // settle to brightness-based value
          now + 0.015, // burst lasts ~15ms
          0.04
        );

        // Reset vibrato envelope for delayed onset
        nodes.vibratoEnvGain.gain.cancelScheduledValues(now);
        nodes.vibratoEnvGain.gain.setValueAtTime(0, now);

        soundingRef.current = true;
        setIsActive(true);
      }
    } else {
      // Release — fade out
      if (soundingRef.current) {
        nodes.envGain.gain.cancelScheduledValues(now);
        nodes.envGain.gain.setValueAtTime(nodes.envGain.gain.value, now);
        nodes.envGain.gain.linearRampToValueAtTime(0, now + RELEASE_TIME_S);
        nodes.vibratoEnvGain.gain.setTargetAtTime(0, now, 0.02);
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

    const result = detectPitchYIN(buf, nodes.ctx.sampleRate, {
      yinThreshold: 0.15,
      silenceRms: 0.015,
      noisyFallback: 0.4,
    });

    if (!result) {
      // Silence or unpitched — fade out
      applySynthParams(nodes, smoothedFreqRef.current, 0, rms);
      setConfidence(0);
      setDetectedNote(null);
      setDetectedFreq(0);
    } else {
      const { freq, confidence: conf } = result;

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

      applySynthParams(nodes, smoothedFreqRef.current, conf, result.rms);
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
