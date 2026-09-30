import { gapKey, normaliseQuestion } from "./gap-key";
import { REDACTED, SCRUB_MAX_CHARS, scrubQuestion } from "./scrub";

describe("scrubQuestion", () => {
  it("removes email addresses", () => {
    expect(scrubQuestion("email me at casey.smith+lab@cornell.edu please")).toBe(`email me at ${REDACTED} please`);
  });

  it("removes phone numbers in the usual shapes", () => {
    expect(scrubQuestion("call +1 (607) 555-0123 now")).not.toMatch(/555/);
    expect(scrubQuestion("text 607.555.0123")).not.toMatch(/555/);
    expect(scrubQuestion("or 6075550123")).not.toMatch(/555/);
  });

  it("removes NetID-shaped tokens but keeps CO2 and MK4", () => {
    expect(scrubQuestion("I'm abc123 and jd42")).toBe(`I'm ${REDACTED} and ${REDACTED}`);
    expect(scrubQuestion("Is the CO2 laser like the MK4?")).toBe("Is the CO2 laser like the MK4?");
  });

  it("removes URLs with their query strings", () => {
    expect(scrubQuestion("see https://example.com/x?token=abc&user=casey ok")).toBe(`see ${REDACTED} ok`);
    expect(scrubQuestion("www.example.com/profile/casey")).toBe(REDACTED);
  });

  it("keeps ordinary questions, numbers and settings intact", () => {
    expect(scrubQuestion("What power for 3 mm acrylic at 20 mm/s?")).toBe("What power for 3 mm acrylic at 20 mm/s?");
  });

  it(`caps at ${SCRUB_MAX_CHARS} characters without splitting a character`, () => {
    const long = "🙂".repeat(400);
    const out = scrubQuestion(long);
    expect(Array.from(out)).toHaveLength(SCRUB_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/�/);
  });

  it("folds whitespace and handles Unicode text", () => {
    expect(scrubQuestion("  ¿Cómo   uso\nla   cortadora?  ")).toBe("¿Cómo uso la cortadora?");
    expect(scrubQuestion("激光切割机怎么用")).toBe("激光切割机怎么用");
  });
});

describe("gapKey", () => {
  it("folds case, whitespace, punctuation and accents together", () => {
    expect(gapKey("How do I cut glass?", "t1")).toBe(gapKey("how do i  cut GLASS", "t1"));
    expect(normaliseQuestion("Cómo usar")).toBe("como usar");
  });

  it("keeps different tools apart, and no tool as its own", () => {
    expect(gapKey("cut glass", "t1")).not.toBe(gapKey("cut glass", "t2"));
    expect(gapKey("cut glass", null)).not.toBe(gapKey("cut glass", "t1"));
  });
});
