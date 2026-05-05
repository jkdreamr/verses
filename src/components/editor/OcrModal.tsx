"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";

export function OcrModal({
  open,
  onClose,
  onInsert,
  onReplace,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  onReplace: (text: string) => void;
}) {
  const { toast } = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const [extracted, setExtracted] = useState<string>("");
  const [filename, setFilename] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setProgress(null);
    setExtracted("");
    setFilename("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFile = async (file: File) => {
    setFilename(file.name);
    setProgress(0.01);
    setExtracted("");
    try {
      // Dynamic import keeps Tesseract out of the initial bundle
      const Tesseract = (await import("tesseract.js")).default;
      const { data } = await Tesseract.recognize(file, "eng", {
        logger: (m: { status: string; progress: number }) => {
          if (typeof m.progress === "number") {
            setProgress(Math.max(0.02, m.progress));
          }
        },
      });
      setProgress(1);
      setExtracted((data.text ?? "").trim());
    } catch (err) {
      console.error(err);
      toast("OCR failed — try a clearer photo", "error");
      setProgress(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Scan handwritten lyrics"
    >
      {!extracted && progress === null ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-mute">
            Upload or take a photo of your handwritten lyrics. Tesseract.js runs
            entirely in your browser — your photo never leaves this device.
          </p>
          <label
            htmlFor="ocr-file"
            className="cursor-pointer rounded border border-dashed border-ink-line p-8 text-center text-sm text-ink-mute transition-colors duration-150 hover:border-amber-gold/60 hover:text-amber-gold"
          >
            click to upload an image
            <div className="mt-1 text-[11px] text-ink-mute/70">
              JPG · PNG · WebP · HEIC
            </div>
          </label>
          <input
            id="ocr-file"
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </div>
      ) : null}

      {progress !== null && progress < 1 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-mute">
            Reading <span className="text-ink-text">{filename}</span>…
          </p>
          <div className="h-1 w-full overflow-hidden rounded bg-ink-line">
            <div
              className="h-full bg-amber-gold transition-all duration-150"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {progress === 1 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-mute">
            Extracted text — edit before importing:
          </p>
          <textarea
            value={extracted}
            onChange={(e) => setExtracted(e.target.value)}
            rows={10}
            className="serif w-full rounded border border-ink-line bg-ink/60 px-3 py-2 text-sm leading-relaxed focus:border-amber-gold/60"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => {
                reset();
                onClose();
              }}
              className="rounded border border-ink-line px-3 py-1.5 text-xs text-ink-mute hover:text-ink-text"
            >
              cancel
            </button>
            <button
              onClick={() => {
                if (extracted.trim()) onInsert(extracted);
                reset();
              }}
              className="rounded border border-ink-line px-3 py-1.5 text-xs hover:border-amber-gold/60 hover:text-amber-gold"
            >
              insert at cursor
            </button>
            <button
              onClick={() => {
                if (extracted.trim()) onReplace(extracted);
                reset();
              }}
              className="rounded border border-amber-gold/50 bg-amber-gold/10 px-3 py-1.5 text-xs text-amber-gold hover:bg-amber-gold/20"
            >
              replace current text
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
