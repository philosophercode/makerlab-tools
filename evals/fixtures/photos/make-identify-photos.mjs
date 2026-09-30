// Builds the photo-identification eval photos (evals/cases/photo-identify.yaml).
//
//   node evals/fixtures/photos/make-identify-photos.mjs
//
// A student photographs a machine, not a product page, so most of these are
// the bundled product images (public/tool-images) put through what a phone
// does to them: placed in a drawn workshop scene (wall, pegboard, bench,
// spools, a box), cut off by the frame, tilted a few degrees, softened, grainy
// and small. One is left as a clean studio shot, one carries a QR label that
// encodes the tool's real label URL, and one is a machine the lab does not
// have. No generative model touches any of them (spec amendment "No
// generative redraw"): every pixel is the product image or drawn here.
//
// Deterministic — the grain comes from a seeded generator — so re-running it
// changes nothing that is committed. Every file is a JPEG no longer than
// 1024 px on its long edge.
//
// The files are named like a phone names them (IMG_2041.jpg), because the chat
// sends the file name to the model in the `[Attached photos: …]` hint — a
// fixture called "bambu-x1c.jpg" would give the answer away.
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import sharp from "sharp";
import { DEFAULT_SITE_URL } from "../../../src/lib/qr/site-url.ts";
import { toolQrTargetUrl } from "../../../src/lib/qr/urls.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const images = path.join(here, "../../../public/tool-images");

const SCENE_W = 1600;
const SCENE_H = 1200;
const BENCH_TOP = 744;
/** Where a machine's feet sit on the bench. */
const BASELINE = 800;

