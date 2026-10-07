import { inlineText } from "../web/fence";

/** The heading the companion rules point at (`lab-companion.ts`). */
export const ON_SHIFT_HEADING = "On shift now";

/**
 * "On shift now" in the chat prompt (on-shift spec 2026-10-07 §5.4): the
 * staff who marked themselves on shift, as students see them ("Alex M."), so
 * the companion line can say "Alex M. is on shift, ask them to show you."
 *
 * Per request, so it goes in the prompt's "This conversation" tail, never
 * the cached prefix. **Empty when nobody is on shift**: no section at all,
 * and the companion rules then name nobody ("ask a SuperMaker"). The names
 * are people's own display names, so each is quoted on its own line
 * (`inlineText`): a name cannot end its line and start an instruction. They
 * are already short (first word and an initial) before they get here.
 *
 * Starter answers are pre-run and cached, so they are composed without this
 * section and never name anyone on shift.
 */
export function onShiftSection(names: readonly string[]): string {
  if (names.length === 0) return "";
  const list = names.map((name) => `- ${inlineText(name, 40)}`).join("\n");
  return `## ${ON_SHIFT_HEADING}

These MakerLAB staff marked themselves on shift at the lab right now:

${list}

When the "point to people" rule applies, you may suggest one of them by name, written without the quotes, for example: "Alex M. is on shift, ask them to show you." Name only people in this list, exactly as written. Do not say when their shift ends, where they are, or anything else about them.`;
}
