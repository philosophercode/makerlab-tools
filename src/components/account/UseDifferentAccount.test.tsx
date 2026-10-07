/**
 * "Use a different Google account" (auth spec amendment 2026-10-07): signs this
 * browser out first, then restarts Google sign-in back to where the refused
 * sign-in started. The server always asks Google for its account chooser, so
 * the order of the two requests is the whole of the client's job.
 */
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { render, screen, userEvent } from "../../../test/utils/render";
import { UseDifferentAccount } from "./UseDifferentAccount";

const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UseDifferentAccount", () => {
  it("signs out, then starts Google sign-in back to the page the refused sign-in began on", async () => {
    const calls: string[] = [];
    let signInBody: unknown = null;
    server.use(
      http.post("*/api/auth/sign-out", () => {
        calls.push("sign-out");
        return HttpResponse.json({ success: true });
      }),
      http.post("*/api/auth/sign-in/social", async ({ request }) => {
        calls.push("sign-in");
        signInBody = await request.json();
        return HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?prompt=select_account" });
      })
    );

    render(<UseDifferentAccount retryPath="/tools/form-4" />);
    await userEvent.click(screen.getByRole("button", { name: "Use a different Google account" }));

    await vi.waitFor(() => expect(assign).toHaveBeenCalled());
    expect(calls).toEqual(["sign-out", "sign-in"]);
    expect(signInBody).toEqual({ provider: "google", callbackURL: "/tools/form-4" });
    expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?prompt=select_account");
  });

  it("still restarts sign-in when there was nothing to sign out of", async () => {
    server.use(
      http.post("*/api/auth/sign-out", () => HttpResponse.json({ message: "no session" }, { status: 400 })),
      http.post("*/api/auth/sign-in/social", () => HttpResponse.json({ url: "https://accounts.google.com/x" }))
    );

    render(<UseDifferentAccount retryPath="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Use a different Google account" }));

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/x"));
  });

  it("says so when sign-in is not set up here, and lets the person try again", async () => {
    server.use(
      http.post("*/api/auth/sign-out", () => HttpResponse.json({ success: true })),
      http.post("*/api/auth/sign-in/social", () => HttpResponse.json({ error: "x" }, { status: 503 }))
    );

    render(<UseDifferentAccount retryPath="/" />);
    const button = screen.getByRole("button", { name: "Use a different Google account" });
    await userEvent.click(button);

    expect(await screen.findByText("Sign-in isn't set up on this deployment.")).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("says so when the request fails", async () => {
    server.use(
      http.post("*/api/auth/sign-out", () => HttpResponse.json({ success: true })),
      http.post("*/api/auth/sign-in/social", () => HttpResponse.json({ error: "x" }, { status: 500 }))
    );

    render(<UseDifferentAccount retryPath="/" />);
    await userEvent.click(screen.getByRole("button", { name: "Use a different Google account" }));

    expect(await screen.findByText("Couldn't start Google sign-in. Try again.")).toBeInTheDocument();
  });
});
