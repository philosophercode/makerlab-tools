const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { IntakeActions, IntakeApproveResult } from "../../app/admin/intake/action-result";
import type { CategoryOption, LocationOption } from "../../lib/data/taxonomy";
import type { PendingToolView } from "../../lib/intake/types";
import type { ResearchResult } from "../../lib/research/result";
import { PreliminaryToolPage, type PreliminaryToolPageProps } from "./PreliminaryToolPage";

/**
 * The page an admin approves from (spec §5.4 steps 10–12, §10 "Approve disabled
 * at low confidence until the override is ticked").
 *
 * The property the spec names is the gate: research that could not confirm an
 * item must not become a tool on one click. Both Approve buttons stay off until
 * the reviewer ticks "I've checked this" *and* says what they checked, and the
 * note travels with the approval. The rest is the discipline every admin
 * surface keeps: a refusal leaves the typing where it was, and a success says
 * where the tool now lives.
 */

const ID = "6a1f0c3e-0d7b-4c55-9f2a-1b8e7d3c4a01";

const CATEGORIES: CategoryOption[] = [{ id: "c-laser", name: "Laser cutters", group: "Cutting" }];

const LOCATIONS: LocationOption[] = [
  { id: "l-1", room: "Makerlab", zone: "Printer bay", mapTag: null },
  { id: "l-2", room: "Makerlab", zone: "Laser room", mapTag: null },
];

function research(over: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Original Prusa MK4S",
    description: "An open-frame FDM printer.",
    specs: [{ label: "Build volume", value: "250 × 210 × 220 mm" }],
    materials: ["PLA", "PETG"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [
      { title: "User manual", url: "https://example.com/manual.pdf", type: "Manual" },
      { title: "Setup video", url: "https://example.com/video", type: "Video" },
    ],
    droppedLinks: ['Manual "Old manual" (https://example.com/old.pdf) — 404'],
    sourceUrls: ["https://www.prusa3d.com/mk4s"],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: true,
      manualFound: true,
      specsFromSource: true,
      categoryOnly: false,
    },
    confidence: { level: "high", basis: [], unknowns: [] },
    ...over,
  };
}

const LOW = research({
  canonicalName: "Vinyl cutter",
  evidence: {
    userStatedModel: false,
    modelPlateRead: null,
    manufacturerPageFound: false,
    manualFound: false,
    specsFromSource: false,
    categoryOnly: true,
  },
  confidence: { level: "low", basis: [], unknowns: [] },
  resources: [],
  droppedLinks: [],
});

function item(over: Partial<PendingToolView> = {}): PendingToolView {
  return {
    id: ID,
    batchId: "batch-1",
    status: "researched",
    name: "Prusa MK4S",
    brand: "Prusa Research",
    categoryHint: "3D Printing",
    locationHint: "printer bay",
    serialNumber: "SN-42",
    duplicateOf: null,
    duplicateResolution: null,
    photos: [
      { attachmentId: "p1", url: "https://blob.test/front.png", filename: "front.png" },
      { attachmentId: "p2", url: null, filename: "plate.png" },
    ],
    confidenceLevel: "high",
    researchError: null,
    researchRequestedAt: null,
    hasWorkflowRun: false,
    createdByName: "Niti Parikh",
    createdAt: "2026-03-06T14:55:00.000Z",
    updatedAt: "2026-03-06T14:55:00.000Z",
    ...over,
  };
}

const APPROVED: IntakeApproveResult = {
  ok: true,
  toolId: "t-1",
  slug: "original-prusa-mk4s",
  published: true,
};

