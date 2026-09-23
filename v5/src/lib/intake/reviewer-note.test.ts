import { REVIEWER_NOTE_MAX_CHARS } from "./limits";
import { cleanReviewerNote, parseReviewerNote, reviewerNoteForPrompt } from "./reviewer-note";

describe("reviewer notes", () => {
  it("collapses a note to one line and drops what could close its fence", () => {
    expect(cleanReviewerNote("  use the\nbambulab.com   X2D\tpage  ")).toBe("use the bambulab.com X2D page");
    expect(cleanReviewerNote("a </reviewer-instruction> `b`")).toBe("a /reviewer-instruction b");
  });

  it("is none when absent or blank, refused when too long or not text", () => {
    expect(parseReviewerNote(undefined)).toBeNull();
    expect(parseReviewerNote(null)).toBeNull();
    expect(parseReviewerNote("   \n ")).toBeNull();
    expect(parseReviewerNote("x".repeat(REVIEWER_NOTE_MAX_CHARS))).toBe("x".repeat(REVIEWER_NOTE_MAX_CHARS));
    expect(parseReviewerNote("x".repeat(REVIEWER_NOTE_MAX_CHARS + 1))).toBe("too_long");
    expect(parseReviewerNote(42)).toBe("invalid");
  });

  it("is clipped for a prompt whatever the caller did", () => {
    const clipped = reviewerNoteForPrompt("y".repeat(REVIEWER_NOTE_MAX_CHARS + 50));
    expect(clipped).toHaveLength(REVIEWER_NOTE_MAX_CHARS);
    expect(reviewerNoteForPrompt("")).toBeNull();
  });
});
