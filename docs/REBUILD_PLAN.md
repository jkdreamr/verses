# Verses — Rebuild Plan (Perform · Takes · Voice Score + UI/UX pass)

This document is the Phase 0 output: a map of the current architecture, the exact
files each feature will touch, and the files that must **not** change (Rhyme Lens).
Written after a full read of `src/`, the config, the docs, and a baseline
`npm test` (30/30) + `npm run build` (exit 0).

---

## 1. Current architecture

**Framework.** Next.js 14 App Router + React 18 + TypeScript + Tailwind. Client-only
feature work lives in `"use client"` components. No backend beyond optional Supabase;
guest mode persists songs to `localStorage` and takes to IndexedDB.

**Routing / shell.**
- `src/app/layout.tsx` — fonts (Inter/Lora), theme bootstrap, service worker, `ToastProvider`.
- `src/app/globals.css` — CSS variables for dark/light, range-slider styling, focus rings.
- `src/app/editor/[id]/page.tsx` → `src/components/editor/Editor.tsx` — the workbench.
- `tailwind.config.ts` — `ink.*` + `amber.gold` semantic colors mapped to CSS vars.

**Editor.** `Editor.tsx` owns an exclusive-rail / exclusive-modal state machine and a
layered textarea + highlight mirror. It mounts every feature modal/panel, including
Rhyme Lens. Stats, autosave, versioning, shortcuts live here.

**Perform audio stack (Web Audio, hand-rolled).**
- `hooks/perform/usePerformAudioBus.ts` — singleton bus: `drumGain/chordGain/trumpetGain → masterGain → compressor → limiter → destination (+ MediaStreamDestination tap, + analyser)`. Already has `setTargetAtTime` gain setters. **Good bones — keep the routing idea, port to Tone.**
- `hooks/perform/useDrumEngine.ts` — procedural drum synth (osc/noise) + look-ahead RAF scheduler, 5 presets, swing.
- `hooks/perform/useChordSynth.ts` — **raw-oscillator** chords (the thing to replace with `Tone.Sampler`), 13 instrument presets, 6 progressions, convolver reverb.
- `hooks/perform/useHandTracking.ts` — MediaPipe HandLandmarker loader, EMA smoothing, **zone** (discrete 0–3) model, gesture history. Not actually used by `PerformModal` (which inlines its own copy).
- `hooks/perform/useLiveTrumpet.ts` — **multi-oscillator formant synth** (1200/2400/3800 Hz) driven by YIN. The thing to replace with a sampled trumpet + pitchy.
- `lib/pitchDetection.ts` — shared YIN + RMS + midi helpers.

**Feature UIs.**
- `components/editor/PerformModal.tsx` (1115 lines) — hand-gesture instrument; inlines MediaPipe + a zone-chord/latched-transport mapping; bus gain sliders; **desktop-only** (mobile shows a toast).
- `components/editor/RecorderModal.tsx` (2015 lines) — the Takes hub: getUserMedia + MediaRecorder, MIME fallback chain (already present), layers (none/hand/trumpet/both), `SmartTeleprompter` (word-overlap matcher, ratio≥0.5), `ReviewView`.
- `components/editor/VoiceToScoreModal.tsx` (1800 lines) — YIN sampling → `samplesToNotes` (octave-fix, median smooth, onset, segment, quantize, merge) → piano-roll canvas / note list / (placeholder) staff; MIDI/JSON/CSV export; oscillator playback.
- `components/editor/TakesPanel.tsx`, `PlayablePiano.tsx`, `Toolbar.tsx`, `Modal.tsx`, `Toast.tsx`, `ThemeToggle.tsx` — supporting UI.

**Storage.** `lib/storage.ts` (songs/versions/youtube in localStorage), `lib/takes.ts`
(IndexedDB take store + `formatBytes/formatDuration`), `lib/types.ts`.

**Key problems to fix.**
1. Chords are raw oscillators → thin. Replace with sampled `Tone.Sampler`.
2. Volume sliders write to bus gains but the chord/drum engines keep their own gains too → double control + confusion. Unify on one Tone graph.
3. Perform hand model is discrete zones, not an expressive instrument; no touch fallback; hidden on mobile.
4. Smart lyric follow is coarse (line-level word overlap). Need word-level forced alignment with fuzzy tolerance.
5. Trumpet is synthetic formants. Replace with sampled trumpet + pitchy (McLeod) + AudioWorklet; add Sing-then-Convert.
6. Raw takes use `echoCancellation/noiseSuppression/autoGainControl: true` → muffled. Add a true raw path + post-save self-test.
7. Voice Score: YIN-only, no key/chord inference, no real notation, no MusicXML/PDF.

---

## 2. New dependencies (pinned)

| Package | Version | Use | Load strategy |
|---|---|---|---|
| `tone` | 15.1.x | Audio engine, `Sampler`, `Reverb`, gains | lazy `import()` in a singleton engine module |
| `pitchy` | 4.1.0 | McLeod pitch + clarity (trumpet, VoiceScore fallback) | lazy |
| `@spotify/basic-pitch` | 1.0.1 | Neural note transcription (VoiceScore primary) | lazy; model from jsDelivr CDN |
| `@tensorflow/tfjs` | 4.22.0 | basic-pitch backend | lazy (`--legacy-peer-deps`, peer wants ^3) |
| `@tonejs/midi` | ^2 | basic-pitch peer + MIDI read | lazy |
| `@tonaljs/tonal` | 4.10.0 | key + `Chord.detect`, note math | static ok (pure JS) |
| `vexflow` | 4.2.x | sheet-music staff rendering | lazy in the staff view |

