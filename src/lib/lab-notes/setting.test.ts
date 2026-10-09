// @vitest-environment node
import { LAB_NOTES_MAX_CHARS, labNotesSchema, normalizeLabNotes, readLabNotesSetting } from "./setting";

/** The lab-wide notes as stored in `lab_settings.lab_notes` (identity spec amendment "Lab notes"). */

describe("labNotesSchema", () => {
  it("takes text up to the cap and refuses longer", () => {
    expect(labNotesSchema.safeParse({ text: "x".repeat(LAB_NOTES_MAX_CHARS) }).success).toBe(true);
    expect(labNotesSchema.safeParse({ text: "x".repeat(LAB_NOTES_MAX_CHARS + 1) }).success).toBe(false);
    expect(labNotesSchema.safeParse({ text: 42 }).success).toBe(false);
    expect(labNotesSchema.safeParse({}).success).toBe(false);
  });
});

describe("normalizeLabNotes", () => {
  it("stores one shape: \\n line endings, no trailing spaces, at most one blank line, trimmed", () => {
    expect(normalizeLabNotes({ text: "\r\n  Clean up.   \r\n\r\n\r\n\r\nPut tools back.\t\n\n" })).toEqual({
      text: "Clean up.\n\nPut tools back.",
    });
  });

  it("is idempotent, so saving the same notes twice changes nothing", () => {
    const once = normalizeLabNotes({ text: "A\r\n\r\n\r\nB  " });
    expect(normalizeLabNotes(once)).toEqual(once);
  });
});

describe("readLabNotesSetting", () => {
  it("reads the stored text", () => {
    expect(readLabNotesSetting({ text: "Clean up." })).toBe("Clean up.");
  });

  it("reads a missing row or a value that no longer parses as no notes, never an error", () => {
    for (const bad of [undefined, null, "Clean up.", { text: 3 }, { body: "x" }, { text: "x".repeat(LAB_NOTES_MAX_CHARS + 1) }]) {
      expect(readLabNotesSetting(bad)).toBe("");
    }
  });
});
