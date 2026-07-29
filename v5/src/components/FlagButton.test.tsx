import { render, screen, userEvent, waitFor } from "../../test/utils/render";
import { nextCacheMock } from "../../test/mocks/next-cache";
import { FlagButton } from "./FlagButton";

// Only for the FLAG_FIELDS drift check below — the capability module pulls in
// catalog.ts, which imports next/cache.
vi.mock("next/cache", () => nextCacheMock());

const TOOL_ID = "tool-form-4";

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

function created() {
  return mockFetch(async () => Response.json({ id: "flag-page-1" }, { status: 201 }));
}

function failed(status = 502, code = "write_failed") {
  return mockFetch(async () => Response.json({ code }, { status }));
}

async function openModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Report a correction" }));
  return screen.getByRole("dialog");
}

describe("FlagButton", () => {
  it("renders a quiet text trigger and no modal until it is clicked", () => {
    render(<FlagButton toolId={TOOL_ID} />);

    const trigger = screen.getByRole("button", { name: "Report a correction" });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a modal with the field select and every documented option", async () => {
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    const select = screen.getByLabelText("Which field is wrong?");
    expect(select).toHaveValue("description");
    expect(
      Array.from((select as HTMLSelectElement).options).map((option) => option.value)
    ).toEqual([
      "description",
      "image",
      "name",
      "category",
      "location",
      "materials",
      "safety_info",
    ]);
  });

  it("offers exactly the FLAG_FIELDS the capability accepts", async () => {
    const { FLAG_FIELDS } = await import("@/lib/capabilities/flags");
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    const select = screen.getByLabelText("Which field is wrong?") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      ...FLAG_FIELDS,
    ]);
  });

  it("pre-selects a field when one is passed in", async () => {
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} field="safety_info" />);
    await openModal(user);

    expect(screen.getByLabelText("Which field is wrong?")).toHaveValue("safety_info");
  });

  it("keeps submit disabled until a description exists", async () => {
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    const submit = screen.getByRole("button", { name: "Send report" });
    expect(submit).toBeDisabled();

    // Whitespace alone is not a description.
    await user.type(screen.getByLabelText("What's wrong?"), "   ");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("What's wrong?"), "Wrong room.");
    expect(submit).toBeEnabled();
  });

  it("posts the trimmed report to /api/flags", async () => {
    const fetchSpy = created();
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} field="location" />);
    await openModal(user);

    await user.type(screen.getByLabelText("What's wrong?"), "  It is in the Resin Bench.  ");
    await user.type(screen.getByLabelText("Your name (optional)"), "Ada");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/flags");
    expect(JSON.parse(init.body as string)).toEqual({
      tool_id: TOOL_ID,
      field_flagged: "location",
      issue_description: "It is in the Resin Bench.",
      reporter: "Ada",
    });
  });

  it("replaces the form with an inline confirmation that promises no reply", async () => {
    created();
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    await user.type(screen.getByLabelText("What's wrong?"), "Wrong room.");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByText("Report sent")).toBeInTheDocument();
    expect(screen.queryByLabelText("What's wrong?")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send report" })).not.toBeInTheDocument();
    expect(screen.getByText(/staff will review this/i)).toBeInTheDocument();
  });

  it("keeps what was typed when the submission fails", async () => {
    failed();
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    await user.type(screen.getByLabelText("What's wrong?"), "Wrong room.");
    await user.type(screen.getByLabelText("What should it say? (optional)"), "Resin Bench");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The report didn't send. Your text is still here — try again."
    );
    expect(screen.getByLabelText("What's wrong?")).toHaveValue("Wrong room.");
    expect(screen.getByLabelText("What should it say? (optional)")).toHaveValue(
      "Resin Bench"
    );
  });

  it("tells the reporter when to retry after a 429", async () => {
    failed(429, "rate_limited");
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    await user.type(screen.getByLabelText("What's wrong?"), "Wrong room.");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many reports from this device. Try again in an hour."
    );
  });

  it("surfaces a network failure without losing the report", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    await user.type(screen.getByLabelText("What's wrong?"), "Wrong room.");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("What's wrong?")).toHaveValue("Wrong room.");
  });

  // Spec §10, "cases that would embarrass us": flag text rendered unescaped.
  it("never renders flag text as HTML", async () => {
    created();
    const user = userEvent.setup();
    const { container } = render(<FlagButton toolId={TOOL_ID} />);
    await openModal(user);

    const payload = "<img src=x onerror=alert(1)><b>bold</b>";
    const description = screen.getByLabelText("What's wrong?");
    await user.type(description, payload);

    expect(description).toHaveValue(payload);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("bold")).not.toBeInTheDocument();

    // ...and it is not echoed into the confirmation either.
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText("Report sent");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("closes on Cancel and on Escape", async () => {
    const user = userEvent.setup();
    render(<FlagButton toolId={TOOL_ID} />);

    await openModal(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openModal(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
