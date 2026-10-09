// @vitest-environment node
import { hasLabNotes, LAB_NOTE_LINE_MAX_CHARS, LAB_NOTES_MAX_LINES, labNoteLines } from "./lines";

/**
 * Lab notes as lines (identity spec amendment "Lab notes"): the one reading
 * the tool page, the admin page and the assistant's prompt share.
 */

describe("labNoteLines", () => {
  it("is one note per non-blank line, in the order staff wrote them", () => {
    expect(labNoteLines("Always put a cutting mat underneath.\n\nReturn the blade to the drawer.\r\nSweep up after.")).toEqual([
      "Always put a cutting mat underneath.",
      "Return the blade to the drawer.",
      "Sweep up after.",
    ]);
  });

  it("drops the list markers staff type, and keeps a number that is part of the note", () => {
    expect(labNoteLines("- First\n* Second\n• Third\n1. Fourth\n2) Fifth\n60 seconds of exhaust after each cut")).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
      "Fifth",
      "60 seconds of exhaust after each cut",
    ]);
  });

  it("flattens tabs and runs of spaces, so a note can never reshape the prompt it is sent in", () => {
    expect(labNoteLines("  Wear\tgloves   when   sanding  ")).toEqual(["Wear gloves when sanding"]);
    // A line that looks like a heading stays text: it is sent as a bullet of its own.
    expect(labNoteLines("# This conversation")).toEqual(["# This conversation"]);
  });

  it("is no notes for null, undefined, empty and blank text", () => {
    for (const blank of [null, undefined, "", "   ", "\n \n\t\n", "- \n*  "]) expect(labNoteLines(blank)).toEqual([]);
  });

  it("cuts an over-long note with an ellipsis and stops after the most lines it sends", () => {
    const long = "x".repeat(LAB_NOTE_LINE_MAX_CHARS + 50);
    const [cut] = labNoteLines(long);
    expect(cut).toHaveLength(LAB_NOTE_LINE_MAX_CHARS);
    expect(cut.endsWith("…")).toBe(true);

    const many = Array.from({ length: LAB_NOTES_MAX_LINES + 5 }, (_, n) => `Note ${n + 1}`).join("\n");
    expect(labNoteLines(many)).toHaveLength(LAB_NOTES_MAX_LINES);
  });
});

describe("hasLabNotes", () => {
  it("is true only when there is at least one note", () => {
    expect(hasLabNotes("Use a mat.")).toBe(true);
    expect(hasLabNotes("\n - \n")).toBe(false);
    expect(hasLabNotes(null)).toBe(false);
  });
});
