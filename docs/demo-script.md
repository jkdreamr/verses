# Verses — Demo Script

## Setup (before demo)
- Open a song with at least 8 lines of lyrics (chorus + verse)
- Load a YouTube beat in the bottom bar
- Have the app in dark mode (default)
- Use Chrome on desktop for gesture features
- Have headphones ready (or use speakers for demo — trumpet will be louder)

---

## Part 1: Writing + Rhyme Lens (2 min)

**Open the song. Show the editor.**

"This is the writing view. Clean, distraction-free. Just the lyrics and the tools you need."

**Highlight a word, click Rhymes tooltip.**

"If you want rhyme options for any word, just select it."

**Show the RhymePanel with perfect/near/sounds-like tabs.**

"But that's single-word lookup. What if you want to understand the whole draft?"

**Click Rhyme Lens (bottom-left of editor).**

"Rhyme Lens analyzes the entire lyric and highlights sound families directly in the editor."

**Point to the inline highlights and Sound Map panel:**

"Each color is a different rhyme family. Amber might be end rhymes. Blue might be internal echoes. The Sound Map on the right shows what each family is — I can click one to isolate it."

**Click a family in the panel — show it isolating in the editor.**

"End rhymes, internal rhymes, multisyllabic chains, slant, alliteration, repetition — all detected locally. Nothing leaves the browser. Updates as I type."

**Switch density modes — Clean, Detailed, Max.**

"Clean shows only the strongest families. Max shows everything."

**Close the panel.** "Toggle off — highlights disappear, I'm back to writing."

---

## Part 2: New Take — Setup (2 min)

**Click takes → New Take.**

"In Verses, Perform Mode isn't a separate app. It's part of how you record a take."

**Point to Performance Layers section.**

"When I open a new take, I choose how much of the performance system to turn on."

**Click "Gestures + Trumpet".**

"I'm enabling both hand gestures and live trumpet."

**Show the gesture setup sub-panel:**

"Beat source — I'll use Drum Preset for now. Boom Bap at 88 BPM. Chord progression — I'll use R&B."

**Show the trumpet setup sub-panel:**

"Trumpet preset — Trumpet Sketch. I can tune brightness and vibrato."

"Headphones warning because I'm monitoring through speakers."

**Check "record video".**

"I'll record video so the hand tracking is visible in the take."

---

## Part 3: Recording (3–4 min)

**Click Record. Grant permissions.**

"One permission prompt for camera and mic."

**Show the camera feed with zone overlay.**

"Four zones on the right side of the camera. Those are my chord zones."

**Raise left hand, open palm, hold.**

"Hold open palm. The beat latches on."

*Beat starts and keeps playing.*

"My hand is down. Beat is still going. That's the latch — I triggered it once, it loops until I stop it."

**Move right hand across zones with open palm.**

"Right hand, open palm — I'm sweeping through the chord slots. Each zone is a different chord."

**Switch to two-finger gesture.**

"Two fingers activates slots 5 through 8. Different chords."

**Make right fist.**

"Fist — silence. No chord."

**Start singing.**

"Now I'm singing into the mic. Listen."

*Trumpet sound follows voice.*

"That's the trumpet synthesis following my pitch in real time. When I stop singing, it fades out. When I start again, it comes back."

**Point to teleprompter.**

"The teleprompter is in Smart Lyric Follow mode. It's listening to what I sing and trying to match it to the lines. It's not perfect — sung words are harder than spoken — but it moves forward as I go. I can also nudge it manually."

**Play some chords while the beat runs.**

"So I have a looping beat, I'm controlling the harmonic content with my right hand, and the melody is being transformed live."

**Click the piano keyboard.**

"I can also click the piano to audition individual notes — or to preview what a chord root sounds like before I assign it."

**Make left fist, hold.**

"Fist to stop the beat."

*Beat stops.*

**Click Stop recording.**

---

## Part 4: Save and Review (1 min)

**Review screen appears.**

"The take is captured. Everything mixed together — drums, chords, trumpet — minus the YouTube audio which can't be routed for browser security reasons. The label auto-suggests 'gesture + trumpet take 12:40'."

**Save the take.**

**Show TakesPanel with the new take.**

"There it is. Play it back."

*Playback of the take — drums/chords/trumpet audible.*

---

## Part 5: Voice to Score (optional, 1 min)

"Separately, there's Voice to Score. This is for mapping out a melody."

**Open Voice to Score from toolbar.**

"Hum a phrase — 4 or 5 notes."

*Record → analyze.*

"YIN pitch detection, piano roll output. I can re-analyze, export the note list, or play back my original recording to compare."

---

## Closing

"The app keeps you in control. It doesn't generate music for you. Your hands, your voice, your song."

"Writing, performing, and recording are one session — not three separate tools."

---

## Q&A Prep

**Q: Does this use AI for the music?**
A: No. The drum machine is procedural synthesis. The chord synth is a standard oscillator stack. The trumpet is a multi-oscillator Web Audio model that follows your pitch. The only "smart" things are gesture recognition (MediaPipe, runs locally) and the rhyme analysis (local phonetic matching).

**Q: Why can't you record the YouTube audio?**
A: Browser security restrictions prevent capturing audio from cross-origin iframes like YouTube. The take captures everything synthesized in the browser — drums, chords, trumpet — plus whatever your mic picks up from the room. This is documented and not hidden.

**Q: Does it work offline?**
A: The editor works fully offline. MediaPipe downloads its model once from a CDN on first use. YouTube requires network access. Datamuse rhyme lookup requires network.

**Q: Future work?**
A: MIDI keyboard input, sample-based drums, export chord progressions to MIDI, Supabase-backed take sync across devices.
