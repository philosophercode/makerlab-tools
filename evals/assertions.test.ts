import {
  citesPage,
  saysNotCovered,
  ASSERTION_KINDS,
  calledTool,
  notCalledTool,
  citesResource,
  containsAll,
  containsAny,
  isAssertionKind,
  mentionsTool,
  noFabricatedSpecs,
  notContainsAny,
  noUnknownTools,
  runAssertion,
} from "./assertions";
import { buildFixture, evalFixture } from "./fixtures";
import { mockTools } from "@/components/mock-catalog";

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

  it("reads a denial written with a typographic apostrophe as a denial", () => {
    // What GPT-6 Luna actually answered in the 2026-09-23 eval gate run.
    expect(noUnknownTools("I don\u2019t see a waterjet cutter in the MakerLab catalog.", evalFixture).ok).toBe(true);
    expect(
      noUnknownTools(
        "I don\u2019t see a Bambu Lab X1-Carbon in the MakerLab catalog, so I can\u2019t confirm its location.",
        evalFixture
      ).ok
    ).toBe(true);
  });

  it("allows naming an absent machine in order to deny having it", () => {
    const text =
      "We don't have a waterjet cutter in the MakerLab. For flat stock, the Trotec Speedy 400 can cut acrylic and plywood.";
    expect(noUnknownTools(text, evalFixture).ok).toBe(true);
  });
});

