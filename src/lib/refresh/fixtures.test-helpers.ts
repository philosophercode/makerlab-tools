import type { ResearchResult } from "../research/result";
import type { ProposeTool } from "./propose";

/**
 * Fixtures shaped like the Aug 29 Catalog Reconciliation's findings (refresh
 * research spec §10), shared by the refresh tests. Not a test file itself.
 */

export function researchFixture(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "WEN DC3401",
    description: "A 3-speed air filtration system that removes fine dust from the air of a workshop.",
    specs: [{ label: "Filtration", value: "5 micron (outer), 1 micron (inner)" }],
    materials: [],
    ppeRequired: [],
    tags: ["Dust collection"],
    trainingRequired: false,
    useRestrictions: "Rated for 5-micron filtration; not a substitute for a respirator.",
    category: { name: "Dust Collection", group: "Workshop", existingId: null },
    resources: [{ title: "DC3401 manual", url: "https://wenproducts.com/manuals/DC3401.pdf", type: "Manual" }],
    droppedLinks: [],
    sourceUrls: ["https://wenproducts.com/products/dc3401"],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: true,
      manualFound: true,
      specsFromSource: true,
      categoryOnly: false,
    },
    confidence: { level: "high", basis: [], unknowns: [] },
    emergencyStop: null,
    citations: {
      use_restrictions: [
        { quote: "Filters particles down to 5 microns", url: "https://wenproducts.com/products/dc3401", verified: true },
      ],
      name: [{ quote: "WEN DC3401 3-Speed Air Filtration System", url: "https://wenproducts.com/products/dc3401", verified: true }],
      description: [{ quote: "removes fine dust", url: "https://wenproducts.com/products/dc3401", verified: true }],
      tags: [{ quote: "dust collection", url: "https://wenproducts.com/products/dc3401", verified: true }],
    },
    ...overrides,
  };
}

export function toolFixture(overrides: Partial<ProposeTool> = {}): ProposeTool {
  return {
    name: "WEN DC3401",
    description:
      "A three-speed air filtration system for the wood shop. It hangs from the ceiling and pulls fine dust out of the air while people cut and sand.",
    materials: [],
    tags: ["Dust collection"],
    trainingRequired: false,
    useRestrictions: "Rated for 1-micron filtration.",
    emergencyStop: null,
    floorCheck: null,
    resourceUrls: ["https://wenproducts.com/manuals/DC3401.pdf"],
    hasCover: true,
    ...overrides,
  };
}
