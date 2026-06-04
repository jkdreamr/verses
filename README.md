# Verses

**A songwriting and performance workbench for the browser.**

Write lyrics, see how they rhyme, build a beat, then perform — make music with your
hands or your fingers, turn your voice into a trumpet, and turn a hummed melody into
real sheet music. Everything runs in the browser. No account required.

Live: **[verses-zeta.vercel.app](https://verses-zeta.vercel.app)** · Repo: **jkdreamr/verses**

The mental model: **your body is the instrument.** Verses isn't "AI writes your song" —
the artist controls everything. It just gives you more ways to play while you're still
inside the page.

---

## Contents

1. [Quickstart](#quickstart)
2. [Part 1 — Technical deep-dive](#part-1--technical-deep-dive)
   - [Architecture](#architecture)
   - [Tech stack](#tech-stack)
   - [The persistent audio engine](#the-persistent-audio-engine)
   - [Sampled instruments](#sampled-instruments)
   - [Perform: hands + touch](#perform-hands--touch)
   - [Smart Lyric Reader: strict line-by-line alignment](#smart-lyric-reader-strict-line-by-line-alignment)
   - [Live Trumpet pipeline](#live-trumpet-pipeline)
   - [Recording capture](#recording-capture)
   - [Voice Score pipeline](#voice-score-pipeline)
   - [Latest refinements](#latest-refinements)
   - [Tradeoffs & limitations](#tradeoffs--limitations)
3. [Part 2 — User guide](#part-2--user-guide)
4. [Privacy](#privacy) · [Development](#development) · [Disclosure](#disclosure)

---

## Quickstart

```bash
git clone https://github.com/jkdreamr/verses
cd verses
npm install
npm run dev
```

Open <http://localhost:3000>. Works in **guest mode with no environment variables** —
songs live in `localStorage`, recordings in IndexedDB. Supabase is optional:

```
NEXT_PUBLIC_SUPABASE_URL=your_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key
```

Camera/mic features need HTTPS or `localhost`. Best in Chrome on desktop; mobile gets
the on-screen touch instrument instead of the camera.

---

# Part 1 — Technical deep-dive

## Architecture

Next.js 14 (App Router) + React 18 + TypeScript + Tailwind. Everything is client-side;
there is no custom server. The editor is a layered text area with a highlight mirror
behind it (for Rhyme Lens), an exclusive-rail / exclusive-modal state machine, and a set
of feature modals that mount on demand.

```
src/
  app/                      App Router routes, layout, globals.css (design tokens)
  components/
    editor/                 Editor shell + feature modals
      PerformModal.tsx        Perform — the one place you record (hands/touch,
                              beat, chords, smart lyrics, trumpet, voice)
      TakesPanel.tsx          Takes — viewer for past recordings
      VoiceToScoreModal.tsx   Voice Score
      score/StaffView.tsx     VexFlow sheet-music renderer
      RhymeLens.tsx / …       Rhyme Lens (unchanged)
    perform/
      TouchInstrument.tsx     Multi-touch instrument pad
      StepSequencer.tsx       Editable 4×16 drum grid
      LyricTeleprompter.tsx   Strict line-by-line lyric overlay
    ui/Slider.tsx             Premium slider primitive
  hooks/
    perform/                useDrumEngine, useChordSynth, useHandTracking, useLiveTrumpet
    useSmartLyrics.ts       Speech-driven, strict line-by-line lyric follower
  lib/
    audio/                  engine.ts, samplers.ts, scales.ts, oneEuro.ts
    music/                  lyricAlign.ts, voiceScore.ts
    pitchDetection.ts       Shared YIN + MIDI helpers
    rhymeLens.ts            Rhyme engine (unchanged)
  public/
    samples/                Vendored trumpet / piano / cello recordings
    models/basic-pitch/     Vendored neural-transcription model
    worklets/pitch-detector.js   McLeod (MPM) AudioWorklet
```

**Lazy by design.** Tone.js, TensorFlow.js + basic-pitch, MediaPipe, VexFlow and the
sample packs are all dynamically imported the first time they're needed. The editor
route's initial JS stays ~70 kB; the heavy libraries live in separate chunks that load
on demand, so first paint is fast.

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS with CSS-variable design tokens (light/dark) |
| Audio engine | **Tone.js 15** (Sampler, Reverb, Filter, Synth) over one shared `AudioContext` |
| Pitch (real-time) | **pitchy 4** (McLeod) + a hand-written MPM **AudioWorklet** |
| Pitch (neural) | **@spotify/basic-pitch** on **@tensorflow/tfjs** |
| Music theory | **@tonaljs/tonal** (key + `Chord.detect`) |
| Notation | **VexFlow 4** (SVG staff) + MusicXML export |
| Hand tracking | **@mediapipe/tasks-vision** (HandLandmarker, WASM, in-browser) |
| Speech | Web Speech API (`SpeechRecognition`) |
| OCR | Tesseract.js (WASM) |
| Rhymes | Datamuse API + an offline phonetic engine |
| Storage | `localStorage` (songs) · IndexedDB (takes) · Supabase (optional auth/sync) |

## The persistent audio engine

Everything audible flows through **one** `AudioContext` and **one** fixed node graph,
created exactly once (`src/lib/audio/engine.ts`) and shared by every engine. We never
build a graph per note, and we never spin up a second context.

```
 drumBus  ─┐
 chordBus ─┤
 trumpetBus┤─►  master ─►  glue compressor ─►  limiter ─►  destination
 padBus   ─┘                                        └────►  recordDest (MediaStream tap)
                                  master ─►  analyser
```

- The native core (context, gain buses, compressor/limiter, recorder tap, analyser) is
  built **synchronously** — no dependency on Tone — so drums, mic analysis and recording
  work instantly. Tone is bound to the **same** context lazily (`engine.loadTone()`) only
  when a sampled instrument is first needed, so a `Tone.Sampler` output plugs straight
  into a native bus gain.
- **Volume sliders actually move volume.** Each slider writes to the gain of a node that
  is genuinely in the signal path, using `gain.setTargetAtTime(value, now, 0.02)` for
  click-free changes (never a bare `.value =` that the next note's envelope overwrites).
  Slider position is mapped through a perceptual curve (`gain = x²`) so the travel feels
  even. Master / Drums / Chords move independently across their full range in real time.
- Because the tap (`MediaStreamAudioDestinationNode`) hangs off the limiter, **everything
  you perform is captured** by `MediaRecorder` — drums, chords, the hand/touch lead, and
  the trumpet — with no extra wiring.
- Closing a Perform/Takes panel **suspends** the context rather than tearing it down, so
  reopening is instant and samples stay cached.

## Sampled instruments

Chords and the trumpet are **real recordings**, not oscillators. We vendor a curated,
sparse set of notes per instrument (from the `nbrosowsky/tonejs-instruments` library)
into `public/samples/{piano,cello,trumpet}` and let `Tone.Sampler` pitch-shift between
the anchors, which keeps the download small while covering the whole range. Each
instrument is `Sampler → lowpass filter → Tone.Reverb → bus` for warmth, with a loading
state while the MP3s fetch.

Three chord timbres ship: **Grand Piano**, **Warm Strings** (cello, slow attack, more
reverb) and **Felt Keys** (piano through a dark lowpass + long reverb — a felt/EP voice).

## Perform: hands + touch

Perform turns a webcam **or** a touchscreen into a scale-locked instrument so people
with no keyboard can make music.

**Hand tracking (MediaPipe).** `HandLandmarker` runs in `VIDEO` mode at ~30 fps and
returns 21 landmarks per hand. We map them to a real instrument:

- **Right hand = a theremin-style XY pad.** Horizontal position selects a note (or chord)
  from a **scale-locked** ladder — you pick the key + scale (`src/lib/audio/scales.ts`),
  so you're always in key. Vertical position controls expression (filter cutoff + level).
  Raw landmark X/Y is smoothed with a **One-Euro filter** (`oneEuro.ts`) — adaptive
  low-pass that smooths hard when the hand is slow (kills jitter) and lightly when it's
  fast (kills lag). Note changes glide with **portamento** so it sounds like an
  instrument, not a stair-step.
- **Pinch = note on/off.** Thumb–index distance is normalised by palm size and gated with
  **hysteresis** (on below 0.45, off above 0.62) so a held note doesn't chatter.
- **Left hand = transport.** Hold an open palm to start/loop the beat, a fist to stop, a
  pinch to mute — latched with a hold timer + cooldown so a brief gesture doesn't trigger.
- Camera frames never leave the device; you can toggle the skeleton overlay and swap
  hands, and preferences persist in `localStorage`.

**Touch instrument (`TouchInstrument.tsx`).** The primary path on phones and for anyone
who can't/won't use a webcam: a multi-touch, scale-locked XY pad where **every finger is
its own gliding synth voice** (true polyphony via a Tone voice pool), plus a row of large
chord pads. X→note in scale, Y→brightness/level; targets are ≥44 px with clear press
animations and `touch-action: manipulation` for sub-frame response.

## Smart Lyric Reader: strict line-by-line alignment

The teleprompter sits in the Perform stage (the "black space" over the camera or touch
pad) and follows you as you sing. Because we already **know** the written lyrics, this is
*alignment*, not open transcription (`src/lib/music/lyricAlign.ts`, `useSmartLyrics.ts`,
`LyricTeleprompter.tsx`).

1. **Per-line keys.** Each lyric line is tokenised into words, and each word is tagged
   with a normalised form plus **Soundex** and **Metaphone** codes (so "night"/"nite",
   "come"/"comb" still match).
2. The Web Speech API runs `continuous`, `interimResults` — a noisy, drifting transcript.
3. On each interim result we score the **current line** and the **single next line** by the
   fraction of their words that fuzzy-match the tail of what was heard (exact, small
   **Levenshtein** distance, or a shared Soundex/Metaphone bucket).
4. **Strict advance.** The active line moves forward **by at most one line at a time** and
   **never jumps backward** — no matter what the recogniser does, the highlight walks the
   song line by line, which keeps it accurate through repeated words and choruses. Within
   the active line we highlight up to the furthest word matched and auto-centre the scroll.
5. The recogniser stops on silence, so we **auto-restart** it on `end`. If speech isn't
   available or matching stalls (>6 s), we fall back to a timed **Pace** scroll (with an
   adjustable seconds-per-line); a manual up/down **nudge** is always available.

Honest note: sung lyrics are harder to recognise than speech, and the API is
browser-dependent — that's why the strict line walk, the nudge and the Pace fallback are
always there.

## Live Trumpet pipeline

In Perform's **Sound** tab, flip **Voice → Trumpet** and your voice drives a **real
recorded trumpet** (`Tone.Sampler` over `public/samples/trumpet`, `useLiveTrumpet.ts`).
It shares the same microphone the take records from — no second permission prompt.

- **Live Monitor.** The mic feeds a **McLeod Pitch Method (MPM) AudioWorklet**
  (`public/worklets/pitch-detector.js`) running **off the main thread** — the same
  normalised-square-difference algorithm pitchy implements, inlined so it needs no
  bundler step. Each voiced frame posts `{ freq, clarity, rms }`; **clarity gates note-on**
  (noisy/unvoiced frames are ignored), Hz is converted to the nearest note (optionally
  **snapped to the performance key/scale**), and the sampler is driven with **portamento**
  so slides feel like a brass player. Input **RMS → velocity**, so louder singing is louder
  and brighter. A **release-hold** keeps the horn ringing through momentary clarity dips so
  sustained, legato singing doesn't chop into separate notes. ~30–100 ms of latency is
  inherent to real-time pitch→audio and can't be fully removed (Vochlea's Dubler FAQ says
  the same).
- **Sing-then-Convert.** Record the dry vocal, then analyse it **offline with pitchy**,
  segment it into clean notes, and play a **perfectly-tracked** trumpet line back — higher
  quality, no live-latency artefacts.

Everything routes through the trumpet bus, so the trumpet is captured in your take. While
the trumpet is on, the dry-voice record tap is **ducked** so the take is the horn, not a
latency-doubled voice + horn.

## Recording capture

A Perform take records **your voice + every layer** as one stream:

- **Voice into the recording, not the speakers.** `getUserMedia` audio is routed to a
  `MediaStreamAudioDestination` **record tap** (never back to the speakers, to avoid
  feedback), then mixed with the engine's master so the take is voice plus drums, chords
  and trumpet — not just the instruments. Echo cancellation is **on** here because the mic
  is meant to hear *you*, not re-capture the monitored beat. (Voice Score, which needs a
  dry vocal for pitch detection, keeps browser DSP **off** instead.)
- **Video takes** composite from a layered canvas: the recorded canvas holds camera +
  skeleton + note flashes (`captureStream`), while the live-only **chord-zone grid** sits
  on a separate canvas that's never captured.
- **MIME fallback chain** with `MediaRecorder.isTypeSupported` (video: `vp9/opus` →
  `vp8/opus` → `webm` → `mp4`; audio: `webm;opus` → `webm` → `mp4` → `ogg`); the `Blob` is
  built from the recorder's **actual** `mimeType`.
- **Chunks** accumulate from `ondataavailable`, the context is **resumed inside a user
  gesture** (iOS), and tracks are stopped on teardown. Takes are stored in IndexedDB and
  reviewed in the Takes panel.

## Voice Score pipeline

Hum or sing a melody → notes → chords → sheet music (`src/lib/music/voiceScore.ts`,
`VoiceToScoreModal.tsx`).

**One auto-optimal pipeline — no quality/timing knobs.** There are no Strict/Balanced/
Sensitive or Raw/Light/Strong modes any more: Voice Score always runs the most accurate
path automatically. The only control is an (auto-detected, overridable) tempo.

1. **Detection.** Primary engine is **basic-pitch** (neural): the recorded blob is
   resampled to 22.05 kHz mono in an `OfflineAudioContext`, run through the lazily-loaded
   TensorFlow.js model (vendored at `public/models/basic-pitch`), and decoded to note
   events with onsets + pitch bends. A single tuned **YIN** path is kept as a silent
   offline fallback, used automatically if the model can't load or finds nothing.
2. **Smoothing.** Median pitch smoothing + **octave-error correction** (the neural result
   is cross-checked against a YIN track and only snapped when YIN strongly agrees); a
   polyphonic result is reduced to a single melodic line, then leftover slivers are merged.
3. **Segmentation & quantization.** Micro-fragments are absorbed into their neighbours and
   onsets/durations snap to a **1/16 grid** against the **auto-detected BPM** (estimated
   from inter-onset intervals; you can type a tempo to override it).
4. **Key inference.** A **Krumhansl-Schmuckler** profile correlation over the
   duration-weighted pitch-class histogram picks the best of all 24 major/minor keys.
5. **Chord inference.** Notes are grouped into beat windows and **`Tonal.Chord.detect`**
   suggests the most likely chord per window, producing a chord sheet (symbols shown above
   the staff), not just a melody.
6. **Notation & export.** Real sheet music via **VexFlow** (treble clef, key + time
   signature, auto-beaming, chord symbols), alongside the existing Piano Roll and Note
   List. Editing (select / pitch ±1 / split / merge / delete) is preserved. Export
   **MIDI, MusicXML, JSON, CSV**, and a **printable lead sheet** (melody + chords).
   Detected-melody playback uses a sampled piano (`Tone.Sampler`); you can also A/B it
   against the original recording. Live input warnings flag clipping / silence / noise.

## Latest refinements

**One place to record: Perform.** Recording has moved entirely into Perform, and **Takes
is now a pure viewer** for past recordings (the old recorder is gone). Two things came with
it:

- **Smart lyrics in the stage.** A **Lyrics** toggle drops your written words into the
  Perform "black space" and follows your voice **strictly line by line** — a new aligner
  (`createLineAligner`) only ever advances the active line by one and never jumps backward,
  so the highlight stays accurate through repeats and choruses. Pace fallback + manual
  nudge included.
- **Voice → Trumpet in the Sound tab.** The live trumpet now lives in Perform and shares
  the take's microphone (no second prompt). A **release-hold** keeps the horn ringing
  through brief clarity dips so legato singing doesn't chop, and turning it on **ducks the
  dry-voice** record tap so the take is the horn rather than a doubled voice + horn.

**Perform — the drum loop restarts cleanly.** Closing your left hand into a fist stops the
beat and opening it again **restarts** it. The sequence is now started once and the shared
transport does the play/stop, fixing the case where fist→open went silent.

**Perform — takes capture your voice.** The singer's mic is routed into the recording tap
(not the speakers, to avoid feedback), so a take is voice **plus** the instruments — not
just the drums/piano.

**Voice Score — one auto-optimal pipeline.** The Strict/Balanced/Sensitive, Raw/Light/
Strong and Neural/Fast selectors are gone. It always runs neural transcription with octave
repair, sliver-merging and a 1/16 grid at the auto-detected tempo; the only knob left is an
optional tempo override.

**Perform — a chord-placement grid that's on screen but never in the recording.**
The camera view now shows a guide dividing it into the exact zones the hand maps to,
so you know where to reach for each chord/note. It is **truthful** — boundaries come
straight from the real `X→action` mapping (`floor(x · N)` over the progression slots in
chord mode; the in-key scale ladder in lead mode), reflect the chosen key/scale, and the
active zone lights up as your hand moves. The recording-exclusion uses a **two-canvas**
design:

- A **capture canvas** composites the mirrored camera frame + skeleton + note-trigger
  flashes — this *is* the recorded picture. A Perform take now combines
  `captureCanvas.captureStream(30)` with the engine's audio tap into one `MediaStream`
  and records video (`has_video:true`); touch mode stays audio-only.
- A **separate grid canvas** (a distinct DOM element, `pointer-events-none`, layered on
  top) draws the zone lines, labels, active highlight and hand indicator. It is **never**
  drawn onto the capture canvas, so the guide is impossible to capture — playback shows
  camera + skeleton + flashes, never the grid. A live show/hide toggle (default on) and
  `prefers-reduced-motion` are honoured; both canvases share one 0..1→width space so the
  guide, the recorded picture and the hand indicator always align.

The trumpet now exposes a sample-loading state (the panel + status bar show "loading
samples…") so a take started before the samples arrive is never silently empty.

A second pass focused on making each feature genuinely musician-usable.

**Editor — highlights pinned to the text (scroll-sync).** Rhyme Lens draws its coloured
boxes in a *backdrop* layer behind a transparent-text textarea. Previously the two layers
were different sizes (the textarea's `height:100%` resolved smaller than the absolutely-
positioned backdrop), so their scroll ranges diverged and the boxes drifted off their
words. Both layers are now the **exact same `absolute inset-0` box** with identical font,
line-height, padding, `white-space`, `word-break` and `box-sizing`; the textarea's
scrollbar is hidden so its text column width matches the backdrop on every platform; and
the backdrop's `scrollTop/scrollLeft` are synced on `scroll`, `input`, window `resize` and
via a `ResizeObserver`. Verified pixel-locked over 40+ lines. The editor's focus cue is now
an on-brand **amber caret** instead of a focus-ring box (a ringed prose editor reads like an
error state); form inputs elsewhere keep their accessible ring.

**Perform — a real step sequencer.** The drum machine is now an editable **4×16 grid**
(`useDrumEngine` + `StepSequencer`): click or click-drag to paint hits, scheduled on the
**`Tone.Transport`** clock via a **`Tone.Sequence`** (with `transport.swing`), and a moving
playhead drawn through **`Tone.Draw`** so it lands on the right visual frame. Three sampled
kits (Acoustic / Punch / Lo-Fi) load as `Tone.Player`s per voice → per-voice gain (level +
mute/solo) → lowpass → drum bus. Tempo, swing, clear, editable templates and **save/load of
custom patterns to localStorage** round it out.

**Perform — voice-led, softer chords.** On each chord change the engine generates the
inversion/octave candidates and picks the **voicing that moves the least** from the sounding
chord (sorted nearest-neighbour cost), then releases only departing notes and attacks only
new ones, so common tones keep ringing (no hard cut). Six softened timbres: Grand Piano,
**Electric Piano** (FM), Warm Strings, Felt Keys, plus **Soft Pad** and **Synth Pad**
(`Tone.PolySynth` with fat unison oscillators) — all with slow-ish attacks, long releases,
warm lowpass + reverb and gentler default velocity.

**Takes — sharper lyric matching + a smoother trumpet.** The forced-alignment matcher now
adds a compact **Metaphone** phonetic key beside Soundex + Levenshtein, so sung mis-hearings
("fone"/"phone", "rite"/"right") still align; the windowed pointer tolerates skipped/repeated
words and never leaps backward, and a clear **Pace-mode** badge appears when it can't hear
you. The Live Trumpet **median-smooths** the worklet pitch and adds **note hysteresis** (a
new note must hold ~2 frames before the sampler commits) to stop semitone chatter, and maps
loudness to **velocity *and* brightness** (the lowpass opens as you sing louder) with
portamento glide between committed notes.

**Voice Score — tuned harder.** basic-pitch runs with solo-voice params (onset 0.5 / frame
0.3 / `minNoteLength` 11 frames / `minFreq` 80 / `maxFreq` 1100 / inferOnsets + melodiaTrick);
a **YIN pitch track over the same buffer cross-checks octaves** and conservatively repairs
basic-pitch's octave flips; tiny same-pitch fragments are merged. Chords come from **chroma
template matching** (a duration/confidence-weighted 12-bin chroma per window correlated
against maj/min/7/maj7/m7/dim/sus templates) for a cleaner chord sheet, and tempo is found by
**phase-aligning candidate beat grids to the onsets** (cos autocorrelation) so 2×/½× errors
are avoided. Verified offline: C-major scale → C, A-minor melody → A minor, a 120 BPM grid →
120, and a I–IV–V → "C F G".

## Tradeoffs & limitations

- **Latency is real.** Live voice→trumpet and hand→sound have ~30–100 ms of unavoidable
  latency; Sing-then-Convert trades immediacy for a clean result.
- **Monophonic vocals work best.** Pitch detection (both YIN and the melodic reduction)
  assumes one clear line; chords/harmony and background music degrade it.
- **Neural model size.** basic-pitch needs TensorFlow.js; the first transcription loads a
  few MB of model + runtime. The YIN fallback keeps the feature usable offline.
- **Speech recognition is browser-dependent** and harder on sung than spoken words — hence
  the Pace fallback and manual nudge.
- **YouTube audio can't be captured** in recordings (cross-origin); it plays through your
  speakers while the mic captures it Photo-Booth style.
- **Sampled, not modeled.** The trumpet is a good sampled instrument with pitch tracking,
  not a studio voice-conversion model.

---

# Part 2 — User guide

### Writing + Rhyme Lens

1. Open or create a song and start typing. It autosaves; version history keeps snapshots.
2. Toggle **Rhyme Lens** (bottom-left). Coloured highlights appear *behind* your text as
   you write — end rhymes, internal echoes, multisyllabic chains, homophones,
   slant/family rhymes, assonance, consonance, alliteration, spelling echoes and repeated
   phrases. Each family gets its own colour; click one in the Sound Map to isolate it.
   Three density modes (Clean / Detailed / Max) control how much is shown.
3. Select any word and hit **rhymes** (⌘R) for perfect / near / sounds-like results.
4. Use **⌘/** to insert structure tags, **scan** to OCR a handwritten page, and **export**
   to copy/print.

> Tip: phonetic analysis is offline and approximate — accent and delivery change what
> *you* hear as a rhyme.

### Beats

Paste a YouTube link in the bottom bar to play it, set **A/B loop** points, and drop
named markers at key timestamps. When you record, the beat can auto-start.

### Takes (your recordings)

Open **takes** to review everything you've recorded — **play, rename, download, delete**.
Takes is a viewer now; all recording happens in **Perform** (there's an **↗ Perform**
button right in the panel).

### Perform — the one place you record

Open **perform**. Up top, choose **Hands** or **Touch**, toggle **Lyrics**, and hit
**Record** whenever you're ready. Recordings capture **your voice + every layer** (beat,
chords, trumpet); use headphones so the beat doesn't bleed into the mic.

- **Hands:** Start camera. Keep both hands in frame. The on-screen **grid** shows which
  zone triggers which chord/note (toggle it with **Grid on/off**, top-right — it's a live
  guide and never appears in your recording). **Right hand** moves left↔right to pick the
  note/chord (locked to your key) and up↕down for brightness; **pinch** to sound it.
  **Left hand:** hold open palm to start the beat, fist to stop, pinch to mute. Press
  **Record** to capture a video take (camera + your playing, without the grid).
- **Touch (and mobile):** drag on the pad — left↔right is pitch, up↕down is brightness;
  multiple fingers = chords. Tap the large chord pads for the progression.
- **Lyrics:** click **Lyrics** to drop your written words into the stage. They scroll
  **strictly line by line** as you sing (see Smart Lyric Reader above); a Pace fallback and
  up/down nudge are always there.
- **Beat tab:** build the drum groove yourself. Pick a kit (Acoustic / Punch / Lo-Fi),
  load a template and then **click or drag across the grid** to add/remove hits per
  instrument. Set tempo + swing, mute/solo a row, adjust per-voice levels, and **Save** a
  pattern to reuse later. Hit **Play beat** to hear it loop with a moving playhead.
- **Sound tab:** flip **Voice → Trumpet** to sing through a sampled horn (pick Trumpet /
  Muted / Brass Bold / Flugel / Jazz Lead, set Brightness / Glide, optionally **Snap to
  song key**). The **Master / Drums / Chords** sliders move each layer independently and
  click-free; pick a chord timbre (Grand Piano, Electric Piano, Warm Strings, Felt Keys,
  Soft Pad, Synth Pad). Chords voice-lead automatically, so changes glide smoothly.

### Playable Piano

In the chord-slot editor, the on-screen piano previews chord roots and lights up the
chord tones of the active slot. A–J plays white keys, W E T Y U the black keys; no stuck
notes after release.

### Voice to Score

Open **voice score**, hit **Record**, sing one clear melody (headphones help), then
**Stop**. There are no accuracy/timing knobs — it always runs the most accurate path and
auto-detects everything (the only control is an optional **tempo** override). You'll get
the detected **key + chord sheet**, and three views: **Piano Roll**, **Note List**,
**Staff**. Click notes to select and **pitch ±1 / split / merge / delete**. Play the
**detected** melody (sampled piano) or the **original**, then export **MIDI / MusicXML /
JSON / CSV** or **Print a lead sheet**.

> Tips: sing one line at a time, hold notes a touch longer, and keep background music off.

---

## Privacy

Camera and microphone stay on your device. Hand tracking (MediaPipe), pitch detection,
OCR (Tesseract) and note transcription (basic-pitch) all run locally. Smart Lyric Reader
uses the browser's built-in Web Speech API (the browser/OS may process speech). Takes are
stored in your browser's IndexedDB; in guest mode all song data stays in `localStorage`.

## Development

```bash
npm run dev     # dev server
npm run build   # production build
npm run lint    # lint
npm test        # Rhyme Lens engine test suite
```

`docs/REBUILD_PLAN.md` documents the architecture and which files each feature touches.
Tauri native shell lives in `src-tauri/` (`npm run tauri dev`, requires Rust).

## Disclosure

See `docs/ai-disclosure.md` for the full disclosure on AI assistance used.

---

*Built for songwriters. Your body is the instrument.*