**Samples** vendored under `public/samples/{trumpet,piano,cello}/` from
`nbrosowsky/tonejs-instruments` (verified: real 192 kbps MP3s; sharps use `s`, e.g.
`As4.mp3`; trumpet set is sparse — exact note list captured). `Tone.Sampler`
pitch-shifts between anchors, so a curated sparse set keeps weight ~2–3 MB.

---

## 3. Files to CREATE

- `src/lib/audio/engine.ts` — singleton Tone graph (buses → master → destination + recorder tap), perceptual gain setters, sampler registry, reverb/lowpass. One graph, created once.
- `src/lib/audio/samplers.ts` — sample maps + lazy `Tone.Sampler` factories (piano, warm strings, felt, trumpet) with loading state.
- `src/lib/audio/scales.ts` — key/scale tables, scale-lock helper (X→in-key note), Tonal wrappers.
- `src/lib/audio/oneEuro.ts` — One-Euro / EMA smoothing filter for hand motion.
- `src/lib/music/lyricAlign.ts` — tokenizer + windowed fuzzy forced-alignment matcher (Levenshtein/soundex), pointer advancement.
- `src/lib/music/voiceScore.ts` — pipeline: basic-pitch + YIN fallback, segmentation, quantization, key/chord inference, MIDI/MusicXML builders.
- `src/lib/music/trumpetPitch.worklet.ts` (or inline worklet string) — pitchy in an AudioWorklet.
- `src/components/perform/TouchInstrument.tsx` — multi-touch scale-locked XY pad + chord pads (no-camera path; primary on mobile).
- `src/components/editor/score/StaffView.tsx` — VexFlow staff renderer.
- `docs/REBUILD_PLAN.md` — this file.

## 4. Files to MODIFY per feature

**Feature 1 — Perform**
- `hooks/perform/usePerformAudioBus.ts` → re-implement on the Tone engine (or thin-wrap `engine.ts`).
- `hooks/perform/useChordSynth.ts` → sampled `Tone.Sampler` triggers (keep `chordFrequencies/chordMidiNotes/chordLabel/SLOT_PRESETS` exports — used by RecorderModal too).
- `hooks/perform/useDrumEngine.ts` → route through Tone drum bus (keep presets + scheduler).
- `hooks/perform/useHandTracking.ts` → add continuous XY + pinch + one-euro smoothing (theremin model) alongside existing zone data.
- `components/editor/PerformModal.tsx` → new XY/pinch mapping, touch pad, sampled chords, working sliders, mobile-enabled.

**Feature 2 — Takes**
- `hooks/perform/useLiveTrumpet.ts` → sampled trumpet + pitchy worklet + Live/Sing-then-Convert.
- `components/editor/RecorderModal.tsx` → raw-capture path (DSP off + self-test), new `SmartTeleprompter` using `lyricAlign.ts`, trumpet mode switch.
- `lib/takes.ts` → (maybe) add a self-test helper. `lib/types.ts` unchanged unless needed.

**Feature 3 — Voice Score**
- `components/editor/VoiceToScoreModal.tsx` → call `voiceScore.ts`, add StaffView, chord row, MusicXML/PDF export, Tone sampler playback.
- `lib/pitchDetection.ts` → keep (YIN fallback path).

**Global UI/UX + shell**
- `src/app/globals.css`, `tailwind.config.ts` — design tokens, premium sliders/toggles/buttons, motion, reduced-motion, focus.
- `components/Modal.tsx`, `Toolbar.tsx`, `Toast.tsx`, `TakesPanel.tsx`, `PlayablePiano.tsx`, `ThemeToggle.tsx` — polish + a11y + states.
- `components/editor/Editor.tsx` — give mobile the touch-instrument path instead of the desktop-only toast; harmonize tokens. **Keep the Rhyme Lens wiring identical.**
- `README.md` — full rewrite. `package.json`/`package-lock.json` — deps.

## 5. Files that MUST NOT change (Rhyme Lens — hard constraint)

Byte-for-byte unchanged; re-run `npm test` to prove it:
- `src/lib/rhymeLens.ts`
- `src/lib/phonetics.ts`
- `src/lib/datamuse.ts`
- `src/components/editor/RhymeLens.tsx`
- `src/components/editor/RhymePanel.tsx`
- `scripts/test-rhyme-engine.ts`

`Editor.tsx` imports these — when editing it, the Rhyme Lens props, highlight-mirror
logic, and `buildCharHighlights`/`FAMILY_COLORS` usage stay exactly as-is. Global CSS
token changes must not alter Rhyme Lens's family colors (those come from `RhymeLens.tsx`
constants, not Tailwind, so they're safe). Any shared component I touch (e.g. `Modal`)
must keep its existing API so Rhyme-adjacent panels render identically.

## 6. Guardrails

- Guest mode with **no env vars** keeps working; Supabase stays optional.
- Everything in-browser; **lazy-load** Tone, tfjs/basic-pitch, MediaPipe, VexFlow, samples.
- After each feature: `npm run build` + `npm run lint` clean, `npm test` green.
- Commit in logical chunks; push to `main` at the end.

## 7. Order of work

1. Deps + samples + `engine.ts`/`samplers.ts` foundation.
2. Perform (chords→sampler, sliders, hand XY + touch pad, mobile).
3. Takes (raw fix → lyric align → sampled trumpet).
4. Voice Score (pipeline → staff → chords → exports).
5. Global UI/UX pass.
6. README + final verify + commit/push.
