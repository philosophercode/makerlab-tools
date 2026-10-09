import { Canvas, type Rgba } from "./synthetic.ts";

/**
 * A synthetic tablet product shot, for the cutout's hard cases (gateway spec
 * amendment "Thin margins and white bezels"): a rounded-corner tablet on a
 * white backdrop, a metal rim, a bezel, a dark screen with a few app tiles.
 *
 * The real case was the catalogue's "iPad 6th generation" photo: a frame-
 * filling tablet with an 8 px white margin (3 px at the top) and rounded
 * corners, whose cutout was never kept — so the white corners stayed. The white-bezel variants are
 * the harder ones: a bezel the colour of the backdrop, held only by a rim or a
 * faint outline.
 *
 * Deterministic: the same options paint the same pixels.
 */

export interface TabletOptions {
  width: number;
  height: number;
  /** White backdrop between the frame and the tablet, px. */
  margin: number;
  /** Corner radius of the tablet, px. */
  radius: number;
  /** The metal edge, `rimWidth` px wide; 0 for none. */
  rim: Rgba;
  rimWidth: number;
  /** A line just inside the rim, `outlineWidth` px (a white bezel's faint outline); null for none. */
  outline: Rgba | null;
  outlineWidth?: number;
  bezel: Rgba;
  /** The bezel's width around the screen, px. */
  bezelWidth: number;
  screen: Rgba;
  backdrop: Rgba;
}

export const TABLET_VARIANTS = {
  /** The real photo's shape: a space-grey tablet, a hairline of white around it. */
  spaceGreyThinMargin: {
    width: 400,
    height: 560,
    margin: 3,
    radius: 30,
    rim: [205, 203, 203, 255],
    rimWidth: 2,
    outline: null,
    bezel: [28, 28, 30, 255],
    bezelWidth: 26,
    screen: [16, 86, 78, 255],
    backdrop: [254, 254, 254, 255],
  },
  /** The same, white: the bezel is the backdrop's colour, held by the silver rim. */
  whiteBezelThinMargin: {
    width: 400,
    height: 560,
    margin: 3,
    radius: 30,
    rim: [212, 212, 215, 255],
    rimWidth: 2,
    outline: null,
    bezel: [250, 250, 250, 255],
    bezelWidth: 26,
    screen: [16, 86, 78, 255],
    backdrop: [254, 254, 254, 255],
  },
  /**
   * The hardest one a fill can still win: a white bezel with no rim, held only
   * by a faint 2 px outline about 35 levels below the backdrop once JPEG has
   * softened it, with room around it — the old outright tolerance of 40 walked
   * through that outline and ate the bezel, leaving the screen floating.
   */
  whiteBezelFaintOutline: {
    width: 400,
    height: 560,
    margin: 48,
    radius: 30,
    rim: [0, 0, 0, 0],
    rimWidth: 0,
    outline: [230, 230, 232, 255],
    outlineWidth: 2,
    bezel: [250, 250, 250, 255],
    bezelWidth: 26,
    screen: [16, 86, 78, 255],
    backdrop: [254, 254, 254, 255],
  },
} satisfies Record<string, TabletOptions>;

export type TabletVariant = keyof typeof TABLET_VARIANTS;

/** Whether (x, y) lies inside the rounded rectangle [left, right] × [top, bottom] with corner radius r. */
function insideRounded(x: number, y: number, left: number, top: number, right: number, bottom: number, r: number): boolean {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = x < left + r ? left + r : x > right - r ? right - r : x;
  const cy = y < top + r ? top + r : y > bottom - r ? bottom - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

export function tabletCanvas(variant: TabletVariant | TabletOptions): Canvas {
  const o: TabletOptions = typeof variant === "string" ? TABLET_VARIANTS[variant] : variant;
  const canvas = new Canvas(o.width, o.height, o.backdrop);
  const left = o.margin;
  const top = o.margin;
  const right = o.width - 1 - o.margin;
  const bottom = o.height - 1 - o.margin;
  const rimEnd = o.rimWidth;
  const outlineEnd = rimEnd + (o.outline ? (o.outlineWidth ?? 1) : 0);
  const screen = { left: left + outlineEnd + o.bezelWidth, top: top + outlineEnd + o.bezelWidth * 2 };
  const screenEnd = { right: right - outlineEnd - o.bezelWidth, bottom: bottom - outlineEnd - o.bezelWidth * 2 };

  canvas.paint((x, y) => {
    if (!insideRounded(x, y, left, top, right, bottom, o.radius)) return o.backdrop;
    // How deep inside the tablet's edge this pixel is (rings of the rounded rectangle).
    let depth = 0;
    while (depth < outlineEnd && insideRounded(x, y, left + depth + 1, top + depth + 1, right - depth - 1, bottom - depth - 1, Math.max(0, o.radius - depth - 1))) {
      depth += 1;
    }
    if (depth < rimEnd) return o.rim;
    if (o.outline && depth < outlineEnd) return o.outline;
    if (x >= screen.left && x <= screenEnd.right && y >= screen.top && y <= screenEnd.bottom) return o.screen;
    return o.bezel;
  });

  // App tiles on the screen: something with colour and edges, like the real one.
  const tiles: Rgba[] = [
    [90, 200, 90, 255],
    [240, 240, 240, 255],
    [230, 80, 70, 255],
    [70, 130, 230, 255],
  ];
  const tile = Math.round((screenEnd.right - screen.left) / 8);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = screen.left + tile + col * tile * 1.8;
      const y = screen.top + tile + row * tile * 2.2;
      canvas.rect(Math.round(x), Math.round(y), tile, tile, tiles[(row + col) % tiles.length]);
    }
  }
  return canvas;
}
