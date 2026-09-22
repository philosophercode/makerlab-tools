import { render, screen, userEvent, waitFor } from "../../test/utils/render";

// next/link needs no router context once mocked to a plain anchor.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The form asks `/api/identity` who is submitting after mount, exactly as the
// header does. Mock the one network-touching helper — the pure `isSignedIn`
// stays real, since what the form does with the answer is the thing under test.
// `fetchIdentity`'s own behaviour is covered in `lib/auth/sign-in-client.test.ts`.
const fetchIdentity = vi.fn<() => Promise<ClientIdentity | null>>(async () => null);

vi.mock("../lib/auth/sign-in-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/sign-in-client")>();
  return { ...actual, fetchIdentity: () => fetchIdentity() };
});

import { ProjectSubmitForm } from "./ProjectSubmitForm";
import type { ClientIdentity } from "../lib/auth/sign-in-client";

// ── Helpers ─────────────────────────────────────────────────────────

const TOOLS = [
  { id: "tool-form-4", name: "Form 4" },
  { id: "tool-trotec-speedy-400", name: "Trotec Speedy 400" },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A promise plus its resolver, for asserting the in-flight UI state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function lastSubmitBody(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls.find(([url]) => url === "/api/projects");
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

async function fillRequired(
  user: ReturnType<typeof userEvent.setup>,
  { body = "Cut on the laser, then glued." } = {}
) {
  await user.type(screen.getByLabelText("Project title"), "Plywood lamp");
  await user.type(screen.getByLabelText("Write-up (Markdown supported)"), body);
}

function submitButton() {
  return screen.getByRole("button", { name: "Submit project" });
}

const SIGNED_IN: ClientIdentity = { role: "user", name: "Ada Lovelace" };

beforeEach(() => {
  fetchIdentity.mockClear();
  // Signed in by default: since Phase 4 submitting requires an account (spec
  // §5.5), so a signed-in visitor is what every test about *the form* needs.
  // The anonymous path renders the sign-in prompt instead and has its own
  // describe below.
  fetchIdentity.mockResolvedValue(SIGNED_IN);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Validation ──────────────────────────────────────────────────────

describe("ProjectSubmitForm validation", () => {
  it("refuses to submit a whitespace-only write-up and never calls the API", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async () => jsonResponse({ id: "p1" }, 201));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.type(screen.getByLabelText("Project title"), "Plywood lamp");
    await user.type(
      screen.getByLabelText("Write-up (Markdown supported)"),
      "   "
    );
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A title and a write-up are required."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the student on the form when validation fails", async () => {
    const user = userEvent.setup();
    stubFetch(async () => jsonResponse({ id: "p1" }, 201));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.type(screen.getByLabelText("Project title"), "  ");
    await user.type(
      screen.getByLabelText("Write-up (Markdown supported)"),
      "A write-up."
    );
    await user.click(submitButton());

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Project title")).toHaveValue("  ");
    expect(
      screen.getByLabelText("Write-up (Markdown supported)")
    ).toHaveValue("A write-up.");
  });
});

// ── Sign-in and the byline (spec §5.5) ──────────────────────────────

describe("ProjectSubmitForm — signing in is the gate", () => {
  it("shows the sign-in prompt instead of the form for an anonymous visitor", async () => {
    fetchIdentity.mockResolvedValue(null);
    render(<ProjectSubmitForm tools={TOOLS} />);

    expect(
      await screen.findByRole("heading", { name: "Sign in to share your project" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit project" })).toBeNull();
    // Browsing stays open — the prompt offers the gallery, not a dead end.
    expect(screen.getByRole("link", { name: "Browse projects" })).toHaveAttribute(
      "href",
      "/projects"
    );
  });

  it("names the institution from config rather than leaving the placeholder", async () => {
    fetchIdentity.mockResolvedValue(null);
    render(<ProjectSubmitForm tools={TOOLS} />);

    const body = await screen.findByText(/credited to your/);
    expect(body).toHaveTextContent("Cornell Tech");
    expect(body.textContent).not.toContain("{institution}");
  });

  it("treats an identity endpoint that cannot answer as anonymous", async () => {
    // A failed `/api/identity` used to mean "type your own name"; now it means
    // the form cannot know who is submitting, and the server would refuse the
    // post anyway. Showing the prompt is the honest answer (Article 4).
    fetchIdentity.mockResolvedValue(null);
    render(<ProjectSubmitForm tools={TOOLS} />);

    expect(
      await screen.findByRole("heading", { name: "Sign in to share your project" })
    ).toBeInTheDocument();
  });

  it("shows neither the form nor the prompt until the answer arrives", async () => {
    // The half-second where a signed-in student is told to sign in would be
    // the most annoying possible bug on this page.
    const pending = deferred<ClientIdentity | null>();
    fetchIdentity.mockReturnValue(pending.promise);
    render(<ProjectSubmitForm tools={TOOLS} />);

    expect(screen.queryByRole("heading", { name: "Sign in to share your project" })).toBeNull();
    expect(screen.getByRole("button", { name: "Submit project" })).toBeInTheDocument();

    pending.resolve(null);
    expect(
      await screen.findByRole("heading", { name: "Sign in to share your project" })
    ).toBeInTheDocument();
  });

  it("shows the byline it will use, and offers no field to change it", async () => {
    render(<ProjectSubmitForm tools={TOOLS} />);

    expect(
      await screen.findByText(/Your project will be credited to Ada Lovelace/)
    ).toBeInTheDocument();
    // The server writes the session name whatever is posted, so an input here
    // would be offering a choice that is not there.
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it("sends no author of its own — the byline is the server's to decide", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async () => jsonResponse({ id: "p1" }, 201));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await waitFor(() => expect(fetchIdentity).toHaveBeenCalled());
    await fillRequired(user);
    await user.click(submitButton());

    await screen.findByRole("heading", {
      name: "Thanks — your project is pending review",
    });
    const body = lastSubmitBody(fetchMock);
    expect(body).not.toHaveProperty("author");
    expect(body).not.toHaveProperty("author_email");
  });

  it("still submits for a signed-in account Google gave no name for", async () => {
    fetchIdentity.mockResolvedValue({ role: "user", name: null });
    const user = userEvent.setup();
    const fetchMock = stubFetch(async () => jsonResponse({ id: "p1" }, 201));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await waitFor(() => expect(fetchIdentity).toHaveBeenCalled());
    // No byline note — there is no name to promise — but the form is there.
    expect(screen.queryByText(/will be credited to/)).toBeNull();
    await fillRequired(user);
    await user.click(submitButton());

    await screen.findByRole("heading", {
      name: "Thanks — your project is pending review",
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});


// ── Successful submission ───────────────────────────────────────────

describe("ProjectSubmitForm submission", () => {
  it("posts the trimmed submission and shows the pending-review confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async () =>
      jsonResponse({ id: "created-project-1" }, 201)
    );
    render(<ProjectSubmitForm tools={TOOLS} />);

    await fillRequired(user);
    await user.type(
      screen.getByLabelText("Materials (optional)"),
      "Plywood, PLA ,"
    );
    await user.type(
      screen.getByLabelText("Link (optional)"),
      "https://example.com/lamp"
    );
    await user.click(screen.getByRole("button", { name: "Form 4" }));
    await user.click(submitButton());

    expect(
      await screen.findByRole("heading", {
        name: "Thanks — your project is pending review",
      })
    ).toBeInTheDocument();
    // The student is told plainly that staff must publish it.
    expect(
      screen.getByText(
        "A staff member will review your submission and publish it to the gallery soon."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to gallery" })).toHaveAttribute(
      "href",
      "/projects"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({ method: "POST" })
    );
    expect(lastSubmitBody(fetchMock)).toEqual({
      title: "Plywood lamp",
      body: "Cut on the laser, then glued.",
      link: "https://example.com/lamp",
      tools: ["tool-form-4"],
      materials: ["Plywood", "PLA"],
      photos: [],
    });
  });

  it("never sends a published flag of its own", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async () => jsonResponse({ id: "p1" }, 201));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await fillRequired(user);
    await user.click(submitButton());

    await screen.findByRole("heading", {
      name: "Thanks — your project is pending review",
    });
    expect(lastSubmitBody(fetchMock)).not.toHaveProperty("published");
  });

  it("disables the submit button while the request is in flight", async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    stubFetch(async () => pending.promise);
    render(<ProjectSubmitForm tools={TOOLS} />);

    await fillRequired(user);
    await user.click(submitButton());

    const submitting = await screen.findByRole("button", { name: "Submitting…" });
    expect(submitting).toBeDisabled();

    pending.resolve(jsonResponse({ id: "p1" }, 201));
    await screen.findByRole("heading", {
      name: "Thanks — your project is pending review",
    });
  });
});

// ── Failure preserves the write-up ──────────────────────────────────

describe("ProjectSubmitForm failure handling", () => {
  it("surfaces the API error and preserves everything the student typed", async () => {
    const user = userEvent.setup();
    stubFetch(async () =>
      jsonResponse({ error: "Link must be a valid http(s) URL." }, 400)
    );
    render(<ProjectSubmitForm tools={TOOLS} />);

    await fillRequired(user, { body: "Two evenings of sanding." });
    await user.type(
      screen.getByLabelText("Link (optional)"),
      "https://example.com"
    );
    await user.click(screen.getByRole("button", { name: "Form 4" }));
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Link must be a valid http(s) URL."
    );
    // A failed submission must never lose the write-up.
    expect(screen.getByLabelText("Project title")).toHaveValue("Plywood lamp");
    expect(
      screen.getByLabelText("Write-up (Markdown supported)")
    ).toHaveValue("Two evenings of sanding.");
    expect(screen.getByLabelText("Link (optional)")).toHaveValue(
      "https://example.com"
    );
    expect(screen.getByRole("button", { name: "Form 4" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    // Still on the form, and the button is usable again for a retry.
    expect(submitButton()).toBeEnabled();
  });

  it("falls back to a generic message when the API returns no error body", async () => {
    const user = userEvent.setup();
    stubFetch(async () => new Response("gateway blew up", { status: 502 }));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await fillRequired(user);
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again."
    );
  });

  it("surfaces a network failure without losing the form", async () => {
    const user = userEvent.setup();
    stubFetch(async () => {
      throw new Error("Failed to fetch");
    });
    render(<ProjectSubmitForm tools={TOOLS} />);

    await fillRequired(user);
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Project title")).toHaveValue("Plywood lamp");
  });
});

// ── Photos ──────────────────────────────────────────────────────────

describe("ProjectSubmitForm photos", () => {
  function fileInput() {
    return document.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("uploads an image and includes its attachment id in the submission", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async (url) =>
      url === "/api/uploads"
        ? jsonResponse({ attachmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", previewUrl: null, name: "lamp.png" })
        : jsonResponse({ id: "p1" }, 201)
    );
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.upload(
      fileInput(),
      new File([new Uint8Array([1, 2, 3])], "lamp.png", { type: "image/png" })
    );

    expect(await screen.findByText("lamp.png")).toBeInTheDocument();

    await fillRequired(user);
    await user.click(submitButton());

    await screen.findByRole("heading", {
      name: "Thanks — your project is pending review",
    });
    // The id is an `attachments` row the submission claims, not a Notion handle.
    expect(lastSubmitBody(fetchMock).photos).toEqual([
      { id: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", name: "lamp.png" },
    ]);
  });

  it("disables submit and shows progress while a photo is uploading", async () => {
    const user = userEvent.setup();
    const pending = deferred<Response>();
    stubFetch(async () => pending.promise);
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.upload(
      fileInput(),
      new File([new Uint8Array([1])], "lamp.png", { type: "image/png" })
    );

    expect(await screen.findByText("Uploading photos…")).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();

    pending.resolve(
      jsonResponse({ attachmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", previewUrl: null, name: "lamp.png" })
    );
    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByText("Uploading photos…")).toBeNull();
  });

  it("lets a student remove an uploaded photo before submitting", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async (url) =>
      url === "/api/uploads"
        ? jsonResponse({ attachmentId: "3f2504e0-4f89-41d3-9a0c-0305e82c3303", previewUrl: null, name: "lamp.png" })
        : jsonResponse({ id: "p1" }, 201)
    );
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.upload(
      fileInput(),
      new File([new Uint8Array([1])], "lamp.png", { type: "image/png" })
    );
    await screen.findByText("lamp.png");
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("lamp.png")).toBeNull();

    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByRole("heading", {
      name: "Thanks — your project is pending review",
    });
    expect(lastSubmitBody(fetchMock).photos).toEqual([]);
  });

  it("rejects a non-image file client-side without calling the upload route", async () => {
    // `applyAccept: false` bypasses user-event's own accept="image/*" filter so
    // the component's own guard is what's under test (a real browser lets a
    // drag-dropped file past the accept hint too).
    const user = userEvent.setup({ applyAccept: false });
    const fetchMock = stubFetch(async () => jsonResponse({}, 200));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.upload(
      fileInput(),
      new File(["notes"], "notes.txt", { type: "text/plain" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only image files are supported."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says photo uploads are unavailable when no blob store is configured, and stays submittable", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async (url) =>
      url === "/api/uploads"
        ? jsonResponse({ code: "blob_not_configured" }, 503)
        : jsonResponse({ id: "p1", slug: "plywood-lamp" }, 201)
    );
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.upload(
      fileInput(),
      new File([new Uint8Array([1])], "lamp.png", { type: "image/png" })
    );

    // Translated, not the route's English prose (Article 6).
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Photo uploads are unavailable right now. You can still submit your project without photos."
    );

    // The write-up is the part worth keeping; the form must not be blocked.
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByRole("heading", {
      name: "Thanks — your project is pending review",
    });
    expect(lastSubmitBody(fetchMock).photos).toEqual([]);
  });

  it("surfaces an upload failure and adds no photo", async () => {
    const user = userEvent.setup();
    stubFetch(async () =>
      jsonResponse({ error: "File too large (max 18MB)" }, 400)
    );
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.upload(
      fileInput(),
      new File([new Uint8Array([1])], "huge.png", { type: "image/png" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "File too large (max 18MB)"
    );
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

// ── Tool picker + preview ───────────────────────────────────────────

describe("ProjectSubmitForm tool picker", () => {
  it("toggles a tool on and off", async () => {
    const user = userEvent.setup();
    stubFetch(async () => jsonResponse({ id: "p1" }, 201));
    render(<ProjectSubmitForm tools={TOOLS} />);

    const chip = screen.getByRole("button", { name: "Form 4" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("filters the tool list by the search box", async () => {
    const user = userEvent.setup();
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.type(screen.getByPlaceholderText("Search tools…"), "trotec");

    expect(
      screen.getByRole("button", { name: "Trotec Speedy 400" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Form 4" })).toBeNull();
  });

  it("previews the write-up as markdown without executing embedded HTML", async () => {
    const user = userEvent.setup();
    const globals = globalThis as unknown as { __formPwned?: boolean };
    delete globals.__formPwned;
    const { container } = render(<ProjectSubmitForm tools={TOOLS} />);

    await user.type(
      screen.getByLabelText("Write-up (Markdown supported)"),
      "# Lamp"
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Lamp" })
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Write-up (Markdown supported)"));
    await user.type(
      screen.getByLabelText("Write-up (Markdown supported)"),
      "<script>globalThis.__formPwned = true;</script>"
    );

    expect(container.querySelector(".project-preview script")).toBeNull();
    expect(globals.__formPwned).toBeUndefined();
  });
});
