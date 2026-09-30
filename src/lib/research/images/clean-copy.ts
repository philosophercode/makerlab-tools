import type { ImageInfo } from "../../images/inspect.ts";
import type { BackgroundClass, CleanedKind, CleanNote } from "../result.ts";
import { classifyBackground } from "./background.ts";
import { cleanImage } from "./clean.ts";
import { boxWithin, CROP_ONLY_PADDING, CROP_PADDINGS, cropToBox, padBox, shouldCrop, type ProductBox } from "./crop.ts";
import type { SharpLoader } from "./downscale.ts";

/**
 * What rank 1's cleaned copy is, if anything (gateway spec amendments "No
 * generative redraw: deterministic cutout" and "Composites and product crop").
 * Every copy is the original's own pixels — cropped, cut, or both — never a
 * redraw.
 *
 * - **A product box, and a reason to use it** (`crop.ts`'s `shouldCrop`: a
 *   composite, a busy background, or the product under 80% of the frame) →
 *   the original is **cropped** to the box, padded 4%, then 2%, then 1%
 *   (`CROP_PADDINGS`) until a crop is on a `plain` backdrop and its **cut**
 *   passes the cutout's checks (`cropped_and_cut`). The cut is told where the
 *   box is (`protect`): inside it the fill takes only near-backdrop pixels and
 *   follows no gradient, so a white base a shade off a white backdrop stays.
 *   When no crop can be cut, one is kept alone (`cropped`, padded 2%) with a
 *   note saying why the backdrop stayed; an already transparent crop is kept
 *   as it is.
 * - **Otherwise, as before the crop existed:** a `plain` rank 1 is cut
 *   (`cut`, protected by the box when the ranking gave one); a `busy` one
 *   gets nothing (`busy_background`); a `transparent` or unclassified one gets
 *   nothing and no note.
 *
 * Never throws. Plain Node: step code imports this.
 */

export interface CleanCopySource {
  bytes: Uint8Array;
  background: BackgroundClass | null;
  composite: boolean;
  productBox: ProductBox | null;
}

export type CleanCopy =
  | { made: true; kind: CleanedKind; bytes: Uint8Array; info: ImageInfo; note: CleanNote | null }
  | { made: false; note: CleanNote | null };

export async function makeCleanCopy(source: CleanCopySource, opts: { loadSharp?: SharpLoader } = {}): Promise<CleanCopy> {
  const load = opts.loadSharp;
  const box = source.productBox;
  if (shouldCrop(box, source)) {
    let cutNote: CleanNote | null = null;
    for (const padding of CROP_PADDINGS) {
      const crop = await cropToBox(source.bytes, box, { loadSharp: load, padding });
      if (!crop) return { made: false, note: "failed" };
      const background = await classifyBackground(crop.bytes, { loadSharp: load });
      if (background === "transparent") return { made: true, kind: "cropped", bytes: crop.bytes, info: crop.info, note: null };
      if (background !== "plain") continue;
      const cut = await cleanImage(crop.bytes, { loadSharp: load, protect: boxWithin(box, padBox(box, padding)) });
      if (cut.ok) return { made: true, kind: "cropped_and_cut", bytes: cut.image.bytes, info: cut.image.info, note: null };
      cutNote ??= cut.note;
    }
    // No crop could be cut: keep one alone, with some margin and less of its neighbours.
    const crop = await cropToBox(source.bytes, box, { loadSharp: load, padding: CROP_ONLY_PADDING });
    if (!crop) return { made: false, note: "failed" };
    return { made: true, kind: "cropped", bytes: crop.bytes, info: crop.info, note: cutNote ?? "busy_background" };
  }

  if (source.background === "busy") return { made: false, note: "busy_background" };
  if (source.background !== "plain") return { made: false, note: null };
  // A box the crop did not need still tells the cut where the product is.
  const cut = await cleanImage(source.bytes, { loadSharp: load, ...(box ? { protect: box } : {}) });
  return cut.ok
    ? { made: true, kind: "cut", bytes: cut.image.bytes, info: cut.image.info, note: null }
    : { made: false, note: cut.note };
}
