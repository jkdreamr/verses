# Verses — Evaluation Guide

## Functionality Status

| Feature | Status | Notes |
|---------|--------|-------|
| Lyric editor + autosave | Working | 10s interval, visibilitychange flush |
| Version history | Working | Cloud + local, 60s snapshot interval |
| Per-word rhyme finder | Working | Datamuse API, 3 tabs, syllable groups |
| **Rhyme Lens** | Working | Inline editor highlights + Sound Map panel |
| Structure tags | Working | 9 presets |
| Export (txt/copy/print) | Working | |
| OCR scan | Working | Tesseract.js WASM |
| YouTube bar | Working | Load, A/B loop, markers, event bridge |
| Takes list | Working | IndexedDB, rename/download/delete |
| Normal audio take | Working | MediaRecorder, review-then-save |
| Normal video take | Working | Camera + mic combined stream |
| **Hand gesture layer** | Working | In New Take → Performance Layers |
| **Live Trumpet layer** | Working | In New Take → Performance Layers |
| **Gestures + Trumpet** | Working | Both layers simultaneously |
| **Smart Lyric Follow** | Working | Web Speech API + pace/manual fallback |
| **Playable piano** | Working | Click/touch/keyboard, octave shift |
| Voice to Score | Working | YIN, piano roll, re-analyze, dual playback |
| Guest mode | Working | All features work without Supabase |

---

## Manual Test Checklist

### Writing & Rhyme Lens

**Test 1: Rhyme Lens toggle + inline highlights**
1. Open any song, write 6+ lines with some rhyming endings (e.g., "night / light / right")
2. Bottom-left of the editor: click **Rhyme Lens**
3. Expected: Sound Map panel slides in from the right. Editor adjusts padding.
4. Expected: highlights appear directly in the editor behind the text (different colors per family)
5. Expected: Sound Map shows metrics (density, end, internal, etc.) and clickable family list
6. Expected: night/light/right grouped as one end rhyme family with one color
7. Click a family in Sound Map → only that family highlighted in the editor
8. Click "Show all" → all families visible again
9. Add more text while panel is open → analysis updates after ~0.4s pause
10. Click toggle again → panel slides out, highlights disappear, editor returns to full width

**Test 2: Per-word rhyme finder still works**
1. Select a word in the editor
2. Expected: "rhymes" tooltip appears above selection
3. Click it → RhymePanel opens from the right
4. Expected: both RhymeLens and RhymePanel can be open at the same time without overlap

---

### New Take — Performance Layers

**Test 3: Normal take (no layers)**
1. Takes → New Take
2. Leave Performance Layers set to "Normal"
3. Record 5 seconds of audio
4. Stop → review → save
5. Expected: take appears in Takes list, plays back correctly

**Test 4: Normal video take**
1. New Take, check "record video"
2. Record → Stop → Save
3. Expected: take labeled "take HH:MM", has video icon in Takes list

**Test 5: Hand Gesture layer — basic**
1. New Take → Performance Layers → "Hand Gestures"
2. Expected: beat source selector (Drums/YouTube), drum preset selector, chord progression selector appear
3. Camera section: "camera will be used for gesture tracking" note visible
4. Set drum preset to "Trap", chord to "R&B"
5. Click Record → grant camera+mic permissions
6. Expected: camera feed appears with zone overlay
7. Hold left open palm for 0.4s → beat starts and keeps looping (latch behavior)
8. Lower hand → beat continues
9. Hold left fist 0.4s → beat stops
10. Right hand in zone 1 with open palm → slot 1 chord plays
11. Right hand in zone 3 with two fingers → slot 7 chord plays
12. Right fist → silence
13. Stop → Save
14. Expected: take saved, drums and chords audible in playback

**Test 6: Hand Gesture — drums stop on close**
1. New Take → Hand Gestures → Record
2. Start drums (left palm hold)
3. Click Cancel or X without stopping recording
4. Expected: drums stop immediately, no background audio continues

**Test 7: Hand Gesture — YouTube beat source**
1. Load a YouTube beat in the editor bar first
2. New Take → Hand Gestures → Beat Source: "YOUTUBE BEAT"
3. Expected: YouTube title appears, no "(no beat loaded)" warning
4. Record → hold left palm → YouTube beat starts playing
5. Expected: UI note about YouTube not being captured in recording

**Test 7a: YouTube beat auto-plays on Record start (all layer modes)**
1. Load a YouTube beat in the editor bar
2. For each of the 4 layer modes (Normal, Hand Gestures, Live Trumpet, Gestures + Trumpet), set Beat Source to YouTube where applicable
3. Click Record in each mode
4. Expected: YouTube beat begins playing automatically at Record start in every mode — no manual trigger required

**Test 7b: YouTube Replace clears markers and loop**
1. Load a YouTube beat; set A/B loop points and add a named marker
2. In the bottom bar, click **Replace**
3. Expected: the current video stops, all markers are cleared, loop points are reset
4. Paste a new YouTube URL
5. Expected: new beat loads cleanly with no leftover markers or loop points from the previous beat

**Test 7c: Drum BPM live adjustment**
1. New Take → Hand Gestures → Beat Source: Drums
2. Note the current BPM value
3. Click **+** BPM button several times while drums are looping
4. Expected: beat audibly speeds up in real time; BPM display reflects the new value
5. Click **−** BPM button to reduce; expected: beat slows down audibly
6. Adjust BPM to the minimum (50) and maximum (200) boundaries
7. Expected: BPM clamps correctly; no crash or audio glitch at boundaries
8. Click Reset (or reload the preset)
9. Expected: BPM returns to the preset's default value

