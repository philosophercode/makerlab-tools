import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { DemoSignupForm } from "./DemoSignupForm";

/**
 * The demo sign-up form (demo pass spec 2026-10-07 §5.1, §6): mistakes said
 * beside each field before any request, the route's answers turned into the
 * thank-you or a plain reason, and the honeypot out of everyone's way.
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
  it("labels every field, marks the optional ones, and starts with consent unticked", () => {
    render(<DemoSignupForm days={14} />);
    // What signing up gives, with no pass or amount named (amendment "Sign up to learn more").
    expect(screen.getByText(/^Once you sign up, you can also try it on this device for 14 days, like a student here:/)).toBeInTheDocument();
    expect(screen.queryByText(/\$|demo pass/i)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Name/ })).toBeRequired();
    expect(screen.getByRole("combobox", { name: /^Role/ })).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Yes" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "You may contact me about MakerLAB AI." })).not.toBeChecked();
    // The honeypot is not something a person can reach.
    expect(screen.queryByRole("textbox", { name: "Leave this field empty" })).not.toBeInTheDocument();
  });

  it("says what is missing beside each field without sending anything, and focuses the first", async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    answer(201, {}, seen);
    render(<DemoSignupForm days={14} />);
    await user.type(screen.getByRole("textbox", { name: /^Email/ }), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    const name = screen.getByRole("textbox", { name: /^Name/ });
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Please fill this in.");
    expect(screen.getByRole("textbox", { name: /^Email/ })).toHaveAccessibleDescription(/Please enter a valid email address\./);
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the fields marked above.");
    expect(name).toHaveFocus();
    expect(seen).not.toHaveBeenCalled();
  });

  it("sends the answers and shows the thank-you with the pass's end, and no amount", async () => {
    const user = userEvent.setup();
    let sent: Record<string, unknown> = {};
    answer(201, { ok: true, status: "created", pass: { remainingUsd: 0.5, budgetUsd: 0.5, exhausted: false, expiresAt: ENDS, contactEmail: null } }, (body) => {
      sent = body as Record<string, unknown>;
    });
    render(<DemoSignupForm days={14} />);
    await fillRequired(user);
    await user.selectOptions(screen.getByRole("combobox", { name: /^Role/ }), "lab_manager");
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.click(screen.getByRole("checkbox", { name: "You may contact me about MakerLAB AI." }));
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    const heading = await screen.findByRole("heading", { name: "Thanks for signing up" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("You can try MakerLAB AI on this device until Oct 25, 2026.");
    expect(screen.getByRole("button", { name: "Ask the assistant" })).toBeInTheDocument();
    expect(sent).toMatchObject({ name: "Ada Lovelace", email: "ada@example.org", role: "lab_manager", runsMakerspace: "yes", consent: true, website: "" });
  });

  it("welcomes back a returning address, with the pass's end and no amount", async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, status: "existing", pass: { remainingUsd: 0.31, budgetUsd: 0.5, exhausted: false, expiresAt: ENDS, contactEmail: null } });
    render(<DemoSignupForm days={14} />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByText("Welcome back. You can try MakerLAB AI on this device again until Oct 25, 2026.")).toBeInTheDocument();
  });

  it("says when a pass for this address has ended, without offering the assistant", async () => {
    const user = userEvent.setup();
    answer(200, { ok: true, status: "expired", pass: null });
    render(<DemoSignupForm days={14} />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByText("The demo for this email has ended, but we have your details.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask the assistant" })).not.toBeInTheDocument();
  });

  it("explains a busy network and keeps what was typed", async () => {
    const user = userEvent.setup();
    answer(429, { ok: false, code: "rate_limited" });
    render(<DemoSignupForm days={14} />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Too many sign-ups from this network just now."));
    expect(screen.getByRole("textbox", { name: /^Name/ })).toHaveValue("Ada Lovelace");
  });

  it("shows the route's own refusals beside their fields", async () => {
    const user = userEvent.setup();
    answer(400, { ok: false, code: "invalid", fields: { institution: "tooLong" } });
    render(<DemoSignupForm days={14} />);
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Institution/ })).toHaveAccessibleDescription(/That is too long\./));
  });
});