function actions(over: Partial<IntakeActions> = {}): IntakeActions {
  return {
    approve: vi.fn(async () => APPROVED),
    approveAsDraft: vi.fn(async () => ({ ...APPROVED, published: false })),
    addUnit: vi.fn(async () => ({
      ok: true as const,
      toolId: "t-form",
      slug: "form-4",
      published: true,
    })),
    discard: vi.fn(async () => ({ ok: true as const })),
    saveIdentity: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

function renderPage(over: Partial<PreliminaryToolPageProps> = {}) {
  const props: PreliminaryToolPageProps = {
    item: item(),
    research: research(),
    categories: CATEGORIES,
    locations: LOCATIONS,
    targetTool: null,
    createdTool: null,
    canPublish: true,
    actions: actions(),
    ...over,
  };
  render(<PreliminaryToolPage {...props} />);
  return props;
}

const approveButton = () => screen.getByRole("button", { name: "Approve" });
const draftButton = () => screen.getByRole("button", { name: "Approve as draft" });

beforeEach(() => {
  router.refresh.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PreliminaryToolPage — the low-confidence gate", () => {
  it("disables both Approve buttons at low confidence", () => {
    renderPage({
      item: item({ name: "Unknown Vinyl Cutter", confidenceLevel: "low" }),
      research: LOW,
    });

    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(approveButton()).toBeDisabled();
    expect(draftButton()).toBeDisabled();
  });

  it("keeps them disabled when the box is ticked but no note is written", async () => {
    renderPage({ research: LOW });

    await userEvent.click(screen.getByRole("checkbox", { name: "I've checked this" }));

    expect(approveButton()).toBeDisabled();
    expect(draftButton()).toBeDisabled();
  });

  it("keeps them disabled with a note but no tick, and with a blank note", async () => {
    renderPage({ research: LOW });

    await userEvent.type(screen.getByLabelText("What you checked"), "   ");
    await userEvent.click(screen.getByRole("checkbox", { name: "I've checked this" }));
    expect(approveButton()).toBeDisabled();

    await userEvent.click(screen.getByRole("checkbox", { name: "I've checked this" }));
    await userEvent.type(screen.getByLabelText("What you checked"), "Read the plate");
    expect(approveButton()).toBeDisabled();
  });

  it("enables them with the box ticked and a note, and sends the note", async () => {
    const props = renderPage({ research: LOW });

    await userEvent.click(screen.getByRole("checkbox", { name: "I've checked this" }));
    await userEvent.type(
      screen.getByLabelText("What you checked"),
      "Read the model plate myself: Cricut Maker 3."
    );

    expect(approveButton()).toBeEnabled();
    expect(draftButton()).toBeEnabled();

    await userEvent.click(draftButton());

    expect(props.actions.approveAsDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ID,
        overrideNote: "Read the model plate myself: Cricut Maker 3.",
      })
    );
    expect(props.actions.approve).not.toHaveBeenCalled();
  });

  it("enables both at high confidence, with no override box and no note sent", async () => {
    const props = renderPage();

    expect(screen.queryByRole("checkbox", { name: "I've checked this" })).not.toBeInTheDocument();
    expect(approveButton()).toBeEnabled();
    expect(draftButton()).toBeEnabled();

    await userEvent.click(approveButton());
    expect(props.actions.approve).toHaveBeenCalledWith(
      expect.objectContaining({ id: ID, overrideNote: null })
    );
  });

  it("hides Approve from somebody who may only draft", () => {
    renderPage({ canPublish: false });

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(draftButton()).toBeEnabled();
  });
});

describe("PreliminaryToolPage — the proposal", () => {
  it("pre-fills the editor's fields from research, specs in the description", () => {
    renderPage();

    expect(screen.getByLabelText("Name")).toHaveValue("Original Prusa MK4S");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "An open-frame FDM printer.\n\n- **Build volume:** 250 × 210 × 220 mm"
    );
    expect(screen.getByLabelText("Materials")).toHaveValue("PLA, PETG");
    expect(screen.getByLabelText("Training required before use")).toBeChecked();
    expect(screen.getByLabelText("Serial number")).toHaveValue("SN-42");
    // Research proposed a category the lab does not have: it is offered new.
    expect(screen.getByLabelText("Category")).toHaveDisplayValue("Create “3D Printing — FDM”");
    // The hint matched a zone, ignoring case.
    expect(screen.getByLabelText("Location")).toHaveValue("l-1");
  });

  it("pre-selects the category research matched, when the lab still has it", () => {
    renderPage({
      research: research({
        category: { name: "Laser cutters", group: "Cutting", existingId: "c-laser" },
      }),
    });
    expect(screen.getByLabelText("Category")).toHaveValue("c-laser");
  });

  it("shows the evidence: the strip, sources, dropped links with reasons, and the photos", () => {
    renderPage();

    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "prusa3d.com" })).toBeInTheDocument();
    expect(
      screen.getByText('Manual "Old manual" (https://example.com/old.pdf) — 404')
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Prusa MK4S, photo 1" })).toBeInTheDocument();
    // A private photo says so rather than guessing a URL.
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("sends the edited record, the new category and only the links left ticked", async () => {
    const props = renderPage();

    await userEvent.clear(screen.getByLabelText("Materials"));
    await userEvent.type(screen.getByLabelText("Materials"), "PLA, TPU");
    await userEvent.click(screen.getByRole("checkbox", { name: "Setup video (Video)" }));
    await userEvent.click(approveButton());

    expect(props.actions.approve).toHaveBeenCalledWith({
      id: ID,
      overrideNote: null,
      fields: {
        name: "Original Prusa MK4S",
        description: "An open-frame FDM printer.\n\n- **Build volume:** 250 × 210 × 220 mm",
        categoryId: null,
        newCategory: { name: "FDM", group: "3D Printing" },
        locationId: "l-1",
        materials: ["PLA", "TPU"],
        ppeRequired: [],
        tags: ["3d-printing"],
        trainingRequired: true,
        useRestrictions: null,
        serialNumber: "SN-42",
        resourceUrls: ["https://example.com/manual.pdf"],
        // The item has uploaded photos: they are the cover, and nothing replaces them.
        image: { choice: "none" },
      },
    });
  });
});

