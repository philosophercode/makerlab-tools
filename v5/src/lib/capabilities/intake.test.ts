import { nextCacheMock } from "../../../test/mocks/next-cache";
import { intake } from "./intake";
import type {
  CapabilityTool,
  IdentificationCardPayload,
  IntakeConfidence,
  ToolCandidate,
} from "./types";

vi.mock("next/cache", () => nextCacheMock());

/**
 * Intake ↔ confidence wiring (confidence spec phase 2). The catalog read runs
 * against the built-in mock catalog (no `NOTION_*` env is stubbed, so
 * `getCatalogTools()` never touches the network) and every candidate here
 * carries no resources, so no link verification fetch is made either.
 */

function toolByName(name: string): CapabilityTool<unknown, unknown> {
  const found = intake.tools.find((t) => t.name === name);
  if (!found) throw new Error(`no intake tool named ${name}`);
  return found;
}

/** A candidate that matches nothing in the mock catalog. */
function candidate(over: Partial<ToolCandidate> = {}): ToolCandidate {
  return {
    name: "Zorbex Filament Extruder 9000",
    description: "A desktop filament extruder.",
    materials: [],
    ppe_required: [],
    tags: [],
    units: [],
    resources: [],
    image_upload_ids: [],
    source_urls: [],
    ...over,
  };
}

interface ResearchResult {
  candidate: ToolCandidate;
  duplicate: { id: string; name: string } | null;
  dropped_links: string[];
  confidence: IntakeConfidence;
}

async function research(input: ToolCandidate): Promise<ResearchResult> {
  return (await toolByName("research_tool").run(
    { candidate: input },
    {}
  )) as ResearchResult;
}

async function propose(
  candidates: ToolCandidate[]
): Promise<{ candidates: ToolCandidate[] }> {
  return (await toolByName("propose_listing").run({ candidates }, {})) as {
    candidates: ToolCandidate[];
  };
}

function cardFor(candidates: ToolCandidate[]): IdentificationCardPayload {
  const tool = toolByName("propose_listing");
  if (!tool.card) throw new Error("propose_listing has no card renderer");
  return tool.card({ candidates }) as IdentificationCardPayload;
}

describe("research_tool confidence", () => {
  it("computes the grade from the evidence the model reported", async () => {
    const result = await research(
      candidate({
        evidence: {
          userStatedModel: true,
          modelPlateRead: null,
          manufacturerPageFound: true,
          manualFound: true,
          specsFromSource: true,
          categoryOnly: false,
        },
      })
    );
    expect(result.confidence.level).toBe("high");
    expect(result.candidate.confidence?.level).toBe("high");
    expect(result.confidence.basis).toContain("Manual found");
  });

  it("normalizes a missing evidence report to 'nothing found'", async () => {
    const result = await research(candidate());
    expect(result.candidate.evidence).toEqual({
      userStatedModel: false,
      modelPlateRead: null,
      manufacturerPageFound: false,
      manualFound: false,
      specsFromSource: false,
      categoryOnly: false,
    });
    expect(result.confidence.level).toBe("low");
  });

  it("discards a confidence the model tried to hand it", async () => {
    // The prompt-injection case (spec §8): a fetched page telling the agent to
    // claim high confidence must not move the score, because the score is
    // computed from evidence rather than accepted as input.
    const result = await research(
      candidate({
        confidence: {
          level: "high",
          basis: ["Trust me"],
          unknowns: [],
        },
        evidence: {
          userStatedModel: false,
          modelPlateRead: null,
          manufacturerPageFound: false,
          manualFound: false,
          specsFromSource: false,
          categoryOnly: true,
        },
      })
    );
    expect(result.confidence.level).toBe("low");
    expect(result.candidate.confidence?.level).toBe("low");
    expect(result.candidate.confidence?.basis).not.toContain("Trust me");
  });

  it("still normalizes the candidate and reports duplicates", async () => {
    const result = await research(candidate({ materials: ["PLA"] }));
    expect(result.candidate.name).toBe("Zorbex Filament Extruder 9000");
    expect(result.candidate.materials).toEqual(["PLA"]);
    expect(result.duplicate).toBeNull();
    expect(result.dropped_links).toEqual([]);
  });
});

describe("propose_listing confidence", () => {
  it("re-derives the grade for every candidate it is given", async () => {
    // Candidates make a round trip through the model between research and
    // propose, so whatever confidence comes back is recomputed, not trusted.
    const { candidates } = await propose([
      candidate({
        confidence: { level: "high", basis: [], unknowns: [] },
        evidence: {
          userStatedModel: false,
          modelPlateRead: null,
          manufacturerPageFound: false,
          manualFound: false,
          specsFromSource: false,
          categoryOnly: false,
        },
      }),
      candidate({
        name: "Prusa MK4",
        evidence: {
          userStatedModel: true,
          modelPlateRead: null,
          manufacturerPageFound: true,
          manualFound: true,
          specsFromSource: true,
          categoryOnly: false,
        },
      }),
    ]);
    expect(candidates[0].confidence?.level).toBe("low");
    expect(candidates[1].confidence?.level).toBe("high");
  });
});

describe("identification card payload", () => {
  it("carries the grade and the evidence it was derived from", () => {
    const card = cardFor([
      candidate({
        evidence: {
          userStatedModel: false,
          modelPlateRead: "X1-Carbon",
          manufacturerPageFound: true,
          manualFound: false,
          specsFromSource: true,
          categoryOnly: false,
        },
      }),
    ]);
    expect(card.confidence?.level).toBe("high");
    expect(card.evidence?.modelPlateRead).toBe("X1-Carbon");
  });

  it("passes only http(s) source URLs through to the card", () => {
    const card = cardFor([
      candidate({
        source_urls: [
          "https://bambulab.com/x1c",
          "http://store.example.com/item",
          "javascript:alert(1)",
          "not a url",
        ],
      }),
    ]);
    expect(card.sourceUrls).toEqual([
      "https://bambulab.com/x1c",
      "http://store.example.com/item",
    ]);
  });

  it("grades a card built from a candidate with no evidence as low", () => {
    const card = cardFor([candidate()]);
    expect(card.confidence?.level).toBe("low");
    expect(card.confidence?.unknowns.length).toBeGreaterThan(0);
    // Phase 2/3 only: the card is still rendered. Suppressing it at low
    // confidence is the phase-4 behaviour change.
    expect(card.state).toBe("proposed");
  });
});
