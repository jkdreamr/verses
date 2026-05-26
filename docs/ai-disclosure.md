# AI Tools Disclosure

## Overview

This project used AI coding assistants (specifically Devin/Claude) for scaffolding, implementation assistance, and debugging across three rounds of development. This disclosure is provided in accordance with academic integrity guidelines and the course rubric.

---

## Round 1 — Initial Build

### What AI Was Used For

- Code scaffolding and boilerplate generation
- Debugging TypeScript and Next.js configuration issues
- Generating initial implementations of complex algorithms (pitch detection, Web Audio scheduling)
- Suggesting component structures and patterns
- Writing documentation drafts

### What Was Not AI-Generated

- **Product concept and direction**: The idea of a gesture-controlled songwriting workbench, the emphasis on "the artist's body as instrument," and the specific feature set were the author's original decisions
- **UX and design decisions**: Layout choices, visual language, typography approach, and editorial aesthetic
- **Music workflow design**: The specific drum preset patterns, chord mapping system, and gesture-to-music mapping were designed by the author based on music knowledge
- **Feature prioritization**: Deciding which features to include, what quality level was acceptable, and what to remove were author decisions
- **All final code review and integration**: All generated code was reviewed, tested, and often substantially modified

---

## Round 2 — Refinement Pass

### What AI Was Used For

- Refining the gesture system implementation: latched transport logic (hold-to-latch vs. hold-to-play), debounce timing, latch state management
- Implementing the 8-chord zone system: zone boundary calculation, gesture+zone combination logic, slot grid UI
- Replacing the autocorrelation pitch detector with a YIN algorithm implementation
- Building the YouTube event bridge (`window` custom event `yt-transport`) so the YouTube IFrame player and Perform mode could coordinate without a shared React state dependency
- UI polish: slot grid visualization, SILENCE label, zone boundary indicators, re-analyze and playback controls in Voice to Score
- Updating documentation

### What Was Author-Designed in Round 2

- **The latching behavior decision**: The choice to use latch-on/latch-off rather than hold-to-play came from musical usability reasoning — hold-to-play means any hand movement mid-performance cuts the beat, which is unworkable. The author identified this problem and specified the latched model; AI implemented it.
- **The zone-based chord system concept**: Having eight chord slots addressable by two gestures × four spatial zones was the author's design. The specific zone layout (screen-width divided into 4 equal bands) and the decision to use open-palm vs. two-fingers as the gesture axis were author choices.
- **The product direction of "latched transport"**: Framing the left hand as a latching transport control (rather than a volume/filter-only control) was a deliberate product direction change based on usability observation. The author noticed that performers instinctively wanted to lower their hand after triggering and expected the beat to continue.
- **YIN algorithm selection**: The decision to upgrade from autocorrelation to YIN was the author's, based on research into pitch detection methods and observed failure cases with the original implementation.

### Honest Note

The gesture interaction design required multiple iterations based on musical usability testing. The first implementation (hold-to-play) was technically correct but musically wrong. The second implementation (latched) came from the author watching a test performer try to play chords while holding their left hand up — and realizing the interface was fighting the music. That observation, and the design change that followed, were not AI-generated.

---

## Round 3 — Performance System Overhaul

### What AI Was Used For

- Extracting inline drum/chord/hand-tracking/trumpet logic into shared hooks (`useDrumEngine`, `useChordSynth`, `useHandTracking`, `useLiveTrumpet`) in `src/hooks/perform/`
- Implementing gesture smoothing improvements: 8-frame rolling history, wrist EMA, palm-size normalization, zone hysteresis
- Full rewrite of `RecorderModal` to support Performance Layers (Normal / Hand Gestures / Live Trumpet / Gestures + Trumpet) — adding gesture camera, chord engine, trumpet synthesis, and smart lyric follow into the recording flow
- Smart Lyric Follow: Web Speech API integration with word-matching heuristic and automatic fallback to pace mode
- `RhymeLens` panel: full-lyric analysis for end rhymes (exact/phonetic/near/sounds-like), start rhymes, internal echoes, repeated phrases, and unrhymed lines
- `PlayablePiano` component: click/touch piano with Web Audio synthesis, octave shifting, and sustain
- YIN pitch detection improvements in `useLiveTrumpet` with parabolic interpolation and EMA smoothing
- Trumpet synthesis model: multi-oscillator stack (sawtooth + detuned square + octave up), bandpass filter, soft-clip WaveShaper, vibrato LFO, breath noise layer, impulse-response reverb

### What Was Author-Designed in Round 3

