import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        plum: { DEFAULT: "#3A1631", 50: "#F6EEF3", 100: "#EBD9E4", 300: "#B98AA8", 500: "#7A3D63", 700: "#52203F", 900: "#2A0F23" },
        ivory: { DEFAULT: "#F8F2E6", 50: "#FFFCF6", 200: "#EFE6D6", 300: "#E4D7C1" },
        clay: { DEFAULT: "#A9502C", 100: "#F3E1D7", 300: "#D69A7B", 700: "#7E3A1F" },
        raspberry: { DEFAULT: "#B0205A", 100: "#F7DCE7", 700: "#851743" },
        ink: { DEFAULT: "#2B2427", soft: "#5E5357", faint: "#8C8084" },
        line: "#E3D6C4",
        ok: { DEFAULT: "#2F6B4A", 100: "#DDEFE4" },
        warn: { DEFAULT: "#8A5A00", 100: "#FBEFD2" },
        bad: { DEFAULT: "#A12B2B", 100: "#F8DEDB" },
      },
      fontFamily: {
        serif: ['"Young Serif"', "Georgia", "serif"],
        sans: ['"Instrument Sans"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { DEFAULT: "4px", sm: "2px", md: "6px" },
      maxWidth: { prose: "68ch" },
    },
  },
  plugins: [],
} satisfies Config;
