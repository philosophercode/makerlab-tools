// @vitest-environment node

/**
 * The archive step's retry rule: only a transient failure (network, 5xx, a
 * Blob write) or an unreachable database is retried; an HTML page, an
 * oversize file or a 404 comes back as a value and is not.
 */

const archive = vi.hoisted(() => ({ archiveManual: vi.fn() }));
vi.mock("./archive", () => archive);

import { FatalError, RetryableError } from "workflow";
import { archiveManualStep, MANUAL_STEP_MAX_RETRIES } from "./steps";

const ID = "675596a3-081a-41a5-88e2-91353a18f759";

beforeEach(() => {
  archive.archiveManual.mockReset();
});

describe("archiveManualStep", () => {
  it("returns an archived or skipped outcome as it came", async () => {
    archive.archiveManual.mockResolvedValue({ status: "skipped", reason: "already_archived" });
    expect(await archiveManualStep(ID)).toEqual({ status: "skipped", reason: "already_archived" });
  });

  it("returns a permanent failure without retrying it", async () => {
    archive.archiveManual.mockResolvedValue({ status: "failed", reason: "not_pdf", transient: false });
    expect(await archiveManualStep(ID)).toEqual({ status: "failed", reason: "not_pdf", transient: false });
  });

  it("throws a RetryableError for a transient failure", async () => {
    archive.archiveManual.mockResolvedValue({ status: "failed", reason: "http_error", transient: true, httpStatus: 503 });
    const error = await archiveManualStep(ID).catch((e: unknown) => e);
    expect(RetryableError.is(error)).toBe(true);
  });

  it("retries an unreachable database and gives up on anything else", async () => {
    archive.archiveManual.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    expect(RetryableError.is(await archiveManualStep(ID).catch((e: unknown) => e))).toBe(true);

    archive.archiveManual.mockRejectedValueOnce(new Error("syntax error at or near"));
    expect(FatalError.is(await archiveManualStep(ID).catch((e: unknown) => e))).toBe(true);
  });

  it("sets maxRetries as a property on the step", () => {
    expect((archiveManualStep as unknown as { maxRetries: number }).maxRetries).toBe(MANUAL_STEP_MAX_RETRIES);
  });
});
