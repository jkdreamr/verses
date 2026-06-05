# Verses

**Verses is a browser-based songwriting and performance workbench.**

It combines lyric writing, rhyme analysis, beat playback, gesture/touch performance, live vocal effects, recording, voice-to-trumpet, and voice-to-score transcription in one creative workspace.

The goal is not to replace the songwriter. The goal is to keep the songwriter in flow.

> **Write, hear, perform, record, and notate ideas without leaving the browser.**

Live app: **https://verses-zeta.vercel.app**
Repository: **https://github.com/jkdreamr/verses**

---

## Contents

1. [Overview](#overview)
2. [User Guide](#user-guide)
3. [Technical Architecture](#technical-architecture)
4. [Feature-by-Feature Technical Details](#feature-by-feature-technical-details)
5. [Evaluation and Evidence](#evaluation-and-evidence)
6. [Limitations and Tradeoffs](#limitations-and-tradeoffs)
7. [Privacy](#privacy)
8. [Development](#development)
9. [Credits and Disclosure](#credits-and-disclosure)
10. [Rubric Coverage](#rubric-coverage)

---

# Overview

Songwriting usually happens across many disconnected tools: a notes app for lyrics, YouTube for beats, a rhyme website for word ideas, a voice memo app for recordings, a DAW for vocal effects, and notation software for melodies.

Verses brings those early-stage songwriting actions into one browser app.

The core workflow is:

1. Write lyrics.
2. Find rhymes and visualize sound patterns.
3. Write to a beat.
4. Scan handwritten lyrics if needed.
5. Perform with hands, touch, voice, drums, chords, and vocal effects.
6. Record takes.
7. Convert sung melodies into notes, chords, and sheet music.

Verses treats a song as more than plain text. A song is text, sound, rhythm, voice, movement, performance, and notation.

---

# User Guide

This section explains how to use every major part of the app.

---

## 1. Opening the App

Open the live app in a modern browser.

Recommended:

* Chrome or Edge on desktop for camera/mic features.
* `localhost` or HTTPS for development.
* Headphones for vocal effects and recording.

The core writing features work without an account. Guest-mode song data is stored locally in the browser.

---

## 2. Dashboard

The dashboard is the home screen for songs.

From the dashboard, users can:

* Create a new song.
* Open an existing song.
* Search songs by title, lyrics, or tags.
* See song previews.
* See when each song was last updated.
* Delete songs.
* Toggle between light mode and dark mode.

The dashboard is meant to feel like a small song library rather than a file manager.

---

## 3. Light and Dark Mode

Verses supports both dark mode and light mode.

The theme toggle changes the app theme and saves the preference locally, so the next visit keeps the same appearance.

Dark mode is the default because the app is designed for long writing and late-night music sessions.

---

## 4. Lyric Editor

The editor is the main writing surface.

It includes:

* Song title field.
* Large lyric textarea.
* Autosave.
* Version snapshots.
* Word and line count.
* Font toggle.
* Structure tags.
* Rhyme tools.
* OCR import.
* Export options.
* YouTube beat bar.
* Perform / Takes / Voice Score access.

The editor is intentionally minimal so the lyric stays at the center.

---

## 5. Autosave

Verses saves drafts automatically.

Autosave helps prevent losing work during:

* browser refreshes
* navigation
* accidental tab closing
* long writing sessions

Version history gives additional protection by keeping snapshots of earlier drafts.

---

## 6. Structure Tags

The structure tag picker inserts common songwriting labels into the lyrics.

Examples:

* Verse
* Chorus
* Pre-Chorus
* Hook
* Bridge
* Outro

This helps organize lyrics while writing.

---

## 7. Tags

Tags organize songs in the dashboard.

A user can tag songs by:

* genre
* mood
* class/project
* draft status
* performance type
* any custom label

Search includes tags, so tags can be used as lightweight organization.

---

## 8. Version History

Version history stores earlier snapshots of a song.

Users can:

* Open version history.
* Preview older versions.
* Restore a previous draft.

This is useful because songwriting often involves trying risky changes, cutting lines, and later wanting them back.

---

## 9. Rhyme Finder

Rhyme Finder gives word-level rhyme suggestions.

How to use it:

1. Highlight a word in the lyric editor.
2. Open the rhyme panel.
3. Switch between Perfect, Near, and Sounds Like.
4. Click a result to copy it.
5. Right-click a result to search rhymes for that new word.

Results are grouped by syllable count, which makes them more useful for lyrics and meter.

---

## 10. Rhyme Lens

Rhyme Lens analyzes the whole lyric and highlights sound relationships directly behind the text.

It can show:

* end rhymes
* internal rhymes
* multisyllabic rhymes
* compound/mosaic rhymes
* slant rhymes
* family rhymes
* assonance
* consonance
* alliteration
* repeated phrases
* cross-line echoes
* rhyme chains
* dense rhyme pockets
* weaker lines

Rhyme Lens has density modes:

* **Clean**: fewer, stronger highlights
* **Detailed**: balanced analysis
* **Max**: shows the most sound relationships

The Sound Map lets users isolate one rhyme family at a time.

---

## 11. YouTube Beat Bar

The beat bar lets users write to a YouTube beat from inside the editor.

Users can:

* Paste a YouTube URL.
* Play or pause the beat.
* Seek through the beat.
* Set loop start and loop end.
* Add named markers.
* Keep writing while the beat plays.

This supports a common songwriting workflow: looping a beat section while drafting lyrics.

---

## 12. OCR: Scan Handwritten Lyrics

The OCR feature imports lyrics from a photo.

Users can:

1. Open the scan modal.
2. Upload or take a photo of handwritten lyrics.
3. Wait for OCR extraction.
4. Edit the extracted text.
5. Insert it at the cursor or replace the current lyric.

This is useful for writers who start in a notebook and later move into the app.

---

## 13. Export and Print

The export modal lets users move lyrics out of Verses.

Options include:

* Download as `.txt`.
* Copy lyrics to clipboard.
* Open print view.

The print view can be used for rehearsal, sharing, or saving as PDF.

---

## 14. Takes

Takes are recordings attached to a song.

Users can:

* View previous takes.
* Play takes.
* Rename takes.
* Download takes.
* Delete takes.

Takes are stored locally in the browser through IndexedDB.

---

## 15. Perform

Perform is the main live performance and recording area.

It includes:

* Chords & Drums mode.
* Vocal FX mode.
* Photobooth mode.
* Hands/camera input.
* Touch input.
* Lyric teleprompter.
* Drum sequencer.
* Chord instruments.
* Voice-to-trumpet.
* Recording.

Perform is where a written song can become a recorded performance.

---

## 16. Chords & Drums Mode

Chords & Drums mode lets the user play music with hands or touch.

### Hands Input

With camera input:

* The right hand controls chords or melody.
* Horizontal hand position selects a chord or note.
* Vertical hand position controls expression.
* Pinching triggers sound.
* The left hand controls beat transport.
* Open palm starts drums.
* Fist stops drums.
* Pinch mutes/unmutes drums.

A live guide grid shows which zones trigger which musical actions. The guide is only for the performer and is not included in recordings.

### Touch Input

Touch mode works without a camera.

* Dragging on the pad controls pitch and expression.
* Multiple fingers can create multiple voices.
* Chord pads trigger harmonic progressions.

Touch mode is especially useful on mobile or when camera input is not reliable.

---

## 17. Step Sequencer

The step sequencer is a 4x16 drum grid.

It includes:

* kick row
* snare row
* hi-hat row
* percussion row
* preset templates
* tempo control
* swing control
* drum kit selection
* click-and-drag editing
* mute and solo per row
* per-voice volume
* saved custom patterns

The sequencer gives the user a simple beat-making tool inside the songwriting workspace.

---

## 18. Chord Slots and Chord Presets

Verses includes an 8-slot chord system.

Users can:

* choose a chord progression preset
* edit each chord slot
* choose root note
* choose chord quality
* choose octave
* choose inversion
* preview chord tones
* save custom progressions

Supported chord qualities include:

* major
* minor
* maj7
* min7
* dom7
* sus2
* sus4
* dim
* aug
* add9
* 6
* min6

Chord presets include pop, R&B, sad, jazz, trap-dark, and gospel-style progressions.

---

## 19. Chord and Lead Sounds

Verses includes multiple chord timbres:

* Grand Piano
* Electric Piano
* Warm Strings
* Felt Keys
* Soft Pad
* Synth Pad

Lead mode turns the right hand or touch pad into a scale-locked melody instrument. The selected key and scale keep notes musical, while pitch glide makes the instrument feel more expressive.

---

## 20. Smart Lyric Reader

The Smart Lyric Reader is a performance teleprompter.

It displays:

* previous line
* active line
* next line

It supports:

* Smart mode
* Pace mode
* manual line nudging
* word-level highlighting
* compact karaoke-style display

Smart mode listens to the performer and aligns heard words against the written lyrics. Pace mode scrolls by time when speech recognition is unavailable or unreliable.

---

## 21. Vocal FX Mode

Vocal FX mode turns the app into a live vocal processor.

Users can sing into the microphone and shape the voice with a rack of effects.

Presets include:

* Clean Studio
* Modern Pop
* Rap Lead
* R&B Smooth
* Indie Double
* Dream Hall
* Live Low Latency
* Raw Clean

Controls include:

* input gain
* noise gate
* high-pass filter
* tone EQ
* autotune amount
* retune speed
* key and scale
* auto key detection
* de-esser
* compressor
* saturation
* doubler
* harmony
* delay
* reverb
* output gain
* latency/window-size control

Users can choose whether recordings capture the processed vocal or a raw clean vocal.

---

## 22. Hand-Controlled Vocal FX

In Vocal FX camera mode, hand movement controls live vocal effects.

Right hand:

* raises or lowers pitch
* can snap pitch changes to the selected key/scale
* controls a visible pitch ladder

Left hand:

* adds reverb/delay wash
* triggers harmony throws
* can bypass effects and return to a dry vocal

This makes vocal processing performable instead of only slider-based.

---

## 23. Touch-Controlled Vocal FX

In touch mode, Vocal FX provides a touch-friendly singing stage.

Users can:

* see detected note
* see input level
* control pitch bend with a slider
* use the Voice rack for detailed settings

This gives mobile users access to the same vocal engine without needing hand tracking.

---

## 24. Voice → Trumpet

Voice → Trumpet turns sung pitch into a trumpet-style instrument.

Users can:

* enable Voice → Trumpet in the Sound tab
* sing into the mic
* choose a trumpet preset
* adjust brightness
* choose tracking mode
* map voice range into trumpet range
* snap output to the song key/scale
* use live mode for real-time play
* use convert mode for cleaner playback

Presets include:

* Trumpet
* Muted
* Brass Bold
* Flugel
* Jazz Lead

Tracking modes include:

* Fast
* Balanced
* Accurate

Range modes include:

* Auto
* Same
* +12
* +24
* -12

---

## 25. Photobooth Mode

Photobooth records a simpler camera/mic performance.

It is useful when the user wants a raw performance capture without hand instruments, grids, or heavy vocal processing.

---

## 26. Recording

Recording happens inside Perform.

Depending on mode, recordings can include:

* camera video
* skeleton overlay
* note flashes
* drums
* chords
* lead synth
* Vocal FX
* Voice → Trumpet
* raw voice
* processed voice

Live helper guides, such as the chord grid or pitch ladder, are not recorded.

Recordings are saved as takes and can be played, renamed, downloaded, or deleted.

---

## 27. Voice Score

Voice Score converts a sung or hummed melody into musical notation.

Users can:

1. Open Voice Score.
2. Record a melody.
3. Let Verses analyze it.
4. View detected notes.
5. See inferred key and chords.
6. Switch between Piano Roll, Note List, and Staff views.
7. Edit notes.
8. Export the result.

Exports include:

* MIDI
* MusicXML
* JSON
* CSV
* printable lead sheet

Voice Score is designed for musicians who can sing an idea before they can notate it.

---

## 28. PWA and Native Shell

Verses can be used as a browser app and includes installability support.

It also includes a Tauri scaffold for building native desktop shells for macOS, Windows, and Linux.

---

# Technical Architecture

## App Structure

Verses is built with:

* Next.js 14 App Router
* React 18
* TypeScript
* Tailwind CSS
* Web Audio API
* Tone.js
* MediaPipe Tasks Vision
* TensorFlow.js
* Spotify basic-pitch
* VexFlow
* Tesseract.js
* Datamuse API
* pitchy
* Tonal.js
* IndexedDB
* localStorage
* Tauri

The application is organized around a few main areas:

* `src/app`: routes and app shell
* `src/components/editor`: lyric editor and editor modals
* `src/components/perform`: performance UI
* `src/hooks/perform`: audio, hand, trumpet, chord, and drum hooks
* `src/lib/audio`: shared audio engine, samplers, scales, filters, and calibration
* `src/lib/music`: lyric alignment and voice-score logic
* `src/lib/rhymeLens.ts`: local rhyme analysis engine
* `public/worklets`: pitch detector AudioWorklet
* `public/samples`: instrument samples
* `public/models/basic-pitch`: neural transcription model

The app is client-heavy by design. Writing, audio, OCR, hand tracking, pitch detection, recording, and transcription all run in the browser.

---

## Lazy Loading

Heavy features are loaded only when needed.

Examples:

* Tone.js loads when audio features start.
* MediaPipe loads when hand tracking starts.
* Tesseract loads when OCR opens.
* TensorFlow/basic-pitch loads when Voice Score analyzes a recording.
* VexFlow loads for notation rendering.

This keeps the initial editor experience lighter.

---

## Storage

The core guest-mode app uses local browser storage.

* Songs: `localStorage`
* Version snapshots: `localStorage`
* YouTube sessions: `localStorage`
* UI preferences: `localStorage`
* Drum/chord/Vocal FX presets: `localStorage`
* Takes: IndexedDB

IndexedDB is used for takes because recordings are binary Blobs and are too large for normal localStorage.

---

## Shared Audio Engine

Verses uses one persistent Web Audio engine.

The engine creates one `AudioContext` and shared buses:

```txt
drumBus ─┐
chordBus ─┤
trumpetBus ─┤──► master ─► compressor ─► limiter ─► speakers
padBus ─┘                              └──────► recordDest
```

This design keeps audio routing consistent:

* drums, chords, pads, trumpet, and vocals share the same engine
* recordings tap the same final audio graph
* volume sliders control real nodes in the graph
* the app avoids creating multiple competing AudioContexts
* samples can stay cached across feature panels

Tone.js is attached to the same AudioContext when it is needed.

---

# Feature-by-Feature Technical Details

## Lyric Editor

The editor uses a native textarea for typing. This preserves normal browser text behavior: selection, keyboard navigation, scrolling, spellcheck, copy/paste, and accessibility.

Rhyme Lens requires styled highlights behind the text, which a textarea cannot do directly. Verses solves this with a highlight mirror:

1. The highlight layer renders behind the textarea.
2. The textarea text is made visually transparent enough for highlights to show.
3. Both layers share identical font, padding, line height, wrapping, and scroll position.
4. A scroll/resize sync keeps highlights pinned to words.

This gives the app both native text editing and rich visual analysis.

---

## Autosave and Versions

Autosave tracks changed song state and persists it on a timer. It also saves on page lifecycle events such as hiding or closing the tab.

Version snapshots are stored separately from the current song. This lets the user restore earlier drafts without losing the current save object.

---

## Theme System

Theme is stored in localStorage. The app toggles a root `light` class on the document element, and CSS variables update the interface.

This makes theme switching global and avoids duplicating light/dark styles across components.

---

## Rhyme Finder

Rhyme Finder uses the Datamuse API.

The selected word is sent through one of three relationship modes:

* perfect rhyme
* near rhyme
* sounds-like

The app debounces requests, caches results for the session, filters low-quality results, sorts by score, and groups by syllable count.

Grouping by syllable count matters because a lyricist often needs a rhyme that fits a rhythmic slot, not just any rhyming word.

---

## Rhyme Lens

Rhyme Lens is a local phonetic analysis engine.

Pipeline:

1. Split lyrics into lines.
2. Tokenize words and preserve character offsets.
3. Normalize tokens.
4. Build phonetic shapes.
5. Extract vowel skeletons, consonant skeletons, endings, and clusters.
6. Build one-word and multi-word spans.
7. Compare spans for sound similarity.
8. Filter filler words and weak phrases.
9. Group matching spans into rhyme families.
10. Assign stable colors.
11. Render highlights behind the editor text.

It detects:

* end rhyme
* internal rhyme
* multisyllabic rhyme
* compound/mosaic rhyme
* slant rhyme
* assonance
* consonance
* alliteration
* repetition
* cross-line echo
* rhyme chains
* dense pockets
* weak lines

The analysis is approximate because accent and vocal delivery affect rhyme, but it gives a useful structural map of the lyric.

---

## YouTube Beat Bar

The beat bar uses the YouTube IFrame API.

Verses stores the beat URL, loop points, and markers with the song session. A playback loop checks current time and seeks back to the loop start when needed.

YouTube audio is not directly captured in the internal recording stream because cross-origin media cannot be freely mixed into Web Audio recording output.

---

## OCR

OCR uses Tesseract.js.

Pipeline:

1. User selects an image.
2. Tesseract is lazy-loaded.
3. Recognition runs in the browser.
4. Progress updates are shown.
5. Extracted text is editable before insertion.
6. User inserts or replaces lyrics.

This supports notebook-to-digital songwriting without a custom OCR server.

---

## Perform

Perform is a combined stage, instrument, and recorder.

It manages:

* camera stream
* microphone stream
* hand tracking
* touch input
* audio engine
* lyric reader
* mode switching
* recording
* take saving

The three modes are separated so each mode can have a clear mental model:

* Chords & Drums: perform instruments and beats
* Vocal FX: process and perform the voice
* Photobooth: simple raw capture

---

## Hand Tracking

Hand tracking uses MediaPipe HandLandmarker.

Pipeline:

1. The browser gets a camera stream.
2. Video frames are passed to MediaPipe.
3. MediaPipe returns 21 landmarks per hand.
4. Verses maps landmarks into normalized stage coordinates.
5. Pinches and gestures are detected from landmark distances.
6. Coordinates are smoothed.
7. Gestures are mapped to musical controls.

The right hand typically controls pitch, chords, or expression. The left hand controls transport or effects.

Pinch detection uses hysteresis so the gesture does not flicker when the hand is near the threshold.

---

## Touch Input

Touch input maps pointer events into musical controls.

Each active touch point can become its own voice, which allows polyphony. X position maps to a scale degree or pitch region, while Y position maps to expression such as brightness or level.

Touch mode gives the app a fallback for mobile devices and situations where camera tracking is not appropriate.

---

## Step Sequencer

The drum sequencer uses a 4x16 boolean grid.

Each row controls a drum voice:

* kick
* snare
* hi-hat
* percussion

The sequence is scheduled on Tone.Transport, which provides musical timing. The visual playhead is drawn with Tone.Draw so the UI stays aligned with the audio clock.

Each voice uses a sample player routed through per-voice gain and then into the drum bus. Mute, solo, level, tempo, swing, presets, and saved patterns all update sequencer state.

---

## Chord System

Chord slots store musical chord definitions:

* root
* quality
* octave
* inversion

Chord qualities are interval templates. For example:

* major: 0, 4, 7
* minor: 0, 3, 7
* dominant 7: 0, 4, 7, 10
* maj7: 0, 4, 7, 11

The chord engine converts each slot into MIDI notes. For smoother changes, it evaluates possible voicings and chooses the one with the lowest movement from the previously sounding chord.

That voice-leading makes chord changes feel less abrupt.

---

## Sampled Instruments

Verses uses a mix of sampled instruments and synthesized instruments.

Sampled instruments use Tone.Sampler. A sparse set of recorded anchor notes is loaded, and the sampler pitch-shifts between them to cover the full range.

Typical chain:

```txt
sampler or synth → lowpass filter → reverb → volume → engine bus
```

This gives the app more realistic chords and converted trumpet playback while keeping sample size manageable.

---

## Smart Lyric Reader

The Smart Lyric Reader aligns recognized speech against known lyrics.

It is not trying to freely transcribe a song. Since the lyrics are already written, the task is to determine where the performer is.

Pipeline:

1. Split lyrics into lines.
2. Tokenize each line.
3. Normalize words.
4. Generate fuzzy/phonetic forms.
5. Listen with Web Speech API.
6. Compare recognized words to current and next lyric line.
7. Advance at most one line at a time.
8. Never jump backward automatically.
9. Provide manual nudge and Pace fallback.

This strict movement prevents repeated choruses or misheard words from causing large jumps.

---

## Vocal FX

Vocal FX is a real-time vocal chain built on Web Audio and Tone.js.

Signal flow:

```txt
mic
→ input gain
→ noise gate
→ high-pass filter
→ tone EQ
→ pitch shift + dry path
→ correction blend
→ de-esser
→ compressor
→ saturation
→ vocal bus
   ├─ harmony
   ├─ doubler
   ├─ delay send/return
   └─ reverb send/return
→ output gain
→ limiter
→ engine master + recording tap
```

### Pitch Detection and Autotune

A pitch detector runs in an AudioWorklet and returns:

* frequency
* clarity
* RMS/input level

Autotune works as:

1. Detect current vocal pitch.
2. Convert frequency to MIDI.
3. Find the nearest note in the selected key/scale.
4. Compute the pitch difference.
5. Drive a pitch shifter by that correction amount.
6. Smooth the correction using retune speed.
7. Blend corrected and dry signals using autotune amount.

Fast retune creates a hard modern effect. Slow retune sounds more natural.

### Auto Key Detection

Auto key detection listens to sung pitches for several seconds, builds a pitch-class histogram, and compares it against major/minor key profiles. The result sets the vocal key and scale automatically.

### Gate, EQ, De-esser, Compressor, Saturation

The vocal chain includes tools commonly found in a vocal rack:

* gate to reduce room noise
* high-pass filter to remove low rumble
* body/presence/air EQ
* de-esser for harsh high-frequency sibilance
* compressor for dynamic control
* saturation for harmonic color

### Doubler, Harmony, Delay, Reverb

Spatial and musical effects run in parallel:

* doubler adds width with short delay/pan
* harmony adds a pitch-shifted interval
* delay adds echo
* reverb adds space

The delay and reverb are sends/returns rather than simple destructive inserts, so the dry vocal remains clear.

### Hand-Controlled Vocal FX

In camera mode, hand movement writes directly into the same audio chain:

* right hand controls pitch shift
* key-lock snaps pitch shifts to musical scale intervals
* left hand increases space/wash
* left-hand pinch adds harmony
* left-hand fist bypasses effects

This makes Vocal FX performable, not only adjustable through sliders.

---

## Voice → Trumpet

Voice → Trumpet has two paths.

### Live Path

The live path prioritizes latency.

Pipeline:

```txt
mic
→ pitch detector AudioWorklet
→ One Euro smoothing
→ pitch-to-MIDI
→ trumpet range mapping
→ optional scale snap
→ note hysteresis
→ low-latency brass synth
→ trumpet bus
```

The live brass synth uses:

* sawtooth oscillator
* square oscillator
* slight detune
* breath noise
* formant-like filter
* lowpass brightness filter
* amplitude envelope
* smooth pitch ramps

This is more responsive than triggering a sample for every tiny pitch movement.

The app maps vocal loudness to velocity and brightness. It also uses note hysteresis to avoid semitone chatter and a short release hold to prevent sustained notes from cutting off during tiny detection dropouts.

### Convert Path

The convert path prioritizes clean output.

Pipeline:

```txt
recorded voice
→ offline pitch analysis
→ median smoothing
→ octave-flip removal
→ tiny-fragment merging
→ trumpet range mapping
→ optional scale snap
→ scheduled trumpet samples
```

Live mode is for performing. Convert mode is for cleaner playback.

---

## Photobooth

Photobooth is a simpler capture mode. It records raw camera and microphone without the heavier performance instrument overlays.

This gives users a straightforward way to record a vocal/video idea.

---

## Recording

Recording uses MediaRecorder.

For camera-based takes:

1. A capture canvas draws the camera, skeleton, and note flashes.
2. The guide canvas draws live helper overlays separately.
3. The capture canvas creates a video stream.
4. The audio engine provides an audio stream through the recording tap.
5. The video and audio tracks are combined into one MediaStream.
6. MediaRecorder writes chunks.
7. The final Blob is saved as a take in IndexedDB.

The live guide grid and pitch ladder are not recorded because they are drawn on separate live-only layers.

---

## Takes

Takes are stored in IndexedDB.

Each take can store:

* id
* song id
* name
* MIME type
* duration
* size
* creation time
* whether it has video
* recording Blob

IndexedDB is used because recordings are too large for localStorage.

---

## Voice Score

Voice Score converts a sung or hummed melody into structured music.

Pipeline:

```txt
recorded audio
→ neural transcription with basic-pitch
→ YIN fallback if needed
→ monophonic reduction
→ octave correction
→ fragment merging
→ melody simplification
→ BPM estimation
→ 1/16 quantization
→ key inference
→ chord inference
→ piano roll / note list / staff notation
→ export
```

### Neural Transcription

The primary transcription engine is Spotify basic-pitch through TensorFlow.js. The audio is resampled to mono at 22.05 kHz and passed through the model to produce note events.

### YIN Fallback

If the neural model fails or finds no clear notes, the app falls back to YIN pitch detection samples.

### Melody Cleanup

The app repairs octave errors, merges tiny fragments, and simplifies repeated pitch events so the result looks like a readable melody instead of noisy micro-notes.

### Key and Chord Inference

Verses estimates key from a duration-weighted pitch-class histogram. Chords are inferred by grouping notes into beat windows and matching chroma patterns against chord templates.

### Notation and Export

The detected melody can be viewed as:

* Piano Roll
* Note List
* Staff notation

Exports include:

* MIDI
* MusicXML
* JSON
* CSV
* printable lead sheet

---

# Evaluation and Evidence

Verses includes both automated and manual validation.

## Automated Testing

The rhyme engine can be tested with:

```bash
npm test
```

This runs the Rhyme Lens engine test script.

## Manual Validation

The following flows were manually tested during development:

### Writing

* creating songs
* saving/reopening songs
* autosave behavior
* version restore
* long lyric scrolling
* Rhyme Lens highlight alignment
* export and print
* OCR insertion

### Rhyme Tools

* perfect rhyme lookup
* near rhyme lookup
* sounds-like lookup
* syllable grouping
* Rhyme Lens density modes
* repeated phrase detection
* internal rhyme detection
* alliteration/assonance/consonance detection

### Perform

* camera permission flow
* hand tracking start/stop
* pinch detection
* open-palm beat start
* fist beat stop
* touch mode
* chord triggering
* lead mode
* guide grid alignment
* guide grid exclusion from recording

### Audio and Recording

* drum sequencer playback
* tempo/swing changes
* chord timbre changes
* master/drum/chord volume controls
* camera recording
* audio-only recording
* takes playback
* download/delete/rename takes

### Vocal FX

* preset switching
* autotune on/off
* retune speed
* key and scale selection
* auto key detection
* harmony
* delay/reverb
* raw vs processed recording
* hand pitch bend
* left-hand wash/harmony/bypass gestures
* latency/window tradeoff

### Voice → Trumpet

* live tracking
* fast/balanced/accurate tracking
* range mapping
* scale snap
* note hysteresis
* release hold
* convert mode
* converted sample playback

### Voice Score

* simple scale transcription
* short melody transcription
* key inference
* chord inference
* note editing
* staff rendering
* MIDI export
* MusicXML export
* JSON/CSV export

## Evidence of Iteration

The project went through multiple design refinements:

* Rhyme Lens highlight rendering was aligned to the editor mirror so highlights stay attached to the correct words while scrolling.
* Recording was centralized in Perform, while Takes became a dedicated viewer.
* Camera recording was split into capture canvas and guide canvas so helper overlays are visible live but excluded from final takes.
* Voice Score was simplified into one automatic pipeline instead of many confusing user-facing quality knobs.
* Voice → Trumpet was separated into live and convert paths so latency and quality could be handled differently.
* Vocal FX added raw/processed recording options and exposed latency as a visible tradeoff.

---

# Limitations and Tradeoffs

## Browser Audio Latency

Real-time audio has unavoidable latency. Pitch detection requires a window of audio before it can estimate frequency.

Smaller windows reduce latency but create more artifacts. Larger windows sound smoother but feel slower.

## Vocal FX Pitch Shifting

The current pitch shifter is real-time and granular. It is useful for autotune, harmony, and moderate pitch bends, but it is not formant-preserving. Large pitch shifts can color the voice.

## Pitch Detection

Pitch detection works best with one clear sung line. Background music, harmony, noisy rooms, and quiet singing can reduce accuracy.

## Smart Lyrics

Smart Lyrics depends on browser speech recognition. Sung lyrics are harder to recognize than normal speech, so Pace mode and manual nudging are included.

## YouTube Audio

YouTube audio cannot be directly captured into the internal recording stream because of cross-origin restrictions. The app can play YouTube beats for writing, but recordings do not directly include the YouTube audio track.

## OCR

OCR quality depends on handwriting clarity, lighting, and image quality. Extracted text may need manual correction.

## Not a Full DAW

Verses is focused on early songwriting, performance capture, and musical idea generation. It does not yet include a full multitrack timeline, clip editing, plugin hosting, automation, or mastering tools.

---

# Privacy

Verses keeps the core creative workflow local when used in guest mode.

* Songs are stored in localStorage.
* Takes are stored in IndexedDB.
* OCR runs in the browser.
* Hand tracking runs in the browser.
* Pitch detection runs locally.
* Voice Score transcription runs locally with the vendored model when available.
* Camera and microphone streams are used by the browser for live features.
* Smart Lyrics uses the browser's built-in speech recognition, so behavior depends on browser/OS implementation.

---

# Development

## Quickstart

```bash
git clone https://github.com/jkdreamr/verses
cd verses
npm install
npm run dev
```

Open:

```txt
http://localhost:3000
```

Camera and microphone features require HTTPS or localhost.

## Scripts

```bash
npm run dev       # local development server
npm run build     # production build
npm run start     # production server
npm run lint      # lint
npm test          # Rhyme Lens engine tests
```

## Native Shell

The Tauri shell lives in `src-tauri`.

```bash
npm run tauri:dev
npm run tauri:build
```

---

# Credits and Disclosure

## Major Libraries and APIs

Verses uses:

* Next.js
* React
* TypeScript
* Tailwind CSS
* Web Audio API
* Tone.js
* MediaPipe Tasks Vision
* TensorFlow.js
* Spotify basic-pitch
* VexFlow
* Tesseract.js
* Datamuse API
* pitchy
* Tonal.js
* Tauri
* Web Speech API
* IndexedDB
* localStorage

## Samples

Verses uses vendored instrument samples for piano, strings/cello, and trumpet playback. Sample sources and licenses should remain credited in the repository wherever applicable.

## AI Assistance

AI assistance was used during debugging, code iteration, architecture explanation, and README drafting.

The project author remains responsible for the final implementation, design decisions, testing, disclosure, and submission.

---

# Rubric Coverage

## Problem and Insight

Verses addresses a meaningful problem: songwriting workflows are fragmented across too many separate tools.

The motivation is to reduce context switching and preserve creative flow. The approach is original because it combines lyric writing, rhyme visualization, beat writing, gesture-controlled performance, vocal processing, recording, voice-to-trumpet, and voice-to-score transcription in one browser workspace.

## Execution and Technical Work

The implementation includes substantial technical work across several domains:

* writing interface
* local persistence
* rhyme analysis
* browser audio
* sampled instruments
* step sequencing
* hand tracking
* touch performance
* vocal effects
* pitch detection
* recording
* speech alignment
* neural transcription
* music theory inference
* notation rendering
* export formats

The app is functional as a connected creative workflow rather than a single isolated demo.

## Evaluation and Evidence

The project includes:

* Rhyme Lens automated tests
* manual feature validation
* recording tests
* pitch-detection tests
* Voice Score sanity checks
* latency/quality tradeoff analysis
* fallback paths for unreliable browser APIs
* documented limitations

## Communication and Presentation

The README is organized as:

1. product overview
2. user guide
3. technical architecture
4. feature-level technical details
5. evaluation
6. limitations
7. privacy
8. development
9. credits/disclosure
10. rubric mapping

This structure is intended to be understandable to both non-technical readers and technical graders.

## Process, Integrity, and Disclosure

The README credits major libraries, APIs, browser technologies, and AI assistance. It also documents major technical decisions, tradeoffs, and limitations.
