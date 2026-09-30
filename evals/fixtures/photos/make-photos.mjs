// Builds the multi-item intake photos the eval cases attach (evals/cases/multi-item-intake.yaml).
//
//   node evals/fixtures/photos/make-photos.mjs
//
// Each "photo" is a plain backdrop with several of the bundled product images
// (public/tool-images) placed on it — one picture of several things, the case
// the amendment "Many items at once" is about. Deterministic: the same inputs
// give the same files, so re-running it changes nothing that is committed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const images = path.join(here, "../../../public/tool-images");

async function tile(file, size) {
  return sharp(path.join(images, file)).resize(size, size, { fit: "contain", background: "#f4f1ea" }).flatten({ background: "#f4f1ea" }).toBuffer();
}

async function photo(out, width, height, items) {
  const composites = [];
  for (const item of items) composites.push({ input: await tile(item.file, item.size), left: item.left, top: item.top });
  await sharp({ create: { width, height, channels: 3, background: "#f4f1ea" } })
    .composite(composites)
    .jpeg({ quality: 78 })
    .toFile(path.join(here, out));
  console.log("wrote", out);
}

// One photo, three things: a drill press, a Cricut and a battery on a bench.
await photo("bench-three-tools.jpg", 1500, 560, [
  { file: "RYOBI Drill Press.png", size: 500, left: 30, top: 30 },
  { file: "Cricut Maker® 3.png", size: 460, left: 560, top: 60 },
  { file: "RYOBI ONE+ 18V Lithium-Ion 3.0 Ah Battery P103.png", size: 300, left: 1110, top: 230 },
]);

// Two photos: the Cricut in both (the same machine, seen twice), a soldering station in the second.
await photo("shelf-a.jpg", 800, 560, [{ file: "Cricut Maker® 3.png", size: 500, left: 150, top: 30 }]);
await photo("shelf-b.jpg", 1100, 560, [
  { file: "Cricut Maker® 3.png", size: 420, left: 20, top: 90 },
  { file: "HAKKO FX-888D.png", size: 440, left: 560, top: 60 },
]);
