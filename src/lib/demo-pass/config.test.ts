import { DEFAULT_DEMO_PASS_BUDGET_USD, demoPassBudgetUsd, demoPassContactEmail, demoPassEnabled } from "./config";

/** The demo pass's three settings (demo pass spec 2026-10-07, `.env.example`). */

afterEach(() => vi.unstubAllEnvs());

describe("demo pass settings", () => {
  it("is on unless DEMO_PASS says off", () => {
    expect(demoPassEnabled()).toBe(true);
    for (const off of ["off", "OFF", "0", "false"]) {
      vi.stubEnv("DEMO_PASS", off);
      expect(demoPassEnabled()).toBe(false);
    }
    vi.stubEnv("DEMO_PASS", "on");
    expect(demoPassEnabled()).toBe(true);
  });

  it("budgets $0.50 a pass by default, and reads DEMO_PASS_BUDGET_USD", () => {
    expect(demoPassBudgetUsd()).toBe(DEFAULT_DEMO_PASS_BUDGET_USD);
    expect(DEFAULT_DEMO_PASS_BUDGET_USD).toBe(0.5);
    vi.stubEnv("DEMO_PASS_BUDGET_USD", "1.25");
    expect(demoPassBudgetUsd()).toBe(1.25);
  });

  it("falls back to the default for a budget that is not a sensible dollar amount", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of ["abc", "0", "-1", "50"]) {
      vi.stubEnv("DEMO_PASS_BUDGET_USD", bad);
      expect(demoPassBudgetUsd()).toBe(DEFAULT_DEMO_PASS_BUDGET_USD);
    }
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("offers a contact address only when DEMO_PASS_CONTACT_EMAIL is one", () => {
    expect(demoPassContactEmail()).toBeNull();
    vi.stubEnv("DEMO_PASS_CONTACT_EMAIL", " makerlab@example.edu ");
    expect(demoPassContactEmail()).toBe("makerlab@example.edu");
    vi.stubEnv("DEMO_PASS_CONTACT_EMAIL", "<script>@x");
    expect(demoPassContactEmail()).toBeNull();
  });
});