describe("PreliminaryToolPage — the product image", () => {
  const IMAGES: NonNullable<ResearchResult["images"]> = {
    candidates: [
      {
        url: "https://cdn.prusa3d.com/mk4s-front.png",
        pageUrl: "https://www.prusa3d.com/mk4s",
        source: "og",
        width: 1200,
        height: 900,
        contentType: "image/png",
        rank: 1,
        reason: "Front on.",
      },
      {
        url: "https://cdn.prusa3d.com/mk4s-side.png",
        pageUrl: "https://www.prusa3d.com/mk4s",
        source: "jsonld",
        width: 900,
        height: 900,
        contentType: "image/png",
        rank: 2,
        reason: "Side.",
      },
    ],
    cleaned: { attachmentId: "3c0a8f3e-1111-4c55-9f2a-1b8e7d3c4a01", fromUrl: "https://cdn.prusa3d.com/mk4s-front.png" },
  };

  const imageFields = (props: PreliminaryToolPageProps, action: "approve" | "approveAsDraft" = "approve") =>
    vi.mocked(props.actions[action]).mock.calls[0][0].fields.image;

  it("sits above the photos and sends the preselected cleaned copy with Approve", async () => {
    const props = renderPage({ item: item({ photos: [] }), research: research({ images: IMAGES }) });

    const section = screen.getByRole("radiogroup", { name: "Product image" });
    const photos = screen.getByRole("heading", { name: "Photos" });
    expect(section.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(approveButton());
    expect(imageFields(props)).toEqual({ choice: "cleaned" });
  });

  it("sends the original the admin picked, by its recorded URL, with Approve as draft", async () => {
    const props = renderPage({ item: item({ photos: [] }), research: research({ images: IMAGES }) });

    await userEvent.click(screen.getByRole("radio", { name: "Option 2" }));
    await userEvent.click(draftButton());

    expect(imageFields(props, "approveAsDraft")).toEqual({
      choice: "original",
      candidateUrl: "https://cdn.prusa3d.com/mk4s-side.png",
    });
  });

  it("sends none when the admin says No image", async () => {
    const props = renderPage({ item: item({ photos: [] }), research: research({ images: IMAGES }) });

    await userEvent.click(screen.getByRole("radio", { name: "No image" }));
    await userEvent.click(approveButton());

    expect(imageFields(props)).toEqual({ choice: "none" });
  });

  it("uses the uploaded photo and offers no candidates, even when research recorded some", async () => {
    const props = renderPage({ research: research({ images: IMAGES }) });

    expect(screen.getByText("Using your photo")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Background removed" })).not.toBeInTheDocument();
    await userEvent.click(approveButton());
    expect(imageFields(props)).toEqual({ choice: "none" });
  });

  it("shows no product image section for an add-unit item", () => {
    renderPage({
      item: item({ duplicateResolution: "add_unit", photos: [] }),
      research: null,
      targetTool: { name: "Form 4", slug: "form-4", published: true },
    });
    expect(screen.queryByRole("heading", { name: "Product image" })).not.toBeInTheDocument();
  });

  it("says the image did not attach when the approval reports it", async () => {
    renderPage({
      item: item({ photos: [] }),
      research: research({ images: IMAGES }),
      actions: actions({
        approve: vi.fn(async () => ({
          ...APPROVED,
          warning: "image_not_attached" as const,
          imageAttached: false,
        })),
      }),
    });

    await userEvent.click(approveButton());

    expect(
      await screen.findByText("The tool was created, but its image could not be attached. Add a photo in the editor.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Original Prusa MK4S" })).toBeInTheDocument();
  });

  it("still says so when the warning slot went to a lost audit event", async () => {
    renderPage({
      item: item({ photos: [] }),
      research: research({ images: IMAGES }),
      actions: actions({
        approve: vi.fn(async () => ({
          ...APPROVED,
          warning: "audit_unavailable" as const,
          imageAttached: false,
        })),
      }),
    });

    await userEvent.click(approveButton());

    expect(await screen.findByText(/could not be written to the audit log/)).toBeInTheDocument();
    expect(screen.getByText(/its image could not be attached/)).toBeInTheDocument();
  });

  it("says nothing about an image when none was chosen", async () => {
    renderPage({
      item: item({ photos: [] }),
      research: research({ images: IMAGES }),
      actions: actions({ approve: vi.fn(async () => ({ ...APPROVED, imageAttached: false })) }),
    });

    await userEvent.click(screen.getByRole("radio", { name: "No image" }));
    await userEvent.click(approveButton());

    expect(await screen.findByText(/Approved and published/)).toBeInTheDocument();
    expect(screen.queryByText(/its image could not be attached/)).not.toBeInTheDocument();
  });
});

describe("PreliminaryToolPage — outcomes", () => {
  it("links the new tool after an approval, and says it is published", async () => {
    renderPage();

    await userEvent.click(approveButton());

    expect(
      await screen.findByText("Approved and published. It is in the catalog now.")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Original Prusa MK4S" })).toHaveAttribute(
      "href",
      "/tools/original-prusa-mk4s"
    );
  });

  it("says a draft is a draft, and still links it — approvers can open drafts", async () => {
    renderPage();

    await userEvent.click(draftButton());

    expect(await screen.findByText(/Approved as a draft/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Original Prusa MK4S" })).toHaveAttribute(
      "href",
      "/tools/original-prusa-mk4s"
    );
  });

  it("keeps the success and shows the warning when the audit trail missed it", async () => {
    renderPage({
      actions: actions({
        approve: vi.fn(async () => ({ ...APPROVED, warning: "audit_unavailable" as const })),
      }),
    });

    await userEvent.click(approveButton());

    expect(await screen.findByText(/could not be written to the audit log/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Original Prusa MK4S" })).toBeInTheDocument();
  });

  it("keeps every edit when the server refuses, and says why", async () => {
    const props = renderPage({
      actions: actions({
        approve: vi.fn(async () => ({ ok: false as const, error: "not_editable" as const })),
      }),
    });

    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Prusa MK4S+");
    await userEvent.type(screen.getByLabelText("Use restrictions"), "Staff only");
    await userEvent.click(approveButton());

    expect(
      await screen.findByText(/This item has moved on since this page opened/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Prusa MK4S+");
    expect(screen.getByLabelText("Use restrictions")).toHaveValue("Staff only");
    expect(props.actions.approve).toHaveBeenCalledTimes(1);
    expect(approveButton()).toBeEnabled();
  });

  it("says the save failed when the action rejects outright, and keeps the edits", async () => {
    renderPage({
      actions: actions({ approve: vi.fn(async () => Promise.reject(new Error("offline"))) }),
    });

    await userEvent.type(screen.getByLabelText("Use restrictions"), "Staff only");
    await userEvent.click(approveButton());

    expect(await screen.findByText("That did not save. Nothing was changed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Use restrictions")).toHaveValue("Staff only");
  });

  it("disables every control while a write is in flight", async () => {
    let resolve: (value: IntakeApproveResult) => void = () => {};
    renderPage({
      actions: actions({
        approve: vi.fn(() => new Promise<IntakeApproveResult>((done) => (resolve = done))),
      }),
    });

    await userEvent.click(approveButton());

    expect(await screen.findByText("Approving…")).toBeInTheDocument();
    expect(draftButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();

    resolve(APPROVED);
    expect(await screen.findByText(/Approved and published/)).toBeInTheDocument();
  });

  it("discards after an inline confirmation, never a modal", async () => {
    const props = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(props.actions.discard).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Yes, discard" }));

    expect(props.actions.discard).toHaveBeenCalledWith({ id: ID });
    expect(await screen.findByText(/Discarded\. It is off the queue/)).toBeInTheDocument();
  });

  it("renders an item the server already approved as settled, with its tool", () => {
    renderPage({
      item: item({ status: "approved" }),
      createdTool: { name: "Original Prusa MK4S", slug: "original-prusa-mk4s", published: false },
    });

    expect(screen.getByText(/Approved as a draft/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});

describe("PreliminaryToolPage — name, brand and Research again", () => {
  it("saves a corrected name and brand", async () => {
    const props = renderPage();

    const name = screen.getByLabelText("Name as identified");
    await userEvent.clear(name);
    await userEvent.type(name, "Prusa MK4S+");
    await userEvent.click(screen.getByRole("button", { name: "Save name and brand" }));

    expect(props.actions.saveIdentity).toHaveBeenCalledWith({
      id: ID,
      name: "Prusa MK4S+",
      brand: "Prusa Research",
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("saves a corrected name first, then sends the item back to research", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ requestId: "r", runId: "run", queued: [ID], readyAsUnit: [] }),
          { status: 202 }
        )
      );
    const props = renderPage({ research: LOW });

    const name = screen.getByLabelText("Name as identified");
    await userEvent.clear(name);
    await userEvent.type(name, "Cricut Maker 3");
    await userEvent.click(screen.getByRole("button", { name: "Research again" }));

    expect(props.actions.saveIdentity).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ ids: [ID] });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("renders the route's refusal code when research cannot start", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "daily_limit", error: "limit", remaining: 0 }), {
        status: 429,
      })
    );
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: "Research again" }));

    expect(await screen.findByText(/today's research limit/)).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("PreliminaryToolPage — an add-unit item", () => {
  const unitItem = item({
    name: "Form 4",
    duplicateOf: { kind: "tool", id: "t-form", name: "Form 4", slug: "form-4", published: true },
    duplicateResolution: "add_unit",
    serialNumber: "F4-0002",
    confidenceLevel: null,
  });

  it("shows the tool it joins and a serial field, and no Approve buttons", () => {
    renderPage({
      item: unitItem,
      research: null,
      targetTool: { name: "Form 4", slug: "form-4", published: true },
    });

    const section = screen.getByRole("region", { name: "Another unit of an existing tool" });
    expect(within(section).getByRole("link", { name: "Form 4" })).toHaveAttribute(
      "href",
      "/tools/form-4"
    );
    expect(within(section).getByLabelText("Serial number")).toHaveValue("F4-0002");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve as draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Research again" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("adds the unit with the serial as typed, then links the tool", async () => {
    const props = renderPage({
      item: unitItem,
      research: null,
      targetTool: { name: "Form 4", slug: "form-4", published: true },
    });

    const serial = screen.getByLabelText("Serial number");
    await userEvent.clear(serial);
    await userEvent.type(serial, "F4-0003");
    await userEvent.click(screen.getByRole("button", { name: "Add unit" }));

    expect(props.actions.addUnit).toHaveBeenCalledWith({ id: ID, serialNumber: "F4-0003" });
    expect(await screen.findByText("Added as another unit of Form 4.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Form 4" })).toHaveAttribute(
      "href",
      "/tools/form-4"
    );
  });

  it("says why when the serial is already taken, and keeps it", async () => {
    renderPage({
      item: unitItem,
      research: null,
      targetTool: { name: "Form 4", slug: "form-4", published: true },
      actions: actions({
        addUnit: vi.fn(async () => ({ ok: false as const, error: "duplicate_serial" as const })),
      }),
    });

    await userEvent.click(screen.getByRole("button", { name: "Add unit" }));

    expect(
      await screen.findByText(/already has a unit with that serial number/)
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Serial number")).toHaveValue("F4-0002");
  });

  it("cannot add a unit to a tool that is gone", () => {
    renderPage({ item: unitItem, research: null, targetTool: null });
    expect(screen.getByRole("button", { name: "Add unit" })).toBeDisabled();
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
  });
});

describe('PreliminaryToolPage — correcting the AI (amendment "reviewer notes")', () => {
  const IMAGES = {
    candidates: [
      {
        url: "https://wiki.example.com/x2d-back.jpg",
        pageUrl: "https://wiki.example.com/x2d",
        source: "og" as const,
        width: 1200,
        height: 900,
        contentType: "image/jpeg" as const,
        rank: 1 as const,
        reason: "rear",
        view: "back" as const,
      },
    ],
    cleaned: null,
  };
  const noPhotos = item({ photos: [] });

  it("sends the note with Research again, one line, and offers the last one again", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ requestId: "r", runId: "run", queued: [ID], readyAsUnit: [] }), { status: 202 }));
    renderPage({ research: research({ reviewerNote: "use the prusa3d.com page" }) });

    const box = screen.getByLabelText("Note for research (optional)");
    expect(box).toHaveValue("use the prusa3d.com page");
    expect(box).toHaveAttribute("maxLength", "300");
    expect(box).toHaveAttribute("placeholder", "e.g. use the bambulab.com X2D product page");
    await userEvent.clear(box);
    await userEvent.type(box, "use the bambulab.com{Enter}X2D product page");
    await userEvent.click(screen.getByRole("button", { name: "Research again" }));

    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({
      ids: [ID],
      note: "use the bambulab.com X2D product page",
    });
  });

  it("sends no note when the box is empty", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ requestId: "r", runId: "run", queued: [ID], readyAsUnit: [] }), { status: 202 }));
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Research again" }));
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ ids: [ID] });
  });

  it("asks for a different image with its note, then refreshes", async () => {
    const differentImage = vi.fn(async () => ({ ok: true as const }));
    renderPage({ item: noPhotos, research: research({ images: IMAGES }), actions: actions({ differentImage }) });

    await userEvent.type(screen.getByLabelText("What to look for (optional)"), "front-facing photo of the whole printer");
    await userEvent.click(screen.getByRole("button", { name: "Find a different image" }));

    expect(differentImage).toHaveBeenCalledWith({ id: ID, note: "front-facing photo of the whole printer" });
    expect(router.refresh).toHaveBeenCalled();
    expect(await screen.findByText("Looking for another image…")).toBeInTheDocument();
  });

  it("says why it could not start, and keeps the note", async () => {
    const differentImage = vi.fn(async () => ({ ok: false as const, error: "daily_limit" as const }));
    renderPage({ item: noPhotos, research: research({ images: IMAGES }), actions: actions({ differentImage }) });

    await userEvent.type(screen.getByLabelText("What to look for (optional)"), "front view");
    await userEvent.click(screen.getByRole("button", { name: "Find a different image" }));

    expect(await screen.findByText(/today's research limit/)).toBeInTheDocument();
    expect(screen.getByLabelText("What to look for (optional)")).toHaveValue("front view");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("shows a run in progress with the button off, and polls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPage({
        item: noPhotos,
        research: research({
          images: IMAGES,
          imageRetry: { requestId: "r1", requestedAt: new Date().toISOString(), status: "running", note: "front", error: null },
        }),
        actions: actions({ differentImage: vi.fn() }),
      });
      expect(screen.getByText("Looking for another image…")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Find a different image" })).toBeDisabled();
      vi.advanceTimersByTime(5_100);
      expect(router.refresh).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows why the last run failed, and tags a back view", () => {
    renderPage({
      item: noPhotos,
      research: research({
        images: IMAGES,
        imageRetry: { requestId: "r1", requestedAt: "2026-09-23T10:00:00.000Z", status: "failed", note: null, error: "No other picture of it was found." },
      }),
      actions: actions({ differentImage: vi.fn() }),
    });
    expect(screen.getByText("The search for another image did not work: No other picture of it was found.")).toBeInTheDocument();
    expect(screen.getByText("Back view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find a different image" })).toBeEnabled();
  });

  it("re-derives the image choice when new pictures arrive", () => {
    const props = {
      item: noPhotos,
      research: research({ images: IMAGES }),
      categories: CATEGORIES,
      locations: LOCATIONS,
      targetTool: null,
      createdTool: null,
      canPublish: true,
      actions: actions({ differentImage: vi.fn() }),
    };
    const { rerender } = render(<PreliminaryToolPage {...props} />);
    expect(screen.getByRole("radio", { name: "Option 1" })).toBeChecked();

    const next = { ...IMAGES.candidates[0], url: "https://bambulab.example/x2d-front.jpg", view: "front" as const };
    rerender(<PreliminaryToolPage {...props} research={research({ images: { candidates: [next], cleaned: null } })} />);
    expect(screen.getByRole("radio", { name: "Option 1" })).toBeChecked();
    expect(screen.queryByText("Back view")).not.toBeInTheDocument();
  });
});
