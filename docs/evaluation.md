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
| Perform mode - drum engine (DRUMS source) | Working | Procedural synthesis, 5 presets |
| Perform mode - YouTube beat source | Working | Controlled via window event bridge; audio not capturable in recording |
| Perform mode - latched transport | Working | Left open palm holds ~0.4s to latch on; fist to stop |
| Perform mode - 8-slot chord system | Working | Open palm + zone 1-4 = slots 1-4; two fingers + zone 1-4 = slots 5-8 |
| Perform mode - chord sustain (pinch) | Working | Sustain toggle |
| Perform mode - recording | Working* | *Synth audio only; YouTube audio excluded by browser cross-origin policy |
| Voice-to-Score recording | Working | Requires mic permission |
| Voice-to-Score pitch detection (YIN) | Working* | *Best with clean monophonic input |
| Voice-to-Score re-analyze | Working | Reprocesses same recording without re-recording |
| Voice-to-Score playback | Working | Plays original recording for comparison |
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

**Task 2: Start the drum loop**
- Open Perform mode
- Select the "Boom Bap" drum preset (DRUMS source)
- Start the camera
- Raise your left open palm and hold it still for about 0.4 seconds
- Observe: the beat should start and keep looping even after the hand is lowered
- Success: drum loop playing and continuing without the hand held up, within 20 seconds of opening Perform mode

**Task 3: Trigger chords across zones**
- With the drum loop playing, raise your right open hand
- Move your right hand to different horizontal positions (far left, center-left, center-right, far right)
- Observe: the active chord slot (1–4) should change as the hand moves across the screen
- Switch to a two-finger gesture and repeat the zone sweep to trigger slots 5–8
- Observe: the slot grid on screen should highlight the active slot in real time
- Success: at least 3 different slots triggered with audible chord changes and correct slot label shown

**Task 4: Silence the chords**
- With a chord playing, make a right fist
- Observe: chords should go immediately silent; the UI should show a SILENCE label
- Success: chord cuts off within one frame; SILENCE label visible

**Task 5: Record a sung melody and inspect the score**
- Open Voice to Score
- Click Record, grant mic permission if prompted
- Sing a short 4-note ascending melody (e.g. C D E G)
- Click Stop
- View the piano roll result and note list
- If the result looks off, click Re-analyze
- Success: at least 2 notes correctly detected and visible on the piano roll

## Voice to Score — Manual Test Cases

The following specific inputs were used during development to verify pitch detection behavior:

| Input | Expected result |
|-------|----------------|
| 4-note ascending melody (e.g. C D E G) | 4 distinct note events in ascending order |
| One repeated note held (e.g. A4 for 2 seconds) | Single note event or near-identical consecutive notes merged |
| Note with slight vibrato | Core pitch detected; vibrato should not fragment into multiple notes |
| Melody with silence between notes | Notes separated cleanly; silence gaps visible in piano roll |
| Noisy input / quiet input | Graceful degradation; low-confidence detections filtered or flagged |

## Success Metrics

| Metric | Target |
|--------|--------|
| Task completion rate (5 tasks) | ≥ 4/5 tasks completed without help |
| Time to first looping beat (Task 2) | < 20 seconds |
| Time to first saved take | < 60 seconds |
| User rating of creative flow (1-5) | ≥ 3.5 avg |
| Latched transport understood without explanation | ≥ 60% of users |
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

1. **Gesture accuracy**: Geometric gesture recognition occasionally misclassifies gestures, especially in poor lighting or when the hand is at an oblique angle to the camera. A ML-based classifier would improve this.
2. **Pitch detection**: The YIN algorithm is more robust than basic autocorrelation, but still produces uncertain results for notes held less than 100ms, heavy vibrato, or in noisy environments.
3. **Drum synthesis**: Procedural drums are functional but lack the warmth of sampled drums. A future version should use royalty-free sample packs.
4. **YouTube audio gap in recordings**: Browser cross-origin restrictions prevent the YouTube player audio from being captured. This is expected behavior, not a bug, but it means a Take recorded against a YouTube beat will only contain the synth audio.
5. **No persistence for performance sessions**: Chord mappings and drum preset selections are not persisted between sessions.
6. **MediaPipe loading time**: First load of the hand landmarker model (~5MB) takes 2-5 seconds depending on connection.
