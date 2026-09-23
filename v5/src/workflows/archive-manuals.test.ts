// @vitest-environment node

/**
 * `archiveManuals` as a plain function: without the workflow compiler the
 * directives are strings, so the steps are mocked and the orchestration is
 * under test — one step per resource, in order, each ending on its own.
 */

const steps = vi.hoisted(() => ({ archiveManualStep: vi.fn(), finishManualArchive: vi.fn() }));
vi.mock("../lib/manuals/steps", () => steps);

import { archiveManuals } from "./archive-manuals";

beforeEach(() => {
  steps.archiveManualStep.mockReset();
  steps.finishManualArchive.mockReset().mockResolvedValue(undefined);
});

describe("archiveManuals", () => {
  it("archives each resource in order and counts every outcome, a thrown step as failed", async () => {
    steps.archiveManualStep
      .mockResolvedValueOnce({ status: "archived", reason: "archived" })
      .mockRejectedValueOnce(new Error("retries exhausted"))
      .mockResolvedValueOnce({ status: "skipped", reason: "already_archived" })
      .mockResolvedValueOnce({ status: "failed", reason: "not_pdf", transient: false });

    expect(await archiveManuals(["a", "b", "c", "d"])).toEqual({ archived: 1, skipped: 1, failed: 2 });
    expect(steps.archiveManualStep.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "d"]);
    expect(steps.finishManualArchive).toHaveBeenCalledWith({ archived: 1, skipped: 1, failed: 2 });
  });
});
