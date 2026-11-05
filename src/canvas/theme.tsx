import { createContext, useContext } from "react";

/**
 * How the canvas is coloured. The screen theme reads the design tokens as they
 * are; the print theme (printer-friendly export) reads the matching
 * `--print-*` token for each one and maps the five inks to dark versions.
 */
export type CanvasTheme = {
  name: "screen" | "print";
  token(name: string): string;
  ink(colour: string): string;
  /** False when exporting without images. */
  images: boolean;
};

const cache = new Map<string, string>();
export function cssVar(name: string): string {
  let v = cache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, v);
  }
  return v;
}

/** The five toolbar inks (SPEC: Canvas tools), keyed by colour. */
const INK_TOKEN: Record<string, string> = {
  "#f4f7ff": "--ink-white",
  "#01c6a3": "--mint",
  "#e8a828": "--gold",
  "#ff5c86": "--pink",
  "#8fb8ff": "--pale-blue",
};

const printVar = (name: string) => cssVar(name.replace(/^--/, "--print-")) || cssVar(name);

export const screenTheme: CanvasTheme = {
  name: "screen",
  token: cssVar,
  ink: (c) => c,
  images: true,
};

export const printTheme: CanvasTheme = {
  name: "print",
  token: printVar,
  ink: (c) => {
    const t = INK_TOKEN[c.toLowerCase()];
    return t ? printVar(t) : c;
  },
  images: true,
};

export const ThemeContext = createContext<CanvasTheme>(screenTheme);
export const useCanvasTheme = () => useContext(ThemeContext);
