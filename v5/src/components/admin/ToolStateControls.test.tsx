import { render, screen, userEvent } from "../../../test/utils/render";
import { ToolStateControls } from "./ToolStateControls";
import type { EditableTool } from "../../lib/data/tools";

/**
 * Looks good, Publish, Unpublish, Archive, Restore (spec §5.3(3), §5.3(5)).
 *
 * What it must never offer is a delete: a tool is archived, because maintenance
 * history, project links and printed QR labels all point at rows that have to
 * survive (§5.3 "Deleting").
 */

function tool(overrides: Partial<EditableTool> = {}): EditableTool {
  return {
    id: "tool-1",
    slug: "form-4",
    name: "Form 4",
    description: null,
    categoryId: null,
    locationId: null,
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: false,
    useRestrictions: null,
    emergencyStop: null,
    notes: null,
    published: true,
    archivedAt: null,
    lastReviewedAt: null,
    lastReviewedBy: null,
    revision: "1758000000.1",
    ...overrides,
  };
}

function renderControls(
  overrides: Partial<EditableTool> = {},
  props: { canPublish?: boolean } = {}
) {
  const handlers = {
    onMarkReviewed: vi.fn(),
    onPublish: vi.fn(),
    onUnpublish: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
  };
  render(
    <ToolStateControls
      tool={tool(overrides)}
      canPublish={props.canPublish ?? true}
      pending={false}
      {...handlers}
    />
  );
  return handlers;
}

it("says what state the tool is in, archived winning over published", () => {
  renderControls({ published: true, archivedAt: new Date("2026-02-01T00:00:00.000Z") });
  expect(screen.getByText("Archived")).toBeInTheDocument();
});

it("says a tool has never been reviewed, which is the flag it is here to clear", () => {
  renderControls();
  expect(screen.getByText("Never reviewed")).toBeInTheDocument();
});

it("shows when it was last reviewed, as a date two people can compare", () => {
  renderControls({ lastReviewedAt: new Date("2026-06-01T09:00:00.000Z") });
  expect(screen.getByText("Last reviewed 2026-06-01")).toBeInTheDocument();
});

it("marks a tool reviewed in one click", async () => {
  const handlers = renderControls();
  await userEvent.click(screen.getByRole("button", { name: "Looks good" }));
  expect(handlers.onMarkReviewed).toHaveBeenCalled();
});

it("never offers to delete a tool", () => {
  renderControls();
  expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
});

it("will not publish an archived tool without restoring it first", () => {
  renderControls({ published: false, archivedAt: new Date("2026-02-01T00:00:00.000Z") });
  expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
});

it("hides every state change from somebody who only holds tools.edit", () => {
  renderControls({}, { canPublish: false });

  for (const label of ["Publish", "Unpublish", "Archive", "Restore"]) {
    expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
  }
  // Reviewing is an ordinary edit, so it is still offered.
  expect(screen.getByRole("button", { name: "Looks good" })).toBeInTheDocument();
});
