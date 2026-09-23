// @vitest-environment node

/** `requestManualArchive` never throws and starts nothing for nothing. */

const starter = vi.hoisted(() => ({ startManualArchive: vi.fn() }));
vi.mock("./start", () => starter);

import { requestManualArchive } from "./trigger";

const A = "675596a3-081a-41a5-88e2-91353a18f759";
const B = "0f5e4a3c-1111-2222-3333-444455556666";

beforeEach(() => {
  starter.startManualArchive.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("requestManualArchive", () => {
  it("starts one run with the distinct, uuid-shaped ids", async () => {
    expect(await requestManualArchive([A, B, A, "nope"])).toBe(true);
    expect(starter.startManualArchive).toHaveBeenCalledWith([A, B]);
  });

  it("starts nothing for an empty list", async () => {
    expect(await requestManualArchive([])).toBe(false);
    expect(starter.startManualArchive).not.toHaveBeenCalled();
  });

  it("answers false, never a throw, when the start blows up", async () => {
    starter.startManualArchive.mockRejectedValue(new Error("world unavailable"));
    await expect(requestManualArchive([A])).resolves.toBe(false);
  });
});
