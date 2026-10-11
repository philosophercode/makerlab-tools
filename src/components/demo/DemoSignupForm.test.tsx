import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { DemoSignupForm } from "./DemoSignupForm";

/**
 * The sign-up form (demo pass spec 2026-10-07 §5.1, §6; amendment
 * 2026-10-11): mistakes said beside each field before any request, the
 * route's answers turned into the thank-you or a plain reason, the honeypot
 * out of everyone's way, and nothing on the form about a pass.
 */

const ENDS = "2026-10-25T15:00:00.000Z";

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: /^Name/ }), "Ada Lovelace");
  await user.type(screen.getByRole("textbox", { name: /^Email/ }), "ada@example.org");
  await user.type(screen.getByRole("textbox", { name: /^Institution or affiliation/ }), "Analytical Engines Lab");
}

function answer(status: number, body: Record<string, unknown>, seen?: (body: unknown) => void) {
  server.use(
    http.post(/\/api\/demo-pass$/, async ({ request }) => {
      seen?.(await request.json());
      return HttpResponse.json(body, { status });
    })
  );
}

describe("DemoSignupForm", () => {
  it("labels every field, marks the optional ones, and offers only Submit", () => {
    const { container } = render(<DemoSignupForm />);
    expect(screen.getByRole("textbox", { name: /^Name/ })).toBeRequired();
    expect(screen.getByRole("combobox", { name: /^Role/ })).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Yes" })).not.toBeChecked();
    // Being contacted is what the form is for: no consent box, and the privacy line says so.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/We use your details only to contact you about MakerLAB AI\./)).toBeInTheDocument();
    // Nothing leads away from a half-filled form, and nothing mentions a pass.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Submit"]);
    expect(container).not.toHaveTextContent(/pass/i);
    // The honeypot is not something a person can reach.
    expect(screen.queryByRole("textbox", { name: "Leave this field empty" })).not.toBeInTheDocument();
  });

  it("says what is missing beside each field without sending anything, and focuses the first", async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    answer(201, {}, seen);
    render(<DemoSignupForm />);
    await user.type(screen.getByRole("textbox", { name: /^Email/ }), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Submit" }));

    const name = screen.getByRole("textbox", { name: /^Name/ });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Please fill this in.");
    expect(screen.getByRole("textbox", { name: /^Email/ })).toHaveAccessibleDescription(/Please enter a valid email address\./);
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the fields marked above.");
    expect(name).toHaveFocus();
    expect(seen).not.toHaveBeenCalled();
  });

  it("sends the answers with consent, and thanks without mentioning a pass", async () => {
    const user = userEvent.setup();
    let sent: Record<string, unknown> = {};
    answer(201, { ok: true, status: "created", pass: { remainingUsd: 0.5, budgetUsd: 0.5, exhausted: false, expiresAt: ENDS, contactEmail: null } }, (body) => {
      sent = body as Record<string, unknown>;
    });
    render(<DemoSignupForm />);
    await fillRequired(user);
    await user.selectOptions(screen.getByRole("combobox", { name: /^Role/ }), "lab_manager");
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("button", { name: "Submit" }));

    const heading = await screen.findByRole("heading", { name: "Thank you" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("We'll be in touch about bringing MakerLAB AI to your makerspace.");
    expect(heading.closest("section")).not.toHaveTextContent(/pass/i);
    expect(screen.getByRole("button", { name: "Ask the assistant" })).toBeInTheDocument();
    expect(sent).toMatchObject({ name: "Ada Lovelace", email: "ada@example.org", role: "lab_manager", runsMakerspace: "yes", consent: true, website: "" });
  });

  it("tells a returning address that we already have its details", async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, status: "existing", pass: { remainingUsd: 0.31, budgetUsd: 0.5, exhausted: false, expiresAt: ENDS, contactEmail: null } });
    render(<DemoSignupForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("We already have your details, and we'll be in touch.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask the assistant" })).toBeInTheDocument();
  });

  it("thanks an address whose pass has ended the same way, without offering the assistant", async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, status: "expired", pass: null });
    render(<DemoSignupForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("We already have your details, and we'll be in touch.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask the assistant" })).not.toBeInTheDocument();
  });

  it("explains a busy network and keeps what was typed", async () => {
    const user = userEvent.setup();
    answer(429, { ok: false, code: "rate_limited" });
    render(<DemoSignupForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many sign-ups from this network just now."));
    expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("Ada Lovelace");
  });

  it("shows the route's own refusals beside their fields", async () => {
    const user = userEvent.setup();
    answer(400, { ok: false, code: "invalid", fields: { institution: "tooLong" } });
    render(<DemoSignupForm />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Institution/ })).toHaveAccessibleDescription(/That is too long\./));
  });
});
