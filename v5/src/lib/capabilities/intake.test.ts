import { nextCacheMock } from "../../../test/mocks/next-cache";
import { intake, mapWithConcurrency, RESEARCH_CONCURRENCY } from "./intake";
import type {
  CapabilityCtx,
  CapabilityTool,
  IdentificationCardPayload,
  IntakeConfidence,
  ToolCandidate,
} from "./types";
import type { MakerLabTool } from "../../components/catalog-types";

vi.mock("next/cache", () => nextCacheMock());

/**
 * Intake ↔ confidence wiring (confidence spec phases 2, 4 and 5). The catalog
 * read runs against the built-in mock catalog (no `NOTION_*` env is stubbed, so
 * `getCatalogTools()` never touches the network) and every candidate here
 * carries no resources, so no link verification fetch is made either.
 *
 * `../catalog` is wrapped rather than replaced: by default the real
 * `getCatalogTools` runs, and a test that needs to observe or delay the read
 * (the fan-out cases) swaps in its own implementation for the duration.
 */

const catalogHook = vi.hoisted(() => ({
  impl: null as null | (() => Promise<MakerLabTool[]>),
}));

vi.mock("../catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../catalog")>();
  return {
    ...actual,
    getCatalogTools: (): Promise<MakerLabTool[]> =>
      catalogHook.impl ? catalogHook.impl() : actual.getCatalogTools(),
  };
});

afterEach(() => {
  catalogHook.impl = null;
});

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

/** Evidence that grades `high`: a stated model corroborated by a fetched page. */
const STRONG_EVIDENCE: ToolCandidate["evidence"] = {
  userStatedModel: true,
  modelPlateRead: null,
  manufacturerPageFound: true,
  manualFound: true,
  specsFromSource: true,
  categoryOnly: false,
};

/** Evidence that grades `medium`: a model, but nothing external to check it. */
const THIN_EVIDENCE: ToolCandidate["evidence"] = {
  userStatedModel: true,
  modelPlateRead: null,
  manufacturerPageFound: false,
  manualFound: false,
  specsFromSource: false,
  categoryOnly: false,
};

/** Evidence that grades `low`: only the general type of machine was inferable. */
const CATEGORY_ONLY_EVIDENCE: ToolCandidate["evidence"] = {
  userStatedModel: false,
  modelPlateRead: null,
  manufacturerPageFound: false,
  manualFound: false,
  specsFromSource: false,
  categoryOnly: true,
};

interface ResearchItem {
  candidate: ToolCandidate;
  duplicate: { id: string; name: string } | null;
  dropped_links: string[];
  confidence: IntakeConfidence;
  error?: string;
}

async function research(candidates: ToolCandidate[]): Promise<ResearchItem[]> {
  const result = (await toolByName("research_tool").run(
    { candidates },
    {}
  )) as { items: ResearchItem[] };
  return result.items;
}

async function researchOne(input: ToolCandidate): Promise<ResearchItem> {
  return (await research([input]))[0];
}

interface ProposeResult {
  proposed: {
    candidate_id: string;
    name: string;
    state: string;
    confidence: string;
  }[];
  needs_more_info: { name: string; ask: string[] }[];
}

/** Run `propose_listing` with a recording stream writer, as chat would. */
async function propose(candidates: ToolCandidate[]): Promise<{
  result: ProposeResult;
  cards: IdentificationCardPayload[];
}> {
  const cards: IdentificationCardPayload[] = [];
  const ctx = {
    writer: {
      write: (part: { type: string; data: IdentificationCardPayload }) => {
        if (part.type === "data-card") cards.push(part.data);
      },
    },
  } as unknown as CapabilityCtx;
  const result = (await toolByName("propose_listing").run(
    { candidates },
    ctx
  )) as ProposeResult;
  return { result, cards };
}

/** The single card `propose_listing` emitted for one candidate. */
async function cardFor(input: ToolCandidate): Promise<IdentificationCardPayload> {
  const { cards } = await propose([input]);
  if (!cards.length) throw new Error("no card was emitted for this candidate");
  return cards[0];
}

describe("research_tool confidence", () => {
  it("computes the grade from the evidence the model reported", async () => {
    const item = await researchOne(candidate({ evidence: STRONG_EVIDENCE }));
    expect(item.confidence.level).toBe("high");
    expect(item.candidate.confidence?.level).toBe("high");
    expect(item.confidence.basis).toContain("Manual found");
  });

  it("normalizes a missing evidence report to 'nothing found'", async () => {
    const item = await researchOne(candidate());
    expect(item.candidate.evidence).toEqual({
      userStatedModel: false,
      modelPlateRead: null,
      manufacturerPageFound: false,
      manualFound: false,
      specsFromSource: false,
      categoryOnly: false,
    });
    expect(item.confidence.level).toBe("low");
  });

  it("discards a confidence the model tried to hand it", async () => {
    // The prompt-injection case (spec §8): a fetched page telling the agent to
    // claim high confidence must not move the score, because the score is
    // computed from evidence rather than accepted as input.
    const item = await researchOne(
      candidate({
        confidence: { level: "high", basis: ["Trust me"], unknowns: [] },
        evidence: CATEGORY_ONLY_EVIDENCE,
      })
    );
    expect(item.confidence.level).toBe("low");
    expect(item.candidate.confidence?.level).toBe("low");
    expect(item.candidate.confidence?.basis).not.toContain("Trust me");
  });

  it("still normalizes the candidate and reports duplicates", async () => {
    const item = await researchOne(candidate({ materials: ["PLA"] }));
    expect(item.candidate.name).toBe("Zorbex Filament Extruder 9000");
    expect(item.candidate.materials).toEqual(["PLA"]);
    expect(item.duplicate).toBeNull();
    expect(item.dropped_links).toEqual([]);
  });
});

