import { render, screen, userEvent } from "../../../test/utils/render";
import { useChatLauncher } from "../ChatLauncherContext";
import { AddInventoryButton } from "./AddInventoryButton";
import { ImportListAction } from "./ImportListAction";

/**
 * Two page actions from the 2026-09-25 admin polish: **Add inventory** on
 * `/admin/inventory` (the same chat flow as Add equipment) and **Import a
 * list** on Intake (importing is part of Intake, not a surface of its own).
 */

const pathname = vi.hoisted(() => ({ value: "/admin/intake" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return (
    <output data-testid="chat-probe">
      {isOpen ? "open" : "closed"}|{pendingSeed?.text ?? ""}
    </output>
  );
}

describe("AddInventoryButton", () => {
  it("opens the chat with the add-equipment seed, like the header's Add equipment", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AddInventoryButton role="admin" />
        <ChatProbe />
      </>
    );
    await user.click(screen.getByRole("button", { name: "Add inventory" }));
    expect(screen.getByTestId("chat-probe")).toHaveTextContent("open|I'd like to add new equipment to the inventory.");
  });

  it.each(["user", "anonymous"] as const)("is not offered to %s", (role) => {
    const { container } = render(<AddInventoryButton role={role} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ImportListAction", () => {
  it("links to the import page from Intake's other tabs", () => {
    pathname.value = "/admin/intake/imports";
    render(<ImportListAction href="/admin/intake/imports/new" />);
    expect(screen.getByRole("link", { name: "Import a list" })).toHaveAttribute("href", "/admin/intake/imports/new");
  });

  it("is not offered on the import page itself", () => {
    pathname.value = "/admin/intake/imports/new/";
    const { container } = render(<ImportListAction href="/admin/intake/imports/new" />);
    expect(container).toBeEmptyDOMElement();
  });
});
