import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "../../../test/utils/render";
import { identityFor } from "../../../test/utils/identities";
import { availableTool } from "../../../test/fixtures/catalog";
import type { MakerLabTool } from "../catalog-types";

vi.mock("../../lib/auth/identity", () => ({ resolveIdentityFromHeaders: vi.fn() }));

import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { SignedInToolLocation } from "./SignedInToolLocation";

/** A tool at a zone the Studio 101 plan has. */
const bambu: MakerLabTool = {
  ...availableTool,
  name: "Bambu Lab X1-Carbon",
  location: "Studio 101",
  zone: "3D Printing Hub",
  mapId: null,
};

describe("SignedInToolLocation (map access, PR #98)", () => {
  beforeEach(() => vi.mocked(resolveIdentityFromHeaders).mockReset());

  it("sends a signed-out visitor nothing: no section, no plan, no zone", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("anonymous"));
    const element = await SignedInToolLocation({ tool: bambu });
    expect(element).toBeNull();
  });

  it("shows a signed-in visitor where the tool is", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("user"));
    const element = await SignedInToolLocation({ tool: bambu });
    expect(element).not.toBeNull();
    render(element!);
    expect(screen.getByRole("heading", { name: "Where it is" })).toBeInTheDocument();
    expect(screen.getByText("Zone 2 · 3D Printing Hub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open map" })).toHaveAttribute("href", "/map?highlight=Z2");
  });
});