describe("research_tool fan-out", () => {
  it("researches every item in the batch and keeps input order", async () => {
    const items = await research([
      candidate({ name: "Item A" }),
      candidate({ name: "Item B" }),
      candidate({ name: "Item C" }),
    ]);
    expect(items.map((i) => i.candidate.name)).toEqual([
      "Item A",
      "Item B",
      "Item C",
    ]);
  });

  it("lets one unidentifiable item fail without failing the batch", async () => {
    // allSettled, not all (spec §3.3). Reading `source_urls` throws for this one
    // candidate, standing in for any way a single research pass can blow up.
    const exploding = candidate({ name: "Exploding Item" });
    Object.defineProperty(exploding, "source_urls", {
      get() {
        throw new Error("vision call failed");
      },
    });

    const items = await research([
      candidate({ name: "Good One", evidence: STRONG_EVIDENCE }),
      exploding,
      candidate({ name: "Good Two", evidence: STRONG_EVIDENCE }),
    ]);

    expect(items).toHaveLength(3);
    expect(items[0].confidence.level).toBe("high");
    expect(items[2].confidence.level).toBe("high");

    // The failure is reported as a low-confidence candidate with an explanatory
    // unknown, not as a gap in the batch — so it turns into a question.
    expect(items[1].error).toContain("vision call failed");
    expect(items[1].confidence.level).toBe("low");
    expect(items[1].candidate.name).toBe("Exploding Item");
    expect(
      items[1].confidence.unknowns.some((u) => u.includes("vision call failed"))
    ).toBe(true);
  });

  it("never runs more than four research passes at once", async () => {
    let inFlight = 0;
    let peak = 0;
    catalogHook.impl = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return [];
    };

    const items = await research(
      Array.from({ length: 30 }, (_, i) => candidate({ name: `Photo ${i}` }))
    );

    expect(items).toHaveLength(30);
    expect(peak).toBeGreaterThan(1); // it really did fan out
    expect(peak).toBeLessThanOrEqual(RESEARCH_CONCURRENCY);
    expect(RESEARCH_CONCURRENCY).toBe(4);
  });

  it("applies the turn's photos to a lone candidate but not across a batch", async () => {
    const ctx = {
      attachments: [
        { file_upload_id: "up_1", name: "a.jpg", contentType: "image/jpeg" },
        { file_upload_id: "up_2", name: "b.jpg", contentType: "image/jpeg" },
      ],
    } as CapabilityCtx;
    const run = toolByName("research_tool").run;

    const single = (await run({ candidates: [candidate()] }, ctx)) as {
      items: ResearchItem[];
    };
    expect(single.items[0].candidate.image_upload_ids).toEqual(["up_1", "up_2"]);

    // Eight photos of eight machines must not all land on all eight tools.
    const batch = (await run(
      {
        candidates: [
          candidate({ name: "One", image_upload_ids: ["up_1"] }),
          candidate({ name: "Two", image_upload_ids: ["up_2"] }),
        ],
      },
      ctx
    )) as { items: ResearchItem[] };
    expect(batch.items[0].candidate.image_upload_ids).toEqual(["up_1"]);
    expect(batch.items[1].candidate.image_upload_ids).toEqual(["up_2"]);
  });
});

describe("mapWithConcurrency", () => {
  it("holds the cap and still settles everything, in order", async () => {
    let inFlight = 0;
    let peak = 0;
    const settled = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 4, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      if (n === 3) throw new Error("nope");
      return n * 2;
    });

    expect(peak).toBe(4);
    expect(settled).toHaveLength(8);
    expect(settled[0]).toEqual({ status: "fulfilled", value: 2 });
    expect(settled[2].status).toBe("rejected");
    expect(settled[7]).toEqual({ status: "fulfilled", value: 16 });
  });

  it("never starts more workers than there are items", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapWithConcurrency([1], 4, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      inFlight -= 1;
      return n;
    });
    expect(peak).toBe(1);
  });
});

