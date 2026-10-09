import { AdminActions } from "./AdminActions";
import { useChatLauncher } from "../ChatLauncherContext";
import { render, screen, userEvent, within } from "../../../test/utils/render";

/**
 * The overview's **Quick actions** (admin sections spec 2026-10-07): Print QR
 * labels first, Log finished work, Add equipment and All tools, each for the
 * role its page allows. Refresh catalog moved to Settings › General.
 */

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return (
    <output data-testid="chat-probe">
      {isOpen ? "open" : "closed"}|{pendingSeed?.text ?? ""}
    </output>
  );
}

// en.json: nav.addEquipment = "ADD EQUIPMENT", admin.actionsLabel = "Admin actions".
describe("AdminActions", () => {
  it.each(["admin", "super_admin"] as const)("offers %s every quick action, Print QR labels first", (role) => {
    render(<AdminActions role={role} />);

    const row = screen.getByRole("group", { name: "Admin actions" });
    const links = within(row).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "/admin/inventory/qr");
    expect(links[0]).toHaveTextContent("Print QR labels");
    expect(within(row).getByRole("link", { name: "Log finished work" })).toHaveAttribute("href", "/admin/maintenance#log-completed");
    expect(within(row).getByRole("link", { name: "All tools" })).toHaveAttribute("href", "/admin/inventory");
    expect(within(row).getByRole("button", { name: "ADD EQUIPMENT" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Refresh catalog" })).not.toBeInTheDocument();
  });

  it.each(["user", "anonymous"] as const)("renders nothing for %s", (role) => {
    const { container } = render(<AdminActions role={role} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the chat with the same add-equipment seed the profile menu uses", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AdminActions role="admin" />
        <ChatProbe />
      </>
    );

    await user.click(screen.getByRole("button", { name: "ADD EQUIPMENT" }));

    expect(screen.getByTestId("chat-probe")).toHaveTextContent("open|I'd like to add new equipment to the inventory.");
  });
});
