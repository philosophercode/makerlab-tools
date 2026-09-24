import { AdminActions } from "./AdminActions";
import { useChatLauncher } from "../ChatLauncherContext";
import { render, screen, userEvent } from "../../../test/utils/render";

/**
 * The `/admin` action row: Add equipment (`tools.add`) and Refresh catalog
 * (`tools.edit`), moved from the header on 2026-09-23. RefreshCatalogButton's
 * own behaviour is in RefreshCatalogButton.test.tsx.
 */

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return (
    <output data-testid="chat-probe">
      {isOpen ? "open" : "closed"}|{pendingSeed?.text ?? ""}
    </output>
  );
}

// en.json: nav.addEquipment = "ADD EQUIPMENT", catalogRefresh.action = "REFRESH",
// admin.actionsLabel = "Admin actions".
describe("AdminActions", () => {
  it.each(["admin", "super_admin"] as const)("offers %s both actions", (role) => {
    render(<AdminActions role={role} />);

    const row = screen.getByRole("group", { name: "Admin actions" });
    expect(row).toContainElement(screen.getByRole("button", { name: "ADD EQUIPMENT" }));
    expect(row).toContainElement(screen.getByRole("button", { name: /Refresh the/ }));
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

    expect(screen.getByTestId("chat-probe")).toHaveTextContent(
      "open|I'd like to add new equipment to the inventory."
    );
  });

  it("shows the refresh confirmation in the row", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as unknown as Response);
    render(<AdminActions role="admin" />);

    await user.click(screen.getByRole("button", { name: /Refresh the/ }));

    expect(
      screen.getByRole("group", { name: "Admin actions" })
    ).toContainElement(await screen.findByText("Catalog refreshed"));
  });
});
