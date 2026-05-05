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
          DEFAULT: "#0d0d0d",
          surface: "#1a1a1a",
          line: "#262626",
          mute: "#6b6b6b",
          text: "#e8e8e8",
        },
        amber: {
          gold: "#c9a84c",
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
