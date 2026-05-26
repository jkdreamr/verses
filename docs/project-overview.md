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
4. **Perform mode (Gesture Instrument)** — webcam hand tracking (MediaPipe) + Web Audio drum engine + chord synth. Left hand controls drums. Right hand triggers mapped chords.
5. **Voice-to-Score** — record a sung melody, detect pitch via autocorrelation, display a piano-roll sketch of the notes

## How It Works

### Lyric Editor
Standard textarea + autosave to localStorage (guest mode) or Supabase (signed-in). Selection tooltip shows rhyme trigger. OCR via Tesseract.js runs fully in the browser.

### Gesture Instrument (Perform Mode)
- Webcam feed is captured with `getUserMedia`
- MediaPipe Hand Landmarker processes video frames and returns 21 3D landmarks per hand
- Geometric gesture recognition classifies each hand as: open palm, fist, pinch, two fingers, or point
- Left hand gestures control the drum engine: open palm plays, fist pauses; wrist height = volume; X position = filter cutoff
- Right hand gesture triggers the mapped chord on the synth
- All synthesis is done with Web Audio API: procedural drum sounds (oscillator+noise+envelope), layered chord oscillators with LPF and envelope
- Mixed audio can be recorded to a Take using MediaStreamDestination + MediaRecorder

### Voice-to-Score
- Microphone input captured via Web Audio API
- Pitch detection uses autocorrelation on time-domain samples from AnalyserNode
- Frequency mapped to MIDI note number, quantized, and merged into note events
- Result displayed as a piano-roll canvas

## Technical Architecture

```
Browser (Next.js 14, React 18, TypeScript, Tailwind)
├── lib/storage.ts          localStorage for guest songs + sessions
├── lib/takes.ts            IndexedDB for vocal takes (audio/video blobs)
├── lib/supabase/           Supabase client for authenticated users
├── components/editor/
│   ├── Editor.tsx          Main editor orchestrator
│   ├── YoutubeBar.tsx      YouTube IFrame player + loop controls
│   ├── RecorderModal.tsx   Vocal take recorder
│   ├── TakesPanel.tsx      Takes list + playback
│   ├── PerformModal.tsx    Gesture instrument (MediaPipe + Web Audio)
│   ├── VoiceToScoreModal.tsx  Pitch detection + piano roll
│   └── ...                 Other panels (rhymes, history, OCR, export)
└── External
    ├── Datamuse API         Rhyme suggestions (no key required)
    ├── Tesseract.js         OCR (runs in browser WASM)
    ├── MediaPipe            Hand landmark detection (WASM in browser)
    └── YouTube IFrame API   Beat playback
```

## Why This Is Original

Most "AI songwriting" tools generate lyrics or melodies automatically. Verses is explicitly anti-generative. It is a *craft* tool. The gesture-controlled performance mode is unusual: using hand tracking not for VR/gaming but as a musical performance interface inside a writing app. The combination of gesture harmony + procedural drums + lyric editor + vocal takes in a single, focused browser app is uncommon.

The Voice-to-Score feature addresses a real gap: a songwriter who hums an idea into their phone typically loses the melodic data. Verses gives a rough transcription sketch immediately, in the same environment where the lyrics live.

## Limitations

- **Gesture latency**: MediaPipe runs at ~15-30fps in the browser; there is inherent latency in hand tracking (~50-100ms)
- **Pitch detection accuracy**: The autocorrelation method works well for clean monophonic signals; it struggles with vibrato, background noise, or polyphonic input
- **Drum sounds**: Fully procedural (no samples); the sounds are functional but lack the character of real recorded drums
- **Audio recording quality**: Web Audio API recording quality depends on the browser and platform
- **No MIDI export**: Chord mappings and note data are stored as JSON only; MIDI export was not implemented in this version
- **Guest mode only for some features**: Some features (performs, voice-to-score) are client-only and don't sync to cloud
- **Mobile**: The perform mode requires a full camera setup and works best on desktop

## Future Work

- MIDI output for the chord synth (connect to external hardware or DAW via WebMIDI API)
- Improved pitch detection (YIN algorithm, or ML-based like SPICE)
- Sample-based drum engine with royalty-free samples
- Export chord progression as notation
- Collaborative session sharing
- Mobile-optimized gesture UI (using front camera)
- Deeper Supabase integration for takes and performance sessions
