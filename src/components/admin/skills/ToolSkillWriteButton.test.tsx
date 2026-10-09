const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => "/admin/inventory/form-4/skill" }));

import { render, screen, userEvent } from "../../../../test/utils/render";
import { SkillWritingControl } from "./SkillWritingControl";
import { ToolSkillWriteButton } from "./ToolSkillWriteButton";

/**
 * The skill page's Write / Rewrite button and the AI agents page's Turn on /
 * Turn off (tool skills spec 2026-10-07 §6): each sends its action and says
 * what happened in place.
 */

beforeEach(() => refresh.mockClear());

describe("ToolSkillWriteButton", () => {
  it("says Write skill for a tool with none, Rewrite skill for one with a skill", () => {
    const { unmount } = render(<ToolSkillWriteButton toolId="t1" hasSkill={false} latestVersion={null} write={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Write skill" })).toBeInTheDocument();
    unmount();
    render(<ToolSkillWriteButton toolId="t1" hasSkill latestVersion={2} write={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Rewrite skill" })).toBeInTheDocument();
  });

  it("starts the run for its tool, then says the skill is being written and waits", async () => {
    const write = vi.fn(async () => ({ ok: true as const }));
    render(<ToolSkillWriteButton toolId="t1" hasSkill={false} latestVersion={null} write={write} />);
    await userEvent.click(screen.getByRole("button", { name: "Write skill" }));
    expect(write).toHaveBeenCalledWith({ toolId: "t1" });
    expect(await screen.findByText("Writing. The skill appears here in a minute or two.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Write skill|Started/ })).toBeDisabled();
  });

  it("shows a refusal in place, from the shared admin errors", async () => {
    const write = vi.fn(async () => ({ ok: false as const, error: "skill_daily_limit" as const }));
    render(<ToolSkillWriteButton toolId="t1" hasSkill latestVersion={1} write={write} />);
    await userEvent.click(screen.getByRole("button", { name: "Rewrite skill" }));
    expect(await screen.findByText("The lab has written today's limit of tool skills. More can be written over the next 24 hours.")).toBeInTheDocument();
    expect(screen.queryByText(/Writing\./)).not.toBeInTheDocument();
  });
});

describe("SkillWritingControl", () => {
  it("flips the setting and refreshes the page", async () => {
    const set = vi.fn(async () => ({ ok: true as const }));
    render(<SkillWritingControl on={false} set={set} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(set).toHaveBeenCalledWith({ afterResearch: true });
    expect(refresh).toHaveBeenCalled();
  });

  it("offers Turn off when it is on, and shows a refusal", async () => {
    const set = vi.fn(async () => ({ ok: false as const, error: "not_permitted" as const }));
    render(<SkillWritingControl on set={set} />);
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(set).toHaveBeenCalledWith({ afterResearch: false });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
