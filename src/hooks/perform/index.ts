export { useDrumEngine, DRUM_PRESETS } from "./useDrumEngine";
export type { DrumPreset } from "./useDrumEngine";

export {
  useChordSynth,
  INSTRUMENT_PRESETS,
  SLOT_PRESETS,
  NOTE_NAMES,
  chordFrequencies,
  chordMidiNotes,
  chordLabel,
  createReverb,
} from "./useChordSynth";
export type { ChordQuality, ChordSlot, InstrumentPreset } from "./useChordSynth";

export { useHandTracking } from "./useHandTracking";
export type { GestureId, HandState, UseHandTrackingConfig } from "./useHandTracking";

export { useLiveTrumpet, TRUMPET_PRESETS } from "./useLiveTrumpet";
export type { TrumpetPreset, UseLiveTrumpetConfig } from "./useLiveTrumpet";
