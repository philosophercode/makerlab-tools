/**
 * One tool as the ⌘K palette knows it: enough to match on (display name,
 * official name, slug), to group by category, and to mark a draft. Built from
 * the cached catalogue for everybody (`getPaletteTools`) and from
 * `listToolIndex` on admin pages.
 */
export interface PaletteTool {
  id: string;
  slug: string;
  name: string;
  officialName: string | null;
  /** The category group the gallery filters on; absent on the admin index. */
  category?: string | null;
  published: boolean;
}
