import { render, screen, userEvent, waitFor, within } from "../../../test/utils/render";
import { ToolEditorPanel } from "./ToolEditorPanel";
import type { ToolEditorPayload } from "../../app/admin/inventory/action-result";
import type { ToolEditorActions } from "./tool-editor-actions";

/**
 * The tool editor as the person using it sees it (spec §5.3(3)–(5), §6).
 *
 * Every action is a `vi.fn`, which is the whole reason they arrive as props:
 * who may actually perform these writes is decided in
 * `src/app/admin/inventory/actions.test.ts`, against a real database and a real
 * session. What is under test here is what the panel *does with the answers* —
 * above all the conflict, where the only copy of somebody's work is the text
 * still in the boxes.
 */

function payload(overrides: Partial<ToolEditorPayload["tool"]> = {}): ToolEditorPayload {
  return {
    tool: {
      id: "tool-1",
      slug: "form-4",
      name: "Form 4",
      description: "A resin printer",
      categoryId: null,
      locationId: null,
      materials: [],
      ppeRequired: [],
      tags: [],
      trainingRequired: false,
      useRestrictions: null,
      emergencyStop: null,
      notes: null,
      starterQuestions: [],
      published: true,
      archivedAt: null,
      lastReviewedAt: null,
      lastReviewedBy: null,
      revision: "1758000000.1",
      ...overrides,
    },
    units: [],
    resources: [],
    photos: [],
    categories: [{ id: "cat-1", name: "Resin Printing", group: "3D Printing" }],
    locations: [{ id: "loc-1", room: "Bloomberg 061", zone: "Resin Bay", mapTag: null }],
  };
}

/** Every action stubbed to succeed, with the two the panel reads back real. */
function stubActions(overrides: Partial<ToolEditorActions> = {}): ToolEditorActions {
  const ok = vi.fn(async () => ({ ok: true as const, revision: "1758000001.5" }));
  return {
    load: vi.fn(async () => ({ ok: true as const, editor: payload() })),
    save: ok,
    markReviewed: ok,
    publish: ok,
    unpublish: ok,
    archive: ok,
    restore: ok,
    addUnit: vi.fn(async () => ({ ok: true as const, revision: "r", unitId: "u1" })),
    editUnit: vi.fn(async () => ({ ok: true as const, revision: "r", unitId: "u1" })),
    retireUnit: vi.fn(async () => ({ ok: true as const, revision: "r", unitId: "u1" })),
    deleteUnit: vi.fn(async () => ({ ok: true as const, revision: "r", unitId: "u1" })),
    addResource: vi.fn(async () => ({
      ok: true as const,
      revision: "r",
      resourceId: "r1",
      filesSubmitted: 0,
      filesAttached: 0,
    })),
    editResource: vi.fn(async () => ({ ok: true as const, revision: "r", resourceId: "r1" })),
    removeResource: vi.fn(async () => ({ ok: true as const, revision: "r", resourceId: "r1" })),
    attachPhotos: vi.fn(async () => ({
      ok: true as const,
      revision: "r",
      photosSubmitted: 0,
      photosAttached: 0,
    })),
    reorderPhotos: vi.fn(async () => ({ ok: true as const, revision: "r", order: [] })),
    removePhoto: vi.fn(async () => ({ ok: true as const, revision: "r", order: [] })),
    ...overrides,
  } as ToolEditorActions;
}

async function openPanel(
  actions: ToolEditorActions,
  props: Partial<React.ComponentProps<typeof ToolEditorPanel>> = {}
) {
  render(
    <ToolEditorPanel
      idOrSlug="form-4"
      toolName="Form 4"
      actions={actions}
      onClose={() => {}}
      {...props}
    />
  );
  // The panel mints its token on open, so nothing is interactive until then.
  await screen.findByLabelText("Description");
}

function descriptionBox() {
  return screen.getByLabelText("Description");
}

