import { nextCacheMock } from "../../test/mocks/next-cache";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoDataBanner } from "./DemoDataBanner";

// The banner reaches `isDemoCatalog` through `lib/catalog`, which imports
// `next/cache` at module load.
vi.mock("next/cache", () => nextCacheMock());

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

async function renderBanner() {
  render(await DemoDataBanner());
}

describe("DemoDataBanner", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("warns when there is no database and the catalogue is the demo seed", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await renderBanner();
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Demo data");
    // The institution must be interpolated, not left as a literal placeholder.
    expect(banner).not.toHaveTextContent("{institution}");
    expect(banner.textContent).toMatch(/inventory/);
  });

  it("stays out of the way when a real database is configured", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.neon.tech/db");
    await renderBanner();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // A configured-but-unreachable database is a different failure: the catalogue
  // throws rather than serving sample data, so the banner must not claim the
  // page is a demo. It keys on the substrate alone.
  it("does not fire for a database that is merely unhealthy", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@unreachable.invalid/db");
    await renderBanner();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
