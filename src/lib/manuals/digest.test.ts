// @vitest-environment node
import { formatOutline, isSpecLine, manualDigest, specScore, specSectionPages } from "./digest";

/**
 * What research's read model is given of a manual (manual text spec §3.7):
 * the outline, then the pages richest in specifications, in page order,
 * within the budget.
 */

const page = (pageNumber: number, text: string, label: string | null = null) => ({ pageNumber, label, text });

describe("spec lines", () => {
  it("counts a number with a unit, dimensions, or a label with a number", () => {
    for (const line of ["Work area: 400 x 300 mm", "Laser power 40 W", "Input voltage: 110-120 V AC", "Weight: 32 kg", "200 × 125 mm", "Max speed 600 mm/s"]) {
      expect(isSpecLine(line), line).toBe(true);
    }
    for (const line of ["Read the whole manual first.", "Clean the lens weekly", "", "a and b"]) {
      expect(isSpecLine(line), line).toBe(false);
    }
    expect(specScore("Weight: 32 kg\nprose here\nPower: 40 W")).toBe(2);
  });
});

describe("formatOutline", () => {
  it("indents by level, gives pages, leaves out level 3, and stops at the budget", () => {
    const outline = [
      { title: "Safety", page: 3, level: 1 },
      { title: "Laser safety", page: 4, level: 2 },
      { title: "Class 4", page: 4, level: 3 },
      { title: "Specifications", page: 12, level: 1 },
    ];
    expect(formatOutline(outline, 1000)).toBe("- Safety (p. 3)\n  - Laser safety (p. 4)\n- Specifications (p. 12)");
    expect(formatOutline(outline, 20)).toBe("- Safety (p. 3)\n  …");
  });
});

describe("manualDigest", () => {
  const pages = [
    page(1, "Welcome. Thank you for choosing the Acme Laser."),
    page(2, "Safety: never leave the laser running unattended."),
    page(3, "Work area: 400 x 300 mm\nLaser power: 40 W\nWeight: 32 kg", "3-1"),
    page(4, "Cleaning the lens with the wipes."),
    page(5, "Input voltage: 110-120 V\nRated current: 5 A"),
  ];

  it("gives the outline, then the spec-rich pages in page order, each headed with its page and printed label", () => {
    const digest = manualDigest({ outline: [{ title: "Specifications", page: 3, level: 1 }], pages }, 10_000);
    expect(digest).toBe(
      [
        "Contents:\n- Specifications (p. 3)",
        "[page 3 (printed 3-1)]\nWork area: 400 x 300 mm\nLaser power: 40 W\nWeight: 32 kg",
        // Page 4 opens nothing but follows the Specifications heading, so it counts too.
        "[page 4]\nCleaning the lens with the wipes.",
        "[page 5]\nInput voltage: 110-120 V\nRated current: 5 A",
      ].join("\n\n")
    );
  });

  it("takes the richest pages first when they do not all fit, and never exceeds the budget", () => {
    const digest = manualDigest({ outline: [], pages }, 290);
    expect(digest).toContain("[page 3");
    expect(digest).not.toContain("Welcome");
    expect(digest.length).toBeLessThanOrEqual(290);
  });

  it("gives the first pages when no page reads like a specification", () => {
    const prose = [page(1, "Intro prose."), page(2, "More prose.")];
    expect(manualDigest({ outline: [], pages: prose }, 1000)).toBe("[page 1]\nIntro prose.\n\n[page 2]\nMore prose.");
  });

  it("cuts a single page that alone is over the budget at a line break", () => {
    const huge = page(1, Array.from({ length: 400 }, (_, i) => `Spec ${i}: ${i} mm`).join("\n"));
    const digest = manualDigest({ outline: [], pages: [huge] }, 1000);
    expect(digest.length).toBeLessThanOrEqual(1000);
    expect(digest).toMatch(/\n…\[page cut\]$/);
  });

  it("favours the pages a specifications chapter opens on", () => {
    expect([...specSectionPages([{ title: "Technical Data", page: 7, level: 1 }, { title: "Safety", page: 2, level: 1 }])]).toEqual([7, 8]);
  });
});
