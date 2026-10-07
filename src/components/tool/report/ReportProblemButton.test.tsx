import { render, screen, userEvent, waitFor } from "../../../../test/utils/render";
import { ReportProblemButton, type ReportUnit } from "./ReportProblemButton";

/**
 * The quick report form (quick report spec §6, §10): one box, an optional
 * photo, the unit preselected or chosen, and a plain confirmation with the
 * ticket's short reference. The route is stubbed at `fetch`; what it does is
 * `app/api/report/route.test.ts`.
 */

const UNITS: ReportUnit[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Prusa MK3S+ #1", status: "Available" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Prusa MK3S+ #2", status: "Offline" },
];

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function mockFetch(impl: FetchImpl) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

/** The JSON body of the `n`th call to `/api/report`. */
function reportBody(spy: ReturnType<typeof mockFetch>, n = 0): Record<string, unknown> {
  const calls = spy.mock.calls.filter(([url]) => String(url) === "/api/report");
  return JSON.parse(String(calls[n][1]?.body));
}

function renderButton(props: Partial<React.ComponentProps<typeof ReportProblemButton>> = {}) {
  return render(<ReportProblemButton toolSlug="prusa-mk3s" toolName="Prusa i3 MK3S+" units={UNITS} label="Report a problem" {...props} />);
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Report a problem" }));
  return screen.getByRole("dialog");
}

afterEach(() => vi.restoreAllMocks());

describe("ReportProblemButton", () => {
  it("opens one box, the unit choice and the photo, and nothing else to fill", async () => {
    const user = userEvent.setup();
    renderButton();
    const dialog = await openForm(user);

    expect(dialog).toHaveAccessibleName("Prusa i3 MK3S+");
    expect(screen.getByLabelText("Tell us what's wrong with this machine")).toHaveFocus();
    expect(screen.getByRole("group", { name: "Which unit?" })).toBeInTheDocument();
    // Both units and "Not sure", which is the default with no label scanned.
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "Not sure" })).toBeChecked();
    // A unit that is down says so.
    expect(screen.getByRole("radio", { name: /Prusa MK3S\+ #2/ })).toHaveAccessibleName(/Offline/);
    expect(screen.getByText("Add a photo")).toBeInTheDocument();
    // The only text inputs a person can reach are the box and the photo picker.
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
  });

  it("asks no unit when the tool has one", async () => {
    const user = userEvent.setup();
    const spy = mockFetch(async () => Response.json({ ref: "ABCD1234", unit: "Prusa MK3S+ #1" }, { status: 201 }));
    renderButton({ units: [UNITS[0]] });
    await openForm(user);

    expect(screen.queryByRole("group", { name: "Which unit?" })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Tell us what's wrong with this machine"), "Bed will not heat");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(reportBody(spy).unit_id).toBe(UNITS[0].id));
  });

  it("sends the words, the chosen unit, an empty trap and how long the form was open", async () => {
    const user = userEvent.setup();
    const spy = mockFetch(async () => Response.json({ ref: "3F2A9C1D", unit: "Prusa MK3S+ #2" }, { status: 201 }));
    renderButton();
    await openForm(user);

    await user.click(screen.getByRole("radio", { name: /Prusa MK3S\+ #2/ }));
    await user.type(screen.getByLabelText("Tell us what's wrong with this machine"), "  Filament stopped feeding. The extruder clicks.  ");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    await screen.findByText("Thanks. Your report is in.");
    const body = reportBody(spy);
    expect(body).toMatchObject({
      tool: "prusa-mk3s",
      unit_id: UNITS[1].id,
      text: "Filament stopped feeding. The extruder clicks.",
      photo_attachment_ids: [],
      website: "",
    });
    expect(typeof body.open_ms).toBe("number");
    // The plain confirmation: the short reference and where it landed.
    expect(screen.getByText("3F2A9C1D")).toBeInTheDocument();
    expect(screen.getByText("Filed for Prusa MK3S+ #2.")).toBeInTheDocument();
  });

  it("preselects the unit a scanned label named", async () => {
    const user = userEvent.setup();
    renderButton({ initialUnitId: UNITS[1].id });
    await openForm(user);
    expect(screen.getByRole("radio", { name: /Prusa MK3S\+ #2/ })).toBeChecked();
    expect(screen.getByText("Chosen from the label you scanned.")).toBeInTheDocument();
  });

  it("keeps what was typed after a failure, and says why in words", async () => {
    const user = userEvent.setup();
    mockFetch(async () => Response.json({ code: "rate_limited" }, { status: 429 }));
    renderButton();
    await openForm(user);

    await user.type(screen.getByLabelText("Tell us what's wrong with this machine"), "Laser will not fire");
    await user.click(screen.getByRole("button", { name: "Send report" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many reports from here in the last hour.");
    expect(screen.getByLabelText("Tell us what's wrong with this machine")).toHaveValue("Laser will not fire");

    // Closing after a failure keeps the draft too.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await openForm(user);
    expect(screen.getByLabelText("Tell us what's wrong with this machine")).toHaveValue("Laser will not fire");
  });

  it("resets after a report was sent", async () => {
    const user = userEvent.setup();
    mockFetch(async () => Response.json({ ref: "00AA11BB", unit: null }, { status: 201 }));
    renderButton();
    await openForm(user);
    await user.type(screen.getByLabelText("Tell us what's wrong with this machine"), "Smells like burning");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText("00AA11BB");
    expect(screen.queryByText(/Filed for/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    await openForm(user);
    expect(screen.getByLabelText("Tell us what's wrong with this machine")).toHaveValue("");
  });

  it("uploads the photo privately and sends its id", async () => {
    const user = userEvent.setup();
    const spy = mockFetch(async (url) =>
      String(url) === "/api/uploads"
        ? Response.json({ attachmentId: "33333333-3333-4333-8333-333333333333", name: "jam.jpg", previewUrl: null })
        : Response.json({ ref: "AAAA0000", unit: null }, { status: 201 })
    );
    renderButton();
    await openForm(user);

    const file = new File(["jpeg"], "jam.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Add a photo"), file);
    expect(await screen.findByText("jam.jpg")).toBeInTheDocument();
    const upload = spy.mock.calls.find(([url]) => String(url) === "/api/uploads");
    expect((upload?.[1]?.body as FormData).get("kind")).toBe("maintenance");

    await user.type(screen.getByLabelText("Tell us what's wrong with this machine"), "Nozzle jammed");
    await user.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText("AAAA0000");
    expect(reportBody(spy).photo_attachment_ids).toEqual(["33333333-3333-4333-8333-333333333333"]);
  });

  it("says photos are unavailable and still lets the report go", async () => {
    const user = userEvent.setup();
    mockFetch(async (url) =>
      String(url) === "/api/uploads"
        ? Response.json({ code: "blob_not_configured" }, { status: 503 })
        : Response.json({ ref: "BBBB1111", unit: null }, { status: 201 })
    );
    renderButton();
    await openForm(user);

    await user.upload(screen.getByLabelText("Add a photo"), new File(["x"], "a.png", { type: "image/png" }));
    expect(await screen.findByText("Photos can't be uploaded right now. You can still send the report.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Tell us what's wrong with this machine"), "Belt is loose");
    expect(screen.getByRole("button", { name: "Send report" })).toBeEnabled();
  });
});