describe("opening the panel", () => {
  it("loads the tool when it mounts, which is what mints the revision", async () => {
    const actions = stubActions();
    await openPanel(actions);

    expect(actions.load).toHaveBeenCalledWith("form-4");
    expect(screen.getByRole("complementary")).toHaveAccessibleName("Editing Form 4");
  });

  it("says why it cannot open, rather than showing an empty form", async () => {
    const actions = stubActions({
      load: vi.fn(async () => ({ ok: false as const, error: "not_permitted" as const })),
    });
    render(
      <ToolEditorPanel idOrSlug="form-4" toolName="Form 4" actions={actions} onClose={() => {}} />
    );

    expect(
      await screen.findByText(/does not hold the permission/)
    ).toBeInTheDocument();
  });

  it("carries the token it was given into the save", async () => {
    const actions = stubActions();
    await openPanel(actions);

    await userEvent.clear(descriptionBox());
    await userEvent.type(descriptionBox(), "Fixed");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() =>
      expect(actions.save).toHaveBeenCalledWith({
        toolId: "tool-1",
        expectedRevision: "1758000000.1",
        patch: { description: "Fixed" },
      })
    );
  });

  it("sends only the fields that changed, so it cannot overwrite the rest", async () => {
    const actions = stubActions();
    await openPanel(actions);

    await userEvent.type(screen.getByLabelText("Notes"), "Tank replaced");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    const [call] = vi.mocked(actions.save).mock.calls;
    expect(Object.keys(call[0].patch)).toEqual(["notes"]);
  });
});

// ── The conflict, which is what this phase exists to get right ──────

describe("a conflict", () => {
  /** A save that refuses because somebody else moved the row. */
  function conflicting() {
    return stubActions({
      save: vi.fn(async () => ({ ok: false as const, error: "conflict" as const })),
    });
  }

  it("keeps every unsaved edit on screen and offers a reload", async () => {
    await openPanel(conflicting());

    await userEvent.clear(descriptionBox());
    await userEvent.type(descriptionBox(), "My careful rewrite");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    // The one thing that must never happen: the panel throwing away work the
    // database never took.
    expect(await screen.findByRole("alert")).toHaveTextContent(/Somebody else changed this/);
    expect(descriptionBox()).toHaveValue("My careful rewrite");
    expect(screen.getByRole("button", { name: /Reload/ })).toBeInTheDocument();
  });

  it("shows the other version beside the edit after a reload, and keeps both", async () => {
    const actions = conflicting();
    // The second read answers with what the other person wrote.
    vi.mocked(actions.load)
      .mockResolvedValueOnce({ ok: true, editor: payload() })
      .mockResolvedValue({ ok: true, editor: payload({ description: "Their rewrite" }) });

    await openPanel(actions);
    await userEvent.clear(descriptionBox());
    await userEvent.type(descriptionBox(), "My rewrite");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: /Reload/ }));

    // Both versions are on screen, and the box still holds this person's.
    expect(await screen.findByText("Their version: Their rewrite")).toBeInTheDocument();
    expect(descriptionBox()).toHaveValue("My rewrite");
  });

  it("takes the other version when the person asks for it", async () => {
    const actions = conflicting();
    vi.mocked(actions.load)
      .mockResolvedValueOnce({ ok: true, editor: payload() })
      .mockResolvedValue({ ok: true, editor: payload({ description: "Their rewrite" }) });

    await openPanel(actions);
    await userEvent.clear(descriptionBox());
    await userEvent.type(descriptionBox(), "My rewrite");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /Reload/ }));
    await userEvent.click(screen.getByRole("button", { name: "Use theirs" }));

    expect(descriptionBox()).toHaveValue("Their rewrite");
  });

  it("saves against the newer token after a reload", async () => {
    const actions = conflicting();
    vi.mocked(actions.load)
      .mockResolvedValueOnce({ ok: true, editor: payload() })
      .mockResolvedValue({
        ok: true,
        editor: payload({ description: "Their rewrite", revision: "1758000099.9" }),
      });

    await openPanel(actions);
    await userEvent.type(descriptionBox(), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: /Reload/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(vi.mocked(actions.save).mock.calls).toHaveLength(2));
    expect(vi.mocked(actions.save).mock.calls[1][0].expectedRevision).toBe("1758000099.9");
  });
});

