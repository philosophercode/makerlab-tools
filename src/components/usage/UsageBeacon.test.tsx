import { render } from "../../../test/utils/render";
import { USAGE_ENDPOINT, UsageBeacon } from "./UsageBeacon";

const searchParams = { value: new URLSearchParams() };
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams.value }));

const TOOL = "11111111-1111-4111-8111-111111111111";

async function sentBodies(spy: ReturnType<typeof vi.fn>): Promise<unknown[]> {
  return Promise.all(spy.mock.calls.map(async ([, blob]) => JSON.parse(await (blob as Blob).text())));
}

describe("UsageBeacon", () => {
  let sendBeacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    sendBeacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { value: sendBeacon, configurable: true, writable: true });
    searchParams.value = new URLSearchParams();
  });

  it("sends one tool view with nothing about the visitor, once per tab", async () => {
    const first = render(<UsageBeacon kind="tool_view" toolId={TOOL} />);
    first.unmount();
    render(<UsageBeacon kind="tool_view" toolId={TOOL} />);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0][0]).toBe(USAGE_ENDPOINT);
    expect(await sentBodies(sendBeacon)).toEqual([{ kind: "tool_view", toolId: TOOL, source: "direct" }]);
  });

  it("marks an arrival from a machine's QR label", async () => {
    searchParams.value = new URLSearchParams("src=qr");
    render(<UsageBeacon kind="tool_view" toolId={TOOL} />);
    expect(await sentBodies(sendBeacon)).toEqual([{ kind: "tool_view", toolId: TOOL, source: "qr" }]);
  });

  it("counts a kiosk arrival only when the URL came from the kiosk's code", async () => {
    render(<UsageBeacon kind="kiosk_view" />);
    expect(sendBeacon).not.toHaveBeenCalled();
    searchParams.value = new URLSearchParams("src=kiosk&ask=1");
    render(<UsageBeacon kind="kiosk_view" />);
    expect(await sentBodies(sendBeacon)).toEqual([{ kind: "kiosk_view", source: "qr" }]);
  });

  it("does nothing, and breaks nothing, without sendBeacon", () => {
    Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true, writable: true });
    expect(() => render(<UsageBeacon kind="tool_view" toolId={TOOL} />)).not.toThrow();
  });
});