**Test 7d: Chords play while drums are looping**
1. New Take → Hand Gestures → Record
2. Start drums with left palm hold
3. While drums are looping, move right hand into a chord zone (open palm, zone 1–4)
4. Expected: chord plays simultaneously with the drum beat — no dropout, no audio conflict
5. Switch chord zones while drums continue; expected: smooth chord changes with drums uninterrupted

**Test 7e: Camera large enough for two-hand visibility**
1. New Take → Hand Gestures → Record (grant camera permission)
2. Expected: camera panel uses a 500px column width and the modal is ~1200px wide
3. Expected: "Keep both hands inside the frame" instruction is visible
4. Hold both hands in frame simultaneously
5. Expected: both hands are clearly visible in the camera view without needing to crop or zoom out

**Test 8: Live Trumpet layer**
1. New Take → Performance Layers → "Live Trumpet"
2. Expected: preset selector, brightness/vibrato/output sliders appear
3. Expected: headphones warning visible
4. Select "Muted Trumpet"
5. Record → sing into mic
6. Expected: trumpet-like sound follows pitch, stops during silence
7. Expected: no random jumping during silence
8. Stop → Save → play back: trumpet synth audible in recording

**Test 9: Gestures + Trumpet (both layers)**
1. New Take → "Gestures + Trumpet"
2. Expected: compact combined monitor visible during recording
3. Left palm → beat starts
4. Right hand → chords
5. Sing → trumpet follows
6. Expected: all three layers work simultaneously without interference
7. Stop → Save → playback includes all captured layers

**Test 10: Smart Lyric Follow**
1. Write 5+ lines of lyrics
2. New Take → Record (any layer)
3. Teleprompter controls: Mode = [Smart] [Pace] [Manual]
4. If Smart: status shows "● Listening"
5. Speak/sing lyrics clearly → expected: teleprompter advances matching lines in gold
6. Switch to Pace → pace slider appears
7. Switch to Manual → use ↑↓ buttons to nudge
8. Expected: no crash if mic permission is denied for speech recognition
9. Expected: if Smart unavailable, falls back to Pace with a status message

---

### Playable Piano

**Test 11: Piano interaction**
1. New Take → Hand Gestures (or Gestures + Trumpet) → Record
2. Piano keyboard visible in center panel
3. Click a white key → note plays, key highlights in amber
4. Hold key → note sustains
5. Release → note fades
6. Click a black key → plays correct pitch
7. Press keyboard shortcut "A" → C note plays
8. Press "D" → E note plays
9. Click ↑ oct → octave label advances, keys play higher notes
10. Click ↓ oct → back to previous octave
11. Drag across keys → each key plays as pointer enters
12. Close modal → no stuck notes playing

---

### Voice to Score (standalone — still works)

**Test 12: Voice to Score unchanged**
1. Toolbar → "voice score"
2. Record 5s of singing
3. Expected: piano roll shows detected notes
4. Expected: Re-analyze button works
5. Expected: Original recording plays back

---

### Cleanup & Reliability

**Test 13: No stuck audio after modal close**
1. Open New Take, enable Hand Gestures
2. Start recording, start drums, play chords
3. Close modal (X button or Cancel)
4. Expected: complete silence — no drums, no chords, no oscillators

**Test 14: YouTube beat stops on close**
1. Hand Gesture layer, beat source = YouTube
2. Start recording, trigger YouTube beat via left palm
3. Close modal
4. Expected: YouTube beat pauses (verses:beat-pause event dispatched)

---

## Voice to Score Manual Test Cases

| Input | Expected Result |
|-------|----------------|
| Hum "C D E F G" (clear ascending scale) | 5 notes detected, roughly C4 D4 E4 F4 G4 |
| Hold one note for 2 seconds | Single long note, confidence ≥ 0.7 |
| Rest / silence for entire recording | 0 notes detected, no random garbage |
| Fast melodic run (8th notes) | Some notes detected; short notes may be filtered |
| Heavy vibrato on one pitch | Note detected as single pitch (merge pass working) |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Build passes | 0 errors |
| TypeScript strict | 0 type errors |
| Normal take saves correctly | 100% |
| Drums latch correctly (start, persist, stop) | Reliable in demo |
| Drums stop on modal close | 100% |
| No stuck chord notes | 100% |
| Gesture zones stable (no flickering) | No visible flicker in demo |
| Smart Lyric Follow fallback | Graceful if Speech API unavailable |
| Trumpet follows pitch in < 200ms latency | Perceptible responsiveness |
| Rhyme Lens inline highlights | Distinct colors per family, aligned with text |
| Piano playable without stuck notes | 100% |

---

## Known Limitations (Honest)

- **YouTube recording**: captures mic/synth/drum only, not YouTube stream directly
- **Smart Lyric Follow**: sung lyrics harder to recognize than spoken; confidence varies
- **Trumpet synthesis**: browser oscillator model; not studio AI
- **Hand tracking**: ~50–100ms latency; performance degrades in poor lighting
- **Voice to Score**: best with clean monophonic, held notes; fails on chords or noisy input
- **MediaPipe**: may take 2–4 seconds to load model on first use