/** mulberry32: a tiny seeded PRNG, so the grain is the same on every run. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A workshop corner: painted wall, pegboard, a wooden bench top, and clutter on it. */
function sceneSvg(seed) {
  const rand = prng(seed);
  const width = SCENE_W;
  const height = SCENE_H;
  const holes = [];
  for (let y = 30; y < BENCH_TOP - 40; y += 26) {
    for (let x = 20; x < width * 0.42; x += 26) holes.push(`<circle cx="${x}" cy="${y}" r="3" fill="#6b5a45"/>`);
  }
  const grain = [];
  for (let i = 0; i < 40; i++) {
    const y = BENCH_TOP + 8 + rand() * (height - BENCH_TOP - 10);
    grain.push(`<path d="M0 ${y.toFixed(1)} Q ${width / 2} ${(y + (rand() - 0.5) * 18).toFixed(1)} ${width} ${(y + (rand() - 0.5) * 10).toFixed(1)}" stroke="#8a6a44" stroke-opacity="${(0.15 + rand() * 0.25).toFixed(2)}" stroke-width="${(1 + rand() * 2).toFixed(1)}" fill="none"/>`);
  }
  const colours = ["#d9482b", "#2f6fb5", "#e8e2d0", "#3c9a4a"];
  const spools = colours.map((colour, i) => {
    const cx = 60 + i * 95;
    return `<rect x="${cx - 38}" y="${BENCH_TOP - 20}" width="76" height="70" rx="6" fill="${colour}"/><ellipse cx="${cx}" cy="${BENCH_TOP - 20}" rx="38" ry="12" fill="#2b2b2b"/><ellipse cx="${cx}" cy="${BENCH_TOP - 20}" rx="11" ry="4" fill="#111"/>`;
  });
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d8d4cb"/><stop offset="1" stop-color="#a9a399"/></linearGradient>
    <linearGradient id="bench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c49a66"/><stop offset="1" stop-color="#8f6a3e"/></linearGradient>
    <radialGradient id="light" cx="0.4" cy="0.3" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.15"/><stop offset="1" stop-color="#000" stop-opacity="0.38"/></radialGradient>
  </defs>
  <rect width="${width}" height="${BENCH_TOP}" fill="url(#wall)"/>
  <rect x="8" y="12" width="${Math.round(width * 0.42)}" height="${BENCH_TOP - 40}" fill="#b89c78"/>
  ${holes.join("")}
  <rect x="120" y="70" width="16" height="96" fill="#444"/><rect x="180" y="60" width="10" height="126" fill="#c33"/><circle cx="300" cy="120" r="34" fill="none" stroke="#333" stroke-width="8"/>
  <rect x="1380" y="140" width="190" height="130" fill="#f3f0e6" stroke="#bbb"/><rect x="1400" y="165" width="150" height="10" fill="#bbb"/><rect x="1400" y="190" width="120" height="10" fill="#bbb"/>
  <rect y="${BENCH_TOP}" width="${width}" height="${height - BENCH_TOP}" fill="url(#bench)"/>
  ${grain.join("")}
  <rect y="${BENCH_TOP - 3}" width="${width}" height="6" fill="#6e5030"/>
  ${spools.join("")}
  <rect x="1290" y="${BENCH_TOP + 30}" width="200" height="120" fill="#b8905a"/><rect x="1290" y="${BENCH_TOP + 30}" width="200" height="20" fill="#a37d4b"/>
  <circle cx="1180" cy="${BENCH_TOP + 150}" r="30" fill="#ddd" stroke="#999" stroke-width="12"/>
  <rect x="200" y="${BENCH_TOP + 160}" width="260" height="18" rx="6" fill="#e4c21f" transform="rotate(-8 330 ${BENCH_TOP + 169})"/>
  <rect width="${width}" height="${height}" fill="url(#light)"/>
</svg>`);
}

/** Seeded grey grain the size of the image, for an overlay blend. */
async function grain(width, height, seed, amount) {
  const rand = prng(seed);
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const v = Math.max(0, Math.min(255, Math.round(128 + (rand() + rand() + rand() - 1.5) * amount)));
    pixels[i * 3] = pixels[i * 3 + 1] = pixels[i * 3 + 2] = v;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

/** The product image, its transparent margin trimmed, scaled to `size` on its long edge. */
async function product(file, size) {
  const trimmed = await sharp(path.join(images, file)).trim().png().toBuffer();
  return sharp(trimmed).resize(size, size, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
}

/**
 * A phone photo of `file` on the bench: the machine stood on the bench at
 * `left`, the frame `crop` (scene pixels) around it, tilted, softened,
 * grainy and small.
 */
async function inSitu(out, file, { size, left, crop, tilt, finalWidth, blur, seed, quality = 62, grainAmount = 38, extra = () => [] }) {
  const { data: machine, info } = await product(file, size);
  const top = BASELINE - info.height;
  const scene = await sharp(sceneSvg(seed))
    .composite([{ input: machine, left, top }, ...extra({ left, top, width: info.width, height: info.height })])
    .png()
    .toBuffer();
  // Tilt the framed region, then cut the corners the rotation filled.
  const framed = await sharp(scene).extract(crop).png().toBuffer();
  const tilted = await sharp(framed).rotate(tilt, { background: "#3a3a3a" }).png().toBuffer();
  const meta = await sharp(tilted).metadata();
  const inner = { width: Math.round(crop.width * 0.9), height: Math.round(crop.height * 0.9) };
  const straight = await sharp(tilted)
    .extract({ left: Math.round((meta.width - inner.width) / 2), top: Math.round((meta.height - inner.height) / 2), ...inner })
    .png()
    .toBuffer();
  // Two pipelines: sharp resizes before it composites, and the grain is full size.
  const noise = await grain(inner.width, inner.height, seed + 1, grainAmount);
  const grainy = await sharp(straight)
    .composite([{ input: noise, blend: "overlay" }])
    .modulate({ brightness: 0.93, saturation: 0.9 })
    .blur(blur)
    .png()
    .toBuffer();
  await sharp(grainy).resize({ width: finalWidth }).jpeg({ quality }).toFile(path.join(here, out));
  console.log("wrote", out);
}

/** A clean product shot on a plain tabletop backdrop — the easy case. */
async function studio(out, file, size) {
  const { data: machine, info } = await product(file, size);
  await sharp({ create: { width: 1000, height: 760, channels: 3, background: "#e9e7e2" } })
    .composite([{ input: machine, left: Math.round((1000 - info.width) / 2), top: Math.round((760 - info.height) / 2) }])
    .jpeg({ quality: 80 })
    .toFile(path.join(here, out));
  console.log("wrote", out);
}

/** A printed MakerLAB label: the code and the lab's name — not the tool's, so only the code says which it is. */
async function qrLabel(slug, px) {
  const code = await QRCode.toBuffer(toolQrTargetUrl(DEFAULT_SITE_URL, slug), { errorCorrectionLevel: "H", width: px, margin: 2 });
  const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="40"><text x="${px / 2}" y="27" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#b31b1b">MakerLAB</text></svg>`);
  return sharp({ create: { width: px, height: px + 40, channels: 3, background: "#ffffff" } })
    .composite([{ input: code, left: 0, top: 0 }, { input: text, left: 0, top: px }])
    .png()
    .toBuffer();
}

