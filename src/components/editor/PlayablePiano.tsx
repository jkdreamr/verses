"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// MIDI note number helpers
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToName(midi: number): string {
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${oct}`;
}

const WHITE_INDICES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_INDICES = [1, 3, -1, 6, 8, 10, -1]; // C# D# gap F# G# A# gap

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function isBlack(noteInOctave: number): boolean {
  return [1, 3, 6, 8, 10].includes(noteInOctave);
}

type ActiveOscillator = {
  osc: OscillatorNode;
  gain: GainNode;
};

export function PlayablePiano({
  octave = 4,
  activeNotes = [],
  onOctaveChange,
  onNoteOn,
  onNoteOff,
  instrumentType = "triangle",
  reverbWet = 0.15,
  destNode = null,
}: {
  octave?: number;
  activeNotes?: number[];
  onOctaveChange?: (oct: number) => void;
  onNoteOn?: (midi: number) => void;
  onNoteOff?: (midi: number) => void;
  instrumentType?: OscillatorType;
  reverbWet?: number;
  destNode?: AudioNode | null;
}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const reverbRef = useRef<ConvolverNode | null>(null);
  const activeOscsRef = useRef<Map<number, ActiveOscillator>>(new Map());
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set());

  // Keyboard octave: show 2 octaves from `octave`
  const startMidi = octave * 12 + 12; // C of the given octave

  const ensureCtx = useCallback(() => {
    if (ctxRef.current) return ctxRef.current;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    ctxRef.current = ctx;

    // Simple reverb using delay feedback
    const convolver = ctx.createConvolver();
    const bufLen = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(2, bufLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < bufLen; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2);
      }
    }
    convolver.buffer = buf;
    reverbRef.current = convolver;
    return ctx;
  }, []);

  const playNote = useCallback((midi: number) => {
    if (activeOscsRef.current.has(midi)) return;
    const ctx = ensureCtx();

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const reverbGain = ctx.createGain();

    osc.type = instrumentType;
    osc.frequency.value = midiToFreq(midi);

    // Slight detune for warmth
    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.value = midiToFreq(midi);
    osc2.detune.value = 7;
    const env2 = ctx.createGain();
    env2.gain.value = 0.3;
    osc2.connect(env2);
    env2.connect(env);

    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.008);

    reverbGain.gain.value = reverbWet;

    const dest = destNode || ctx.destination;
    if (reverbRef.current) {
      env.connect(reverbRef.current);
      reverbRef.current.connect(reverbGain);
      reverbGain.connect(dest);
    }
    env.connect(dest);

    osc.connect(env);
    osc.start(ctx.currentTime);
    osc2.start(ctx.currentTime);

    activeOscsRef.current.set(midi, { osc, gain: env });
    setPressedKeys((prev) => new Set([...prev, midi]));
    onNoteOn?.(midi);
  }, [ensureCtx, instrumentType, reverbWet, destNode, onNoteOn]);

  const releaseNote = useCallback((midi: number) => {
    const entry = activeOscsRef.current.get(midi);
    if (!entry) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { osc, gain } = entry;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.28);
    activeOscsRef.current.delete(midi);
    setPressedKeys((prev) => {
      const next = new Set(prev);
      next.delete(midi);
      return next;
    });
    onNoteOff?.(midi);
  }, [onNoteOff]);

  // Release all on unmount
  useEffect(() => {
    const oscs = activeOscsRef;
    const ctx = ctxRef;
    return () => {
      const audioCtx = ctx.current;
      if (!audioCtx) return;
      oscs.current.forEach(({ osc, gain }) => {
        try {
          gain.gain.cancelScheduledValues(audioCtx.currentTime);
          gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
          osc.stop(audioCtx.currentTime + 0.02);
        } catch {}
      });
      oscs.current.clear();
    };
  }, []);

  // Release all on pointercancel / window blur
  useEffect(() => {
    const releaseAll = () => {
      activeOscsRef.current.forEach((_, midi) => releaseNote(midi));
    };
    window.addEventListener("blur", releaseAll);
    return () => window.removeEventListener("blur", releaseAll);
  }, [releaseNote]);

  // Keyboard shortcuts: A S D F G H J = C D E F G A B; W E = C# D#; T Y U = F# G# A#
  useEffect(() => {
    const KEY_MAP: Record<string, number> = {
      a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
    };
    const pressed = new Set<string>();
    const onDown = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return;
      if (ev.repeat) return;
      const offset = KEY_MAP[ev.key.toLowerCase()];
      if (offset === undefined) return;
      const midi = startMidi + offset;
      pressed.add(ev.key.toLowerCase());
      playNote(midi);
    };
    const onUp = (ev: KeyboardEvent) => {
      const offset = KEY_MAP[ev.key.toLowerCase()];
      if (offset === undefined) return;
      const midi = startMidi + offset;
      pressed.delete(ev.key.toLowerCase());
      releaseNote(midi);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      pressed.forEach((k) => {
        const offset = KEY_MAP[k];
        if (offset !== undefined) releaseNote(startMidi + offset);
      });
    };
  }, [startMidi, playNote, releaseNote]);

  // Build 2-octave key list
  const whites: number[] = [];
  const blacks: { midi: number; whiteIndex: number }[] = [];

  for (let o = 0; o < 2; o++) {
    WHITE_INDICES.forEach((noteIdx) => {
      whites.push(startMidi + o * 12 + noteIdx);
    });
    BLACK_INDICES.forEach((noteIdx, wi) => {
      if (noteIdx === -1) return;
      blacks.push({ midi: startMidi + o * 12 + noteIdx, whiteIndex: o * 7 + wi });
    });
  }

  const totalWhites = whites.length; // 14 for 2 octaves

  const isActive = (midi: number) =>
    pressedKeys.has(midi) || activeNotes.includes(midi);

  return (
    <div className="flex flex-col gap-2 select-none">
      {/* Octave controls */}
      <div className="flex items-center justify-between px-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mute">
          {midiToName(startMidi)}–{midiToName(startMidi + 23)}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onPointerDown={() => onOctaveChange?.(Math.max(1, octave - 1))}
            className="border border-ink-line px-2 py-0.5 font-mono text-[10px] text-ink-mute transition-colors hover:border-ink-text hover:text-ink-text"
            title="Octave down (Z)"
          >
            ↓ oct
          </button>
          <span className="w-10 text-center font-mono text-[10px] text-ink-mute">
            oct {octave}
          </span>
          <button
            type="button"
            onPointerDown={() => onOctaveChange?.(Math.min(7, octave + 1))}
            className="border border-ink-line px-2 py-0.5 font-mono text-[10px] text-ink-mute transition-colors hover:border-ink-text hover:text-ink-text"
            title="Octave up (X)"
          >
            ↑ oct
          </button>
        </div>
      </div>

      {/* Piano */}
      <div
        className="relative overflow-hidden"
        style={{ height: 72 }}
        onPointerLeave={() => {
          // release any notes being dragged over when leaving the piano
        }}
      >
        {/* White keys */}
        <div className="absolute inset-0 flex">
          {whites.map((midi) => {
            const name = NOTE_NAMES[midi % 12];
            const active = isActive(midi);
            const isC = (midi % 12) === 0;
            return (
              <div
                key={midi}
                className="relative flex-1 cursor-pointer"
                style={{ userSelect: "none" }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  playNote(midi);
                }}
                onPointerUp={() => releaseNote(midi)}
                onPointerCancel={() => releaseNote(midi)}
                onPointerEnter={(e) => {
                  if (e.buttons > 0) playNote(midi);
                }}
                onPointerLeave={(e) => {
                  if (e.buttons > 0) releaseNote(midi);
                }}
              >
                <div
                  className={`absolute inset-0 border border-ink-line transition-colors duration-75 ${
                    active
                      ? "bg-amber-gold/80"
                      : "bg-ink-text hover:bg-ink-text/80"
                  }`}
                  style={{
                    borderRadius: "0 0 2px 2px",
                  }}
                />
                {/* Note label: C notes or active */}
                <div
                  className={`absolute bottom-1 left-0 right-0 text-center font-mono leading-none pointer-events-none ${
                    active
                      ? "text-[8px] text-ink font-bold"
                      : isC
                      ? "text-[8px] text-ink-mute/60"
                      : "text-[7px] text-ink-mute/30"
                  }`}
                >
                  {active ? name : isC ? `C${Math.floor(midi / 12) - 1}` : ""}
                </div>
              </div>
            );
          })}
        </div>

        {/* Black keys */}
        {blacks.map(({ midi, whiteIndex }) => {
          const active = isActive(midi);
          // Position: each white key takes (100/totalWhites)%
          // Black key sits between white keys: offset = (whiteIndex + 0.65) * whiteWidth - blackWidth/2
          const whiteWidth = 100 / totalWhites;
          const left = (whiteIndex + 0.65) * whiteWidth;
          return (
            <div
              key={midi}
              className="absolute top-0 z-10 cursor-pointer"
              style={{
                left: `${left}%`,
                width: `${whiteWidth * 0.6}%`,
                height: "55%",
                userSelect: "none",
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                playNote(midi);
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                releaseNote(midi);
              }}
              onPointerCancel={() => releaseNote(midi)}
              onPointerEnter={(e) => {
                if (e.buttons > 0) playNote(midi);
              }}
              onPointerLeave={(e) => {
                if (e.buttons > 0) releaseNote(midi);
              }}
            >
              <div
                className={`h-full w-full transition-colors duration-75 ${
                  active ? "bg-amber-gold" : "bg-ink hover:bg-ink-mute/80"
                }`}
                style={{ borderRadius: "0 0 2px 2px" }}
              />
            </div>
          );
        })}
      </div>

      {/* Keyboard hint */}
      <div className="px-0.5 font-mono text-[9px] text-ink-mute/40">
        A–J plays white keys · W E T Y U play black keys
      </div>
    </div>
  );
}
