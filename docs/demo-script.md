# Demo Script — Verses (3-5 minutes)

## Setup

Before the demo:
- Open Verses in Chrome on localhost or deployed URL
- Have a song open with a few lines typed
- Camera and mic permissions pre-granted
- Perform mode tested and working
- Either a YouTube beat URL ready to paste, or Boom Bap confirmed working

---

## Q1: Why did you build this?

"I'm a musician, and my songwriting process is scattered. I write lyrics in Notes, find beats on YouTube in a separate tab, use RhymeZone in another tab, hum ideas into Voice Memos, and then a week later I have fragments everywhere but no real song.

The problem isn't talent or time. It's friction. Every app switch costs me momentum. The moment where a hook comes together is fragile — if I stop to open a different app, I often lose the thread.

So I wanted to build one focused environment where I could keep the early creative moment intact. Write the lyric, hear the beat, sketch the harmony, capture the melody — without ever leaving the page."

## Q2: How exactly does it work?

**[Show the editor]**
"This is the writing surface. Intentionally minimal — autosave, version history, a rhyme finder. Highlight a word, the rhymes float up. You can paste a YouTube link at the bottom and it plays under your writing while you're still on the page."

**[Show vocal takes briefly]**
"You can record a raw vocal idea — audio or video — and it saves directly to the song. No mixing, no cloud upload. Just a take."

**[Open Perform mode]**
"This is the part I want to show you. Perform mode. I'll click Start Camera."

*[Click Start Camera, wait for hand skeleton to appear]*

"Now MediaPipe is tracking my hands in real-time — 21 landmark points per hand, 30 frames per second, running entirely in the browser.

For the beat, I can either use a YouTube URL I already have open — the beat from the editor carries over — or I can just pick a drum preset. I'll use Boom Bap."

**[Raise left open palm, hold for ~0.4s → beat starts]**

"I raise my left open palm and hold it for about half a second. The beat latches on — it's going to keep looping now even when I put my hand down."

*[Lower hand]*

"See — hand is down. Beat is still going. That's intentional. If it only played while I held my hand up, I couldn't use both hands freely. The latch frees me up."

**[Make right fist → silence, then raise open palm to re-latch]**

"Left fist stops it. Open palm again — latches back on."

**[Use right open hand in different horizontal zones]**

"Now my right hand controls chords. I've got 8 chord slots mapped. With an open hand, moving left to right across the frame, I'm hitting slots 1 through 4."

*[Move right hand slowly across zones, show slot grid updating]*

"Watch the slot grid — it's tracking which zone my hand is in. Each zone is a different chord."

**[Switch to two-finger gesture, sweep zones]**

"Two fingers gets me slots 5 through 8. Same zone logic, different gesture. So I've got eight chords total across just two hand shapes."

**[Make right fist]**

"Fist cuts everything. Immediate silence."

*[Show SILENCE label on screen]*

"And pinch is a sustain toggle — holds the chord even if I change my hand shape."

**[Hit Record, perform a short phrase, stop]**

"I'll hit Record and do a quick pass."

*[Perform 15–20 seconds: latch beat, play through a few chord slots]*

"Stop. And I can save that as a Take — it lives in this song."

**[Close Perform, open Voice to Score]**

"The other piece is Voice to Score. Let me show you."

*[Open Voice to Score, click Record, sing a 4-note melody, click Stop]*

"I just sang four notes. The app ran YIN pitch detection — a proper fundamental frequency algorithm — and here's the piano roll."

*[Show piano roll with note names]*

"Each block is a note: name, start time, duration. If the result looks off I can hit Re-analyze and it'll reprocess the same recording — I don't have to sing again. And I can play the original audio back to compare."

*[Play back original recording if result is good]*

"It's not sheet music. It's a melody sketch. But that's the right thing for this stage of writing — you just want to know the shape of the idea."

## Q3: What's the point of all this?

"The app keeps you in control. It doesn't generate music for you. Your hands, your voice, your song. Verses just removes the friction between the idea and the capture.

There's also an accessibility angle I find interesting — the gesture instrument means someone who doesn't play piano can still explore harmony physically. Move your hand, find a chord that feels right to the lyric."

## Q4: What would you add?

"MIDI output is the obvious next step — same gestures, but triggering any external synth or DAW via WebMIDI. That would make it genuinely useful in a production workflow, not just for sketching.

Sample-based drums are something I want too. The procedural sounds work, but they lack character.

And honestly — I'd want more people to use it and break it. The core idea feels right. The execution is early."

---

*End of demo. Total time: approximately 3-4 minutes.*
