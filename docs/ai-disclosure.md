# AI Tools Disclosure

## Overview

This project used AI coding assistants (specifically Devin/Claude) for scaffolding, implementation assistance, and debugging. This disclosure is provided in accordance with academic integrity guidelines and the course rubric.

## What AI Was Used For

- Code scaffolding and boilerplate generation
- Debugging TypeScript and Next.js configuration issues
- Generating initial implementations of complex algorithms (pitch detection autocorrelation, Web Audio scheduling)
- Suggesting component structures and patterns
- Writing documentation drafts

## What Was Not AI-Generated

- **Product concept and direction**: The idea of a gesture-controlled songwriting workbench, the emphasis on "the artist's body as instrument," and the specific feature set were the author's original decisions
- **UX and design decisions**: Layout choices, visual language, typography approach, and editorial aesthetic
- **Music workflow design**: The specific drum preset patterns, chord mapping system, and gesture-to-music mapping were designed by the author based on music knowledge
- **Feature prioritization**: Deciding which features to include, what quality level was acceptable, and what to remove (studio, lyric overlay) were author decisions
- **All final code review and integration**: All generated code was reviewed, tested, and often substantially modified

## Features Removed During Development

The following features existed in earlier versions and were deliberately removed:

**Multitrack Studio**: A multi-track recording and mixing interface was built but removed because it did not meet the quality bar for a polished demo. The mixing engine worked but the UI felt incomplete and the concept competed with rather than complemented the core gesture instrument idea.

**Lyric Overlay / Auto-sync**: A feature for rendering lyrics over video takes with auto-sync timing was built but removed because it was unreliable and added complexity without clear value for the core use case.

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

## Substantial Changes Beyond Scaffold

The original scaffold (created with `create-next-app`) provided only the basic Next.js structure. Substantial custom work included:
- Custom IndexedDB abstraction for audio/video blob storage
- Custom Web Audio drum engine with lookahead scheduler
- Gesture recognition from raw MediaPipe landmarks (no ML classifier)
- Autocorrelation pitch detection from scratch
- Piano roll canvas renderer
- Full Supabase guest/auth dual-mode architecture
- Custom design system (CSS variables, Tailwind extension, editorial aesthetic)
