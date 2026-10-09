import { emptyDraft, type SkillDraft } from "./format";
import { guardSkillDraft, hasNumber, saysNotInSources, weakensSafety } from "./numbers-guard";

/**
 * The checks a skill passes before it is stored (tool skills spec 2026-10-07
 * §5.2.2): unknown cites stripped, uncited numbers removed, uncited claims
 * removed where a source is required, weakening language removed — and every
 * removal recorded.
 */

const KNOWN = new Set(["T1", "N1", "M1", "M2", "R1"]);

function draft(patch: Partial<SkillDraft>): SkillDraft {
  return { ...emptyDraft(), ...patch };
}

describe("hasNumber", () => {
  it.each([
    ["Set the power to 80%.", true],
    ["Bed size 600 × 400 mm", true],
    ["Heat to 215 °C", true],
    ["Use M3 screws", true],
    ["Wait one minute", false],
    ["Export your 3D model as STL", false],
    ["Print 2D drawings on paper", false],
    ["Repeat step 4 if the bed is not level", false],
    ["See steps 2 and 3 above", false],
    ["Follow the manual [M2]", false],
  ])("%s → %s", (text, expected) => {
    expect(hasNumber(text)).toBe(expected);
  });
});

describe("weakensSafety", () => {
  it.each([
    "Safety glasses are optional for short cuts.",
    "Training is not required if you have used one before.",
    "You don't need gloves for this.",
    "No need for ear protection on low speed.",
    "The lid interlock can be bypassed to watch the cut.",
    "Disable the door sensor when engraving.",
    "PPE can be skipped for quick jobs.",
  ])("removes: %s", (text) => {
    expect(weakensSafety(text)).toBe(true);
  });

  it.each([
    "Wear safety glasses; they are not optional.",
    "Do not wear gloves near the rotating spindle.",
    "Training is required before first use.",
    "Keep the lid closed while the laser fires.",
    "This step is optional: cleaning the build plate after each print.",
    "Never bypass the lid interlock.",
    "Do not remove the blade guard.",
    "The door sensor must not be disabled.",
  ])("keeps: %s", (text) => {
    expect(weakensSafety(text)).toBe(false);
  });
});

describe("saysNotInSources", () => {
  it("recognises the agreed phrase, with either apostrophe", () => {
    expect(saysNotInSources("Maximum thickness: not in the lab's sources; ask staff")).toBe(true);
    expect(saysNotInSources("Not in the lab’s sources")).toBe(true);
    expect(saysNotInSources("Ask staff")).toBe(false);
  });
});

describe("guardSkillDraft", () => {
  it("strips cites the writer was never given, and records them", () => {
    const result = guardSkillDraft(draft({ materials: [{ text: "Acrylic and plywood", cites: ["M1", "M9", "X2"] }] }), KNOWN);
    expect(result.draft.materials).toEqual([{ text: "Acrylic and plywood", cites: ["M1"] }]);
    expect(result.unknownCites).toEqual(["M9", "X2"]);
  });

  it("removes an item that states a number with no cite left, and keeps a cited one", () => {
    const result = guardSkillDraft(
      draft({
        settingsAndLimits: [
          { text: "Maximum power 80 W", cites: ["M9"] },
          { text: "Maximum speed 1000 mm/s", cites: ["M2"] },
        ],
        operatingProcedure: [
          { text: "Preheat for 5 minutes", cites: [] },
          { text: "Load the file", cites: [] },
        ],
      }),
      KNOWN
    );
    expect(result.draft.settingsAndLimits).toEqual([{ text: "Maximum speed 1000 mm/s", cites: ["M2"] }]);
    expect(result.draft.operatingProcedure).toEqual([{ text: "Load the file", cites: [] }]);
    // In the guide's section order.
    expect(result.removed).toEqual([
      { section: "operatingProcedure", text: "Preheat for 5 minutes", reason: "uncited_number" },
      { section: "settingsAndLimits", text: "Maximum power 80 W", reason: "uncited_number" },
    ]);
  });

  it("needs a source for every claim in Before you start, Settings and limits and Safety — unless it says the sources are silent", () => {
    const result = guardSkillDraft(
      draft({
        safety: [
          { text: "Keep a fire extinguisher nearby", cites: [] },
          { text: "Where the fire blanket is: not in the lab's sources; ask staff", cites: [] },
          { text: "Never leave the laser running unattended", cites: ["N1"] },
        ],
        beforeYouStart: [{ text: "Book a slot", cites: [] }],
        materials: [{ text: "Cardboard works well", cites: [] }],
      }),
      KNOWN
    );
    expect(result.draft.safety.map((item) => item.text)).toEqual([
      "Where the fire blanket is: not in the lab's sources; ask staff",
      "Never leave the laser running unattended",
    ]);
    expect(result.draft.beforeYouStart).toEqual([]);
    // Elsewhere an uncited line without a number stays.
    expect(result.draft.materials).toHaveLength(1);
    expect(result.removed.map((item) => item.reason)).toEqual(["uncited_claim", "uncited_claim"]);
  });

  it("removes weakening language even when it is cited", () => {
    const result = guardSkillDraft(draft({ safety: [{ text: "Goggles are optional", cites: ["M1"] }] }), KNOWN);
    expect(result.draft.safety).toEqual([]);
    expect(result.removed).toEqual([{ section: "safety", text: "Goggles are optional", reason: "weakens_safety" }]);
  });

  it("checks a troubleshooting row's symptom, check and fix together", () => {
    const result = guardSkillDraft(
      draft({
        troubleshooting: [
          { symptom: "Nozzle clogs", check: "Temperature", fix: "Raise to 220 °C", cites: [] },
          { symptom: "Nozzle clogs", check: "Temperature", fix: "Raise to 220 °C", cites: ["M1"] },
          { symptom: "Lid will not open", check: "Interlock", fix: "Bypass the interlock", cites: ["M1"] },
        ],
      }),
      KNOWN
    );
    expect(result.draft.troubleshooting).toHaveLength(1);
    expect(result.removed.map((item) => item.reason)).toEqual(["uncited_number", "weakens_safety"]);
  });

  it("drops a 'not in the sources' topic that states a number", () => {
    const result = guardSkillDraft(draft({ notInSources: ["Maximum thickness", "Cuts up to 6 mm"] }), KNOWN);
    expect(result.draft.notInSources).toEqual(["Maximum thickness"]);
    expect(result.removed).toEqual([{ section: "notInSources", text: "Cuts up to 6 mm", reason: "uncited_number" }]);
  });
});
