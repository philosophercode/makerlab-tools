import { render, screen } from "../../../test/utils/render";
import { UnsubscribeView } from "./UnsubscribeView";

/**
 * The unsubscribe page's states (email notifications spec §6, §10
 * component): confirm (with a plain form POST, so it works before hydration),
 * done, invalid link, a failed save, and too many tries.
 */

describe("UnsubscribeView", () => {
  it("confirms what will stop and posts the token to the one-click route", () => {
    const { container } = render(<UnsubscribeView state={{ kind: "confirm", stops: "ticketFiled", token: "v1.a+b.c" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Turn off these emails?" })).toBeInTheDocument();
    expect(screen.getByText(/each time someone reports a problem with a machine/)).toBeInTheDocument();

    const form = container.querySelector("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/api/notifications/unsubscribe?t=v1.a%2Bb.c");
    expect(container.querySelector('input[name="from"]')?.getAttribute("value")).toBe("page");
    expect(screen.getByRole("button", { name: "Turn off" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("link", { name: "Keep getting them" })).toHaveAttribute("href", "/");
  });

  it("names the morning reminder when that is the email", () => {
    render(<UnsubscribeView state={{ kind: "confirm", stops: "maintenanceDue", token: "t" }} />);
    expect(screen.getByText(/morning reminder of recurring maintenance/)).toBeInTheDocument();
  });

  it("says a failed save failed, and offers the button again", () => {
    render(<UnsubscribeView state={{ kind: "confirm", stops: "ticketFiled", token: "t", failed: true }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("That didn't save.");
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });

  it("confirms it is done, with no button left to press", () => {
    render(<UnsubscribeView state={{ kind: "done", stops: "maintenanceDue" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Turned off" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You won't get the morning maintenance reminder.");
    expect(screen.queryByRole("button", { name: "Turn off" })).toBeNull();
  });

  it("says an invalid link changed nothing", () => {
    render(<UnsubscribeView state={{ kind: "invalid" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "This link doesn't work" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to MakerLAB Tools" })).toHaveAttribute("href", "/");
  });

  it("asks a rate-limited reader to wait", () => {
    render(<UnsubscribeView state={{ kind: "rate_limited" }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Too many tries" })).toBeInTheDocument();
  });
});
