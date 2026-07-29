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

import { ProjectSubmitForm } from "./ProjectSubmitForm";

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
  await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Write-up (Markdown supported)"), body);
}

function submitButton() {
  return screen.getByRole("button", { name: "Submit project" });
}

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
    await user.type(screen.getByLabelText("Your name"), "Ada Lovelace");
    await user.type(
      screen.getByLabelText("Write-up (Markdown supported)"),
      "   "
    );
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Title, your name, and a write-up are required."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the student on the form when validation fails", async () => {
    const user = userEvent.setup();
    stubFetch(async () => jsonResponse({ id: "p1" }, 201));
    render(<ProjectSubmitForm tools={TOOLS} />);

    await user.type(screen.getByLabelText("Project title"), "Plywood lamp");
    await user.type(screen.getByLabelText("Your name"), "  ");
    await user.type(
      screen.getByLabelText("Write-up (Markdown supported)"),
      "A write-up."
    );
    await user.click(submitButton());

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Project title")).toHaveValue("Plywood lamp");
    expect(
      screen.getByLabelText("Write-up (Markdown supported)")
    ).toHaveValue("A write-up.");
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
      author: "Ada Lovelace",
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
    expect(screen.getByLabelText("Your name")).toHaveValue("Ada Lovelace");
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

  it("uploads an image and includes its file_upload id in the submission", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async (url) =>
      url === "/api/upload-notion"
        ? jsonResponse({ file_upload_id: "fu_1", name: "lamp.png" })
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
    expect(lastSubmitBody(fetchMock).photos).toEqual([
      { id: "fu_1", name: "lamp.png" },
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

    pending.resolve(jsonResponse({ file_upload_id: "fu_1", name: "lamp.png" }));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByText("Uploading photos…")).toBeNull();
  });

  it("lets a student remove an uploaded photo before submitting", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(async (url) =>
      url === "/api/upload-notion"
        ? jsonResponse({ file_upload_id: "fu_1", name: "lamp.png" })
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
