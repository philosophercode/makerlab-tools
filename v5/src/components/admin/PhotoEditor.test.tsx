import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { PhotoEditor } from "./PhotoEditor";
import type { EditorPhoto } from "../../lib/data/tool-editor";

/**
 * The Photos section (spec §5.3(3), §4.7).
 *
 * Two properties, and the second is a requirement of this phase: **position 0
 * is the cover**, and **with no Blob store the section says photos cannot be
 * added right now and stays usable for everything else** (Article 4).
 *
 * `fetch` is stubbed rather than reached — `POST /api/uploads` has its own
 * tests, and nothing here may touch the network.
 */

function photo(id: string, name: string): EditorPhoto {
  return { id, url: `https://blob.test/${name}.jpg`, originalFilename: `${name}.jpg` };
}

function stubUploads(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderEditor(photos: EditorPhoto[] = []) {
  const handlers = {
    onAttach: vi.fn(),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<PhotoEditor photos={photos} pending={false} {...handlers} />);
  return handlers;
}

/** A one-pixel file, since nothing here reads the bytes. */
function file(name: string) {
  return new File(["x"], name, { type: "image/jpeg" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("names what is missing when there are no photos (§6, States)", () => {
  renderEditor();
  expect(screen.getByText(/No photos/)).toBeInTheDocument();
});

it("marks the first photo as the cover, and only the first", () => {
  renderEditor([photo("a", "front"), photo("b", "back")]);
  expect(screen.getAllByText("Cover")).toHaveLength(1);
});

it("reorders by moving a photo, which is also how a cover is chosen", async () => {
  const handlers = renderEditor([photo("a", "front"), photo("b", "back")]);

  await userEvent.click(screen.getAllByRole("button", { name: "Move earlier" })[1]);

  expect(handlers.onReorder).toHaveBeenCalledWith(["b", "a"]);
});

it("cannot move the cover earlier or the last photo later", () => {
  renderEditor([photo("a", "front"), photo("b", "back")]);

  expect(screen.getAllByRole("button", { name: "Move earlier" })[0]).toBeDisabled();
  expect(screen.getAllByRole("button", { name: "Move later" })[1]).toBeDisabled();
});

it("uploads a chosen photo and hands the claim the id that came back", async () => {
  stubUploads(200, { attachmentId: "att-1", previewUrl: "https://blob.test/a.jpg" });
  const handlers = renderEditor();

  await userEvent.upload(screen.getByLabelText("Add photos"), file("front.jpg"));

  await waitFor(() => expect(handlers.onAttach).toHaveBeenCalledWith(["att-1"]));
});

it("says photos cannot be added when the deployment has no file storage", async () => {
  // `POST /api/uploads` answers 503 with no `BLOB_READ_WRITE_TOKEN`. The panel
  // must say so and stay usable — never invent an id (Article 4).
  stubUploads(503, { code: "blob_not_configured" });
  const handlers = renderEditor([photo("a", "front"), photo("b", "back")]);

  await userEvent.upload(screen.getByLabelText("Add photos"), file("front.jpg"));

  expect(
    await screen.findByText(/cannot be added right now/)
  ).toBeInTheDocument();
  expect(handlers.onAttach).not.toHaveBeenCalled();
  // Everything that touches only rows still works.
  expect(screen.getAllByRole("button", { name: "Remove" })[0]).toBeEnabled();
  expect(screen.getAllByRole("button", { name: "Move later" })[0]).toBeEnabled();
});

it("reports an upload that failed without claiming anything", async () => {
  stubUploads(502, { error: "Upload failed" });
  const handlers = renderEditor();

  await userEvent.upload(screen.getByLabelText("Add photos"), file("front.jpg"));

  expect(await screen.findByText(/did not finish/)).toBeInTheDocument();
  expect(handlers.onAttach).not.toHaveBeenCalled();
});
