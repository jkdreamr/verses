"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchRhymes, groupBySyllables, type RhymeKind } from "@/lib/datamuse";
import type { DatamuseWord } from "@/lib/types";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/components/Toast";

type Tab = "perfect" | "near" | "soundsLike";

export function RhymePanel({
  open,
  word,
  onClose,
  onPickWord,
}: {
  open: boolean;
  word: string | null;
  onClose: () => void;
  onPickWord: (w: string) => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("perfect");
  const [results, setResults] = useState<DatamuseWord[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounce(word, 300);

  useEffect(() => {
    if (!open) return;
    if (!debounced) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const kind: RhymeKind =
      tab === "perfect" ? "perfect" : tab === "near" ? "near" : "soundsLike";
    fetchRhymes(debounced, kind, controller.signal)
      .then((r) => setResults(r))
      .catch((e) => {
        if (e?.name === "AbortError") return;
        toast("Couldn't reach Datamuse — try again", "error");
        setResults([]);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debounced, tab, open, toast]);

  const grouped = useMemo(() => groupBySyllables(results), [results]);

  return (
    <aside
      aria-hidden={!open}
      className={`fixed bottom-0 right-0 top-0 z-30 flex w-[min(420px,90vw)] flex-col border-l border-ink-line bg-ink-surface transition-transform duration-150 print:hidden ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <header className="flex items-center justify-between border-b border-ink-line px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute">
            Rhymes for
          </div>
          <div className="font-serif text-lg text-amber-gold">
            {word || "—"}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-ink-mute transition-colors duration-150 hover:bg-ink-line hover:text-ink-text"
          aria-label="Close rhyme panel"
        >
          ✕
        </button>
      </header>
      <nav className="flex border-b border-ink-line text-xs">
        {(
          [
            ["perfect", "Perfect"],
            ["near", "Near"],
            ["soundsLike", "Sounds like"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-2 transition-colors duration-150 ${
              tab === k
                ? "border-b border-amber-gold text-amber-gold"
                : "text-ink-mute hover:text-ink-text"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="scrollbar-thin flex-1 overflow-auto px-4 py-3">
        {!word ? (
          <p className="text-sm text-ink-mute">
            Highlight a word in your lyrics, then click 🎵 Rhymes (or press
            ⌘R).
          </p>
        ) : loading ? (
          <p className="text-sm text-ink-mute">searching…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-ink-mute">
            no good matches — try a different word
          </p>
        ) : (
          <div className="space-y-5">
            {grouped.map(({ syllables, words }) => (
              <section key={syllables}>
                <h3 className="mb-2 text-[11px] uppercase tracking-wider text-ink-mute">
                  {syllables} syllable{syllables === 1 ? "" : "s"}
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {words.map((w) => (
                    <RhymeChip
                      key={w.word}
                      word={w}
                      onCopy={async () => {
                        try {
                          await navigator.clipboard.writeText(w.word);
                          toast(`Copied "${w.word}"`, "ok");
                        } catch {
                          toast("Couldn't copy to clipboard", "error");
                        }
                      }}
                      onLookup={() => onPickWord(w.word)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <footer className="border-t border-ink-line px-4 py-2 text-[11px] text-ink-mute">
        Click a chip to copy. Right-click to look up rhymes for it.
      </footer>
    </aside>
  );
}

function RhymeChip({
  word,
  onCopy,
  onLookup,
}: {
  word: DatamuseWord;
  onCopy: () => void;
  onLookup: () => void;
}) {
  return (
    <button
      onClick={onCopy}
      onContextMenu={(e) => {
        e.preventDefault();
        onLookup();
      }}
      title={`score ${word.score} · right-click to look up rhymes for "${word.word}"`}
      className="rounded-full border border-ink-line bg-ink/40 px-3 py-1 text-sm text-ink-text transition-colors duration-150 hover:border-amber-gold/60 hover:bg-amber-gold/10 hover:text-amber-gold"
    >
      {word.word}
      {typeof word.numSyllables === "number" ? (
        <span className="ml-1 text-[10px] text-ink-mute">
          ·{word.numSyllables}
        </span>
      ) : null}
    </button>
  );
}
