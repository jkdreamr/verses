# Verses — Refinement Plan (round 3)

Continued pass toward a ship-ready app. Re-derived from the current repo (HEAD
`367aeda`). Baseline `npm test` 30/30.

## Headline: Perform chord-placement grid (visible live, excluded from recording)

**Current Perform reality (re-read).** `PerformModal.tsx`:
- A `<video>` (CSS-mirrored) is the camera; a single overlay `<canvas>` (CSS-mirrored)
  draws the MediaPipe skeleton. HUD badges are DOM.
- `startRecording` records **audio only** — `new MediaRecorder(engine.recordDest.stream)`
  → `has_video:false`. There is no video capture today.
- Right-hand X→action mapping (the grid must mirror this exactly):
  - chord mode: `idx = floor(hand.x * chordSlots.length)` → 8 bands, labelled
    `chordLabel(root,quality)`.
  - lead mode: `xToScaleMidi(hand.x, …)` → a scale ladder (`buildScaleLadder(root,scale,48,84)`),
    each band a note name. `hand.x` is display space (`1 − rawWristX`).

**Plan (layered canvas).**
- `captureCanvas` (the recorded layer): each frame draw the **mirrored video** +
  skeleton + note-trigger flashes. `captureCanvas.captureStream(30)` → video track,
  combined with `engine.recordDest.stream` audio track into one `MediaStream` →
  `MediaRecorder` (video mime) → video take (`has_video:true`). Audio-only path kept for
  touch mode (no camera).
- `gridCanvas` (live overlay, **never** drawn onto the capture canvas): vertical zone
  dividers + labels derived from the *real* mapping above, active-zone highlight from
  `rightHand.x`, reflects key/scale + progression. A show/hide toggle (default on),
  reduced-motion aware, rescales on resize.
- Both canvases are 640×480 internally and stretch to the stage, so the capture buffer,
  the grid, and the DOM HUD all map `0..1 → 0..width` identically (perfect alignment).
- Verify: the grid is drawn ONLY on `gridCanvas`; the capture stream comes ONLY from
  `captureCanvas` → guides can't bleed into a recording.

## Other sections (mostly landed in round 2 — verify + lighter touches)

- **Trumpet** (`useLiveTrumpet.ts`): already sampled + MPM worklet + median/hysteresis +
  RMS→velocity & brightness + Live/Convert. Verify loading state; smooth release/legato.
- **Smart Lyric Reader** (`lyricAlign.ts`, `RecorderModal.tsx`): windowed fuzzy +
  Soundex + **Metaphone** + Levenshtein + Pace badge already in. Confirm solid.
- **Voice Score** (`voiceScore.ts`): tuned basic-pitch, YIN octave cross-check, chroma
  chords, phase-align BPM already in. Add a visible low-confidence flag if missing.
- **UI polish**: states/loading/empty/error, a11y, mobile — wherever rough.

## Files I WILL change

`src/components/editor/PerformModal.tsx` (capture+grid canvases, video recording, toggle),
maybe a small `src/components/perform/ChordGrid` helper, `src/lib/types.ts` (no change
needed — `has_video` exists). Light edits to `useLiveTrumpet.ts`, `VoiceToScoreModal.tsx`.
`README.md`. `docs/REFINE_PLAN.md`.

## Files I will NOT touch

Rhyme Lens engine + components (`rhymeLens.ts`, `phonetics.ts`, `datamuse.ts`,
`RhymeLens.tsx`, `RhymePanel.tsx`, `scripts/test-rhyme-engine.ts`); storage/auth/routing.

## Guardrails

Build + lint green after each section; `npm test` stays 30/30; guest mode; lazy libs.
Commit per section; push to main at the end.
