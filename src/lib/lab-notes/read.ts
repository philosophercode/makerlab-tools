import { cacheLife, cacheTag } from "next/cache";
import { CATALOG_CACHE } from "../cache";
import { getLabSetting, LAB_NOTES_SETTING } from "../data/lab-settings";
import { labNoteLines } from "./lines";
import { readLabNotesSetting } from "./setting";

/**
 * The lab-wide notes as the assistant reads them (identity spec amendment
 * "Lab notes"): one line per note, from the `lab_notes` setting.
 *
 * Cached with the catalogue (tag `catalog`, `CATALOG_CACHE`), because every
 * chat turn reads it and staff change it a few times a term; saving the notes
 * (`lab.set_notes`) drops the tag, so the next turn has them (Article 4). A
 * stored value that no longer parses reads as no notes.
 */
export async function getLabWideNotes(): Promise<string[]> {
  "use cache";
  cacheTag("catalog");
  cacheLife(CATALOG_CACHE);

  const setting = await getLabSetting(LAB_NOTES_SETTING);
  return labNoteLines(readLabNotesSetting(setting?.value));
}

/**
 * {@link getLabWideNotes} for a chat turn: a read that fails leaves the turn
 * without the notes and says so in the log, rather than failing the answer.
 * The catch sits outside the cached read, so a failure is never cached as
 * "no notes".
 */
export async function loadLabWideNotes(): Promise<string[]> {
  try {
    return await getLabWideNotes();
  } catch (err) {
    console.error("[lab-notes] could not read the lab-wide notes", err);
    return [];
  }
}
