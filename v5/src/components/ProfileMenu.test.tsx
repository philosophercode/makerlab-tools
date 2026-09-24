import { fireEvent } from "@testing-library/react";
import { ProfileMenu } from "./ProfileMenu";
import { useChatLauncher } from "./ChatLauncherContext";
import { render, screen, userEvent } from "../../test/utils/render";
import type { ClientIdentity } from "../lib/auth/sign-in-client";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Sign-out is the one network-touching helper the menu calls; the pure ones
// (`firstNameOf`) stay real. Its own behaviour is in sign-in-client.test.ts.
const signOutAndReload = vi.fn(async () => {});
vi.mock("../lib/auth/sign-in-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/sign-in-client")>();
  return { ...actual, signOutAndReload: () => signOutAndReload() };
});

/** Shows what the chat launcher was asked to do, so a test can read it. */
function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return (
    <output data-testid="chat-probe">
      {isOpen ? "open" : "closed"}|{pendingSeed?.text ?? ""}
    </output>
  );
}

const PHOTO = "https://lh3.googleusercontent.com/a/niti";

const NITI: ClientIdentity = {
  role: "admin",
  name: "Niti Parikh",
  email: "niti@cornell.edu",
  image: PHOTO,
};

function renderMenu(identity: ClientIdentity = NITI) {
  return render(
    <>
      <ProfileMenu identity={identity} />
      <button type="button">Elsewhere</button>
      <ChatProbe />
    </>
  );
}

const trigger = (name = "Signed in as Niti") => screen.getByRole("button", { name });

beforeEach(() => {
  signOutAndReload.mockClear();
});

// en.json: nav.signedInAria = "Signed in as {name}", nav.admin = "ADMIN",
// nav.addEquipment = "ADD EQUIPMENT", nav.signOut = "SIGN OUT",
// admin.roles.* = Student / SuperMaker / Director.
describe("ProfileMenu — the control", () => {
  it("shows the Google photo, square and without a referrer, beside the first name", () => {
    const { container } = renderMenu();

    const img = container.querySelector("img.profile-avatar");
    expect(img).toHaveAttribute("src", PHOTO);
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(img).toHaveAttribute("alt", "");
    expect(trigger()).toHaveTextContent("Niti");
    expect(trigger()).not.toHaveTextContent("Parikh");
  });

  it("falls back to the initial when the photo will not load", () => {
    const { container } = renderMenu();

    fireEvent.error(container.querySelector("img.profile-avatar")!);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("profile-avatar-initial")).toHaveTextContent("N");
  });

  it("shows the initial when Google supplied no photo", () => {
    const { container } = renderMenu({ ...NITI, image: undefined });

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("profile-avatar-initial")).toHaveTextContent("N");
  });

  it("is a closed menu button until pressed", () => {
    renderMenu();

    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("names itself without a first name when Google had none", () => {
    renderMenu({ role: "user", name: null, email: "anon@cornell.edu" });

    expect(trigger("Account menu")).toBeInTheDocument();
    // The initial falls back to the email's first letter.
    expect(screen.getByTestId("profile-avatar-initial")).toHaveTextContent("A");
  });
});

describe("ProfileMenu — the menu", () => {
  it("opens with the person's full name, email and role", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Account menu" })).toBeInTheDocument();
    expect(screen.getByText("Niti Parikh")).toBeInTheDocument();
    expect(screen.getByText("niti@cornell.edu")).toBeInTheDocument();
    expect(screen.getByText("SuperMaker")).toBeInTheDocument();
  });

  it.each([
    ["user", "Student", ["CONNECT AN AI ASSISTANT", "SIGN OUT"]],
    ["admin", "SuperMaker", ["ADMIN", "ADD EQUIPMENT", "CONNECT AN AI ASSISTANT", "SIGN OUT"]],
    ["super_admin", "Director", ["ADMIN", "ADD EQUIPMENT", "CONNECT AN AI ASSISTANT", "SIGN OUT"]],
  ] as const)("offers %s exactly the entries the role holds", async (role, label, expected) => {
    const user = userEvent.setup();
    renderMenu({ ...NITI, role });

    await user.click(trigger());

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(expected);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("links Admin to /admin", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());

    expect(screen.getByRole("menuitem", { name: "ADMIN" })).toHaveAttribute("href", "/admin");
  });

  it("signs out through the shared helper", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "SIGN OUT" }));

    expect(signOutAndReload).toHaveBeenCalledTimes(1);
  });

  it("opens the chat with the add-equipment seed, and closes itself", async () => {
    const user = userEvent.setup();
    renderMenu();

    expect(screen.getByTestId("chat-probe")).toHaveTextContent("closed|");
    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "ADD EQUIPMENT" }));

    expect(screen.getByTestId("chat-probe")).toHaveTextContent(
      "open|I'd like to add new equipment to the inventory."
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when the control is pressed again", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());
    await user.click(trigger());

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("ProfileMenu — dismissal and keyboard", () => {
  it("closes on Escape and returns focus to the control", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a click outside", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("stays open on a click inside the menu's header", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());
    await user.click(screen.getByText("niti@cornell.edu"));

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("focuses the first item on open, and arrows move through the items and wrap", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());
    const [admin, add, connect, signOut] = screen.getAllByRole("menuitem");
    expect(admin).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(add).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(connect).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(signOut).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(admin).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(signOut).toHaveFocus();
    await user.keyboard("{Home}");
    expect(admin).toHaveFocus();
    await user.keyboard("{End}");
    expect(signOut).toHaveFocus();
  });

  it("opens from the keyboard: ArrowDown on the first item, ArrowUp on the last", async () => {
    const user = userEvent.setup();
    renderMenu();

    trigger().focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(trigger()).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    const items = screen.getAllByRole("menuitem");
    expect(items[items.length - 1]).toHaveFocus();
  });

  it("opens with Enter and activates an item with Enter", async () => {
    const user = userEvent.setup();
    renderMenu({ ...NITI, role: "user" });

    trigger().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "CONNECT AN AI ASSISTANT" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "SIGN OUT" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(signOutAndReload).toHaveBeenCalledTimes(1);
  });

  it("keeps menu items out of the tab order — focus is managed by the menu", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());

    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }
  });

  it("closes when Tab moves focus out", async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(trigger());
    await user.keyboard("{Tab}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
