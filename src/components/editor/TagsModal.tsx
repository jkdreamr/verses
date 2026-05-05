"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";

const SUGGESTED = ["draft", "idea", "finished", "verse", "chorus"];

export function TagsModal({
  open,
  tags,
  onChange,
  onClose,
}: {
  open: boolean;
  tags: string[];
  onChange: (t: string[]) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");

  const add = (t: string) => {
    const cleaned = t.trim().toLowerCase().replace(/^#+/, "");
    if (!cleaned) return;
    if (tags.includes(cleaned)) return;
    onChange([...tags, cleaned]);
    setInput("");
  };

  const remove = (t: string) => {
    onChange(tags.filter((x) => x !== t));
  };

  return (
    <Modal open={open} onClose={onClose} title="Tags">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 ? (
          <span className="text-xs text-ink-mute">no tags yet</span>
        ) : (
          tags.map((t) => (
            <button
              key={t}
              onClick={() => remove(t)}
              className="rounded-full border border-ink-line px-3 py-1 text-xs text-ink-mute transition-colors duration-150 hover:border-red-400/60 hover:text-red-300"
              title="click to remove"
            >
              #{t} ✕
            </button>
          ))
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add(input);
        }}
        className="mt-4 flex items-center gap-2"
      >
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="add a tag…"
          className="flex-1 rounded border border-ink-line bg-ink/60 px-3 py-1.5 text-sm focus:border-amber-gold/60"
        />
        <button
          type="submit"
          className="rounded border border-ink-line px-3 py-1.5 text-xs hover:border-amber-gold/60 hover:text-amber-gold"
        >
          add
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTED.filter((s) => !tags.includes(s)).map((s) => (
          <button
            key={s}
            onClick={() => add(s)}
            className="rounded-full border border-dashed border-ink-line px-3 py-1 text-[11px] text-ink-mute hover:text-ink-text"
          >
            +{s}
          </button>
        ))}
      </div>
    </Modal>
  );
}
