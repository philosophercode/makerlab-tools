import en from "../../../messages/en.json";

/**
 * The general opening chips (identity spec 2026-09-28 §4): one each for what
 * the assistant is for — operate, debug, create — shown when no tool page is
 * open. Their text is translated (`chat.starterOperate` …), so the English
 * text is what a cached answer is keyed by; a visitor reading another
 * language always gets a live answer. A replacement the refresh proposes is
 * a message change (and a translation pass) for the owner, never written by
 * the script.
 */
export const GENERAL_CHIP_KEYS = ["starterOperate", "starterDebug", "starterCreate"] as const;

export function generalChipQuestions(): string[] {
  return GENERAL_CHIP_KEYS.map((key) => en.chat[key]);
}

/** What the question writer is told about the general chips' three kinds. */
export const GENERAL_REFINE_NOTE =
  "The three general chips are one of each kind, in this order: operate (how to use or start a machine the lab has), debug (fix a common problem with one), create (what to make, or which of the lab's machines could make something). Name a kind of machine the lab actually has — one of its fabrication machines (3D printers, laser cutters, CNC routers, vinyl cutters, sewing and electronics equipment, hand and power tools), never office equipment such as a paper printer — and keep each broad enough for any student. Write the replacement for the kind that failed, in its place.";
