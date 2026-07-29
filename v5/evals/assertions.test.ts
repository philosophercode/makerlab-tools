import {
  ASSERTION_KINDS,
  calledTool,
  citesResource,
  containsAll,
  isAssertionKind,
  mentionsTool,
  noFabricatedSpecs,
  notContainsAny,
  noUnknownTools,
  runAssertion,
} from "./assertions";
import { evalFixture } from "./fixtures";

// Unit coverage for the assertion vocabulary (design spec §10). These are pure
// functions — no model, no network, no API key — so they run inside `npm test`.
// The interesting cases are the negatives: `no_unknown_tools` catching a
// plausible-but-absent machine, and `no_fabricated_specs` catching a wrong
// number next to a right field name.

const noCalls: never[] = [];

describe("mentions_tool", () => {
  it("finds the machine in plain, bold and linked forms", () => {
    expect(mentionsTool("Use the Trotec Speedy 400.", "Trotec Speedy 400").ok).toBe(true);
    expect(mentionsTool("Use the **Trotec Speedy 400**.", "Trotec Speedy 400").ok).toBe(true);
    expect(
      mentionsTool("Try the [Trotec Speedy 400](/tools/trotec-speedy-400).", "Trotec Speedy 400").ok
    ).toBe(true);
  });

  it("fails when the machine is never named", () => {
    const result = mentionsTool("You should use a laser cutter.", "Trotec Speedy 400");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Trotec Speedy 400");
  });
});

describe("no_unknown_tools", () => {
  it("accepts an answer that only offers catalog machines", () => {
    const text =
      "For 3mm acrylic use the [Trotec Speedy 400](/tools/trotec-speedy-400) in the Laser Bay.";
    expect(noUnknownTools(text, evalFixture).ok).toBe(true);
  });

  it("accepts the manufacturer name of a catalog machine", () => {
    expect(noUnknownTools("The Formlabs Form 4 handles fine detail.", evalFixture).ok).toBe(true);
  });

  it("catches a plausible-but-absent machine offered as available", () => {
    const result = noUnknownTools("You can run that job on the Glowforge Pro.", evalFixture);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Glowforge");
  });

  it("catches a link to a tool page that does not exist", () => {
    const result = noUnknownTools(
      "Try the [Prusa MK4](/tools/prusa-mk4) for that print.",
      evalFixture
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("/tools/prusa-mk4");
  });

  it("allows naming an absent machine in order to deny having it", () => {
    const text =
      "We don't have a waterjet cutter in the MakerLab. For flat stock, the Trotec Speedy 400 can cut acrylic and plywood.";
    expect(noUnknownTools(text, evalFixture).ok).toBe(true);
  });
});

describe("called_tool", () => {
  it("passes when the tool was called", () => {
    expect(calledTool([{ name: "get_unit_details" }], "get_unit_details").ok).toBe(true);
  });

  it("lists what was called instead", () => {
    const result = calledTool([{ name: "search_tools" }], "get_unit_details");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("search_tools");
  });

  it("reports 'none' when no tool was called at all", () => {
    expect(calledTool([], "report_issue").detail).toContain("none");
  });
});

describe("contains_all / not_contains_any", () => {
  it("matches case-insensitively", () => {
    expect(containsAll("Wear Nitrile Gloves.", ["gloves"]).ok).toBe(true);
    expect(notContainsAny("We do not stock that.", ["yes, we have"]).ok).toBe(true);
  });

  it("names what is missing and what is forbidden", () => {
    expect(containsAll("Wear gloves.", ["gloves", "lab coat"]).detail).toContain("lab coat");
    expect(notContainsAny("Yes, we have one.", ["yes, we have"]).ok).toBe(false);
  });
});

describe("no_fabricated_specs", () => {
  it("passes when the answer states no number for an unknown field", () => {
    const text =
      "The catalog doesn't list a build volume for the Form 4 — check the SOP or ask lab staff.";
    expect(noFabricatedSpecs(text, ["build_volume"], evalFixture, "form-4").ok).toBe(true);
  });

  it("catches a wrong number next to a right field name", () => {
    const text = "The Form 4 has a build volume of 145 x 145 x 185 mm.";
    const result = noFabricatedSpecs(text, ["build_volume"], evalFixture, "form-4");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("145");
    expect(result.detail).toContain("records no value for it");
  });

  it("does not mistake a number inside the machine's own name for a spec", () => {
    const text = "The Trotec Speedy 400 cuts acrylic, paper, cardboard and plywood.";
    expect(noFabricatedSpecs(text, ["materials"], evalFixture, "trotec-speedy-400").ok).toBe(true);
  });

  it("ignores sentences that are not about the field", () => {
    const text = "The lab is open 9 to 21 every day.";
    expect(noFabricatedSpecs(text, ["build_volume"], evalFixture, "form-4").ok).toBe(true);
  });

  it("accepts a number that matches the fixture", () => {
    const text = "Form 4 // A was acquired 2024-08-12.";
    expect(noFabricatedSpecs(text, ["date_acquired"], evalFixture, "form-4").ok).toBe(true);
  });

  it("fails loudly on a field the fixture does not define", () => {
    const result = noFabricatedSpecs("anything", ["not_a_field"], evalFixture);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("unknown spec field");
  });
});

describe("cites_resource", () => {
  it("passes when the answer names the document", () => {
    const text = "Follow the Trotec Speedy 400 SOP before you start a job.";
    expect(citesResource(text, evalFixture, "trotec-speedy-400").ok).toBe(true);
  });

  it("fails when the answer cites nothing", () => {
    const result = citesResource("Just be careful.", evalFixture, "trotec-speedy-400");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Trotec Speedy 400 SOP");
  });

  it("fails when the case names a document the catalog does not have", () => {
    const result = citesResource("anything", evalFixture, "form-4", "Waterjet SOP");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("does not have");
  });
});

describe("runAssertion dispatch", () => {
  it("handles every declared kind", () => {
    expect(ASSERTION_KINDS).toHaveLength(7);
    for (const kind of ASSERTION_KINDS) {
      const outcome = runAssertion(
        {
          kind,
          value: kind === "called_tool" ? "get_unit_details" : "Form 4",
          fields: ["materials"],
        },
        { text: "The Form 4 is a resin printer.", toolCalls: noCalls, fixture: evalFixture }
      );
      expect(outcome.kind).toBe(kind);
      expect(typeof outcome.ok).toBe("boolean");
      expect(outcome.expected).not.toBe("");
    }
  });

  it("recognizes only declared kinds", () => {
    expect(isAssertionKind("mentions_tool")).toBe(true);
    expect(isAssertionKind("vibes_check")).toBe(false);
  });
});
