# Verses — Project Overview

## What Was Built

Verses is a browser-native songwriting and performance workbench. The core product decision is that **writing and performance are one session**, not separate apps.

### Writing
- Distraction-free lyric editor with autosave, version history, and structure tags
- Per-word rhyme finder via Datamuse (perfect, near, sounds-like)
- **Rhyme Lens**: inline editor highlighting — highlights appear directly behind text in the editor, showing end rhymes, internal rhymes, multisyllabic chains, compound rhymes, slant/near rhymes, assonance, consonance, alliteration, repetition, cross-line echoes, and weak lines. Each sound family gets a distinct color. Sound Map panel shows metrics and clickable family list (click to isolate). Three density modes (Clean/Detailed/Max). Debounced, deterministic, no external API. See `docs/rhyme-lens-test-plan.md` for test cases.
- OCR: photograph handwritten lyrics, paste into editor
- Export as text / copy / print

### Takes (Recording Hub)
The New Take flow is the unified entry point for all recording and performance features. When creating a take, the user chooses a **Performance Layer**:

- **Normal** — raw mic or video+audio take with teleprompter
- **Hand Gestures** — adds gesture-controlled drum machine and chord synth
- **Live Trumpet** — adds real-time voice-to-brass synthesis
- **Gestures + Trumpet** — both layers simultaneously

This architecture replaces the old model where Perform Mode was a disconnected separate modal.

### Hand Gesture Performance Layer
- MediaPipe Hand Landmarker (WASM, in-browser, no server)
- **Left hand (latched transport)**: hold open palm 400ms → beat latches on; fist → stops; pinch → mutes/unmutes. Beat continues playing after hand leaves frame.
- **Right hand (8-slot chord system)**: open palm + 4 horizontal zones → slots 1–4; two fingers + 4 zones → slots 5–8; fist = silence; pinch = sustain
- Beat source: procedural drums (5 presets) or YouTube beat (via window event bridge)
- **Drum BPM**: adjustable live between 50–200 BPM via +/− controls during performance setup or playback
- Improved gesture reading: 8-frame history buffer, EMA-smoothed wrist position, zone hysteresis, per-action cooldowns
- Camera overlay: optional zone grid, hand skeleton, gesture labels, active zone highlight
- **Camera view**: significantly enlarged when hand gestures are active — 500px column width, 1200px modal — with "Keep both hands inside the frame" instruction

### Live Voice-to-Trumpet
- Browser-native real-time voice transformation
- Pitch detection (YIN / autocorrelation) on mic stream, low-latency mode
- Multi-oscillator trumpet synthesis: saw + square layers, bandpass filter (brightness-controlled), light reverb, breath noise
- Smooth fade-in/out (no random pitch jumps during silence)
- 5 presets: Trumpet Sketch, Muted Trumpet, Brass Section, Soft Flugelhorn, Synth Brass
- Captured in take recording alongside chord/drum layers

### Smart Lyric Follow
- Active during any recording take
- Three modes: Smart, Pace, Manual
- Smart mode: Web Speech API, continuous recognition, fuzzy matching against lyric lines, forward-only advance
- Graceful fallback to Pace if speech recognition unavailable or low confidence
- Manual up/down nudge always available

### Playable Piano
- Interactive keyboard in the performance view of New Take
- Click/touch/keyboard to play notes (A-J = white keys, W E T Y U = black keys)
- Octave shift up/down with range label
- Active notes highlighted in amber
- No stuck notes on blur, pointer cancel, or modal close

### Voice to Score (standalone)
- Record a hummed melody, analyze with YIN pitch detection
- Piano roll canvas with confidence coloring
- Re-analyze button, original-recording playback, JSON/text export

### Beats (YouTube Bar)
- Paste any YouTube URL to play in the bottom bar
- A/B loop, named markers, keyboard shortcut (⌘P)
- Window event bridge for control from performance layers
- **Auto-play on Record start**: when a YouTube beat is loaded and selected, it auto-plays at the start of a recording across all four performance layer modes (Normal, Hand Gestures, Live Trumpet, Gestures + Trumpet)
- **Replace**: a Replace button in the bottom bar clears the current beat, resets all markers and loop points, and lets the user load a new URL cleanly

