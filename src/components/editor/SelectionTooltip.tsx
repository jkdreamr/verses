"use client";

import { useEffect, useState } from "react";

export function SelectionTooltip({
  textareaRef,
  onTriggerRhymes,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onTriggerRhymes: () => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const update = () => {
      if (!ta) return;
      const { selectionStart, selectionEnd, value } = ta;
      if (selectionStart === selectionEnd) {
        setPos(null);
        return;
      }
      const selected = value.slice(selectionStart, selectionEnd).trim();
      if (!selected || /\n/.test(selected) || selected.length > 64) {
        setPos(null);
        return;
      }
      const coords = caretCoordinates(ta, selectionEnd);
      const rect = ta.getBoundingClientRect();
      const x = rect.left + coords.left - ta.scrollLeft;
      const y = rect.top + coords.top - ta.scrollTop;
      setPos({ x, y });
    };

    const onSelect = () => update();
    const onMouseUp = () => requestAnimationFrame(update);
    const onKeyUp = () => requestAnimationFrame(update);
    const onScroll = () => update();

    ta.addEventListener("select", onSelect);
    ta.addEventListener("mouseup", onMouseUp);
    ta.addEventListener("keyup", onKeyUp);
    ta.addEventListener("scroll", onScroll);
    document.addEventListener("selectionchange", update);

    return () => {
      ta.removeEventListener("select", onSelect);
      ta.removeEventListener("mouseup", onMouseUp);
      ta.removeEventListener("keyup", onKeyUp);
      ta.removeEventListener("scroll", onScroll);
      document.removeEventListener("selectionchange", update);
    };
  }, [textareaRef]);

  if (!pos) return null;
  return (
    <button
      onMouseDown={(e) => {
        // prevent textarea from losing the selection
        e.preventDefault();
      }}
      onClick={onTriggerRhymes}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y - 6,
        transform: "translate(-50%, -100%)",
      }}
      className="z-30 rounded-full border border-amber-gold/50 bg-ink-surface/95 px-3 py-1 text-[11px] text-amber-gold shadow-sm backdrop-blur transition-colors duration-150 hover:bg-amber-gold/20 print:hidden"
    >
      🎵 Rhymes
    </button>
  );
}

// Lightweight textarea caret coordinates calculator.
// Based on https://github.com/component/textarea-caret-position
function caretCoordinates(
  el: HTMLTextAreaElement,
  position: number
): { top: number; left: number } {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const style = div.style;
  const computed = window.getComputedStyle(el);

  const propsToCopy = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "borderStyle",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
  ];

  style.position = "absolute";
  style.visibility = "hidden";
  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";

  for (const prop of propsToCopy) {
    // @ts-expect-error -- copying CSSStyleDeclaration props by name
    style[prop] = computed[prop];
  }

  div.textContent = el.value.slice(0, position);

  const span = document.createElement("span");
  span.textContent = el.value.slice(position) || ".";
  div.appendChild(span);

  const coords = {
    top: span.offsetTop + parseInt(computed.borderTopWidth, 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth, 10),
  };
  document.body.removeChild(div);
  return coords;
}
