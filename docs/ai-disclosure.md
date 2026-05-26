# AI Tools Disclosure

## Overview

This project used AI coding assistants (specifically Devin/Claude) for scaffolding, implementation assistance, and debugging across two rounds of development. This disclosure is provided in accordance with academic integrity guidelines and the course rubric.

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

## Features Removed During Development

The following features existed in earlier versions and were deliberately removed:

**Multitrack Studio**: A multi-track recording and mixing interface was built but removed because it did not meet the quality bar for a polished demo. The mixing engine worked but the UI felt incomplete and the concept competed with rather than complemented the core gesture instrument idea.

**Lyric Overlay / Auto-sync**: A feature for rendering lyrics over video takes with auto-sync timing was built but removed because it was unreliable and added complexity without clear value for the core use case.

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
| YouTube IFrame API | Beat playback | YouTube ToS |
| IndexedDB | Local take storage | Browser native |

---

## Substantial Changes Beyond Scaffold

The original scaffold (created with `create-next-app`) provided only the basic Next.js structure. Substantial custom work included:

- Custom IndexedDB abstraction for audio/video blob storage
- Custom Web Audio drum engine with lookahead scheduler
- Gesture recognition from raw MediaPipe landmarks (no ML classifier)
- Latched transport state machine with hold-duration debounce
- Zone-based 8-slot chord addressing system
- YIN pitch detection implementation
- Piano roll canvas renderer with re-analyze and playback
- Window event bridge for YouTube ↔ Perform mode coordination
- Full Supabase guest/auth dual-mode architecture
- Custom design system (CSS variables, Tailwind extension, editorial aesthetic)