describe("not_called_tool", () => {
  it("passes when the tool was never called, and counts the calls when it was", () => {
    expect(notCalledTool([{ name: "search_tools" }], "propose_change").ok).toBe(true);
    const result = notCalledTool([{ name: "propose_change" }, { name: "propose_change" }], "propose_change");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("2 time");
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

describe("contains_any", () => {
  it("passes when any one literal is present, case and emphasis ignored", () => {
    expect(containsAny("Ask a **SuperMaker** to show you.", ["staff", "SuperMaker"]).ok).toBe(true);
    expect(containsAny("Check with lab Staff first.", ["staff", "SuperMaker"]).ok).toBe(true);
  });

  it("fails when none is present, naming them all", () => {
    const result = containsAny("Just press start.", ["staff", "SuperMaker"]);
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('none of: "staff", "SuperMaker"');
  });

  it("runs from a case file's spec", () => {
    const input = { text: "Ask a Super Maker on shift.", toolCalls: [], fixture: evalFixture };
    expect(runAssertion({ kind: "contains_any", value: ["SuperMaker", "Super Maker"] }, input).ok).toBe(true);
    expect(runAssertion({ kind: "contains_any", value: ["staff"] }, input).ok).toBe(false);
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

describe("cites_page", () => {
  it("accepts a #page=N link or p. N, and checks the page when one is named", () => {
    expect(citesPage("See [Replacing the resin tank (Form 4 Manual, p. 42)](https://b.test/m.pdf#page=42).").ok).toBe(true);
    expect(citesPage("See page 42 of the manual.", "42").ok).toBe(true);
    expect(citesPage("See [the manual](https://b.test/m.pdf#page=41).", "42")).toMatchObject({ ok: false });
    expect(citesPage("Lift the tank straight up.")).toMatchObject({ ok: false });
  });

  it("pins the document with file.pdf#page=N: the same page of another manual does not pass", () => {
    const scan = "[Washing prints (Form Wash Guide, p. 3)](https://b.test/manuals/form-wash-guide.pdf#page=3)";
    const other = "[Washing (Form 4 Manual, p. 3)](https://b.test/manuals/form-4-manual.pdf#page=3)";
    expect(citesPage(scan, "form-wash-guide.pdf#page=3").ok).toBe(true);
    expect(citesPage(other, "form-wash-guide.pdf#page=3")).toMatchObject({ ok: false, detail: expect.stringContaining("form-4-manual.pdf#page=3") });
    expect(citesPage(scan.replace("page=3", "page=30"), "form-wash-guide.pdf#page=3")).toMatchObject({ ok: false });
    expect(citesPage("Form Wash Guide, p. 3", "form-wash-guide.pdf#page=3")).toMatchObject({ ok: false });
  });
});

describe("says_not_covered", () => {
  it("accepts an honest 'the manual does not cover it', in either apostrophe", () => {
    expect(saysNotCovered("The Form 4 manual doesn’t cover warranty terms.").ok).toBe(true);
    expect(saysNotCovered("I could not find that in the manual.").ok).toBe(true);
    expect(saysNotCovered("The searchable Form 4 Manual doesn’t state a warranty period.").ok).toBe(true);
    expect(saysNotCovered("The warranty is two years.").ok).toBe(false);
  });
});

describe("runAssertion dispatch", () => {
  it("handles every declared kind", () => {
    expect(ASSERTION_KINDS).toHaveLength(17);
    for (const kind of ASSERTION_KINDS) {
      const outcome = runAssertion(
        {
          kind,
          value: kind === "called_tool" || kind === "not_called_tool" ? "get_unit_details" : kind === "identified_count" ? "2" : "Form 4",
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

describe("the identify_tools assertions (amendment \"Many items at once\")", () => {
  const call = (items: unknown[]) => [{ name: "identify_tools", input: { items } }];
  const input = (toolCalls: { name: string; input?: unknown }[]) => ({ text: "", toolCalls, fixture: evalFixture });
  const bench = call([
    { name: "RYOBI 10 in. Drill Press", brand: "RYOBI", attachmentIds: ["p1"] },
    { name: "Cricut Maker 3", brand: "Cricut", attachmentIds: ["p1"] },
    { name: "RYOBI ONE+ 18V Battery P103", brand: "RYOBI", quantity: 2, attachmentIds: ["p1"] },
  ]);

  it("matches each wanted entry to a different item, by any alternative", () => {
    expect(runAssertion({ kind: "identified_items", value: ["drill press", "cricut|maker", "battery x2"] }, input(bench)).ok).toBe(true);
  });

  it("needs the quantity an entry asks for", () => {
    const outcome = runAssertion({ kind: "identified_items", value: ["battery x3"] }, input(bench));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("quantity 2");
  });

  it("never lets one item satisfy two entries", () => {
    expect(runAssertion({ kind: "identified_items", value: ["ryobi", "ryobi", "ryobi"] }, input(bench)).ok).toBe(false);
  });

  it("counts the items of the last call, as a number or a range", () => {
    expect(runAssertion({ kind: "identified_count", value: "3" }, input(bench)).ok).toBe(true);
    expect(runAssertion({ kind: "identified_count", value: "2-4" }, input(bench)).ok).toBe(true);
    const outcome = runAssertion({ kind: "identified_count", value: "2" }, input(bench));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("3 item(s)");
  });

  it("fails when identify_tools was never called", () => {
    expect(runAssertion({ kind: "identified_count", value: "1" }, input([])).detail).toBe("identify_tools was never called");
    expect(runAssertion({ kind: "identified_items", value: ["x"] }, input([{ name: "start_import" }])).ok).toBe(false);
  });
});

describe("the proposal assertions (assistant–GUI parity spec §10.1)", () => {
  const input = (text: string, toolCalls: { name: string }[] = []) => ({ text, toolCalls, fixture: evalFixture });

  it("contains_all ignores markdown emphasis", () => {
    expect(runAssertion({ kind: "contains_all", value: ["People page"] }, input("Do it on the **People** page.")).ok).toBe(true);
    expect(runAssertion({ kind: "contains_all", value: ["People page"] }, input("Ask the people at the desk.")).ok).toBe(false);
  });

  it("proposed_action passes on a call to the action tool", () => {
    expect(runAssertion({ kind: "proposed_action", value: "set_person_title" }, input("", [{ name: "set_person_title" }])).ok).toBe(true);
    expect(runAssertion({ kind: "proposed_action", value: "set_person_title" }, input("", [{ name: "find_people" }])).ok).toBe(false);
  });

  it.each([
    "Done — Niti is now a Tech Lead.",
    "I've updated Niti's title.",
    "Niti's title has been changed to Tech Lead.",
    "All set!",
  ])("not_claimed_done fails on %j", (text) => {
    expect(runAssertion({ kind: "not_claimed_done" }, input(text)).ok).toBe(false);
  });

  it.each([
    "Here's the change — confirm it on the card.",
    "Nothing has changed yet: press Confirm to apply it.",
    "Once you confirm, Niti's title will be Tech Lead.",
    "Which Niti do you mean?",
    "Removing people from the roster can only be done on the People page.",
    "Removing someone is done on the **People** page; please repeat that request in a new message.",
  ])("not_claimed_done passes on %j", (text) => {
    expect(runAssertion({ kind: "not_claimed_done" }, input(text)).ok).toBe(true);
  });
});

describe("identified_tool", () => {
  // A small lab with look-alikes, built the way `run.eval.ts` builds the
  // `catalog: lab` fixture — from catalogue tools — so aliases apply.
  const lab = buildFixture(
    [
      ["form-4", "Form 4"],
      ["form-2", "Form 2"],
      ["ultimaker-3", "Ultimaker 3"],
      ["ultimaker-3-extended", "Ultimaker 3 Extended"],
      ["dremel-3000", "Dremel 3000"],
      ["epilog-helix-24", "Epilog Helix 24"],
    ].map(([slug, name]) => ({ ...mockTools[0], id: slug, slug, name, officialName: null }))
  );
  const judge = (text: string, value: string) => runAssertion({ kind: "identified_tool", value }, { text, toolCalls: [], fixture: lab });

  it("passes when the first machine named is the one in the photo, plain or linked", () => {
    expect(judge("That's the **Form 4**, our resin printer. To start it…", "form-4").ok).toBe(true);
    expect(judge("This is the [Epilog Helix 24](/tools/epilog-helix-24).", "epilog-helix-24").ok).toBe(true);
    expect(judge("An Epilog laser — ours is on the laser bay.", "epilog-helix-24").ok).toBe(true);
  });

  it("fails when another machine comes first, or none is named", () => {
    const wrong = judge("This is the Form 2. Unlike the Form 4, it…", "form-4");
    expect(wrong.ok).toBe(false);
    expect(wrong.detail).toMatch(/names form-2 first/);
    expect(judge("That looks like a resin printer.", "form-4").detail).toMatch(/names no catalog machine/);
  });

  it("keeps the longest name: an Ultimaker 3 Extended is not also an Ultimaker 3", () => {
    expect(judge("This is the Ultimaker 3 Extended.", "ultimaker-3").ok).toBe(false);
    expect(judge("This is the Ultimaker 3 Extended.", "ultimaker-3-extended").ok).toBe(true);
  });

  it("does not let a maker's name shared by two machines count as either", () => {
    // "Formlabs" is a Form 4 alias, but the Form 2 is a Formlabs printer too.
    expect(judge("A Formlabs printer — this is the Form 2.", "form-2").ok).toBe(true);
  });

  it("with |ask, also accepts a question that names it among the candidates", () => {
    expect(judge("Is this the Ultimaker 3 or the Ultimaker 3 Extended?", "ultimaker-3-extended|ask").ok).toBe(true);
    expect(judge("This is the Ultimaker 3 Extended.", "ultimaker-3-extended|ask").ok).toBe(true);
    const confidentWrong = judge("This is the Ultimaker 3. You can book it for this afternoon.", "ultimaker-3-extended|ask");
    expect(confidentWrong.ok).toBe(false);
    expect(confidentWrong.detail).toMatch(/without asking or saying it cannot tell/);
    // A question that leaves the right machine out is no better.
    expect(judge("Is this the Ultimaker 3?", "ultimaker-3-extended|ask").ok).toBe(false);
  });

  it("with |ask, also accepts saying it cannot tell, naming the candidates", () => {
    const hedged = "It looks like an Ultimaker, but I can’t tell which model. The lab has the Ultimaker 3 and the Ultimaker 3 Extended; check the label.";
    expect(judge(hedged, "ultimaker-3-extended|ask").ok).toBe(true);
    // Hedging about availability is not hedging about which machine it is.
    expect(judge("This is the Ultimaker 3. I can’t confirm it will be free this afternoon; the Ultimaker 3 Extended may be.", "ultimaker-3-extended|ask").ok).toBe(false);
  });

  it("counts a machine class the lab has as that machine, not an unknown one", () => {
    const withShopBot = buildFixture([{ ...mockTools[0], id: "shopbot-buddy-bt48", slug: "shopbot-buddy-bt48", name: "ShopBot Buddy BT48", officialName: null }]);
    expect(noUnknownTools("That looks like the ShopBot Buddy BT48, the CNC router.", withShopBot).ok).toBe(true);
    expect(noUnknownTools("You can use the CNC router in the wood shop.", evalFixture).ok).toBe(false);
  });

  it("none: passes when the lab's lack is said and a catalog machine is only an alternative", () => {
    expect(
      judge("That looks like a benchtop belt and disc sander. The lab doesn't have one; for small sanding jobs the Dremel 3000 could help.", "none").ok
    ).toBe(true);
    expect(judge("This is a belt sander, which isn't in our catalog. The closest thing is the Dremel 3000.", "none").ok).toBe(true);
  });

  it("none: fails when the photo is claimed to be a catalog machine, or the lack is never said", () => {
    const claimed = judge("This is the Dremel 3000, on the Hand Tool Wall.", "none");
    expect(claimed.ok).toBe(false);
    expect(claimed.detail).toMatch(/shows dremel-3000/);
    expect(judge("It looks like a belt sander. Belt sanders need eye protection.", "none").detail).toMatch(/never says the lab does not have it/);
  });

  it("fails loudly on a slug the run's catalogue does not have", () => {
    expect(judge("This is the Form 4.", "bambu-lab-x1-carbon").detail).toMatch(/not a catalog machine in this run/);
  });
});
