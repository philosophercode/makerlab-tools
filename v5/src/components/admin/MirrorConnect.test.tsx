import { render, screen, userEvent } from "../../../test/utils/render";
import type { MirrorConnectActionResult, MirrorTestResult } from "../../app/admin/mirror/action-result";
import { MirrorConnect, type MirrorConnectActions } from "./MirrorConnect";

/**
 * The Connect form (spec §3.8 "Connect", §8).
 *
 * The token field is a password field the browser will not autofill; Test
 * connection shows the page's title and nothing else; Connect clears the token
 * the moment it lands; and a refusal is a sentence, never a success.
 */

const TOKEN = "ntn_COMPONENTtestToken0123456789";
const PAGE_URL = "https://www.notion.so/acme/MakerLab-Tools-mirror-0f5e4a3c111122223333444455556666";

function actions(over: Partial<MirrorConnectActions> = {}): MirrorConnectActions {
  return {
    testConnection: vi.fn(
      async (): Promise<MirrorTestResult> => ({
        ok: true,
        pageId: "0f5e4a3c-1111-2222-3333-444455556666",
        title: "MakerLab Tools — mirror",
      })
    ),
    connect: vi.fn(async (): Promise<MirrorConnectActionResult> => ({ ok: true, title: "MakerLab Tools — mirror" })),
    ...over,
  };
}

const tokenField = () => screen.getByLabelText("Integration token");
const pageField = () => screen.getByLabelText("Page URL");

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(tokenField(), TOKEN);
  await user.type(pageField(), PAGE_URL);
}

describe("MirrorConnect", () => {
  it("asks for the token in a password field the browser will not autofill", () => {
    render(<MirrorConnect actions={actions()} />);
    expect(tokenField()).toHaveAttribute("type", "password");
    expect(tokenField()).toHaveAttribute("autocomplete", "off");
    expect(tokenField()).toHaveAccessibleDescription(/encrypted before it is stored/);
  });

  it("keeps both buttons disabled until both fields are filled", async () => {
    const user = userEvent.setup();
    render(<MirrorConnect actions={actions()} />);

    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    await user.type(tokenField(), TOKEN);
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
    await user.type(pageField(), PAGE_URL);
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("tests the connection and shows the page's title, keeping the token for Connect", async () => {
    const user = userEvent.setup();
    const bundle = actions();
    render(<MirrorConnect actions={bundle} />);
    await fill(user);

    await user.click(screen.getByRole("button", { name: "Test connection" }));

    expect(bundle.testConnection).toHaveBeenCalledWith({ token: TOKEN, pageUrl: PAGE_URL });
    expect(await screen.findByText("Found the page “MakerLab Tools — mirror”.")).toBeInTheDocument();
    expect(tokenField()).toHaveValue(TOKEN);
    expect(bundle.connect).not.toHaveBeenCalled();
  });

  it("connects, then clears the token field", async () => {
    const user = userEvent.setup();
    const bundle = actions();
    render(<MirrorConnect actions={bundle} />);
    await fill(user);

    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(bundle.connect).toHaveBeenCalledWith({ token: TOKEN, pageUrl: PAGE_URL });
    expect(await screen.findByText("Connected to “MakerLab Tools — mirror”.")).toBeInTheDocument();
    expect(tokenField()).toHaveValue("");
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("shows a refusal and keeps what was typed so it can be fixed", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      connect: vi.fn(async (): Promise<MirrorConnectActionResult> => ({ ok: false, error: "page_not_found" })),
    });
    render(<MirrorConnect actions={bundle} />);
    await fill(user);

    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText(/Notion could not find that page/)).toBeInTheDocument();
    expect(screen.queryByText(/Connected/)).not.toBeInTheDocument();
    expect(tokenField()).toHaveValue(TOKEN);
  });

  it("renders a gate refusal from the shared admin errors", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      testConnection: vi.fn(async (): Promise<MirrorTestResult> => ({ ok: false, error: "rate_limited" })),
    });
    render(<MirrorConnect actions={bundle} />);
    await fill(user);

    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/Too many changes at once/)).toBeInTheDocument();
  });

  it("forgets a found title once the fields change", async () => {
    const user = userEvent.setup();
    render(<MirrorConnect actions={actions()} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText(/Found the page/);

    await user.type(pageField(), "x");
    expect(screen.queryByText(/Found the page/)).not.toBeInTheDocument();
  });

  it("starts from the mirror's page when reconnecting", () => {
    render(<MirrorConnect actions={actions()} initialPageUrl="0f5e4a3c-1111-2222-3333-444455556666" />);
    expect(pageField()).toHaveValue("0f5e4a3c-1111-2222-3333-444455556666");
    expect(tokenField()).toHaveValue("");
  });

  it("shows the audit warning on a connect that landed without its event", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      connect: vi.fn(
        async (): Promise<MirrorConnectActionResult> => ({ ok: true, title: "Mirror", warning: "audit_unavailable" })
      ),
    });
    render(<MirrorConnect actions={bundle} />);
    await fill(user);

    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText(/could not be written to the audit log/)).toBeInTheDocument();
    expect(tokenField()).toHaveValue("");
  });
});