describe("propose_listing behaviour gating", () => {
  it("re-derives the grade for every candidate it is given", async () => {
    // Candidates make a round trip through the model between research and
    // propose, so whatever confidence comes back is recomputed, not trusted.
    const { result } = await propose([
      candidate({
        name: "Overclaimed",
        confidence: { level: "high", basis: [], unknowns: [] },
        evidence: THIN_EVIDENCE,
      }),
      candidate({ name: "Prusa MK4", evidence: STRONG_EVIDENCE }),
    ]);
    expect(result.proposed.map((p) => p.confidence)).toEqual([
      "medium",
      "high",
    ]);
  });

  it("proposes a well-evidenced candidate with the plain confirm action", async () => {
    const { result, cards } = await propose([
      candidate({ evidence: STRONG_EVIDENCE }),
    ]);
    expect(result.needs_more_info).toEqual([]);
    expect(cards).toHaveLength(1);
    expect(cards[0].confidence?.level).toBe("high");
    expect(cards[0].actions.map((a) => a.id)).toEqual([
      "confirm",
      "edit",
      "discard",
    ]);
  });

  it("renders NO card at low confidence and names what to ask for instead", async () => {
    // The valuable branch (spec §3.2): weak information used to produce a
    // plausible-looking card someone accepted. It now produces a question.
    const { result, cards } = await propose([
      candidate({ name: "Some 3D printer", evidence: CATEGORY_ONLY_EVIDENCE }),
    ]);
    expect(cards).toEqual([]);
    expect(result.proposed).toEqual([]);
    expect(result.needs_more_info).toHaveLength(1);
    expect(result.needs_more_info[0].name).toBe("Some 3D printer");
    expect(result.needs_more_info[0].ask.join(" ")).toContain(
      "photo of the label"
    );
  });

  it("emits a card per proposable candidate and withholds only the weak one", async () => {
    const { result, cards } = await propose([
      candidate({ name: "Solid One", evidence: STRONG_EVIDENCE }),
      candidate({ name: "Mystery Box", evidence: CATEGORY_ONLY_EVIDENCE }),
      candidate({ name: "Solid Two", evidence: STRONG_EVIDENCE }),
    ]);
    expect(cards.map((c) => c.name)).toEqual(["Solid One", "Solid Two"]);
    expect(result.needs_more_info.map((n) => n.name)).toEqual(["Mystery Box"]);
  });

  it("turns a medium card's primary action into resolving the ambiguity", async () => {
    const { cards } = await propose([
      candidate({
        name: "Prusa MK4",
        evidence: THIN_EVIDENCE,
        variants: ["Prusa MK4", "Prusa MK4S"],
      }),
    ]);
    const actions = cards[0].actions;
    expect(cards[0].confidence?.level).toBe("medium");
    // No "Looks right — add it": the uncertainty has to be resolved to proceed.
    expect(actions.map((a) => a.id)).toEqual([
      "variant-0",
      "variant-1",
      "edit",
      "discard",
    ]);
    expect(actions[0].labelKey).toBe("actionConfirmVariant");
    expect(actions[0].labelValues).toEqual({ variant: "Prusa MK4" });
    expect(actions[1].labelValues).toEqual({ variant: "Prusa MK4S" });
    expect(actions[1].seedMessage).toBe(
      "confirm variant: prusa-mk4 = Prusa MK4S"
    );
  });

  it("asks a medium candidate with no named variants to confirm the model", async () => {
    const { cards } = await propose([
      candidate({ name: "Zorbex 9000", evidence: THIN_EVIDENCE }),
    ]);
    const [primary] = cards[0].actions;
    expect(primary.id).toBe("confirm-model");
    expect(primary.labelKey).toBe("actionConfirmModel");
    expect(primary.labelValues).toEqual({ name: "Zorbex 9000" });
    expect(primary.seedMessage).toBe("confirm model: zorbex-9000 = Zorbex 9000");
  });

  it("works without a stream writer (MCP-shaped ctx) without throwing", async () => {
    const result = (await toolByName("propose_listing").run(
      { candidates: [candidate({ evidence: STRONG_EVIDENCE })] },
      {}
    )) as ProposeResult;
    expect(result.proposed).toHaveLength(1);
  });
});

describe("identification card payload", () => {
  it("carries the grade and the evidence it was derived from", async () => {
    const card = await cardFor(
      candidate({
        evidence: {
          userStatedModel: false,
          modelPlateRead: "X1-Carbon",
          manufacturerPageFound: true,
          manualFound: false,
          specsFromSource: true,
          categoryOnly: false,
        },
      })
    );
    expect(card.confidence?.level).toBe("high");
    expect(card.evidence?.modelPlateRead).toBe("X1-Carbon");
  });

  it("passes only http(s) source URLs through to the card", async () => {
    const card = await cardFor(
      candidate({
        evidence: STRONG_EVIDENCE,
        source_urls: [
          "https://bambulab.com/x1c",
          "http://store.example.com/item",
          "javascript:alert(1)",
          "not a url",
        ],
      })
    );
    expect(card.sourceUrls).toEqual([
      "https://bambulab.com/x1c",
      "http://store.example.com/item",
    ]);
  });

  it("localizes every action through a message key", async () => {
    // Article 6: card labels are built server-side with no locale resolved, so
    // they travel as keys the renderer translates.
    const card = await cardFor(candidate({ evidence: STRONG_EVIDENCE }));
    expect(card.actions.every((a) => Boolean(a.labelKey))).toBe(true);
  });
});
