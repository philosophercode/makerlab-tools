import { render, screen, userEvent, waitFor } from "../../../../test/utils/render";
import { EditToolControl } from "./EditToolControl";
import type { ToolEditorActions } from "../../../components/admin/tool-editor-actions";
import type { ClientIdentity } from "../../../lib/auth/sign-in-client";

// `fetchIdentity`'s own behaviour is covered in `lib/auth/sign-in-client.test.ts`;
// here it is the seam that decides whether the control exists at all.
const fetchIdentity = vi.fn<() => Promise<ClientIdentity | null>>(async () => null);
vi.mock("../../../lib/auth/sign-in-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/sign-in-client")>();
  return { ...actual, fetchIdentity: () => fetchIdentity() };
});

/**
 * Edit mode on a tool's own page (spec §5.3(b)).
 *
 * **The control asks who is calling after mount**, which is what keeps the tool
 * page cached for everybody else — the same contract `AdminLink` has. So the
 * states worth pinning are the three where nothing should appear: nobody signed
 * in, nobody answered yet, and a signed-in student.
 */

const ACTIONS = {
  load: vi.fn(async () => ({ ok: false as const, error: "not_found" as const })),
} as unknown as ToolEditorActions;

function renderControl() {
  render(<EditToolControl slug="form-4" toolName="Form 4" actions={ACTIONS} />);
}

function editButton() {
  return screen.queryByRole("button", { name: "Edit this tool" });
}

beforeEach(() => {
  fetchIdentity.mockReset();
  fetchIdentity.mockResolvedValue(null);
});

it("shows nothing to an anonymous visitor", async () => {
  fetchIdentity.mockResolvedValue({ role: "anonymous", name: null });
  renderControl();

  await waitFor(() => expect(fetchIdentity).toHaveBeenCalled());
  expect(editButton()).not.toBeInTheDocument();
});

it("shows nothing while the answer is still outstanding", () => {
  // A control that flashes into existence and back out is worse than one that
  // arrives a moment late.
  fetchIdentity.mockReturnValue(new Promise(() => {}));
  renderControl();
  expect(editButton()).not.toBeInTheDocument();
});

it("shows nothing when the identity could not be asked", async () => {
  // A 429 from the identity tier, or lab wifi. No evidence is not a permission.
  fetchIdentity.mockResolvedValue(null);
  renderControl();

  await waitFor(() => expect(fetchIdentity).toHaveBeenCalled());
  expect(editButton()).not.toBeInTheDocument();
});

it("shows nothing to a signed-in student", async () => {
  fetchIdentity.mockResolvedValue({ role: "user", name: "Ada" });
  renderControl();

  await waitFor(() => expect(fetchIdentity).toHaveBeenCalled());
  expect(editButton()).not.toBeInTheDocument();
});

it("offers the editor to a SuperMaker, as a full-screen sheet", async () => {
  fetchIdentity.mockResolvedValue({ role: "admin", name: "Luis" });
  renderControl();

  const button = await screen.findByRole("button", { name: "Edit this tool" });
  await userEvent.click(button);

  // The panel opens on the slug, and reads for itself rather than trusting
  // anything the cached page rendered.
  await waitFor(() => expect(ACTIONS.load).toHaveBeenCalledWith("form-4"));
  expect(screen.getByRole("complementary").className).toContain("is-sheet");
});
