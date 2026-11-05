import type { Device } from "./edit";

/** Output formats: the 16:9 product-page cut and the 9:16 vertical cut. */
export type Format = "landscape" | "portrait";

export const SIZE: Record<Format, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

/** Where a device sits on the stage, and how big its screen is drawn. */
export type DeviceLayout = {
  /** The screen (video) rectangle in stage pixels. */
  screen: { left: number; top: number; width: number; height: number };
  /** Page CSS px → stage px. */
  k: number;
};

const BAR = { landscape: 40, portrait: 34 };

export function deviceLayout(format: Format, device: Device, viewport: { width: number; height: number }, hasSide: boolean): DeviceLayout {
  const stage = SIZE[format];
  const aspect = viewport.height / viewport.width;
  if (device === "phone") {
    const height = format === "landscape" ? 860 : 1400;
    const width = height / aspect;
    const left = format === "landscape" ? (hasSide ? 1180 - width / 2 : stage.width / 2 - width / 2) : stage.width / 2 - width / 2;
    const sb = height * 0.058; // the status bar DeviceFrame draws above the page
    const top = format === "landscape" ? (stage.height - height - sb) / 2 + sb - 10 : 250 + sb;
    return { screen: { left, top, width, height }, k: width / viewport.width };
  }
  if (device === "tv") {
    const width = format === "landscape" ? 1440 : 1000;
    const height = width * aspect;
    const top = format === "landscape" ? 92 : 560;
    return { screen: { left: (stage.width - width) / 2, top, width, height }, k: width / viewport.width };
  }
  const width = format === "landscape" ? 1320 : 1010;
  const height = width * aspect;
  const bar = BAR[format];
  const top = format === "landscape" ? 62 + bar : 600 + bar;
  return { screen: { left: (stage.width - width) / 2, top, width, height }, k: width / viewport.width };
}

export const barHeight = (format: Format) => BAR[format];

/**
 * Per-format zoom: the edit's scales are written for 16:9. In the vertical cut
 * desktop and TV footage is small, so zooms go further; the phone already
 * fills the frame, so its zooms are gentler (or text runs off both sides).
 */
export function zoomFor(format: Format, device: Device, s: number): number {
  if (format === "landscape" || s <= 1) return s;
  if (device === "phone") return 1 + (s - 1) * 0.4;
  if (device === "tv") return s * 1.5;
  return s * 1.3;
}