// A: the Form 4, a clean studio shot — "what is this and how do I start it?"
await studio("IMG_2041.jpg", "Form 4.png", 560);

// B: the Bambu Lab X1-Carbon on a cluttered bench, tilted, its right side cut off.
await inSitu("IMG_2044.jpg", "Bambu Lab X1-Carbon Combo 3D Printer.png", {
  size: 700, left: 560, tilt: -4, seed: 11, finalWidth: 900, blur: 1.1,
  crop: { left: 0, top: 20, width: 980, height: 980 },
});

// C: the ShopBot, off to one side of the frame, small and soft — asked with no words.
await inSitu("IMG_2050.jpg", "Shopbot Buddy BT48[L36” x W76” x H67”].png", {
  size: 1050, left: 420, tilt: 5, seed: 23, finalWidth: 800, blur: 1.4,
  crop: { left: 120, top: 140, width: 1440, height: 900 },
});

// D: an Ultimaker 3 Extended with its top — and the model name on it — out of
// frame, small and soft: an Ultimaker, but which one is hard to say.
await inSitu("IMG_2057.jpg", "Ultimaker 3 Extended.png", {
  size: 760, left: 520, tilt: 3, seed: 37, finalWidth: 560, blur: 1.6,
  crop: { left: 470, top: 135, width: 700, height: 630 },
});

// E: a benchtop belt and disc sander — a machine the lab does not have.
await inSitu("IMG_2063.jpg", "WEN Benchtop Belt and Disc Sander (6502T).png", {
  size: 760, left: 470, tilt: -3, seed: 41, finalWidth: 880, blur: 0.9,
  crop: { left: 300, top: 200, width: 1100, height: 800 },
});

const labelForF = await qrLabel("epilog-helix-24", 210);

// F: the top of a laser cutter with a MakerLAB QR label on its lid — the
// wordmark on the front is out of frame, so the code is what names it.
await inSitu("IMG_2068.jpg", "Epilog Helix 24 laser (8000 Laser System).png", {
  size: 1000, left: 300, tilt: 2, seed: 53, finalWidth: 1000, blur: 0.4, quality: 78, grainAmount: 16,
  crop: { left: 200, top: 60, width: 1250, height: 440 },
  extra: ({ left, top }) => [{ input: labelForF, left: left + 640, top: top + 40 }],
});

// G: the Prusa, close and off-centre, the bench clutter beside it.
await inSitu("IMG_2072.jpg", "Prusa i3 MK3S+.png", {
  size: 780, left: 560, tilt: -6, seed: 67, finalWidth: 780, blur: 1.2,
  crop: { left: 500, top: 0, width: 760, height: 960 },
});
