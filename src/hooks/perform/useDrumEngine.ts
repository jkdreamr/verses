import { useCallback, useEffect, useRef, useState } from "react";
import { ensureEngine } from "@/lib/audio/engine";
import {
  DRUM_KITS,
  DRUM_VOICES,
  STEPS,
  type DrumKit,
  type DrumVoice,
} from "@/lib/audio/drumKits";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DrumPreset = {
  name: string;
  bpm: number;
  swing: number;
  pattern: { kick: number[]; snare: number[]; hihat: number[]; perc: number[] };
  levels: { kick: number; snare: number; hihat: number; perc: number };
  description: string;
};

export type DrumGrid = Record<DrumVoice, boolean[]>;

export type SavedPattern = {
  id: string;
  name: string;
  kitId: string;
  bpm: number;
  swing: number;
  grid: DrumGrid;
};

// ─── Presets (now editable starting points) ─────────────────────────────────────

export const DRUM_PRESETS: DrumPreset[] = [
  {
    name: "Boom Bap", bpm: 88, swing: 0.55,
    pattern: {
      kick:  [1,0,0,0,0,0,1,0,0,1,0,0,0,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
      perc:  [0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0],
    },
    levels: { kick: 0.9, snare: 0.75, hihat: 0.5, perc: 0.45 },
    description: "Hip-hop groove w/ swing",
  },
  {
    name: "Trap", bpm: 140, swing: 0.1,
    pattern: {
      kick:  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      snare: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      hihat: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
      perc:  [0,0,1,0,0,0,0,1,0,0,1,0,0,0,1,0],
    },
    levels: { kick: 0.95, snare: 0.8, hihat: 0.25, perc: 0.5 },
    description: "Hard trap, rolling hihat",
  },
  {
    name: "R&B", bpm: 72, swing: 0.4,
    pattern: {
      kick:  [1,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],
      perc:  [0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0],
    },
    levels: { kick: 0.85, snare: 0.7, hihat: 0.45, perc: 0.5 },
    description: "Smooth R&B pocket",
  },
  {
    name: "House", bpm: 120, swing: 0,
    pattern: {
      kick:  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
      perc:  [0,1,0,0,0,0,0,1,0,0,0,0,0,1,0,0],
    },
    levels: { kick: 0.9, snare: 0.7, hihat: 0.5, perc: 0.45 },
    description: "Four-on-floor house",
  },
  {
    name: "Minimal", bpm: 100, swing: 0,
    pattern: {
      kick:  [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
      snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
      hihat: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
      perc:  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    },
    levels: { kick: 0.85, snare: 0.65, hihat: 0.4, perc: 0 },
    description: "Sparse, clean groove",
  },
];

export { DRUM_KITS };
export type { DrumKit, DrumVoice };

// ─── Helpers ────────────────────────────────────────────────────────────────────

const emptyGrid = (): DrumGrid => ({
  kick: new Array(STEPS).fill(false),
  snare: new Array(STEPS).fill(false),
  hihat: new Array(STEPS).fill(false),
  perc: new Array(STEPS).fill(false),
});

const presetToGrid = (p: DrumPreset): DrumGrid => ({
  kick: p.pattern.kick.map(Boolean),
  snare: p.pattern.snare.map(Boolean),
  hihat: p.pattern.hihat.map(Boolean),
  perc: p.pattern.perc.map(Boolean),
});

const SAVE_KEY = "verses:drumPatterns";
const loadSaved = (): SavedPattern[] => {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]"); } catch { return []; }
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Step-sequencer drum engine. Holds an editable 4×16 grid, plays it on the shared
 * Tone.Transport with sampled kits, and exposes a moving playhead. Also keeps the
 * simple transport API (play/stop/setPreset/setBpm/…) used across Perform.
 */
export function useDrumEngine(destNode: AudioNode | null) {
  // ── React state ──
  const [grid, setGrid] = useState<DrumGrid>(() => presetToGrid(DRUM_PRESETS[0]));
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [presetName, setPresetName] = useState(DRUM_PRESETS[0].name);
  const [currentBpm, setCurrentBpm] = useState(DRUM_PRESETS[0].bpm);
  const [swing, setSwingState] = useState(DRUM_PRESETS[0].swing);
  const [kitId, setKitId] = useState(DRUM_KITS[0].id);
  const [kitLoading, setKitLoading] = useState(false);
  const [levels, setLevels] = useState<Record<DrumVoice, number>>(DRUM_PRESETS[0].levels);
  const [mutes, setMutes] = useState<Record<DrumVoice, boolean>>({ kick: false, snare: false, hihat: false, perc: false });
  const [solos, setSolos] = useState<Record<DrumVoice, boolean>>({ kick: false, snare: false, hihat: false, perc: false });
  const [filterCutoff, setFilterCutoffState] = useState(8000);
  const [savedPatterns, setSavedPatterns] = useState<SavedPattern[]>([]);

  // ── Audio refs ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playersRef = useRef<Record<DrumVoice, any>>({} as Record<DrumVoice, any>);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voiceGainsRef = useRef<Record<DrumVoice, any>>({} as Record<DrumVoice, any>);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filterRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const masterRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seqRef = useRef<any>(null);
  const builtRef = useRef(false);
  const buildingRef = useRef<Promise<void> | null>(null);

  // ── Mirrors for the audio-thread sequence callback ──
  const gridRef = useRef(grid);
  const mutesRef = useRef(mutes);
  const solosRef = useRef(solos);
  useEffect(() => { gridRef.current = grid; }, [grid]);
  useEffect(() => { mutesRef.current = mutes; }, [mutes]);
  useEffect(() => { solosRef.current = solos; }, [solos]);
  useEffect(() => { setSavedPatterns(loadSaved()); }, []);

  // ── Build the Tone chain (lazy) ──
  const ensureBuilt = useCallback(async () => {
    if (builtRef.current) return;
    if (buildingRef.current) return buildingRef.current;
    buildingRef.current = (async () => {
      const engine = ensureEngine();
      const Tone = await engine.loadTone();
      const kit = DRUM_KITS.find((k) => k.id === kitId) ?? DRUM_KITS[0];

      const filter = new Tone.Filter({ type: "lowpass", frequency: filterCutoff, Q: 0.4 });
      const master = new Tone.Gain(1);
      filter.connect(master);
      master.connect(destNode ?? engine.drumBus);
      filterRef.current = filter;
      masterRef.current = master;

      setKitLoading(true);
      let loaded = 0;
      await new Promise<void>((resolve) => {
        DRUM_VOICES.forEach((v) => {
          const gain = new Tone.Gain(levels[v]);
          gain.connect(filter);
          voiceGainsRef.current[v] = gain;
          const player = new Tone.Player({
            url: kit.baseUrl + kit.urls[v],
            onload: () => { if (++loaded >= DRUM_VOICES.length) resolve(); },
          });
          player.connect(gain);
          playersRef.current[v] = player;
        });
      });
      setKitLoading(false);

      // Sequence on the transport clock — precise, swing-aware.
      const seq = new Tone.Sequence(
        (time: number, step: number) => {
          const anySolo = DRUM_VOICES.some((v) => solosRef.current[v]);
          for (const v of DRUM_VOICES) {
            if (!gridRef.current[v][step]) continue;
            if (mutesRef.current[v]) continue;
            if (anySolo && !solosRef.current[v]) continue;
            try { playersRef.current[v].start(time); } catch { /* retrigger race */ }
          }
          Tone.getDraw().schedule(() => setCurrentStep(step), time);
        },
        Array.from({ length: STEPS }, (_, i) => i),
        "16n",
      );
      // Start the looping sequence ONCE; play/stop control the transport only.
      // (Re-calling Sequence.start() after stop is the classic Tone gotcha that
      // leaves the loop silent — so we never do that.)
      seq.loop = true;
      seq.start(0);
      seqRef.current = seq;
      builtRef.current = true;
    })();
    return buildingRef.current;
  }, [destNode, filterCutoff, kitId, levels]);

  // ── Transport ──
  const play = useCallback(async () => {
    await ensureBuilt();
    const engine = ensureEngine();
    const Tone = await engine.loadTone();
    if (engine.ctx.state === "suspended") await engine.ctx.resume();
    await Tone.start();
    const t = Tone.getTransport();
    t.bpm.value = currentBpm;
    t.swing = swing;
    t.swingSubdivision = "16n";
    // The sequence is already started + looping; (re)start the transport from the
    // top. Works reliably for play → stop → play (e.g. fist then open palm).
    t.stop();
    t.position = 0;
    t.start();
    setPlaying(true);
  }, [currentBpm, ensureBuilt, swing]);

  const stop = useCallback(() => {
    try {
      const e = ensureEngine();
      if (e.tone) {
        e.tone.getTransport().stop();
      }
    } catch { /* */ }
    setPlaying(false);
    setCurrentStep(-1);
  }, []);

  // ── Grid editing ──
  const toggleStep = useCallback((voice: DrumVoice, step: number) => {
    setGrid((g) => {
      const row = g[voice].slice();
      row[step] = !row[step];
      return { ...g, [voice]: row };
    });
  }, []);
  const setStep = useCallback((voice: DrumVoice, step: number, on: boolean) => {
    setGrid((g) => {
      if (g[voice][step] === on) return g;
      const row = g[voice].slice();
      row[step] = on;
      return { ...g, [voice]: row };
    });
  }, []);
  const clearPattern = useCallback(() => setGrid(emptyGrid()), []);

  const loadPreset = useCallback((name: string) => {
    const p = DRUM_PRESETS.find((x) => x.name === name);
    if (!p) return;
    setGrid(presetToGrid(p));
    setPresetName(name);
    setCurrentBpm(p.bpm);
    setSwingState(p.swing);
    setLevels(p.levels);
    try {
      const e = ensureEngine();
      if (e.tone) { e.tone.getTransport().bpm.value = p.bpm; e.tone.getTransport().swing = p.swing; }
    } catch { /* */ }
  }, []);

  // ── Params ──
  const setBpm = useCallback((bpm: number) => {
    const v = Math.max(50, Math.min(220, Math.round(bpm)));
    setCurrentBpm(v);
    try { const e = ensureEngine(); if (e.tone) e.tone.getTransport().bpm.value = v; } catch { /* */ }
  }, []);
  const setSwing = useCallback((s: number) => {
    const v = Math.max(0, Math.min(0.7, s));
    setSwingState(v);
    try { const e = ensureEngine(); if (e.tone) e.tone.getTransport().swing = v; } catch { /* */ }
  }, []);
  const setLevel = useCallback((voice: DrumVoice, v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setLevels((l) => ({ ...l, [voice]: clamped }));
    try { voiceGainsRef.current[voice]?.gain.rampTo(clamped, 0.02); } catch { /* */ }
  }, []);
  const toggleMute = useCallback((voice: DrumVoice) => setMutes((m) => ({ ...m, [voice]: !m[voice] })), []);
  const toggleSolo = useCallback((voice: DrumVoice) => setSolos((s) => ({ ...s, [voice]: !s[voice] })), []);
  const setFilterCutoff = useCallback((freq: number) => {
    setFilterCutoffState(freq);
    try { filterRef.current?.frequency.rampTo(freq, 0.04); } catch { /* */ }
  }, []);
  // Back-compat: overall kit trim used by gesture volume / mute.
  const setDrumVolume = useCallback((v: number) => {
    try { masterRef.current?.gain.rampTo(Math.max(0, Math.min(1, v)), 0.02); } catch { /* */ }
  }, []);

  // Apply kit changes live.
  useEffect(() => {
    if (!builtRef.current) return;
    let cancelled = false;
    (async () => {
      const kit = DRUM_KITS.find((k) => k.id === kitId) ?? DRUM_KITS[0];
      setKitLoading(true);
      await Promise.all(DRUM_VOICES.map((v) =>
        new Promise<void>((res) => {
          try { playersRef.current[v]?.load(kit.baseUrl + kit.urls[v]).then(() => res()).catch(() => res()); }
          catch { res(); }
        })));
      if (!cancelled) setKitLoading(false);
    })();
    return () => { cancelled = true; };
  }, [kitId]);

  // ── Save / load patterns ──
  const persistSaved = (list: SavedPattern[]) => {
    setSavedPatterns(list);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(list)); } catch { /* */ }
  };
  const savePattern = useCallback((name: string) => {
    const id = `pat_${Date.now().toString(36)}`;
    persistSaved([...loadSaved(), { id, name: name || `Pattern ${loadSaved().length + 1}`, kitId, bpm: currentBpm, swing, grid }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, kitId, currentBpm, swing]);
  const loadSavedPattern = useCallback((id: string) => {
    const p = loadSaved().find((x) => x.id === id);
    if (!p) return;
    setGrid(p.grid);
    setKitId(p.kitId);
    setBpm(p.bpm);
    setSwing(p.swing);
    setPresetName(p.name);
  }, [setBpm, setSwing]);
  const deleteSavedPattern = useCallback((id: string) => {
    persistSaved(loadSaved().filter((x) => x.id !== id));
  }, []);

  // ── Cleanup ──
  useEffect(() => {
    // The ref containers are stable (only their properties get populated), so
    // capturing them here is safe and satisfies the hooks lint rule.
    const players = playersRef.current;
    const gains = voiceGainsRef.current;
    return () => {
      try {
        const e = ensureEngine();
        if (e.tone) { seqRef.current?.stop(); e.tone.getTransport().stop(); }
      } catch { /* */ }
      try { seqRef.current?.dispose(); } catch { /* */ }
      DRUM_VOICES.forEach((v) => {
        try { players[v]?.dispose(); } catch { /* */ }
        try { gains[v]?.dispose(); } catch { /* */ }
      });
      try { filterRef.current?.dispose(); } catch { /* */ }
      try { masterRef.current?.dispose(); } catch { /* */ }
      builtRef.current = false;
      buildingRef.current = null;
    };
  }, []);

  const currentPreset = DRUM_PRESETS.find((p) => p.name === presetName) ?? DRUM_PRESETS[0];

  return {
    // grid + transport state
    grid, playing, currentStep, presetName, currentBpm, swing, kitId, kitLoading,
    levels, mutes, solos, filterCutoff, currentPreset, savedPatterns,
    // editing
    toggleStep, setStep, clearPattern, loadPreset, setKit: setKitId,
    setBpm, setSwing, setLevel, toggleMute, toggleSolo, setFilterCutoff,
    // transport
    play, stop,
    // save/load
    savePattern, loadSavedPattern, deleteSavedPattern,
    // back-compat aliases
    setPreset: loadPreset, setDrumVolume,
    // unused-but-kept accessors
    getCtx: () => { try { return ensureEngine().ctx; } catch { return null; } },
  };
}
