import { act, render, screen } from "../../../test/utils/render";
import { publishIdentity } from "../../lib/auth/identity-store";
import { DemoSignupNudgeClient } from "./DemoSignupNudgeClient";
import { resetSignupNudgeForTests, SIGNUP_NUDGE_DELAY_MS, SIGNUP_NUDGE_KEY, SIGNUP_NUDGE_SINCE_KEY } from "./signup-nudge-store";

/**
 * The sign-up notice (demo pass spec, amendment 2026-10-11): after a minute on
 * the site, on any public page, until dismissed, followed or signed up.
 */

const pathnameMock = vi.fn<() => string>(() => "/");
vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

const WORDS = {
  label: "MakerLAB AI for your makerspace",
  text: "Interested in bringing MakerLAB AI to your makerspace?",
  cta: "Sign up",
  dismiss: "Dismiss",
};

const notice = () => screen.queryByRole("complementary", { name: WORDS.label });

beforeEach(() => {
  vi.useFakeTimers();
  pathnameMock.mockReturnValue("/");
  resetSignupNudgeForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DemoSignupNudgeClient", () => {
  it("appears after a minute on the site, with the question and Sign up", () => {
    render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(SIGNUP_NUDGE_DELAY_MS - 1000));
    expect(notice()).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(notice()).toHaveTextContent(WORDS.text);
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/interest");
    // Announced without taking focus.
    expect(notice()?.parentElement).toHaveAttribute("aria-live", "polite");
    expect(document.activeElement).toBe(document.body);
  });

  it("counts the minute from the first page of the visit, not from this one", () => {
    window.sessionStorage.setItem(SIGNUP_NUDGE_SINCE_KEY, String(Date.now() - (SIGNUP_NUDGE_DELAY_MS - 5000)));
    render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(5000));
    expect(notice()).toBeInTheDocument();
  });

  it("stays dismissed, on this page and the next visit", () => {
    const { unmount } = render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(SIGNUP_NUDGE_DELAY_MS));
    act(() => screen.getByRole("button", { name: "Dismiss" }).click());
    expect(notice()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(SIGNUP_NUDGE_KEY)).toBe("dismissed");
    unmount();

    resetSignupNudgeForTests(); // a new page load: only storage remembers
    render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(SIGNUP_NUDGE_DELAY_MS * 2));
    expect(notice()).not.toBeInTheDocument();
  });

  it("following Sign up also puts it away for good", () => {
    render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(SIGNUP_NUDGE_DELAY_MS));
    const link = screen.getByRole("link", { name: "Sign up" });
    link.addEventListener("click", (event) => event.preventDefault());
    act(() => link.click());
    expect(window.localStorage.getItem(SIGNUP_NUDGE_KEY)).toBe("dismissed");
    expect(notice()).not.toBeInTheDocument();
  });

  it.each(["/interest", "/admin/users", "/kiosk", "/account/tokens", "/oauth/consent"])("is not drawn on %s", (path) => {
    pathnameMock.mockReturnValue(path);
    render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(SIGNUP_NUDGE_DELAY_MS));
    expect(notice()).not.toBeInTheDocument();
  });

  it("is not shown to a signed-in member", () => {
    publishIdentity({ role: "user", name: "Ada Lovelace", email: "ada@cornell.edu" });
    render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(SIGNUP_NUDGE_DELAY_MS));
    expect(notice()).not.toBeInTheDocument();
  });

  it("is never shown where storage cannot remember a dismissal", () => {
    const storage = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<DemoSignupNudgeClient {...WORDS} />);
    act(() => vi.advanceTimersByTime(SIGNUP_NUDGE_DELAY_MS));
    expect(notice()).not.toBeInTheDocument();
    storage.mockRestore();
  });
});
