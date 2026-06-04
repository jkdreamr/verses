// ───────────────────────────────────────────────────────────────────────────
// Sampled drum kits (vendored one-shots in /public/samples/drums). Each kit maps
// the four sequencer rows (kick / snare / hihat / perc) to a real recording.
// Tone.Players pitch-free triggers them on the transport clock.
// ───────────────────────────────────────────────────────────────────────────

export type DrumVoice = "kick" | "snare" | "hihat" | "perc";
export const DRUM_VOICES: DrumVoice[] = ["kick", "snare", "hihat", "perc"];
export const DRUM_VOICE_LABELS: Record<DrumVoice, string> = {
  kick: "Kick",
  snare: "Snare",
  hihat: "Hat",
  perc: "Perc",
};

export type DrumKit = {
  id: string;
  name: string;
  blurb: string;
  baseUrl: string;
  urls: Record<DrumVoice, string>;
};

export const DRUM_KITS: DrumKit[] = [
  {
    id: "acoustic",
    name: "Acoustic",
    blurb: "Natural live kit",
    baseUrl: "/samples/drums/acoustic/",
    urls: { kick: "kick.mp3", snare: "snare.mp3", hihat: "hihat.mp3", perc: "perc.mp3" },
  },
  {
    id: "punch",
    name: "Punch",
    blurb: "Tight, modern electronic",
    baseUrl: "/samples/drums/punch/",
    urls: { kick: "kick.mp3", snare: "snare.mp3", hihat: "hihat.mp3", perc: "perc.mp3" },
  },
  {
    id: "lofi",
    name: "Lo-Fi",
    blurb: "Dusty vintage drum box",
    baseUrl: "/samples/drums/lofi/",
    urls: { kick: "kick.mp3", snare: "snare.mp3", hihat: "hihat.mp3", perc: "perc.mp3" },
  },
];

export const STEPS = 16;
