// @vitest-environment node

/**
 * The archive step's retry rule: only a transient failure (network, 5xx, a
 * Blob write) or an unreachable database is retried; an HTML page, an
 * oversize file or a 404 comes back as a value and is not.
 */

const archive = vi.hoisted(() => ({ archiveManual: vi.fn() }));
vi.mock("./archive", () => archive);
const indexer = vi.hoisted(() => ({ indexResourceManuals: vi.fn() }));
vi.mock("./index-document", () => indexer);

import { FatalError, RetryableError } from "workflow";
import { archiveManualStep, indexManualStep, MANUAL_STEP_MAX_RETRIES } from "./steps";

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

describe("indexManualStep (manual text spec §3.1)", () => {
  beforeEach(() => {
    indexer.indexResourceManuals.mockReset();
  });

  it("returns stored outcomes — ready, no_text, failed — as they came, without retrying any", async () => {
    const outcomes = [
      { status: "indexed", attachmentId: "a", documentStatus: "ready", reason: null, pageCount: 4, outlineEntries: 4, chars: 1, ms: 1 },
      { status: "indexed", attachmentId: "b", documentStatus: "no_text", reason: "no_text_layer", pageCount: 3, outlineEntries: 0, chars: 0, ms: 1 },
      { status: "indexed", attachmentId: "c", documentStatus: "failed", reason: "encrypted", pageCount: null, outlineEntries: 0, chars: 0, ms: 1 },
      { status: "skipped", attachmentId: "d", reason: "already_indexed" },
      { status: "failed", attachmentId: "e", reason: "read_failed", transient: false },
    ];
    indexer.indexResourceManuals.mockResolvedValue(outcomes);
    expect(await indexManualStep(ID)).toEqual(outcomes);
  });

  it("retries a transient embedding failure (phase 2), and returns a permanent one as it came", async () => {
    const passages = (transient: boolean) => ({
      status: "failed",
      documentId: "d",
      reason: "embedding_failed",
      kind: transient ? "rate_limited" : "auth",
      transient,
    });
    indexer.indexResourceManuals.mockResolvedValue([
      { status: "skipped", attachmentId: "a", reason: "already_indexed", passages: passages(true) },
    ]);
    expect(RetryableError.is(await indexManualStep(ID).catch((e: unknown) => e))).toBe(true);
    const permanent = [{ status: "skipped", attachmentId: "a", reason: "already_indexed", passages: passages(false) }];
    indexer.indexResourceManuals.mockResolvedValue(permanent);
    expect(await indexManualStep(ID)).toEqual(permanent);
  });

  it("retries a Blob read that failed transiently", async () => {
    indexer.indexResourceManuals.mockResolvedValue([{ status: "failed", attachmentId: "a", reason: "read_failed", transient: true }]);
    expect(RetryableError.is(await indexManualStep(ID).catch((e: unknown) => e))).toBe(true);
  });

  it("retries an unreachable database and gives up on anything else", async () => {
    indexer.indexResourceManuals.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    expect(RetryableError.is(await indexManualStep(ID).catch((e: unknown) => e))).toBe(true);
    indexer.indexResourceManuals.mockRejectedValueOnce(new Error("pdf.js exploded"));
    expect(FatalError.is(await indexManualStep(ID).catch((e: unknown) => e))).toBe(true);
  });

  it("sets maxRetries as a property on the step", () => {
    expect((indexManualStep as unknown as { maxRetries: number }).maxRetries).toBe(MANUAL_STEP_MAX_RETRIES);
  });
});
