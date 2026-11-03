import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05060A",
          900: "#080A10",
          850: "#0A0D14",
          800: "#0D111A",
          700: "#131826",
          600: "#1B2233",
          500: "#273043",
        },
        lime: {
          DEFAULT: "#B8FF3C",
          soft: "#D8FF9A",
          dim: "#8FCC2E",
        },
        electric: {
          DEFAULT: "#6E8BFF",
          soft: "#A9BAFF",
          dim: "#4458C4",
        },
        ember: {
          DEFAULT: "#FF7A45",
          soft: "#FFB08A",
        },
        danger: "#FF5A6E",
        shade: "#2A3142",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 60px -30px rgba(0,0,0,0.9)",
        glow: "0 0 0 1px rgba(184,255,60,0.18), 0 12px 40px -12px rgba(184,255,60,0.25)",
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(1200px 500px at 50% -10%, rgba(110,139,255,0.13), transparent 70%)",
      },
      keyframes: {
        pulseSoft: {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        riseIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseSoft: "pulseSoft 2.4s ease-in-out infinite",
        riseIn: "riseIn 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
