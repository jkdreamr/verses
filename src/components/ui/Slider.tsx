"use client";

import { useId } from "react";

// Premium range slider: custom-filled track, value readout, large hit target,
// keyboard-accessible (wraps a native input[type=range]), reduced-motion safe.
export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
  valueLabel,
  disabled = false,
  ariaLabel,
}: {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  valueLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const id = useId();
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const fill = `linear-gradient(to right, rgb(var(--accent)) 0%, rgb(var(--accent)) ${pct}%, rgb(var(--line)) ${pct}%, rgb(var(--line)) 100%)`;

  return (
    <div className="flex flex-col gap-1.5">
      {(label || valueLabel) && (
        <div className="flex items-center justify-between text-[11px] text-ink-mute">
          {label ? <label htmlFor={id}>{label}</label> : <span />}
          {valueLabel ? (
            <span className="font-mono tabular-nums text-ink-mute/80">{valueLabel}</span>
          ) : null}
        </div>
      )}
      <input
        id={id}
        type="range"
        className="slider-premium"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel ?? label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ background: fill }}
      />
    </div>
  );
}
