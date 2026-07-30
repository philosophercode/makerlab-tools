import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoDataBanner } from "./DemoDataBanner";

// The banner asks next-intl for copy on the server; the message content is not
// what is under test here, only whether the banner appears at all.
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, params?: Record<string, string>) => {
    if (key === "label") return "Demo data";
    // Mirrors next-intl: an unsupplied placeholder is a failure, not a blank.
    // The real bug this guards against rendered the raw key on the page.
    if (!params?.institution) throw new Error("missing `institution` param");
    return `This catalogue is sample data, not ${params.institution}'s inventory.`;
  },
}));

const NOTION_ENV = [
  "NOTION_API_KEY",
  "NOTION_DB_TOOLS",
  "NOTION_DB_CATEGORIES",
  "NOTION_DB_LOCATIONS",
  "NOTION_DB_UNITS",
  "NOTION_DB_RESOURCES",
  "NOTION_DB_MAINTENANCE_LOGS",
  "NOTION_DB_FLAGS",
];

function configureNotion() {
  for (const key of NOTION_ENV) vi.stubEnv(key, "configured");
}

async function renderBanner() {
  render(await DemoDataBanner());
}

describe("DemoDataBanner", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("warns when Notion is not configured at all", async () => {
    await renderBanner();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Demo data");
    // The institution must be interpolated, not left as a literal placeholder.
    expect(banner).not.toHaveTextContent("{institution}");
    expect(banner.textContent).toMatch(/inventory/);
  });

  it("stays out of the way when the catalogue is real", async () => {
    configureNotion();
    await renderBanner();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // The failure that actually reaches production is not "Notion is unset" — it is
  // one variable dropped during a deploy. The catalogue silently falls back to
  // invented equipment, so the banner has to fire on a partial contract too.
  it.each(NOTION_ENV)("warns when only %s is missing", async (missing) => {
    configureNotion();
    vi.stubEnv(missing, "");
    await renderBanner();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
