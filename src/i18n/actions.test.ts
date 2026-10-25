// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { set, revalidatePath, revalidateTag } = vi.hoisted(() => ({
  set: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));
vi.mock("next/cache", () => ({ revalidatePath, revalidateTag }));

const { changeLocale } = await import("./actions");

describe("changeLocale", () => {
  beforeEach(() => {
    set.mockClear();
    revalidatePath.mockClear();
    revalidateTag.mockClear();
  });

  it("sets the cookie for a supported locale and invalidates no shared cache", async () => {
    await changeLocale("es");
    expect(set).toHaveBeenCalledWith("NEXT_LOCALE", "es", expect.objectContaining({ path: "/" }));
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("does nothing for an unsupported locale (security audit 2026-10-23)", async () => {
    await changeLocale("not-a-locale");
    expect(set).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
