const fetchIdentity = vi.hoisted(() => vi.fn());
vi.mock("./sign-in-client", () => ({ fetchIdentity: () => fetchIdentity() }));

import { loadSharedIdentity } from "./identity-store";

describe("loadSharedIdentity (performance plan, quick win 10)", () => {
  beforeEach(() => fetchIdentity.mockReset());

  it("asks /api/identity once for everybody on the page", async () => {
    fetchIdentity.mockResolvedValue({ role: "admin", name: "Ada" });
    const [header, editControl] = await Promise.all([loadSharedIdentity(), loadSharedIdentity()]);
    const later = await loadSharedIdentity();

    expect(fetchIdentity).toHaveBeenCalledTimes(1);
    expect(header).toEqual({ role: "admin", name: "Ada" });
    expect(editControl).toBe(header);
    expect(later).toBe(header);
  });

  it("asks again after a failed answer", async () => {
    fetchIdentity.mockResolvedValueOnce(null).mockResolvedValueOnce({ role: "user", name: null });
    expect(await loadSharedIdentity()).toBeNull();
    expect(await loadSharedIdentity()).toEqual({ role: "user", name: null });
    expect(fetchIdentity).toHaveBeenCalledTimes(2);
  });
});
