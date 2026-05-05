import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
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
      },
      fontFamily: {
        serif: ["var(--font-lora)", "Lora", "Georgia", "serif"],
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      transitionTimingFunction: {
        "ease-out": "cubic-bezier(0, 0, 0.2, 1)",
      },
      transitionDuration: {
        "150": "150ms",
      },
    },
  },
  plugins: [],
};
export default config;
