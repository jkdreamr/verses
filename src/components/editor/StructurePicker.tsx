"use client";

import { Modal } from "@/components/Modal";

const STRUCTURE_TAGS = [
  "[Verse 1]",
  "[Verse 2]",
  "[Verse 3]",
  "[Pre-Chorus]",
  "[Chorus]",
  "[Bridge]",
  "[Hook]",
  "[Outro]",
  "[Intro]",
  "[Refrain]",
];

export function StructurePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (tag: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Insert structure tag">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {STRUCTURE_TAGS.map((t) => (
          <button
            key={t}
            onClick={() => onPick(t)}
            className="rounded border border-ink-line px-3 py-2 text-left text-sm transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
          >
            {t}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-mute">
        Tip: ⌘/ opens this picker without leaving the editor.
      </p>
    </Modal>
  );
}
