# Verses

**A songwriting and performance workbench for the browser.**

Verses keeps the early creative moment intact. Write lyrics, hear a beat, sketch harmony with your hands, hear your voice transformed live — without switching apps.

---

## What it is

The core idea: **your body is the instrument.** Not "AI writes your song." The artist controls everything. Verses gives you more tools to work with while you are still inside the page.

Writing leads directly to performance. When you are ready to record, you open a Take and choose how much of the performance system to turn on. That is the whole mental model.

---

## Features

### Writing
- Distraction-free lyric editor with autosave
- Version history (restore any snapshot)
- **Rhyme Lens** — toggle a full-draft analysis mode: end rhymes grouped by sound family, internal echoes, start rhymes, near/slant rhymes, repeated phrases, unrhymed lines, possible hooks. Updates as you type (debounced).
- Per-word rhyme finder: highlight any word, get perfect / near / sounds-like results from Datamuse
- Structure tags (Verse, Pre-Chorus, Chorus, Bridge, Outro)
- Export as text / copy / print
- Song tags for organization
- OCR: photograph a handwritten page, paste directly into the editor

### Beats
- Paste any YouTube link to play it in the bottom bar
- Loop a section with A/B loop points
- Named markers at key timestamps
- Sync vocal takes to specific beat positions
- **Auto-play on Record start**: YouTube beat begins automatically when recording starts, across all four performance layer modes
- **Replace**: clears the current beat along with all markers and loop points so a new URL loads cleanly with no leftovers

### Takes (Recording Hub)
**New Take** is where all recording and performance happens. Open the Takes panel, click **New Take**, and choose what to enable:

- **Normal** — mic-only or video+audio take, standard teleprompter
- **Hand Gestures** — adds the gesture-controlled drum machine and chord synth
- **Live Trumpet** — adds real-time voice-to-brass synthesis
- **Gestures + Trumpet** — both layers at once: sing for trumpet, control chords with right hand, start/stop beat with left hand

These work as a unified recording session. The resulting take captures the selected audio layers.

### Hand Gesture Performance Layer
- MediaPipe hand tracking (runs in browser, no server)
- Beat source: **DRUMS** (procedural synthesis) or **YOUTUBE** (loaded beat from the editor bar)
- **Drum BPM**: +/− buttons adjust tempo live between 50–200 BPM; resets to preset default on demand
- **Left hand transport (latched)**: hold open palm ~0.4s → beat latches on and keeps looping; make a fist to stop; pinch to mute/unmute
- **Right hand chords (8 slots)**: open palm + 4 horizontal zones → slots 1–4; two fingers + 4 zones → slots 5–8; fist = silence
- Chords and drums play simultaneously through a shared AudioContext — no routing conflicts
- Improved gesture reading: history buffer, smoothed wrist position, zone hysteresis, per-action cooldowns
- Camera overlay: optional zone grid, hand skeleton, gesture labels, L/R labels — **large camera view** (~1200px modal, 500px column) so both hands are clearly visible in frame
- Toggles: Show zones, Show skeleton, Swap hands

### Live Voice-to-Trumpet Layer
- Open a New Take and enable **Live Trumpet**
- Choose preset: Trumpet Sketch, Muted Trumpet, Brass Section, Soft Flugelhorn, Synth Brass
- Sing into the mic — hear a trumpet-like synth follow your pitch in real time
- Browser-native implementation using pitch detection (YIN/autocorrelation) + Web Audio synthesis
- Multi-oscillator trumpet model: saw + square layers, bandpass/lowpass filters, light reverb, breath noise
- Fades out during silence, smooths pitch transitions, handles vibrato
- Controls: brightness, vibrato, output gain, raw voice monitor toggle
- The transformed trumpet audio is captured in the take recording
- Note: this is a browser-native live voice sketch, not a studio AI voice model

### Smart Lyric Follow
- Active during any New Take recording
- Choose teleprompter mode: **Smart**, **Pace**, or **Manual**
- Smart mode: uses Web Speech API to listen and match recognized words to lyric lines; advances the teleprompter as you sing
- Falls back to Pace mode with a notice if speech recognition is unavailable or confidence is low
- Manual up/down nudge always available
- Honest limitation: sung lyrics are harder to recognize than spoken words; use nudge buttons when needed

