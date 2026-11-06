import { describe, expect, it } from "vitest";
import type { LocationOption } from "../data/taxonomy";
import type { ResearchResult } from "../research/result";
import { DISPLAY_NAME_MAX } from "../tool-names";
import { initialDraft, initialImageChoice, matchLocation } from "./approval-draft";

/**
 * Invariants of the adding-equipment loop's last step, the approval page's
 * starting draft: true for any research result, not just the examples.
 */

const ZONES: LocationOption[] = [
  { id: "common", room: "Studio 101", zone: "Common Purpose Space", mapTag: null },
  { id: "3dp", room: "Studio 101", zone: "3D Printing Hub", mapTag: null },
  { id: "machining", room: "Studio 101A", zone: "Machining Shop", mapTag: null },
  { id: "laser", room: "Studio 101C", zone: "Laser Machine Room", mapTag: null },
  { id: "electronics", room: "Studio 101D", zone: "Electronics Lab", mapTag: null },
];

function research(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Bambu Lab H2D",
    description: "A dual-nozzle 3D printer.",
    specs: [],
    materials: ["PLA"],
    ppeRequired: [],
    tags: ["fdm"],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "3D Printing", group: null, existingId: null },
    resources: [{ title: "Manual", url: "https://example.com/m.pdf", type: "Manual" }],
    droppedLinks: [],
    sourceUrls: [],
    evidence: {} as ResearchResult["evidence"],
    confidence: {} as ResearchResult["confidence"],
    ...overrides,
  };
}

const item = { name: "bambu h2d", locationHint: null, serialNumber: null };

describe("matchLocation", () => {
  it.each([
    ["3D Printing Hub", "3dp"],
    ["studio 101d", "electronics"],
    ["the 3d printing area", "3dp"],
    ["by the other printers", "3dp"],
    ["laser room", "laser"],
    ["machine shop", "machining"],
    ["the shop", "machining"],
    ["electronics bench", "electronics"],
    ["common space", "common"],
  ])("places %j in %s", (hint, id) => {
    expect(matchLocation(hint, ZONES)).toBe(id);
  });

  it.each([null, "", "the lab", "room 3", "somewhere"])("leaves %j unplaced rather than guess", (hint) => {
    expect(matchLocation(hint, ZONES)).toBe("");
  });

  it("never picks between two zones the hint fits equally", () => {
    const twoShops = [...ZONES, { id: "wood", room: "Studio 102", zone: "Wood Shop", mapTag: null }];
    expect(matchLocation("the shop", twoShops)).toBe("");
    expect(matchLocation("wood shop", twoShops)).toBe("wood");
  });
});

describe("initialDraft invariants", () => {
  const names = ["Bambu Lab H2D", "Formlabs Form 4 SLA 3D Printer Complete Package with Wash and Cure Bundle (PKG-F4-WC)", "x".repeat(200)];

  it.each(names)("keeps the display name within %#'s limit", (canonicalName) => {
    const draft = initialDraft(item, research({ canonicalName, displayName: undefined }), [], ZONES);
    expect(draft.name.length).toBeGreaterThan(0);
    expect(draft.name.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX);
  });

  it("always starts training at 'staff to confirm', whatever research said", () => {
    for (const trainingRequired of [true, false, null]) {
      expect(initialDraft(item, research({ trainingRequired }), [], ZONES).trainingRequired).toBeNull();
    }
  });

  it("starts with only links research verified, every one ticked", () => {
    const result = research();
    expect(initialDraft(item, result, [], ZONES).resourceUrls).toEqual(result.resources.map((resource) => resource.url));
  });

  it("never places an item in a zone that does not exist", () => {
    const draft = initialDraft({ ...item, locationHint: "the laser room" }, research(), [], ZONES);
    expect(ZONES.map((zone) => zone.id)).toContain(draft.locationId);
  });
});

describe("initialImageChoice invariants", () => {
  const candidate = { url: "https://bambulab.com/a.png", pageUrl: null, source: "og", width: 800, height: 800, contentType: "image/png", rank: 1, reason: "r" } as const;
  const upload = [{ attachmentId: "photo-1" }];

  it("prefers the cleaned copy, then rank 1, then an uploaded photo, then none", () => {
    expect(initialImageChoice({ candidates: [candidate], cleaned: { attachmentId: "c", fromUrl: candidate.url } }, upload).choice).toBe("cleaned");
    expect(initialImageChoice({ candidates: [candidate], cleaned: null }, upload)).toEqual({ choice: "original", candidateUrl: candidate.url });
    expect(initialImageChoice({ candidates: [], cleaned: null }, upload).choice).toBe("upload");
    expect(initialImageChoice(null, []).choice).toBe("none");
  });
});
