import { and, eq, isNotNull } from "drizzle-orm";
import { failPhotoSearch, finishPhotoSearch, getPhotoSearch, shownPhotoUrls } from "../data/photo-searches.ts";
import { getDb } from "../db/client.ts";
import { attachments, resources, tools } from "../db/schema/index.ts";
import { IMAGE_STEP_MAX_RETRIES, IMAGE_STEP_TIMEOUT_MS, RESEARCH_STEP_MAX_RETRIES } from "../intake/limits.ts";
import { lookupName } from "../tool-names.ts";
import { imageErrorText } from "./image-stage.ts";
import { findPhotoOptions } from "./photo-options-find.ts";

/**
 * **Find photo options** for a catalogue tool (photo options spec 2026-10-29
 * §3). The workflow is `src/workflows/photo-options.ts`; the action has already
 * checked `tools.edit`, charged the daily allowance and written the
 * `searching` row (`data/photo-searches.ts`).
 *
 * {@link searchPhotoOptions}:
 *
 * 1. **The tool's own links.** Its resources that are web pages — the maker's
 *    product page when somebody added one — read through the SSRF-guarded
 *    reader on their own hosts only, at most four, the product page first, for
 *    the pictures they declare.
 * 2. **One Exa search**, always, aimed at the manufacturer's product page and
 *    told the house preference ({@link photoSearchInstruction}) and the
 *    person's note.
 * 3. **New pictures only.** Whatever the tool's earlier searches offered and
 *    whatever its photos were downloaded from are left out, so asking again
 *    is "more options", and the current (bad) cover is never offered back.
 * 4. **Probe and rank** exactly as research does — the same vision ranking,
 *    which drops anything that is not the product itself, puts composites
 *    (banners, store scenes) last, prefers a plain backdrop and the maker's
 *    own pictures — told the same preference, keeping up to
 *    `PHOTO_OPTIONS_MAX`. **Nothing is downloaded to keep and nothing is
 *    cleaned**: a pick does that (`photo-options/pick.ts`).
 * 5. **Write** the options, only while the row is still `searching`.
 *
 * An expected failure (a model error, nothing found) is written as the row's
 * `error`; anything unexpected throws, the step retries, and the workflow
 * finally records it with {@link markPhotoSearchFailed}.
 *
 * Plain Node: step code. Relative imports only.
 */

export type PhotoSearchOutcome = "done" | "failed" | "skipped";

export async function searchPhotoOptions(searchId: string): Promise<PhotoSearchOutcome> {
  "use step";
  const search = await getPhotoSearch(searchId);
  if (!search || search.status !== "searching") return "skipped";

  const db = await getDb();
  const [tool] = await db
    .select({ id: tools.id, name: tools.name, officialName: tools.officialName })
    .from(tools)
    .where(eq(tools.id, search.toolId));
  if (!tool) return fail(searchId, "The tool is gone.");

  const links = (
    await db.select({ url: resources.url }).from(resources).where(and(eq(resources.toolId, tool.id), isNotNull(resources.url)))
  ).flatMap((row) => (row.url ? [row.url] : []));
  const photoSources = (
    await db
      .select({ url: attachments.sourceUrl })
      .from(attachments)
      .where(and(eq(attachments.ownerType, "tool"), eq(attachments.ownerId, tool.id), isNotNull(attachments.sourceUrl)))
  ).flatMap((row) => (row.url ? [row.url] : []));

  const exclude = [...(await shownPhotoUrls(tool.id, { except: searchId })), ...photoSources];
  const found = await findPhotoOptions(
    { name: lookupName(tool), links, note: search.note, exclude },
    { label: searchId, signal: AbortSignal.timeout(IMAGE_STEP_TIMEOUT_MS) }
  );
  if (!found.ok) return fail(searchId, found.reason);
  return (await finishPhotoSearch(searchId, found.options)) ? "done" : "skipped";
}
searchPhotoOptions.maxRetries = IMAGE_STEP_MAX_RETRIES;

/** The workflow gave up on the search: record why. */
export async function markPhotoSearchFailed(searchId: string, reason: string): Promise<boolean> {
  "use step";
  return failPhotoSearch(searchId, imageErrorText(reason));
}
markPhotoSearchFailed.maxRetries = RESEARCH_STEP_MAX_RETRIES;

async function fail(searchId: string, reason: string): Promise<PhotoSearchOutcome> {
  await failPhotoSearch(searchId, imageErrorText(reason));
  return "failed";
}
