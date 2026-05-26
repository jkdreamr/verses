# Demo Script — Verses (3-5 minutes)

## Setup

Before the demo:
- Open Verses in Chrome on localhost or deployed URL
- Have a song open with a few lines typed
- Camera and mic permissions pre-granted
- Perform mode tested and working

---

## Q1: Why did you build this?

"I'm a musician, and my songwriting process is scattered. I write lyrics in Notes, find beats on YouTube in a separate tab, use RhymeZone in another tab, hum ideas into Voice Memos, and then a week later I have fragments everywhere but no real song.

The problem isn't talent or time. It's friction. Every app switch costs me momentum. The moment where a hook comes together is fragile — if I stop to open a different app, I often lose the thread.

So I wanted to build one focused environment where I could keep the early creative moment intact. Write the lyric, hear the beat, sketch the harmony, capture the melody — without ever leaving the page."

## Q2: How exactly does it work?

**[Show the editor]**
"This is the writing surface. It's intentionally minimal — just a textarea with autosave, version history, and a rhyme finder. Highlight a word, the rhymes float in. Paste a YouTube link at the bottom, it plays under your writing."

**[Show vocal takes]**
"You can record vocal ideas — audio or video — and they save directly to this song. Simple, raw, no mixing. Just a take."

**[Open Perform mode]**
"This is the new part. Perform mode. I'll click Start Camera — and now MediaPipe is tracking my hands in real-time. The hand skeleton you can see is 21 landmark points being detected per hand, 30 frames per second, entirely in the browser.

My left hand controls the drums. I'll raise an open palm — and the beat starts. I'll lower it to a fist and it stops. The height of my hand controls volume. The horizontal position changes the filter — more to the right, and it opens up.

My right hand triggers chords. I've mapped my gestures — open palm is C major, pinch is G, two fingers is A minor, fist is F. When I change my gesture, the synth crossfades to the new chord. No clicks.

Watch — I can perform a basic I-V-vi-IV without touching anything except raising and lowering my hands."

**[Perform briefly]**

"And if I want to capture it, I hit Record, perform, then save it as a take."

**[Show Voice to Score]**
"The other new feature is Voice to Score. I hum a melody — maybe four or five notes — and the app detects pitch in real-time using autocorrelation. Then it shows me a piano roll of what I sang. Not perfect sheet music — it's a 'melody sketch.' But for a first pass, it's enough to remember the shape of the idea."

**[Demo voice to score briefly]**

## Q3: Potential use cases / social value?

"The most direct use case is solo songwriters in early stages — before you're ready for a DAW, when you're still sketching. But I also think there's an interesting accessibility angle: the gesture-based instrument means someone who doesn't play piano can still explore harmony physically. Raise your hand in different positions, find a chord that feels right to the lyric.

There's also a performance angle — you could use this as a live looping sketch tool for a beat-making session, or even a performance interface where gestures drive a live set. The technology is all here."

## Q4: What would you add?

"A few things I'd prioritize next:

First, MIDI output. Right now the chord synth only plays audio. With the WebMIDI API, you could trigger any external instrument or DAW with the same gestures. That would make it genuinely useful in a production workflow.

Second, better pitch detection — the autocorrelation method struggles with vibrato and quiet notes. I'd try the YIN algorithm or a small ML model like SPICE.

Third, sample-based drums. The procedural sounds are functional but they lack character. I'd add royalty-free sample packs as an option alongside the synthesized presets.

And honestly — I'd just want more people to use it and tell me where the friction is. The core idea feels right. The execution is early."

---

*End of demo. Total time: approximately 3-4 minutes.*