---

## Architecture

### How It Works

#### Recording Hub (RecorderModal)
RecorderModal owns the recording session. All performance hooks are initialized inside it and route their audio to a shared `MediaStreamDestinationNode`. The final take blob includes the mixed audio from:
- Raw microphone
- Chord synth output (if hand layer active)
- Drum output (if hand layer + drums selected)
- Trumpet synth output (if trumpet layer active)
- Camera video track (if record video is checked)

YouTube audio is not capturable due to browser cross-origin restrictions. This is documented clearly in the UI.

#### Latched Transport State Machine
```
stopped → (hold open palm 400ms) → playing → (hold fist 400ms) → stopped
playing → (hold pinch 400ms) → muted → (hold pinch 400ms) → playing
```
Beat state persists independently of hand presence.

#### Zone-Based Chord System
Right-hand wrist X position → zone 0–3 (with hysteresis).
```
open palm: zone → slot 1/2/3/4
two fingers: zone → slot 5/6/7/8
fist: silence
```
Zone transitions use a committed-zone ref that only updates when movement > 0.08 units.

#### Gesture Stability
Each hand maintains an 8-frame history buffer. A gesture is only "committed" when it appears in 5 of the last 8 frames. This eliminates single-frame misdetections and prevents chord spamming.

#### Audio Routing Architecture
Chords and drums share a single `AudioContext` and play simultaneously without routing conflicts.

```
Mic stream
  ├→ AnalyserNode (level meter)
  ├→ AnalyserNode (pitch detection → trumpet synth → recDest)
  └→ MediaStreamSource → (if rawVoice enabled) → recDest

Drum engine → masterGain → compressor → recDest   ┐ shared AudioContext
Chord synth → reverb → recDest                    ┘

recDest.stream + [camera videoTrack] → MediaRecorder → blob → IndexedDB
```

#### File Structure (key components)
```
src/
  components/editor/
    RecorderModal.tsx     — unified recording + performance hub
    PerformModal.tsx      — thin wrapper, redirects to RecorderModal
    RhymeLens.tsx         — whole-draft rhyme analysis panel
    PlayablePiano.tsx     — interactive keyboard component
    VoiceToScoreModal.tsx — standalone melody transcription
    YoutubeBar.tsx        — YouTube player + window event bridge
    TakesPanel.tsx        — takes list / playback
    Editor.tsx            — main orchestrator
  hooks/
    perform/
      useDrumEngine.ts    — drum machine hook
      useChordSynth.ts    — chord synth hook
      useHandTracking.ts  — MediaPipe gesture tracking hook
      useLiveTrumpet.ts   — real-time trumpet synthesis hook
      index.ts            — barrel exports
```

---

## YouTube Recording Limitation

When the beat source is set to YouTube, browser security restrictions (cross-origin isolation, CORS on media elements) prevent the YouTube audio from being routed into the MediaRecorder pipeline. The take recording captures:
- The user's voice/mic
- The synthesized chord and drum audio
- The trumpet synthesis output

The YouTube audio plays through the device speakers and is only included in the recording if the user's microphone picks it up from the room — similar to how a phone recording in a studio captures the room sound.

This is not a bug. The UI labels this clearly.

---

## Limitations

- **YouTube recording**: see above
- **Smart Lyric Follow**: sung words are harder to transcribe than spoken; the feature is best-effort, with pace/manual fallback
- **Trumpet synthesis**: browser-native multi-oscillator model; not a studio AI voice model
- **Hand tracking**: best in Chrome desktop, 50–100ms latency typical
- **Pitch detection**: works best with clean monophonic vocals
- **Mobile**: editor works; performance layers not optimized for mobile

---

## Future Work

- MIDI keyboard input
- Sample-based drum sounds (vs. procedural)
- Export chord progressions to MIDI
- Supabase-backed take storage (sync across devices)
- Offline PWA with service worker