// ── What a write says afterwards ────────────────────────────────────

describe("the panel's one live region", () => {
  it("confirms a save that landed", async () => {
    await openPanel(stubActions());

    await userEvent.type(descriptionBox(), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("keeps the change and says what is missing when the audit write failed", async () => {
    const actions = stubActions({
      publish: vi.fn(async () => ({
        ok: true as const,
        revision: "r2",
        warning: "audit_unavailable" as const,
      })),
      load: vi.fn(async () => ({ ok: true as const, editor: payload({ published: false }) })),
    });
    await openPanel(actions);

    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    // Never `{ ok: false }` for a write that landed: the tool is published, and
    // the panel says so *and* says the trail did not record it (§4.11).
    expect(await screen.findByText(/could not be written to the audit log/)).toBeInTheDocument();
  });

  it("reports a refusal without claiming anything changed", async () => {
    const actions = stubActions({
      save: vi.fn(async () => ({ ok: false as const, error: "invalid_field" as const })),
    });
    await openPanel(actions);

    await userEvent.type(descriptionBox(), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save details" }));

    expect(await screen.findByText(/not one this field accepts/)).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });
});

// ── The state controls (§5.3(5)) ────────────────────────────────────

describe("the state controls", () => {
  it("offers Publish on a draft and Unpublish on a published tool", async () => {
    const draft = stubActions({
      load: vi.fn(async () => ({ ok: true as const, editor: payload({ published: false }) })),
    });
    await openPanel(draft);
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
  });

  it("offers Restore instead of Archive on an archived tool, and never a delete", async () => {
    const archived = stubActions({
      load: vi.fn(async () => ({
        ok: true as const,
        editor: payload({ archivedAt: new Date("2026-01-05T00:00:00.000Z") }),
      })),
    });
    await openPanel(archived);

    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    // Tools are archived, never deleted (§5.3 "Deleting").
    expect(screen.queryByRole("button", { name: /Delete tool/ })).not.toBeInTheDocument();
  });

  it("hides the publish controls from somebody who only holds tools.edit", async () => {
    await openPanel(stubActions(), { canPublish: false });

    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
    // Looks good is an ordinary edit, so it stays.
    expect(screen.getByRole("button", { name: "Looks good" })).toBeInTheDocument();
  });

  /**
   * The regression: all five state controls commit through `run(…, { refresh:
   * true })`, and the refresh used to re-read the units, resources and photos
   * while leaving the tool row exactly as the panel opened it. The write landed,
   * the live region said "Saved", and the badge and the button went on asserting
   * the state the database had just stopped holding — which is what
   * `action-result.ts` and `audit-warning.ts` say must never happen. Clicking
   * again wrote a second audit event for a change already made.
   */
  it("shows the tool as a draft after Unpublish, rather than still offering Unpublish", async () => {
    const actions = stubActions();
    vi.mocked(actions.load)
      .mockResolvedValueOnce({ ok: true, editor: payload() })
      .mockResolvedValue({ ok: true, editor: payload({ published: false }) });
    await openPanel(actions);

    await userEvent.click(screen.getByRole("button", { name: "Unpublish" }));

    expect(await screen.findByRole("button", { name: "Publish" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpublish" })).not.toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("offers Restore after Archive, so the tool can be restored without reopening", async () => {
    const actions = stubActions();
    vi.mocked(actions.load)
      .mockResolvedValueOnce({ ok: true, editor: payload() })
      .mockResolvedValue({
        ok: true,
        editor: payload({ archivedAt: new Date("2026-01-05T00:00:00.000Z") }),
      });
    await openPanel(actions);

    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("stops saying 'Never reviewed' once Looks good has landed", async () => {
    const actions = stubActions();
    vi.mocked(actions.load)
      .mockResolvedValueOnce({ ok: true, editor: payload() })
      .mockResolvedValue({
        ok: true,
        editor: payload({ lastReviewedAt: new Date("2026-09-22T10:00:00.000Z") }),
      });
    await openPanel(actions);
    expect(screen.getByText("Never reviewed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Looks good" }));

    expect(await screen.findByText("Last reviewed 2026-09-22")).toBeInTheDocument();
  });

  it("leaves the text somebody is typing alone while it adopts the new state", async () => {
    const actions = stubActions();
    vi.mocked(actions.load)
      .mockResolvedValueOnce({ ok: true, editor: payload() })
      .mockResolvedValue({
        ok: true,
        editor: payload({ published: false, description: "Whatever the server holds" }),
      });
    await openPanel(actions);

    await userEvent.clear(descriptionBox());
    await userEvent.type(descriptionBox(), "Half a sentence");
    await userEvent.click(screen.getByRole("button", { name: "Unpublish" }));

    await screen.findByRole("button", { name: "Publish" });
    expect(descriptionBox()).toHaveValue("Half a sentence");
  });

  it("marks a tool reviewed with the token it holds", async () => {
    const actions = stubActions();
    await openPanel(actions);

    await userEvent.click(screen.getByRole("button", { name: "Looks good" }));

    await waitFor(() =>
      expect(actions.markReviewed).toHaveBeenCalledWith({
        toolId: "tool-1",
        expectedRevision: "1758000000.1",
      })
    );
  });
});

// ── The sheet, which is the phone-first surface (§5.3(b), §6) ───────

describe("the phone layout", () => {
  it("renders as a full-screen sheet when a tool page opens it", async () => {
    await openPanel(stubActions(), { variant: "sheet" });
    expect(screen.getByRole("complementary").className).toContain("is-sheet");
  });

  it("renders as a side panel beside the review table by default", async () => {
    await openPanel(stubActions());
    expect(screen.getByRole("complementary").className).toContain("is-panel");
  });
});

// ── The child sections, wired to the same token ─────────────────────

describe("the child sections", () => {
  it("adds a unit and re-reads the panel afterwards", async () => {
    const actions = stubActions();
    await openPanel(actions);

    await userEvent.type(screen.getByLabelText("New unit"), "Form 4 #2");
    await userEvent.click(screen.getByRole("button", { name: "Add unit" }));

    await waitFor(() =>
      expect(actions.addUnit).toHaveBeenCalledWith({
        toolId: "tool-1",
        expectedRevision: "1758000000.1",
        unit: { unitLabel: "Form 4 #2" },
      })
    );
    // A new unit has an id only the server knows, so the list is re-read.
    await waitFor(() => expect(vi.mocked(actions.load).mock.calls.length).toBeGreaterThan(1));
  });

  it("names what is missing when a section is empty (§6, States)", async () => {
    await openPanel(stubActions());

    expect(screen.getByText(/No units recorded/)).toBeInTheDocument();
    expect(screen.getByText(/No manuals or links yet/)).toBeInTheDocument();
    expect(screen.getByText(/No photos/)).toBeInTheDocument();
  });

  it("shows a unit's status as a control that saves on change", async () => {
    const actions = stubActions({
      load: vi.fn(async () => ({
        ok: true as const,
        editor: {
          ...payload(),
          units: [
            {
              id: "unit-1",
              unitLabel: "Form 4 #1",
              serialNumber: null,
              assetTag: null,
              status: "available",
              condition: null,
              dateAcquired: null,
              notes: null,
            },
          ],
        },
      })),
    });
    await openPanel(actions);

    const unit = within(screen.getByRole("listitem", { name: "Form 4 #1" }));
    await userEvent.selectOptions(unit.getByLabelText("Status"), "out_of_service");

    // One decision, one gesture: the person is standing next to the machine.
    await waitFor(() =>
      expect(actions.editUnit).toHaveBeenCalledWith({
        toolId: "tool-1",
        expectedRevision: "1758000000.1",
        unitId: "unit-1",
        patch: { status: "out_of_service" },
      })
    );
  });
});
