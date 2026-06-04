# Verses — Refinement Plan (round 2)

Continuation pass: make each feature genuinely musician-usable and judge-grade.
Builds on the round-1 rebuild (Tone.js engine, samplers, lyric alignment, basic-pitch
Voice Score, VexFlow). Phase 0 re-read the writing surface + reproduced the two visible
editor bugs in the browser.

## Current state + reproductions

- **Rhyme Lens scroll drift (confirmed in browser).** Editor renders a highlight mirror
  `absolute inset-0 overflow-hidden` behind a `height:100%` textarea. Measured at the
  bottom: `textarea.clientHeight = 450` but `mirror.clientHeight = 620` — the textarea's
  `height:100%` resolves *smaller* than the absolutely-positioned mirror, so the mirror's
  scroll range (max 2342) is shorter than the textarea's (max 2512). Syncing
  `mirror.scrollTop = textarea.scrollTop` then clamps → boxes drift up, orphan boxes pool
  at the bottom (screenshotted).
- **Yellow box (confirmed via CSS).** The round-1 global `:where(…textarea…):focus-visible`
  rule paints a 2px accent outline around the whole editor textarea while writing
  (keyboard focus). A full-bleed prose editor shouldn't be ringed.
- **Perform** (`PerformModal.tsx` + `useDrumEngine.ts`): drums are a procedural Web-Audio
  synth with a *read-only* PATTERN preview and an RAF look-ahead scheduler; chords are
  sampled (`useChordSynth` + `samplers.ts`) but switch with a hard release (no
  voice-leading). Sliders route to bus gains.
- **Takes** (`RecorderModal.tsx`, `lyricAlign.ts`, `useLiveTrumpet.ts`): lyric matcher is
  windowed fuzzy (Levenshtein + Soundex); trumpet is sampled + MPM worklet with Live /
  Sing-then-Convert. Both work but can be tightened (metaphone, pitch median/hysteresis,
  brightness-from-RMS).
- **Voice Score** (`VoiceToScoreModal.tsx`, `voiceScore.ts`, `StaffView.tsx`): basic-pitch
  primary + YIN fallback, Krumhansl key, Tonal chords, VexFlow. Detection params are
  defaults; no neural↔YIN cross-check / octave correction; chord inference is set-based,
  not chroma-template.

## Files I WILL change (per section)

1. **Scroll-sync + yellow box** — `src/components/editor/Editor.tsx` (make textarea +
   mirror the same `absolute inset-0` box; sync scroll on scroll/input/resize +
   ResizeObserver), `src/app/globals.css` (exclude `.editor-surface` from the focus ring;
   add `.scrollbar-hide`). **No Rhyme Lens logic/colors touched.**
2. **Perform** — `useDrumEngine.ts` (Tone.Transport/Sequence + sampled kits + editable
   grid state + swing/mute/solo), `PerformModal.tsx` (interactive grid UI, kit picker,
   save/load, playhead), `useChordSynth.ts` (voice-leading: nearest-inversion voicing +
   overlap release), `samplers.ts` (softer ADSR/lowpass/reverb + a synth-pad timbre).
   New: `src/lib/audio/drumKits.ts`, maybe `src/hooks/perform/useStepSequencer.ts`.
3. **Takes** — `lyricAlign.ts` (add double-metaphone, refine windowed alignment),
   `RecorderModal.tsx` (eased scroll already; ensure Pace badge), `useLiveTrumpet.ts`
   (median + hysteresis pitch smoothing, RMS→velocity+brightness).
4. **Voice Score** — `voiceScore.ts` (tuned basic-pitch params, YIN cross-check + octave
   correction, hysteresis merge, onset-envelope BPM, chroma chord templates, confidence
   gating), `VoiceToScoreModal.tsx` (low-confidence visual flags), `StaffView.tsx` tidy.
5. **UI polish + README** — `globals.css`, sequencer/HUD components; extend `README.md`.

## Files I will NOT touch

- Rhyme Lens engine + components: `src/lib/rhymeLens.ts`, `phonetics.ts`, `datamuse.ts`,
  `RhymeLens.tsx`, `RhymePanel.tsx`, `scripts/test-rhyme-engine.ts`. The only editor change
  is scroll/positioning + focus styling — the highlight *data* and colors are untouched.
- Storage, auth, routing, Tauri.

## Guardrails

- `npm run build` + `npm run lint` green after each section; `npm test` (rhyme) stays 30/30.
- Guest mode, no env vars; everything in-browser; heavy libs stay lazy.
- Commit per section; push to main at the end.
