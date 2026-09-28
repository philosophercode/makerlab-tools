import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "../../../messages/en.json";
import { identityFor } from "../../../test/utils/identities";

vi.mock("../../lib/auth/identity", () => ({ resolveIdentityFromHeaders: vi.fn() }));
vi.mock("../../lib/catalog", () => ({ getCatalogTools: vi.fn(async () => []) }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { getCatalogTools } from "../../lib/catalog";
import { STUDIO_101 } from "../../lib/map/studio-101";
import { MapExplorer } from "./MapExplorer";
import { MapGate } from "./MapGate";

describe("MapGate — /map (map access, PR #98)", () => {
  beforeEach(() => {
    vi.mocked(resolveIdentityFromHeaders).mockReset();
    vi.mocked(getCatalogTools).mockClear();
  });

  it("gives a signed-out visitor the sign-in notice and no plan data", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("anonymous"));
    const element = await MapGate();
    expect(element.type).not.toBe(MapExplorer);
    expect(getCatalogTools).not.toHaveBeenCalled();

    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {element}
      </NextIntlClientProvider>
    );
    expect(html).toContain("Sign in to see the floor map.");
    for (const zone of STUDIO_101.zones) expect(html).not.toContain(zone.zone);
    expect(html).not.toContain("Studio 101");
    expect(html).not.toContain("<svg");
  });

  it("gives a signed-in visitor the explorer over the Studio 101 plan", async () => {
    vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor("user"));
    const element = await MapGate();
    expect(element.type).toBe(MapExplorer);
    expect(element.props).toMatchObject({ plan: STUDIO_101, tools: [] });
  });
});
