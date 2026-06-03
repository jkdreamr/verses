import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Legacy tokens (kept verbatim — Rhyme Lens + existing UI depend on them) ──
        ink: {
          DEFAULT: "rgb(var(--bg) / <alpha-value>)",
          surface: "rgb(var(--surface) / <alpha-value>)",
          line: "rgb(var(--line) / <alpha-value>)",
          mute: "rgb(var(--mute) / <alpha-value>)",
          text: "rgb(var(--text) / <alpha-value>)",
        },
        amber: {
          gold: "rgb(var(--accent) / <alpha-value>)",
        },
        // ── New semantic design tokens (additive) ──
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
        },
        success: "rgb(var(--success) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        "ink-text": "rgb(var(--text) / <alpha-value>)",
        "ink-mute": "rgb(var(--mute) / <alpha-value>)",
      },
      fontFamily: {
        serif: ["var(--font-lora)", "Lora", "Georgia", "serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      minWidth: { touch: "44px" },
      minHeight: { touch: "44px" },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      boxShadow: {
        elevate: "0 1px 2px rgb(0 0 0 / 0.18), 0 8px 24px -8px rgb(0 0 0 / 0.32)",
        "elevate-lg": "0 2px 6px rgb(0 0 0 / 0.2), 0 18px 50px -12px rgb(0 0 0 / 0.45)",
      },
      transitionTimingFunction: {
        "ease-out": "cubic-bezier(0, 0, 0.2, 1)",
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        "150": "150ms",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
export default config;
