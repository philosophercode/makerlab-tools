import { continueRender, delayRender, staticFile } from "remotion";

/** The site's tokens (src/styles/globals.css, ui.css) and its three typefaces. */
export const COLORS = {
  background: "#f7f4ee",
  surfaceLow: "#eee8de",
  surfaceHigh: "#e2d8ca",
  primary: "#ff6b35",
  primaryInk: "#b8431a",
  ink: "#171717",
  inkMuted: "#59524a",
  outline: "#cfc6b8",
  night: "#0f0f0f",
};

export const FONTS = {
  display: "'Space Grotesk', 'Arial Narrow', Arial, sans-serif",
  body: "Inter, Arial, sans-serif",
  mono: "'JetBrains Mono', SFMono-Regular, Consolas, monospace",
};

const FACES: [string, string][] = [
  ["Space Grotesk", "fonts/SpaceGrotesk-Variable.woff2"],
  ["Inter", "fonts/Inter-Variable.woff2"],
  ["JetBrains Mono", "fonts/JetBrainsMono-Variable.woff2"],
];

let loaded = false;
/** Loads the vendored fonts once, holding the render until they are ready. */
export function loadFonts(): void {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("brand fonts");
  Promise.all(
    FACES.map(([family, file]) => {
      const face = new FontFace(family, `url(${staticFile(file)}) format("woff2")`, { weight: "100 900" });
      document.fonts.add(face);
      return face.load();
    })
  )
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error(err);
      continueRender(handle);
    });
}
