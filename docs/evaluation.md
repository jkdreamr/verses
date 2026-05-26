# Evaluation Plan — Verses

## What Was Tested

This document describes the evaluation approach, current evidence, and known limitations for Verses.

## Functionality Status

| Feature | Status | Notes |
|---------|--------|-------|
| Lyric editor + autosave | Working | localStorage and Supabase both tested |
| Rhyme finder (Datamuse) | Working | Requires network |
| OCR scan | Working | Tesseract.js WASM in browser |
| YouTube beat player | Working | Loop, markers, volume |
| Vocal takes recorder | Working | Audio + video, IndexedDB |
| Takes playback/rename/delete | Working | |
| Perform mode - hand tracking | Working* | *Requires HTTPS or localhost for camera |
| Perform mode - drum engine | Working | Procedural synthesis |
| Perform mode - chord synth | Working | |
| Perform mode - recording | Working | MediaStreamDestination |
| Voice-to-Score recording | Working | Requires mic permission |
| Voice-to-Score pitch detection | Working* | *Best with clean monophonic input |
| Voice-to-Score piano roll | Working | Canvas-based |
| Guest mode (no Supabase) | Working | All core features functional |
| Dark/light theme | Working | |

## Browser/Device Constraints

- Chrome/Edge recommended (best Web Audio + MediaRecorder support)
- Firefox: functional, minor codec differences
- Safari: some MediaRecorder limitations; iOS Safari may have issues with AudioContext autoplay
- Requires HTTPS or localhost for camera/mic access
- Tested on: Chrome 120+ (macOS), Safari 17 (macOS)
- Mobile: editor works; Perform mode works best on desktop

## Suggested User Testing Protocol

### Pre-session briefing
"This is a songwriting app. I'll give you a few tasks. Think aloud as you work. There are no wrong answers — I'm testing the app, not you."

### Tasks

**Task 1: Write a lyric draft**
- Open a new song
- Type 4 lines of a verse
- Highlight a word and find a rhyme
- Time to first rhyme suggestion (target: < 10 seconds)

**Task 2: Choose a drum preset**
- Open Perform mode
- Select "Boom Bap" preset
- Start the drum loop
- Success: drums playing within 15 seconds of opening perform mode

**Task 3: Map four chords**
- In Perform mode, open the chord map
- Change the open-palm gesture chord to Am
- Save the mapping
- Press "Play chord" to preview it
- Success: heard a chord within 30 seconds

**Task 4: Perform a progression with gestures**
- With camera running and drums playing
- Trigger at least 3 different chord gestures
- Observe the chord name update on screen
- Success: audible chord changes + correct label shown

**Task 5: Record a sung melody and inspect the score**
- Open Voice to Score
- Record a short 4-note melody
- View the piano roll result
- Copy the note sequence
- Success: at least 2 notes correctly detected

## Success Metrics

| Metric | Target |
|--------|--------|
| Task completion rate (5 tasks) | ≥ 4/5 tasks completed without help |
| Time to first sound (performs/drums) | < 20 seconds |
| Time to first saved take | < 60 seconds |
| User rating of creative flow (1-5) | ≥ 3.5 avg |
| Gesture mapping understood without explanation | ≥ 60% of users |
| No critical errors during demo | 100% |

## Competitive Comparison

| Tool | Lyrics | Beat | Rhymes | Gesture | Voice Sketch | Offline | Free |
|------|--------|------|--------|---------|--------------|---------|------|
| Notes app | ✓ | — | — | — | — | ✓ | ✓ |
| YouTube + Voice Memos | — | ✓ | — | — | — | partial | ✓ |
| BandLab | ✓ | ✓ | — | — | — | — | ✓ |
| RhymeZone | — | — | ✓ | — | — | — | ✓ |
| GarageBand | — | ✓ | — | — | partial | ✓ | ✓ |
| **Verses** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** | **✓** |

The key differentiation is the combination: no other listed tool provides lyrics + beats + rhymes + gesture-based harmony in a single focused interface.

## Known Limitations and Honest Assessment

1. **Gesture accuracy**: Geometric gesture recognition occasionally misclassifies gestures, especially in poor lighting. A ML-based classifier would improve this.
2. **Pitch detection**: The autocorrelation method produces uncertain results for notes held less than 100ms, or in noisy environments.
3. **Drum synthesis**: Procedural drums are functional but lack the warmth of sampled drums. A future version should use royalty-free sample packs.
4. **No persistence for performance sessions**: Chord mappings and drum preset selections are not persisted between sessions.
5. **MediaPipe loading time**: First load of the hand landmarker model (~5MB) takes 2-5 seconds depending on connection.
