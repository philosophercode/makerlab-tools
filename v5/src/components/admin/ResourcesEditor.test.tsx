import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { ResourcesEditor } from "./ResourcesEditor";
import type { EditorResource } from "../../lib/data/resources";

/**
 * The Resources section — manuals, SOPs and links (spec §5.3(3), §4.6).
 *
 * The two things worth pinning: it shows **unpublished** resources, which no
 * other surface does, and **the link half keeps working when there is nowhere
 * to put a PDF** (Article 4).
 */

function resource(overrides: Partial<EditorResource> = {}): EditorResource {
  return {
    id: "res-1",
    title: "Form 4 manual",
    type: "manual",
    url: "https://support.formlabs.com/form-4",
    notes: null,
    published: true,
    fileUrls: [],
    ...overrides,
  };
}

function stubUploads(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
    )
  );
}

function renderEditor(resources: EditorResource[] = []) {
  const handlers = {
    onAdd: vi.fn(),
    onTogglePublished: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<ResourcesEditor resources={resources} pending={false} {...handlers} />);
  return handlers;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("names what is missing when there is nothing to read (§6, States)", () => {
  renderEditor();
  expect(screen.getByText(/No manuals or links yet/)).toBeInTheDocument();
});

it("shows an unpublished resource and says it is hidden", () => {
  renderEditor([resource({ published: false })]);

  // The editor is the one place in the app that shows one — which is the point
  // of showing it: somebody came here to look at the manual they hid.
  expect(screen.getByText("Form 4 manual")).toBeInTheDocument();
  expect(screen.getByText("Hidden")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show" })).toBeInTheDocument();
});

it("hides a published resource without deleting it", async () => {
  const handlers = renderEditor([resource()]);

  await userEvent.click(screen.getByRole("button", { name: "Hide" }));

  expect(handlers.onTogglePublished).toHaveBeenCalledWith("res-1", false);
});

it("adds a link with no file, and asks for no upload", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const handlers = renderEditor();

  await userEvent.type(screen.getByLabelText("Title"), "Safety sheet");
  await userEvent.type(screen.getByLabelText("Link"), "https://example.edu/safety");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(handlers.onAdd).toHaveBeenCalledWith(
    { title: "Safety sheet", type: null, url: "https://example.edu/safety" },
    []
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("uploads a PDF first and adds the resource with the id that came back", async () => {
  stubUploads(200, { attachmentId: "att-9" });
  const handlers = renderEditor();

  await userEvent.type(screen.getByLabelText("Title"), "Form 4 manual");
  await userEvent.upload(
    screen.getByLabelText("PDF"),
    new File(["%PDF"], "manual.pdf", { type: "application/pdf" })
  );
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(handlers.onAdd).toHaveBeenCalledWith(
      { title: "Form 4 manual", type: null, url: null },
      ["att-9"]
    )
  );
});

it("adds nothing when the upload had nowhere to go, and says why", async () => {
  stubUploads(503, { code: "blob_not_configured" });
  const handlers = renderEditor();

  await userEvent.type(screen.getByLabelText("Title"), "Form 4 manual");
  await userEvent.upload(
    screen.getByLabelText("PDF"),
    new File(["%PDF"], "manual.pdf", { type: "application/pdf" })
  );
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  // A resource whose manual silently did not attach is the quiet lie Article 4
  // forbids, so nothing is created at all and the person keeps their typing.
  expect(await screen.findByText(/cannot be added right now/)).toBeInTheDocument();
  expect(handlers.onAdd).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Title")).toHaveValue("Form 4 manual");
});

it("removes a resource", async () => {
  const handlers = renderEditor([resource()]);

  await userEvent.click(screen.getByRole("button", { name: "Remove" }));

  expect(handlers.onRemove).toHaveBeenCalledWith("res-1");
});
