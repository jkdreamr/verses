"use client";

import { Modal } from "@/components/Modal";
import type { Song } from "@/lib/types";
import { useToast } from "@/components/Toast";

export function ExportModal({
  open,
  song,
  onClose,
}: {
  open: boolean;
  song: Song;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const filename = (song.title?.trim() || "untitled")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  const fileBody = `${song.title?.trim() || "Untitled"}\n\n${song.content || ""}`;

  const onDownload = () => {
    const blob = new Blob([fileBody], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename || "song"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Downloaded .txt", "ok");
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(fileBody);
      toast("Copied to clipboard", "ok");
    } catch {
      toast("Couldn't copy", "error");
    }
  };

  const onPrint = () => {
    window.open(`/print/${song.id}`, "_blank");
  };

  return (
    <Modal open={open} onClose={onClose} title="Export">
      <div className="flex flex-col gap-2">
        <button
          onClick={onDownload}
          className="rounded border border-ink-line px-3 py-2 text-left text-sm transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
        >
          Download as <span className="font-mono">{filename || "song"}.txt</span>
        </button>
        <button
          onClick={onCopy}
          className="rounded border border-ink-line px-3 py-2 text-left text-sm transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
        >
          Copy lyrics to clipboard
        </button>
        <button
          onClick={onPrint}
          className="rounded border border-ink-line px-3 py-2 text-left text-sm transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
        >
          Open print view
        </button>
      </div>
    </Modal>
  );
}
