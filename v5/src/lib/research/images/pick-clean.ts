import { inspectImage, type ImageInfo } from "../../images/inspect.ts";
import type { BackgroundClass, CleanedKind, CleanNote } from "../result.ts";
import { classifyBackground } from "./background.ts";
import { makeCleanCopy } from "./clean-copy.ts";
import { parseProductBox } from "./crop.ts";
import type { SharpLoader } from "./downscale.ts";

/**
 * The image an admin picked, cleaned the way rank 1 is — at the moment it is
 * downloaded to become a tool's photo (gateway spec amendment "The picked
 * image is cleaned too"). Research makes a cleaned copy of rank 1 only; this
 * gives any other candidate, and refresh research's accepted cover, the same
 * deterministic crop and cutout (`clean-copy.ts`'s `makeCleanCopy`). CPU only:
 * no model call, never a redraw.
 *
 * What research recorded about the candidate is used when present —
 * `background`, `composite`, `productBox`. A candidate recorded without a
 * background class (older rows, older refresh proposals) is classified here.
 *
 * Answers the cleaned PNG when a copy was made, otherwise the **original bytes
 * unchanged** with the note saying why (a busy backdrop with no box, a cut
 * that failed its checks, no `sharp`); an already transparent picture is its
 * own clean version and comes back as it is, with no note. Never throws.
 *
 * Plain Node: imported by server code and tests alike.
 */

/** What research recorded about the picked candidate. Every field optional. */
export interface PickHints {
  background?: BackgroundClass | null;
  composite?: boolean | null;
  productBox?: readonly number[] | null;
}

export interface PickedImage {
  bytes: Uint8Array;
  info: ImageInfo;
  /** The kind of copy made, or null when these are the original bytes. */
  cleaned: CleanedKind | null;
  /** Why no copy (or, beside a `cropped` one, no cut) was made; null otherwise. */
  note: CleanNote | null;
}

export async function cleanPickedImage(
  original: { bytes: Uint8Array; info: ImageInfo },
  hints: PickHints = {},
  opts: { loadSharp?: SharpLoader } = {}
): Promise<PickedImage> {
  const asIs = (note: CleanNote | null): PickedImage => ({ ...original, cleaned: null, note });
  try {
    const background = hints.background ?? (await classifyBackground(original.bytes, { loadSharp: opts.loadSharp }));
    if (background === "transparent") return asIs(null);
    const copy = await makeCleanCopy(
      {
        bytes: original.bytes,
        background,
        composite: hints.composite === true,
        productBox: hints.productBox ? parseProductBox([...hints.productBox]) : null,
      },
      { loadSharp: opts.loadSharp }
    );
    if (!copy.made) return asIs(copy.note);
    // The copy is a PNG `makeCleanCopy` encoded; read its own header rather than trust a field.
    const info = inspectImage(copy.bytes) ?? copy.info;
    return { bytes: copy.bytes, info, cleaned: copy.kind, note: copy.note };
  } catch {
    return asIs("failed");
  }
}