- **RhymeLens product concept**: The decision to analyze the full lyric draft as a whole (not just single-word lookups) and to present end/start/internal analysis simultaneously was the author's. The specific grouping logic (transitive rhyme groups, kind hierarchy) was specified by the author.
- **Performance Layers architecture**: The idea to move performance features into the recording flow (RecorderModal) rather than a separate modal came from the author's observation that having PerformModal and RecorderModal as two separate entry points created confusion. Author decided gesture/trumpet features should be recording-session options, not a separate "mode."
- **Trumpet as melody instrument**: The decision to use a multi-oscillator trumpet-like synthesis model (rather than a simple sine-wave pitch tracker) was the author's, based on the judgment that a more timbral instrument would feel more musical and encourage melodic improvisation alongside the beat.
- **Smart Lyric Follow design**: Author specified the "look ahead 3 lines, require 50% word match" logic and the fallback-to-pace behavior. The specific design choice (listen for the words you actually sang, don't require exact order) came from the author testing naive approaches that failed.
- **Shared hooks refactor**: Author decided to extract performance logic to `src/hooks/perform/` to avoid duplicating the drum/chord engines across PerformModal and RecorderModal. The hook interface contracts (what to expose, what to keep internal) were author decisions.

---

## Features Removed During Development

The following features existed in earlier versions and were deliberately removed:

**Multitrack Studio**: A multi-track recording and mixing interface was built but removed because it did not meet the quality bar for a polished demo. The mixing engine worked but the UI felt incomplete and the concept competed with rather than complemented the core gesture instrument idea.

**Lyric Overlay / Auto-sync**: A feature for rendering lyrics over video takes with auto-sync timing was built but removed because it was unreliable and added complexity without clear value for the core use case.

**Standalone PerformModal**: In earlier versions, a dedicated PerformModal handled gesture performance separately from recording. This was deprecated in Round 3 in favor of Performance Layers inside RecorderModal, unifying recording + performance into a single session.

---

## External Libraries and APIs Used

| Library/API | Purpose | License |
|-------------|---------|---------|
| Next.js 14 | React framework | MIT |
| Tailwind CSS | Utility-first CSS | MIT |
| Supabase | Auth and cloud storage | Apache 2.0 |
| Datamuse API | Rhyme suggestions | Free public API |
| Tesseract.js | OCR in browser | Apache 2.0 |
| @mediapipe/tasks-vision | Hand landmark detection | Apache 2.0 |
| Web Audio API | Synthesis, recording | Browser native |
| Web Speech API | Smart lyric follow (voice recognition) | Browser native |
| YouTube IFrame API | Beat playback | YouTube ToS |
| IndexedDB | Local take storage | Browser native |

---

## Substantial Changes Beyond Scaffold

The original scaffold (created with `create-next-app`) provided only the basic Next.js structure. Substantial custom work included:

- Custom IndexedDB abstraction for audio/video blob storage
- Custom Web Audio drum engine with lookahead scheduler and 5 presets
- Gesture recognition from raw MediaPipe landmarks (no ML classifier)
- Latched transport state machine with hold-duration debounce and zone hysteresis
- Zone-based 8-slot chord addressing system (gesture × zone)
- YIN pitch detection with parabolic interpolation and EMA smoothing
- Piano roll canvas renderer with re-analyze and playback
- Window event bridge for YouTube ↔ Perform mode coordination
- Full Supabase guest/auth dual-mode architecture
- Custom design system (CSS variables, Tailwind extension, editorial aesthetic)
- Multi-oscillator trumpet synthesis with vibrato, breath noise, and impulse reverb
- Full-lyric rhyme analysis engine (transitive grouping, phonetic matching, internal echo detection)
- Smart Lyric Follow with SpeechRecognition API, word normalization, and pace fallback
- Performance Layers architecture integrating gesture/trumpet into the recording session
- Shared performance hooks (`useDrumEngine`, `useChordSynth`, `useHandTracking`, `useLiveTrumpet`)

---

## Round 4 — Final Polish Pass

### What AI Was Used For

- Inline editor highlighting: layered textarea architecture (highlight mirror div behind transparent textarea) with scroll sync
- Rhyme Lens color fix: sequential color assignment replacing hash-based allocation
- Rhyme Lens UI redesign: clickable family focus, Sound Map panel, density mode controls
- Perform Modal UI redesign: APD-inspired reductive modernist aesthetic, larger status display, refined chord pads, compact gesture guide
- Voice to Score refinements: state badges, collapsible tips, piano roll visual improvements, clearer error messages
- Landing page redesign: cinematic dark editorial layout
- Global CSS: custom range slider styling, focus states, select styling, refined color tokens
- Documentation updates

### What Was Author-Designed in Round 4

- **Design direction**: The choice to use visualjournal.it/apd as visual reference for the reductive, modernist, high-contrast aesthetic was the author's
- **Inline highlight concept**: The decision to show rhyme highlights directly in the writing area (not just a side panel) was the author's product vision
- **Family focus interaction**: Click-to-isolate in Sound Map was specified by the author as a needed interaction pattern
- **Word count visibility fix**: The observation that the counter was nearly invisible and the decision to make it clearly readable was the author's
