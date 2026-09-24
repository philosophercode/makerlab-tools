import { FLOOR_CHECK_TEXT, isIdentified, normalizeLabel, proposeChanges, resourceKey } from "./propose";
import { researchFixture, toolFixture } from "./fixtures.test-helpers";
import type { FieldProposal } from "./types";

/**
 * The diff, in code (refresh research spec §3.2, §10): fixtures shaped like
 * the Aug 29 reconciliation's findings.
 */

function byField(proposals: FieldProposal[], field: FieldProposal["field"]): FieldProposal | undefined {
  return proposals.find((p) => p.field === field);
}

describe("proposeChanges", () => {
  it("WEN DC3401: 1 micron on the record, 5 on the page → a safety differs, listed first", () => {
    const proposals = proposeChanges({ tool: toolFixture(), research: researchFixture(), includeDescription: false });
    const restriction = byField(proposals, "use_restrictions");
    expect(restriction).toMatchObject({
      kind: "differs",
      safety: true,
      current: "Rated for 1-micron filtration.",
      proposed: "Rated for 5-micron filtration; not a substitute for a respirator.",
      decision: "pending",
    });
    expect(restriction?.citations[0]).toMatchObject({ verified: true });
    expect(proposals[0].field).toBe("use_restrictions");
  });

  it("RYOBI PCL235: a drill that is an impact driver → a name differs, with its quote", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ name: "RYOBI PCL235 drill" }),
      research: researchFixture({
        canonicalName: "RYOBI ONE+ 18V Impact Driver PCL235",
        citations: {
          name: [{ quote: "18V ONE+ Impact Driver (PCL235)", url: "https://ryobitools.com/pcl235", verified: true }],
        },
      }),
      includeDescription: false,
    });
    expect(byField(proposals, "name")).toMatchObject({
      kind: "differs",
      current: "RYOBI PCL235 drill",
      proposed: "RYOBI ONE+ 18V Impact Driver PCL235",
    });
  });

  it("does not propose a name whose quote was not found on the page", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ name: "RYOBI PCL235 drill" }),
      research: researchFixture({
        canonicalName: "RYOBI Impact Driver PCL235",
        citations: { name: [{ quote: "invented", url: "https://ryobitools.com/pcl235", verified: false }] },
      }),
      includeDescription: false,
    });
    expect(byField(proposals, "name")).toBeUndefined();
  });

  it("ignores case, punctuation and spacing in a name", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ name: "wen   dc-3401" }),
      research: researchFixture({ canonicalName: "WEN DC 3401" }),
      includeDescription: false,
    });
    expect(byField(proposals, "name")).toBeUndefined();
  });

  it("Form 2: a short description saying 25 microns is replaced by the page's 140 µm", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ description: "SLA printer, 25 micron XY." }),
      research: researchFixture({ description: "The Form 2 is an SLA printer with a 140 µm laser spot size." }),
      includeDescription: false,
    });
    expect(byField(proposals, "description")).toMatchObject({ kind: "differs", proposed: expect.stringContaining("140 µm") });
  });

  it("proposes a long description only when the admin asked for descriptions", () => {
    const research = researchFixture({ description: "Something rather different, and long enough to count as a description of the machine." });
    expect(byField(proposeChanges({ tool: toolFixture(), research, includeDescription: false }), "description")).toBeUndefined();
    expect(byField(proposeChanges({ tool: toolFixture(), research, includeDescription: true }), "description")).toMatchObject({
      kind: "differs",
    });
  });

  it("proposes a description as new when the record has none", () => {
    const proposals = proposeChanges({ tool: toolFixture({ description: null }), research: researchFixture(), includeDescription: false });
    expect(byField(proposals, "description")).toMatchObject({ kind: "new", current: null });
  });

  it("never proposes PPE, whatever the model returned", () => {
    const proposals = proposeChanges({
      tool: toolFixture(),
      research: researchFixture({ ppeRequired: ["Safety glasses", "N95 respirator"] }),
      includeDescription: true,
    });
    expect(proposals.map((p) => p.field)).not.toContain("ppe_required");
    expect(JSON.stringify(proposals)).not.toMatch(/respirator.*N95|N95/);
  });

  it("drops values that match the record", () => {
    const tool = toolFixture({ useRestrictions: "Rated for 5-micron filtration; not a substitute for a respirator." });
    const proposals = proposeChanges({ tool, research: researchFixture(), includeDescription: false });
    expect(byField(proposals, "use_restrictions")).toBeUndefined();
    expect(byField(proposals, "tags")).toBeUndefined();
    expect(byField(proposals, "training_required")).toBeUndefined();
  });

  it("records a field research left empty as unverified — not as a match", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ emergencyStop: "Red button on the front panel." }),
      research: researchFixture({ emergencyStop: null, trainingRequired: null, materials: [] }),
      includeDescription: false,
    });
    expect(byField(proposals, "emergency_stop")).toMatchObject({ kind: "unverified", current: "Red button on the front panel." });
    expect(byField(proposals, "emergency_stop")?.proposed).toBeUndefined();
    expect(byField(proposals, "training_required")).toMatchObject({ kind: "unverified", safety: true });
    expect(byField(proposals, "materials")).toMatchObject({ kind: "unverified" });
  });

  it("compares materials and tags as sets and proposes only additions", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ materials: ["pla", "PETG"], tags: [] }),
      research: researchFixture({ materials: ["PLA", "PETG", "TPU"], tags: ["FDM", "Enclosed"] }),
      includeDescription: false,
    });
    expect(byField(proposals, "materials")).toMatchObject({
      kind: "differs",
      current: ["pla", "PETG"],
      proposed: ["pla", "PETG", "TPU"],
      added: ["TPU"],
    });
    expect(byField(proposals, "tags")).toMatchObject({ kind: "new", proposed: ["FDM", "Enclosed"], added: ["FDM", "Enclosed"] });
  });

  it("does not propose a list that research found a subset of", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ materials: ["PLA", "PETG", "ABS"] }),
      research: researchFixture({ materials: ["PLA"] }),
      includeDescription: false,
    });
    expect(byField(proposals, "materials")).toBeUndefined();
  });

  it("proposes a training change as a safety differs", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ trainingRequired: false }),
      research: researchFixture({ trainingRequired: true }),
      includeDescription: false,
    });
    expect(byField(proposals, "training_required")).toMatchObject({ kind: "differs", safety: true, current: false, proposed: true });
  });

  it("proposes only resources the tool lacks, after size-variant and locale normalization", () => {
    const proposals = proposeChanges({
      tool: toolFixture({ resourceUrls: ["https://www.wenproducts.com/en/manuals/DC3401.pdf/"] }),
      research: researchFixture({
        resources: [
          { title: "Manual", url: "https://wenproducts.com/manuals/DC3401.pdf?width=640", type: "Manual" },
          { title: "Setup video", url: "https://youtube.com/watch?v=abc", type: "Video" },
        ],
      }),
      includeDescription: false,
    });
    const resources = proposals.filter((p) => p.field === "resource");
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({ id: "resource:https://youtube.com/watch?v=abc", kind: "new", citations: [] });
  });

  it("proposes a cover photo only when the tool has none", () => {
    const images = {
      candidates: [
        {
          url: "https://wenproducts.com/img/dc3401.jpg",
          pageUrl: "https://wenproducts.com/products/dc3401",
          source: "og" as const,
          width: 1200,
          height: 900,
          contentType: "image/jpeg" as const,
          rank: 1 as const,
          reason: "Front view",
        },
      ],
      cleaned: null,
    };
    expect(byField(proposeChanges({ tool: toolFixture(), research: researchFixture({ images }), includeDescription: false }), "cover_photo")).toBeUndefined();
    expect(
      byField(proposeChanges({ tool: toolFixture({ hasCover: false }), research: researchFixture({ images }), includeDescription: false }), "cover_photo")
    ).toMatchObject({ kind: "new", proposed: { url: "https://wenproducts.com/img/dc3401.jpg", width: 1200 } });
  });

  it("an unidentifiable tool gets a floor check and nothing else", () => {
    const research = researchFixture({ sourceUrls: [], description: "", resources: [] });
    expect(isIdentified(research)).toBe(false);
    const proposals = proposeChanges({ tool: toolFixture({ name: "Old grey sander" }), research, includeDescription: true });
    expect(proposals).toEqual([
      expect.objectContaining({ field: "floor_check", kind: "new", proposed: FLOOR_CHECK_TEXT, current: null }),
    ]);
  });

  it("an identified-by-type-only tool gets a floor check too, and none when one is already owed", () => {
    const research = researchFixture({ evidence: { ...researchFixture().evidence, categoryOnly: true } });
    expect(proposeChanges({ tool: toolFixture(), research, includeDescription: false })).toHaveLength(1);
    expect(proposeChanges({ tool: toolFixture({ floorCheck: FLOOR_CHECK_TEXT }), research, includeDescription: false })).toEqual([]);
  });
});

describe("helpers", () => {
  it("normalizeLabel folds case and separators", () => {
    expect(normalizeLabel("Wood.")).toBe("wood");
    expect(normalizeLabel("Dust-collection")).toBe(normalizeLabel("dust collection"));
  });

  it("resourceKey drops www, trailing slash, size parameters and a locale segment", () => {
    expect(resourceKey("https://www.example.com/en-us/manual.pdf/?w=100")).toBe(resourceKey("http://example.com/manual.pdf"));
    expect(resourceKey("not a url")).toBeNull();
  });
});
