import { render, screen, userEvent } from "../../../test/utils/render";
import type { ProjectModerationEntry } from "../../lib/data/projects";
import { ProjectQueue } from "./ProjectQueue";

/**
 * The moderation queue and its one control (spec §5.6, Article 5).
 *
 * The property that matters most here: a submission waiting for a decision has
 * **no public page to preview**, so everything the moderator needs has to be on
 * the card. A queue that showed only a title would be asking somebody to
 * approve a heading.
 */

function submission(overrides: Partial<ProjectModerationEntry> = {}): ProjectModerationEntry {
  return {
    id: "p-1",
    slug: "resin-dice-tower",
    title: "Resin dice tower",
    authorName: "Casey Rivera",
    authorUserId: "u-casey",
    authorRemoved: false,
    body: "A dice tower printed in three parts.",
    link: "https://example.test/tower",
    materials: ["Standard resin", "Felt"],
    photos: ["https://blob.test/cover.png"],
    published: false,
    publishedAt: null,
    createdAt: new Date("2026-03-05T18:00:00.000Z"),
    ...overrides,
  };
}

function renderQueue(
  projects: ProjectModerationEntry[],
  result: Awaited<ReturnType<Parameters<typeof ProjectQueue>[0]["action"]>> = { ok: true }
) {
  const action = vi.fn(async () => result);
  render(<ProjectQueue projects={projects} action={action} />);
  return { action };
}

describe("ProjectQueue", () => {
  it("names what is missing when nothing has been submitted", () => {
    renderQueue([]);
    expect(screen.getByText(/No projects have been submitted yet/)).toBeInTheDocument();
  });

  it("says so when every submission has been decided on", () => {
    renderQueue([submission({ published: true })]);
    expect(screen.getByText(/Nothing is waiting/)).toBeInTheDocument();
  });

  it("shows the whole submission, because there is no page to preview", () => {
    renderQueue([submission()]);

    expect(screen.getByText("A dice tower printed in three parts.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://example.test/tower" })).toBeInTheDocument();
    expect(screen.getByText(/Standard resin, Felt/)).toBeInTheDocument();
    expect(screen.getByText("By Casey Rivera")).toBeInTheDocument();
    expect(screen.getByText(/Not in the gallery yet/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: /Photos submitted with Resin dice tower/ })).toBeInTheDocument();
  });

  it("says a submission arrived without photos rather than showing an empty strip", () => {
    renderQueue([submission({ photos: [] })]);
    expect(screen.getByText("No photos were submitted.")).toBeInTheDocument();
  });

  it("links a published project to the gallery, where it now is", () => {
    renderQueue([submission({ published: true })]);

    expect(screen.getByRole("link", { name: "Open in the gallery" })).toHaveAttribute(
      "href",
      "/projects/resin-dice-tower"
    );
  });

  it("publishes in one click, and the button then offers the other direction", async () => {
    const { action } = renderQueue([submission()]);

    await userEvent.click(screen.getByRole("button", { name: "Publish Resin dice tower" }));

    expect(action).toHaveBeenCalledWith({ projectId: "p-1", published: true });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unpublish Resin dice tower" })
    ).toBeInTheDocument();
  });

  it("restores the previous state when the server refuses, and says why", async () => {
    renderQueue([submission()], { ok: false, error: "not_permitted" });

    await userEvent.click(screen.getByRole("button", { name: "Publish Resin dice tower" }));

    expect(await screen.findByText(/does not hold the permission/)).toBeInTheDocument();
    // Still the publish button: nothing was published, so nothing may say it was.
    expect(screen.getByRole("button", { name: "Publish Resin dice tower" })).toBeInTheDocument();
  });

  it("keeps the publish and warns when only the audit trail failed", async () => {
    renderQueue([submission()], { ok: true, warning: "audit_unavailable" });

    await userEvent.click(screen.getByRole("button", { name: "Publish Resin dice tower" }));

    // The project *is* published; the trail does not say so. Restoring the
    // button would be the worse lie of the two (§4.11).
    expect(await screen.findByText(/could not be written to the audit log/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpublish Resin dice tower" })).toBeInTheDocument();
  });

  it("keeps published submissions reachable, because unpublishing is this page's job too", () => {
    renderQueue([submission(), submission({ id: "p-2", slug: "lamp", published: true })]);

    expect(screen.getByText("Show 1 already published")).toBeInTheDocument();
  });
});
