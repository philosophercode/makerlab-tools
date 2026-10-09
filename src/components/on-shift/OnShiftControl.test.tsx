import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import type { SetShiftAction } from "../../app/account/shift-result";
import { OnShiftControl, type OnShiftControlProps } from "./OnShiftControl";

/**
 * The "On shift" control (on-shift spec 2026-10-07 §6): go on shift until a
 * time (the end of today by default), change it, end it now; a refusal says
 * why and keeps the time; a placeholder name is flagged with a link to fix it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const TZ = "America/New_York";
const IN_FUTURE = new Date(Date.now() + 3 * 3_600_000).toISOString();

function setup(overrides: Partial<OnShiftControlProps> = {}) {
  const action = vi.fn<SetShiftAction>();
  render(<OnShiftControl endsAt={null} shownAs="Alex M." timeZone={TZ} nameHref="/account" action={action} {...overrides} />);
  return { action, user: userEvent.setup() };
}

it("starts off shift with the end of today filled in, and says how students will see you", () => {
  setup();
  expect(screen.getByRole("status")).toHaveTextContent("You're not on shift.");
  expect(screen.getByLabelText("Until (today, lab time)")).toHaveValue("23:59");
  expect(screen.getByText("Students see you as: Alex M.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "End shift now" })).toBeNull();
});

it("goes on shift until the time picked, and then offers to change or end it", async () => {
  const { action, user } = setup();
  action.mockResolvedValueOnce({ ok: true, endsAt: IN_FUTURE });
  const until = screen.getByLabelText("Until (today, lab time)");
  await user.clear(until);
  await user.type(until, "18:00");
  await user.click(screen.getByRole("button", { name: "Go on shift" }));

  expect(action).toHaveBeenCalledWith({ onShift: true, until: "18:00" });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^You're on shift until/));
  expect(screen.getByRole("button", { name: "Change end time" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "End shift now" })).toBeInTheDocument();
});

it("shows a shift already set with its end time, and ends it", async () => {
  const { action, user } = setup({ endsAt: IN_FUTURE });
  expect(screen.getByRole("status")).toHaveTextContent(/^You're on shift until/);
  action.mockResolvedValueOnce({ ok: true, endsAt: null });
  await user.click(screen.getByRole("button", { name: "End shift now" }));

  expect(action).toHaveBeenCalledWith({ onShift: false });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("You're not on shift."));
  expect(screen.getByLabelText("Until (today, lab time)")).toHaveValue("23:59");
});

it("reads a shift that has already ended as off shift", () => {
  setup({ endsAt: new Date(Date.now() - 60_000).toISOString() });
  expect(screen.getByRole("status")).toHaveTextContent("You're not on shift.");
});

it("says why when the time has passed, and keeps the time typed", async () => {
  const { action, user } = setup();
  action.mockResolvedValueOnce({ ok: false, error: "shift_time_passed" });
  const until = screen.getByLabelText("Until (today, lab time)");
  await user.clear(until);
  await user.type(until, "08:00");
  await user.click(screen.getByRole("button", { name: "Go on shift" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("That time has already passed today. Pick a later time.");
  expect(until).toHaveValue("08:00");
  expect(screen.getByRole("status")).toHaveTextContent("You're not on shift.");
});

it("says the save failed when the action throws", async () => {
  const { action, user } = setup();
  action.mockRejectedValueOnce(new Error("network"));
  await user.click(screen.getByRole("button", { name: "Go on shift" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
});

it("warns that students cannot see somebody whose name is only their address, with a link to add one", () => {
  setup({ shownAs: null, nameHref: "/account" });
  expect(screen.getByText(/Students can't see you yet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Your account" })).toHaveAttribute("href", "/account");
});