### Playable Piano
- Piano keyboard visible in the performance view of New Take
- Clickable/touchable keys play individual notes using the selected instrument sound
- Octave shift controls (down/up) with current range label (e.g., "C3–B4")
- In chord slot editor: clicking a piano key can preview or set the chord root
- Chord tones highlighted on the piano when a slot is active
- No stuck notes after mouseup, touch cancel, or modal close

### Voice to Score (standalone)
- Record a short hummed melody
- YIN pitch detection with median smoothing and note segmentation
- Piano roll canvas with confidence coloring
- Re-analyze button, original-recording playback, JSON export
- Separate from Takes — accessed via "voice score" in the toolbar

---

## How to Record a Take

1. Open a song
2. Write some lyrics
3. Click **takes** in the toolbar, then **● new take**
4. Choose: record video or audio-only; auto-play YouTube beat if loaded
5. Under **Performance Layers**, choose Normal, Hand Gestures, Live Trumpet, or both
6. Configure the layer (drum preset, chord progression, trumpet preset, etc.)
7. Click **Record** — grant mic/camera permissions
8. Perform: left hand starts the beat, right hand plays chords, sing for trumpet
9. Watch the teleprompter follow your lyrics
10. Click **Stop**
11. Review the take, name it, save it

---

## Demo Flow (Rhyme Lens + Performance)

1. Open a song and write a verse
2. Toggle **RHYME LENS** (bottom-left of editor) — see end rhyme groups, internal echoes, repeated phrases
3. Click **takes** → **● new take**
4. Check **record video**, enable **Gestures + Trumpet**
5. Toggle "Show zones on camera" on
6. Select a drum preset and chord progression
7. Select a trumpet preset
8. Click **Record**
9. Left hand (open palm, hold) → beat starts and loops
10. Right hand in zones → chords play
11. Sing → hear trumpet output live; lyrics teleprompter advances
12. Click piano keys to audition notes
13. Stop, review, save

---

## Quickstart

```bash
git clone https://github.com/jkdreamr/verses
cd verses
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

Works in guest mode without any environment variables. Supabase is optional.

**Optional: Supabase setup**

```
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| UI | React 18, TypeScript, Tailwind CSS |
| Storage | localStorage (guest) + Supabase (auth) |
| Audio | Web Audio API |
| Video/Camera | getUserMedia, MediaRecorder |
| Hand tracking | @mediapipe/tasks-vision (WASM, in-browser) |
| OCR | Tesseract.js (WASM, in-browser) |
| Rhymes | Datamuse public API |
| Takes storage | IndexedDB |
| Speech (smart lyric follow) | Web Speech API (browser-native, where available) |

---

## Privacy

Camera and microphone stay on your device.

- Hand tracking runs locally via MediaPipe WASM
- Pitch detection runs locally
- OCR runs locally via Tesseract.js
- Smart Lyric Follow uses the browser's built-in Web Speech API — the browser/OS may process speech depending on platform
- Vocal takes are stored in your browser's IndexedDB
- In guest mode, all song data stays in localStorage

---

## Limitations

- Best in Chrome on desktop
- Camera/mic features require HTTPS or localhost
- **YouTube audio cannot be captured in recordings** — browser cross-origin restrictions prevent routing YouTube audio into MediaRecorder. Drums, chord synth, and trumpet synth are captured; YouTube plays through speakers.
- Trumpet synthesis is browser-native; it is not identical to studio voice modeling tools
- Smart Lyric Follow works best with clear vocals and simple phrasing; sung lyrics are harder to transcribe than spoken speech
- Hand tracking latency: ~50–100ms depending on device
- Pitch detection works best with clean monophonic vocals

---

## Development

```bash
npm run dev        # development server
npm run build      # production build
npm run lint       # lint check
```

Tauri native builds: see `src-tauri/` — run with `npm run tauri dev` (requires Rust).

---

## Class Project Disclosure

See `docs/ai-disclosure.md` for full disclosure on AI assistance used.

---

*Built for songwriters.*
