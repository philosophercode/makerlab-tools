import { acceptAllVerifiedIds, allDecided, markDecided, patchFor, proposedResource, rebaseAfterConflict, rejectAllIds } from "./decide";
import { countByKind, isAcceptable, parseProposals, refreshRank, type FieldProposal } from "./types";

/** Deciding proposals, the pure half (refresh research spec §3.3, §5.2). */

function p(overrides: Partial<FieldProposal> & Pick<FieldProposal, "field">): FieldProposal {
  return {
    id: overrides.field,
    kind: "differs",
    safety: false,
    current: null,
    proposed: null,
    citations: [{ quote: "a quote on the page", url: "https://a.example/", verified: true }],
    decision: "pending",
    ...overrides,
  };
}

const RECORD = {
  name: "Form 2",
  description: "SLA printer.",
  materials: ["Resin"],
  tags: ["SLA"],
  trainingRequired: true,
  useRestrictions: null,
  emergencyStop: null,
  floorCheck: null,
};

describe("patchFor", () => {
  it("turns accepted field proposals into one editor patch, ignoring links and the cover", () => {
    expect(
      patchFor([
        p({ field: "name", proposed: "Formlabs Form 2" }),
        p({ field: "materials", proposed: ["Resin", "Tough resin"] }),
        p({ field: "training_required", proposed: false }),
        p({ field: "use_restrictions", proposed: "Trained users only." }),
        p({ field: "emergency_stop", proposed: "Power switch at the back." }),
        p({ field: "floor_check", proposed: "Read the nameplate." }),
        p({ field: "resource", proposed: { title: "Manual", url: "https://a.example/m.pdf", type: "Manual" } }),
        p({ field: "cover_photo", proposed: { url: "https://a.example/i.jpg" } }),
      ])
    ).toEqual({
      name: "Formlabs Form 2",
      materials: ["Resin", "Tough resin"],
      trainingRequired: false,
      useRestrictions: "Trained users only.",
      emergencyStop: "Power switch at the back.",
      floorCheck: "Read the nameplate.",
    });
  });

  it("never writes PPE: there is no field for it", () => {
    expect(Object.keys(patchFor([p({ field: "tags", proposed: ["Safety glasses"] })]))).toEqual(["tags"]);
  });
});

describe("rebaseAfterConflict", () => {
  it("marks the cards whose field moved, shows the value now, and keeps the others pending", () => {
    const proposals = [
      p({ field: "name", current: "Form 2", proposed: "Formlabs Form 2" }),
      p({ field: "description", current: "SLA printer.", proposed: "Longer." }),
      p({ field: "materials", kind: "differs", current: ["Resin"], proposed: ["Resin", "Tough"], added: ["Tough"] }),
    ];
    const next = rebaseAfterConflict(proposals, { ...RECORD, description: "Edited this afternoon.", materials: ["Resin", "Tough"] });
    expect(next[0]).toMatchObject({ decision: "pending", current: "Form 2" });
    expect(next[1]).toMatchObject({ decision: "conflict", current: "Edited this afternoon." });
    // Everything research would add is already there.
    expect(next[2]).toMatchObject({ decision: "conflict", proposed: ["Resin", "Tough"], added: [] });
  });

  it("leaves decided cards alone", () => {
    const decided = p({ field: "description", current: "SLA printer.", decision: "accepted" });
    expect(rebaseAfterConflict([decided], { ...RECORD, description: "Changed." })[0]).toBe(decided);
  });
});

describe("the accept-all and reject-all sets", () => {
  const proposals = [
    p({ field: "use_restrictions", safety: true }),
    p({ field: "description", citations: [{ quote: "not on the page", url: "https://a.example/", verified: false }] }),
    p({ field: "emergency_stop", kind: "unverified", citations: [] }),
    p({ field: "resource", id: "resource:https://a.example/m.pdf", kind: "new", citations: [] }),
    p({ field: "tags", decision: "rejected" }),
  ];

  it("accept all verified skips unverified quotes, not-found fields and decided cards", () => {
    expect(acceptAllVerifiedIds(proposals)).toEqual(["use_restrictions", "resource:https://a.example/m.pdf"]);
    expect(isAcceptable(proposals[1])).toBe(false);
  });

  it("reject all takes every undecided change", () => {
    expect(rejectAllIds(proposals)).toEqual(["use_restrictions", "description", "resource:https://a.example/m.pdf"]);
  });

  it("allDecided ignores not-found fields", () => {
    const next = markDecided(proposals, new Set(rejectAllIds(proposals)), "rejected");
    expect(allDecided(next)).toBe(true);
    expect(allDecided(proposals)).toBe(false);
  });
});

describe("list order and counts", () => {
  it("ranks safety differs, safety new, differs, new, nothing", () => {
    expect(refreshRank([p({ field: "use_restrictions", safety: true })])).toBe(0);
    expect(refreshRank([p({ field: "use_restrictions", safety: true, kind: "new" })])).toBe(1);
    expect(refreshRank([p({ field: "name" })])).toBe(2);
    expect(refreshRank([p({ field: "tags", kind: "new" })])).toBe(3);
    expect(refreshRank([p({ field: "tags", kind: "unverified" })])).toBe(4);
    expect(refreshRank([p({ field: "use_restrictions", safety: true, decision: "accepted" })])).toBe(4);
  });

  it("counts waiting proposals by kind", () => {
    expect(
      countByKind([
        p({ field: "use_restrictions", safety: true }),
        p({ field: "tags", kind: "new" }),
        p({ field: "materials", kind: "unverified" }),
        p({ field: "name", decision: "rejected" }),
      ])
    ).toEqual({ differs: 1, new: 1, unverified: 1, safety: 1 });
  });
});

describe("storage", () => {
  it("parses a stored list and refuses one that is not proposals", () => {
    expect(parseProposals([p({ field: "name" })])).toHaveLength(1);
    expect(parseProposals([{ field: "ppe_required" }])).toBeNull();
  });

  it("reads a resource proposal, defaulting an unknown type to Other", () => {
    expect(proposedResource(p({ field: "resource", proposed: { title: "Page", url: "https://a.example/", type: "Weird" } }))).toEqual({
      title: "Page",
      url: "https://a.example/",
      type: "Other",
    });
    expect(proposedResource(p({ field: "name" }))).toBeNull();
  });
});
