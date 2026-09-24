// @vitest-environment node

/**
 * `archiveManuals` as a plain function: without the workflow compiler the
 * directives are strings, so the steps are mocked and the orchestration is
 * under test — one step per resource, in order, each ending on its own.
 */

const steps = vi.hoisted(() => ({ archiveManualStep: vi.fn(), indexManualStep: vi.fn(), finishManualArchive: vi.fn() }));
vi.mock("../lib/manuals/steps", () => steps);

import { archiveManuals } from "./archive-manuals";

beforeEach(() => {
  steps.archiveManualStep.mockReset();
  steps.indexManualStep.mockReset().mockResolvedValue([]);
  steps.finishManualArchive.mockReset().mockResolvedValue(undefined);
});

describe("archiveManuals", () => {
  it("archives each resource in order and counts every outcome, a thrown step as failed", async () => {
    steps.archiveManualStep
      .mockResolvedValueOnce({ status: "archived", reason: "archived" })
      .mockRejectedValueOnce(new Error("retries exhausted"))
      .mockResolvedValueOnce({ status: "skipped", reason: "already_archived" })
      .mockResolvedValueOnce({ status: "failed", reason: "not_pdf", transient: false });

    const counts = { archived: 1, skipped: 1, failed: 2, indexed: 0, indexFailed: 0 };
    expect(await archiveManuals(["a", "b", "c", "d"])).toEqual(counts);
    expect(steps.archiveManualStep.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "d"]);
    expect(steps.finishManualArchive).toHaveBeenCalledWith(counts);
  });

  it("processes a resource's PDFs into text after archiving it, or when it already held one — never after a failure", async () => {
    steps.archiveManualStep
      .mockResolvedValueOnce({ status: "archived", reason: "archived" })
      .mockResolvedValueOnce({ status: "skipped", reason: "has_file" })
      .mockResolvedValueOnce({ status: "skipped", reason: "no_url" })
      .mockResolvedValueOnce({ status: "skipped", reason: "not_found" })
      .mockResolvedValueOnce({ status: "failed", reason: "http_error", transient: false })
      .mockRejectedValueOnce(new Error("retries exhausted"));
    steps.indexManualStep
      .mockResolvedValueOnce([{ status: "indexed", documentStatus: "ready" }])
      .mockResolvedValueOnce([{ status: "indexed", documentStatus: "no_text" }, { status: "skipped" }])
      .mockResolvedValueOnce([]);

    const result = await archiveManuals(["a", "b", "c", "d", "e", "f"]);
    expect(steps.indexManualStep.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ archived: 1, skipped: 3, failed: 2, indexed: 2, indexFailed: 0 });
  });

  it("never lets processing change what the archive counted", async () => {
    steps.archiveManualStep.mockResolvedValue({ status: "archived", reason: "archived" });
    steps.indexManualStep
      .mockRejectedValueOnce(new Error("retries exhausted"))
      .mockResolvedValueOnce([{ status: "failed", reason: "read_failed", transient: true }]);
    expect(await archiveManuals(["a", "b"])).toEqual({ archived: 2, skipped: 0, failed: 0, indexed: 0, indexFailed: 2 });
  });
});
