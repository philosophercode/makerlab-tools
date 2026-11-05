import { MODEL_JOBS } from "../ai/models.ts";
import { RESEARCH_MAX_PAGE_READS } from "../intake/limits.ts";
import { brandFromLinks, photoCandidates, photoSearchInstruction, toPhotoOption } from "../photo-options/candidates.ts";
import { PHOTO_OPTIONS_MAX, type PhotoOption } from "../photo-options/types.ts";
import type { ImageHint } from "../web/read-page.ts";
import { uniqueHosts } from "./assemble.ts";
import { expectedFailure, searchProductPictures } from "./image-stage.ts";
import { probeCandidates } from "./images/probe.ts";
import { rankCandidates } from "./images/rank.ts";
import { readCandidatePages } from "./read-pages.ts";
import { isVideoUrl, orderPagesForReading, type PageSubject } from "./source-pages.ts";

/*
 * Its own module, not in `photo-options-steps.ts`: an exported function there
 * that is not a step stays in the workflow bundle with its Node imports, which
 * fails the build. Called from the step's body only, it is left out.
 * Plain Node: relative imports only.
 */

export type FoundPhotoOptions = { ok: true; options: PhotoOption[] } | { ok: false; reason: string };

/**
 * Steps 1–4 with no database: the tool's name, its web links, the person's
 * note and the URLs to leave out in; the ranked options, best first, or why
 * there are none. {@link searchPhotoOptions} runs it for a search row, and the
 * photo-quality eval (`npm run eval:photo-options`) runs it as it ships.
 * Throws only on an unexpected error, as the step expects.
 */
export async function findPhotoOptions(
  input: { name: string; links: readonly string[]; note: string | null; exclude: readonly string[] },
  opts: { label: string; signal: AbortSignal }
): Promise<FoundPhotoOptions> {
  const { name, links } = input;
  const { signal } = opts;
  const subject: { brand: string | null; name: string } = { brand: brandFromLinks(name, links), name };
  const instruction = photoSearchInstruction(input.note);

  const [pageHints, searched] = await Promise.all([
    pagePictures(links, subject, signal),
    searchProductPictures(subject, instruction, { label: opts.label, signal, maxSearches: 1 }),
  ]);
  if (typeof searched === "string") return { ok: false, reason: searched };

  const candidates = photoCandidates(pageHints, searched, { exclude: input.exclude, subject });
  if (candidates.length === 0) return { ok: false, reason: "No new picture of it was found." };

  const usable = (await probeCandidates(candidates, { signal })).flatMap((probe) => (probe.ok ? [probe.image] : []));
  if (usable.length === 0) return { ok: false, reason: "No usable picture of it was found." };

  let ranked;
  try {
    ranked = await rankCandidates(name, usable, { signal, reviewerNote: instruction, brand: subject.brand, maxShown: PHOTO_OPTIONS_MAX });
  } catch (error) {
    const message = expectedFailure(error, "Image ranking", MODEL_JOBS.imageRank.env);
    if (message === null) throw error;
    return { ok: false, reason: message };
  }
  if (ranked.length === 0) return { ok: false, reason: "Pictures were found, but none could be confirmed as the product itself." };
  return { ok: true, options: ranked.map(toPhotoOption) };
}


/** The pictures the tool's own web links declare: at most four pages, product page first, no PDFs, no videos. */
async function pagePictures(urls: readonly string[], subject: PageSubject, signal: AbortSignal): Promise<ImageHint[]> {
  const pages = orderPagesForReading(
    urls.filter((url) => !isVideoUrl(url) && !/\.pdf(?:$|[?#])/i.test(url)),
    subject,
    RESEARCH_MAX_PAGE_READS
  );
  if (pages.length === 0) return [];
  try {
    const read = await readCandidatePages(pages, { signal, allowedHosts: uniqueHosts(pages), max: RESEARCH_MAX_PAGE_READS, maxPdfs: 0 });
    return read.imageHints;
  } catch (error) {
    // The search still runs: the tool's links are a bonus, not the source.
    console.warn(`[photo-options] the tool's links could not be read (${error instanceof Error ? error.name : "unknown error"})`);
    return [];
  }
}
