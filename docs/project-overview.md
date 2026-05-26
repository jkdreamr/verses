# Verses: A Gesture-Controlled Songwriting Workbench

**Track:** Application/Product + Domain-Specific Music Technology  
**Course project, Spring 2025**

## Problem Statement

Songwriters constantly split their creative process across five or more apps: a notes app for lyrics, YouTube for beats, a rhyme dictionary, voice memos for melodic ideas, and a piano or DAW for harmony. Every switch costs creative momentum. The first hum of a melody, the flow-state where a hook comes together — these moments are fragile. Fragmentation breaks them.

## Core Insight

Most AI music tools try to generate *for* the artist. Verses takes the opposite approach. The artist stays in control. Verses gives them new *embodied* controls — their hands, their voice — for sketching musical ideas without leaving the writing environment.

The thesis: **the artist's body should be the instrument.**

## What Was Built

Verses is a browser-native songwriting and performance workbench. It combines:

1. **Distraction-free lyric editor** — autosave, version history, rhyme finder (Datamuse), structure tags, OCR scan of handwritten pages
2. **YouTube beat player** — paste a link, loop a section, drop markers, sync vocal takes to beats
3. **Vocal takes recorder** — record audio or video takes, save them per song, rename/download/delete
4. **Perform mode (Gesture Instrument)** — webcam hand tracking (MediaPipe) + Web Audio drum engine + chord synth. Beat source is either procedural DRUMS or a YOUTUBE beat loaded in the editor. Left hand controls transport (latched latch-on/off). Right hand triggers one of 8 mapped chord slots across two gestures and four horizontal zones.
5. **Voice-to-Score** — record a sung melody, detect pitch via the YIN algorithm, display a piano-roll sketch of the notes with re-analyze capability

## How It Works

### Lyric Editor
Standard textarea + autosave to localStorage (guest mode) or Supabase (signed-in). Selection tooltip shows rhyme trigger. OCR via Tesseract.js runs fully in the browser.

### Gesture Instrument (Perform Mode)

**Beat source**  
The performer chooses between two beat sources before entering perform mode:
- **DRUMS** — procedural synthesis using a Web Audio lookahead scheduler. Five presets (Boom Bap, Trap, R&B, House, Minimal). Runs entirely offline.
- **YOUTUBE** — a YouTube URL loaded in the editor's bottom bar. Perform mode sends play/pause commands to the YouTube IFrame player via a `window` event bridge (`yt-transport` events), so the same beat the songwriter was listening to becomes the perform-mode beat.

**Left hand — latched transport**  
The left hand does not play-while-held. It uses a **latched** model:
- Raise an open palm and hold for ~0.4 seconds → beat starts and keeps looping, even after the hand is lowered
- Make a fist → beat stops and stays stopped until re-triggered
- Wrist height continuously controls volume; horizontal X position controls filter cutoff

This design was deliberate: hold-to-play is unmusical because any slight hand movement mid-performance would cut the beat. Latching frees both hands for expressive use.

**Right hand — 8-slot chord system**  
Eight chord slots are arranged across two gesture types and four horizontal screen zones:
- Open palm + zone 1–4 → slots 1–4
- Two fingers + zone 1–4 → slots 5–8
- Fist → silence (releases all chords immediately)
- Pinch → sustain toggle (holds the current chord even as gesture changes)

Each slot can be assigned any chord: root, quality, octave, inversion. The zone boundaries are visible on-screen, and the active slot is highlighted as the hand moves.

**Synthesis**  
All audio synthesis uses Web Audio API: procedural drum sounds (oscillator + noise + ADSR envelope per drum voice), layered chord oscillators with LPF and amplitude envelope. Mixed audio is recorded to a Take using MediaStreamDestination + MediaRecorder.

> **Note:** When beat source is YOUTUBE, browser cross-origin restrictions prevent the YouTube audio stream from being mixed into the MediaRecorder output. Only synthesized (drum/chord) audio is captured in recordings. This is a known browser limitation.

### Voice-to-Score
- Microphone input captured via Web Audio API AnalyserNode
- Pitch detection uses the **YIN algorithm** — a time-domain fundamental frequency estimator that is more robust than basic autocorrelation for singing, particularly for notes with slight vibrato or softer attacks
- Frequency mapped to MIDI note number, quantized, and merged into note events with smoothing to suppress micro-fluctuations
- Result displayed as a piano-roll canvas with labeled note names (C4, D#4, etc.)
- **Re-analyze** button allows reprocessing the same raw recording without re-recording
- Original recording can be played back for comparison with the piano roll

## Technical Architecture

```
Browser (Next.js 14, React 18, TypeScript, Tailwind)
├── lib/storage.ts          localStorage for guest songs + sessions
├── lib/takes.ts            IndexedDB for vocal takes (audio/video blobs)
├── lib/supabase/           Supabase client for authenticated users
├── components/editor/
│   ├── Editor.tsx          Main editor orchestrator
│   ├── YoutubeBar.tsx      YouTube IFrame player + loop controls
│   │                         (dispatches + listens to window 'yt-transport' events)
│   ├── RecorderModal.tsx   Vocal take recorder
│   ├── TakesPanel.tsx      Takes list + playback
│   ├── PerformModal.tsx    Gesture instrument (MediaPipe + Web Audio)
│   │                         (listens to 'yt-transport' events for YouTube beat mode)
│   ├── VoiceToScoreModal.tsx  YIN pitch detection + piano roll + re-analyze
│   └── ...                 Other panels (rhymes, history, OCR, export)
└── External
    ├── Datamuse API         Rhyme suggestions (no key required)
    ├── Tesseract.js         OCR (runs in browser WASM)
    ├── MediaPipe            Hand landmark detection (WASM in browser)
    └── YouTube IFrame API   Beat playback (controlled via window event bridge)
```

## Why This Is Original

Most "AI songwriting" tools generate lyrics or melodies automatically. Verses is explicitly anti-generative. It is a *craft* tool. The gesture-controlled performance mode is unusual: using hand tracking not for VR/gaming but as a musical performance interface inside a writing app. The latched transport model and zone-based 8-chord system make gesture performance genuinely musical rather than a tech demo — a performer can have both hands expressive at the same time without fighting the interface.

The Voice-to-Score feature addresses a real gap: a songwriter who hums an idea into their phone typically loses the melodic data. Verses gives a rough transcription sketch immediately, in the same environment where the lyrics live.

## Limitations

- **Gesture latency**: MediaPipe runs at ~15-30fps in the browser; there is inherent latency in hand tracking (~50-100ms)
- **Pitch detection accuracy**: The YIN algorithm handles vibrato better than autocorrelation, but still struggles with heavy noise, polyphonic input, or very short notes (<100ms)
- **Drum sounds**: Fully procedural (no samples); the sounds are functional but lack the character of real recorded drums
- **YouTube recording gap**: Cross-origin restrictions prevent YouTube audio from being captured in Takes; only synthesized audio records
- **Audio recording quality**: Web Audio API recording quality depends on the browser and platform
- **No MIDI export**: Chord mappings and note data are stored as JSON only; MIDI export was not implemented in this version
- **Guest mode only for some features**: Perform mode and Voice-to-Score are client-only and don't sync to cloud
- **Mobile**: The perform mode requires a full camera setup and works best on desktop

## Future Work

- MIDI output for the chord synth (connect to external hardware or DAW via WebMIDI API)
- Sample-based drum engine with royalty-free samples
- Export chord progression as notation or MIDI
- Collaborative session sharing
- Mobile-optimized gesture UI (using front camera)
- Deeper Supabase integration for takes and performance sessions
