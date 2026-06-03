"use client";

import { useEffect, useRef, useState } from "react";
import type { NoteEvent } from "@/lib/music/voiceScore";
import type { ChordHit, KeyInfo } from "@/lib/music/voiceScore";

// ───────────────────────────────────────────────────────────────────────────
// Real sheet-music rendering with VexFlow (lazy-loaded). Treble clef, key + time
// signature, auto-beamed notes packed into 4/4 measures with chord symbols above.
// ───────────────────────────────────────────────────────────────────────────

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function midiToVexKey(midi: number, useFlat: boolean): { key: string; acc: string | null } {
  const pc = ((midi % 12) + 12) % 12;
  const name = (useFlat ? FLAT : SHARP)[pc];
  const octave = Math.floor(midi / 12) - 1;
  const letter = name[0].toLowerCase();
  const acc = name.length > 1 ? name.slice(1) : null;
  return { key: `${letter}${acc ?? ""}/${octave}`, acc };
}

function durToVex(durationBeats: number): { d: string; beats: number } {
  if (durationBeats >= 3.5) return { d: "w", beats: 4 };
  if (durationBeats >= 1.5) return { d: "h", beats: 2 };
  if (durationBeats >= 0.75) return { d: "q", beats: 1 };
  if (durationBeats >= 0.375) return { d: "8", beats: 0.5 };
  return { d: "16", beats: 0.25 };
}

export function StaffView({
  notes,
  keyInfo,
  chords,
  bpm,
}: {
  notes: NoteEvent[];
  keyInfo: KeyInfo | null;
  chords: ChordHit[];
  bpm: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const host = hostRef.current;
      if (!host) return;
      host.innerHTML = "";
      if (notes.length === 0) return;
      try {
        const VF = await import("vexflow");
        if (disposed) return;
        const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam } = VF;

        const useFlat = keyInfo?.accidental === "flat";
        const beat = 60 / bpm;

        // Pack notes into 4-beat measures.
        type VN = { sn: InstanceType<typeof StaveNote>; beats: number; startTime: number };
        const measures: VN[][] = [];
        let cur: VN[] = [];
        let acc = 0;
        for (const n of notes) {
          const { d, beats } = durToVex(n.duration / beat);
          const { key, acc: accidental } = midiToVexKey(n.midi, useFlat);
          const sn = new StaveNote({ keys: [key], duration: d, clef: "treble" });
          if (accidental) sn.addModifier(new Accidental(accidental), 0);
          if (acc + beats > 4 && cur.length) { measures.push(cur); cur = []; acc = 0; }
          cur.push({ sn, beats, startTime: n.startTime });
          acc += beats;
        }
        if (cur.length) measures.push(cur);

        // Layout
        const perLine = 4;
        const mW = 260;
        const lineH = 130;
        const totalW = Math.min(perLine, measures.length) * mW + 30;
        const lines = Math.ceil(measures.length / perLine);
        const renderer = new Renderer(host, Renderer.Backends.SVG);
        renderer.resize(totalW, lines * lineH + 30);
        const ctx = renderer.getContext();
        // theme to the app's ink palette
        const ink = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
        const stroke = ink ? `rgb(${ink})` : "#222";
        ctx.setStrokeStyle(stroke);
        ctx.setFillStyle(stroke);

        measures.forEach((m, i) => {
          const col = i % perLine;
          const row = Math.floor(i / perLine);
          const x = 10 + col * mW;
          const y = 10 + row * lineH;
          const stave = new Stave(x, y, mW);
          if (col === 0 && row === 0) {
            stave.addClef("treble").addTimeSignature("4/4");
            if (keyInfo?.vexKey) {
              try { stave.addKeySignature(keyInfo.mode === "minor" ? keyInfo.vexKey.replace("m", "") + "m" : keyInfo.vexKey); } catch { /* */ }
            }
          } else if (col === 0) {
            stave.addClef("treble");
          }
          stave.setContext(ctx).draw();

          const vnotes = m.map((v) => v.sn);
          const voice = new Voice({ num_beats: 4, beat_value: 4 }).setStrict(false);
          voice.addTickables(vnotes);

          // chord symbols above measure-starting notes
          m.forEach((v, j) => {
            const hit = chords.find((c) => Math.abs(c.startTime - v.startTime) < beat * 0.6);
            if (hit) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const Annotation = (VF as any).Annotation;
              if (Annotation) {
                const ann = new Annotation(hit.symbol);
                ann.setFont("Inter, sans-serif", 11, "600");
                if (Annotation.VerticalJustify) ann.setVerticalJustification(Annotation.VerticalJustify.TOP);
                vnotes[j].addModifier(ann, 0);
              }
            }
          });

          const beams = Beam.generateBeams(vnotes);
          new Formatter().joinVoices([voice]).format([voice], mW - 40);
          voice.draw(ctx, stave);
          beams.forEach((b) => b.setContext(ctx).draw());
        });
        setError(null);
      } catch (e) {
        console.warn("[StaffView] render failed:", e);
        if (!disposed) setError("Could not render the staff.");
      }
    })();
    return () => { disposed = true; };
  }, [notes, keyInfo, chords, bpm]);

  return (
    <div className="w-full overflow-x-auto rounded-lg bg-white p-3">
      {error ? <div className="p-4 text-sm text-danger">{error}</div> : <div ref={hostRef} />}
    </div>
  );
}
