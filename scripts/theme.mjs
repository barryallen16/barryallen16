// Color palette + fonts, extracted from the profile's existing SVG assets so the
// new stat cards match byte-for-byte in tone. Dark + light variants.
import { loadFont } from "./pixel.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const themes = {
  dark: {
    bg: "#0d1117",
    border: "#3d444d",
    text: "#e6edf3",
    muted: "#9198a1",
    accent: "#58a6ff",
    track: "#21262d",
  },
  light: {
    bg: "#ffffff",
    border: "#afb8c1",
    text: "#1f2328",
    muted: "#59636e",
    accent: "#0969da",
    track: "#eaeef2",
  },
};

let _regular, _medium;
export function fonts() {
  if (!_regular) _regular = loadFont(join(__dirname, "fonts", "Geist-Regular.ttf"));
  if (!_medium) _medium = loadFont(join(__dirname, "fonts", "Geist-Medium.ttf"));
  return { regular: _regular, medium: _medium };
}
