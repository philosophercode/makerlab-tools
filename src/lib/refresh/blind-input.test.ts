import { buildReadPrompt, buildSearchPrompt } from "../research/prompt";
import { blindInput } from "./blind-input";

/**
 * Blind research (refresh research spec §2, §10): the prompts built for a
 * refresh contain **no current field value**, even when the tool has every
 * field filled — so the model cannot echo a hand-typed mistake back.
 */

const TOOL = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "wen-dc3401",
  name: "WEN DC3401",
  categoryName: "Dust Collection",
  description: "UNIQUE-DESCRIPTION-TEXT rated for 1 micron.",
  materials: ["UNIQUE-MATERIAL"],
  ppeRequired: ["UNIQUE-PPE"],
  tags: ["UNIQUE-TAG"],
  trainingRequired: true,
  useRestrictions: "UNIQUE-RESTRICTION",
  emergencyStop: "UNIQUE-EMERGENCY-STOP",
  notes: "UNIQUE-NOTE",
  floorCheck: "UNIQUE-FLOOR-CHECK",
  locationName: "UNIQUE-LOCATION",
};

const FILLED_VALUES = [
  "UNIQUE-DESCRIPTION-TEXT",
  "1 micron",
  "UNIQUE-MATERIAL",
  "UNIQUE-PPE",
  "UNIQUE-TAG",
  "UNIQUE-RESTRICTION",
  "UNIQUE-EMERGENCY-STOP",
  "UNIQUE-NOTE",
  "UNIQUE-FLOOR-CHECK",
  "UNIQUE-LOCATION",
];

describe("blindInput", () => {
  it("carries the name and the category's name only", () => {
    expect(blindInput(TOOL)).toEqual({ name: "WEN DC3401", brand: null, categoryHint: "Dust Collection", locationHint: null });
  });

  it("names the tool by its official name when it has one (tool display names spec §5.5)", () => {
    expect(blindInput({ ...TOOL, name: "WEN Air Filter", officialName: "WEN DC3401 3-Speed Air Filtration System" }).name).toBe(
      "WEN DC3401 3-Speed Air Filtration System"
    );
    expect(blindInput({ ...TOOL, name: "WEN Air Filter", officialName: "  " }).name).toBe("WEN Air Filter");
  });

  it("the search and read prompts built from it contain no current value", () => {
    const input = blindInput(TOOL);
    const search = buildSearchPrompt(input, [], null, null);
    const read = buildReadPrompt(
      input,
      { canonicalName: "WEN DC3401", description: "", category: null, candidateLinks: [], sourceUrls: [], evidence: {} },
      { pages: [{ url: "https://wenproducts.com/dc3401", title: "DC3401", text: "Filters to 5 microns." }], pdfs: [], failures: [] },
      [],
      null,
      null
    );
    for (const prompt of [search, read]) {
      expect(prompt).toContain("WEN DC3401");
      expect(prompt).toContain("Dust Collection");
      for (const value of FILLED_VALUES) expect(prompt).not.toContain(value);
    }
  });
});
