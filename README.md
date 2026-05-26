# Verses

**A songwriting and performance workbench for the browser.**

Verses keeps the early creative moment intact. Write lyrics, hear a beat, sketch harmony with your hands, capture a melody with your voice — without switching apps.

---

## What it is

Most songwriters use five or six apps to do what Verses does in one. The fragmentation is the problem. The moment a hook comes together is fragile. Verses tries to protect it.

The core idea: **your body is the instrument.** Not "AI writes your song." The artist controls everything. Verses just gives you more tools to work with while you're still inside the page.

---

## Features

### Writing
- Distraction-free lyric editor with autosave (every 10 seconds)
- Version history (restore any snapshot)
- Rhyme finder: highlight a word, get perfect rhymes / near rhymes / sounds-like from Datamuse
- Structure tags (Verse, Pre-Chorus, Chorus, Bridge, Outro)
- Export as text / copy / print
- Song tags for organization
- OCR: photograph a handwritten page, paste it directly into the editor

### Beats
- Paste any YouTube link to play it in the bottom bar
- Loop a section with A/B loop points
- Drop named markers at key timestamps
- Sync vocal takes to specific beat positions

### Vocal Takes
- Record audio or video takes per song
- Stored locally in IndexedDB (no upload required)
- Rename, download, delete takes
- Plays back inline

### Perform Mode (Gesture Instrument)
- Webcam hand tracking via MediaPipe Hand Landmarker (runs in browser, no server)
- Left hand controls drums: open palm plays, fist pauses; height = volume; horizontal = filter
- Right hand triggers mapped chords on a synthesizer
- Map 5 gestures to any chord (root, quality, octave, inversion)
- Drum presets: Boom Bap, Trap, R&B, House, Minimal
- Instrument presets: Warm Keys, Soft Pad, Glass Synth, Bass, Brass-ish
- Record the performance as a Take

### Voice to Score
- Record a short sung melody (up to 15 seconds)
- Pitch detection via autocorrelation (runs in browser)
- Results displayed as a piano roll canvas
- Note events: name (C4, D#4...), start time, duration, confidence
- Export as JSON or copy note sequence as text

---

## Quickstart

```bash
git clone https://github.com/jkdreamr/verses
cd verses
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

Works in guest mode without any environment variables. Supabase is optional (for cloud sync + auth).

**Optional: Supabase setup**

```
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

---

## Using Perform Mode

1. Open any song in the editor
2. Click **perform** in the toolbar
3. Click **Start Camera** — grant webcam permission when prompted
4. Select a drum preset (e.g. Boom Bap)
5. Raise your left hand, **open palm** → drums start
6. Lower your left hand height → volume drops
7. Open the chord map and assign chords to right-hand gestures
8. Raise your right hand with different gestures → chords play
9. Click **Record** to capture the session as a Take

**Left hand gestures:**
- Open palm → play drums
- Fist → pause drums
- Height → volume (high = loud)
- Horizontal position → filter cutoff

**Right hand gestures (default Pop mapping):**
- Open palm → C major
- Pinch → G major
- Two fingers → A minor
- Fist → F major
- Point → E minor

---

## Using Voice to Score

1. In the editor toolbar, click **voice**
2. Click **Record** — grant mic permission
3. Sing a short melody (4-8 notes, up to 15 seconds)
4. Click **Stop**
5. Wait ~1 second for analysis
6. View the piano roll + note list
7. Export JSON or copy note sequence

Works best with: one clear voice, no background music, notes held for at least 0.2 seconds.

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

---

## Privacy

Camera and microphone stay on your device.

- Hand tracking runs locally using MediaPipe WASM — no video is sent anywhere
- Pitch detection runs locally — no audio is sent anywhere
- OCR runs locally via Tesseract.js — no images leave your browser
- Vocal takes are stored in your browser's IndexedDB — no upload unless you explicitly download them
- In guest mode, all song data stays in localStorage

---

## Limitations

- Perform mode works best in Chrome on desktop
- Camera/mic features require HTTPS or localhost
- Hand tracking latency: ~50-100ms depending on device
- Pitch detection works best with clean, monophonic vocals (no vibrato, minimal noise)
- Drum sounds are procedural (synthesized) — not sample-based
- Performance sessions are not persisted between page loads
- Mobile support: editor works; Perform mode is not optimized for mobile

---

## Class Project Disclosure

This is a final class project for [course name]. It is also a real tool the author uses. AI coding assistants were used for implementation assistance; product concept, design decisions, and music workflow were the author's own. See `docs/ai-disclosure.md` for full disclosure.

---

## Development

```bash
npm run dev        # development server
npm run build      # production build
npm run lint       # lint check
```

Tauri native builds: see `src-tauri/` — run with `npm run tauri dev` (requires Rust).

---

## Links

- Live app: [verses.app](https://github.com/jkdreamr/verses) (or localhost)
- GitHub: [github.com/jkdreamr/verses](https://github.com/jkdreamr/verses)
- Docs: `docs/` folder

---

*Built for songwriters.*
