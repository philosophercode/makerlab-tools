import { VISION_MAX_EDGE, downscaleForVision, fitWithin } from "./downscale-image";

/**
 * The copy of a photo the model receives (intake spec §6.1). jsdom has neither
 * `createImageBitmap` nor a canvas implementation, so the browser APIs are
 * stubbed per test and the assertions are about what gets drawn and released.
 */

function blob(type = "image/jpeg"): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type });
}

describe("fitWithin", () => {
  it("never enlarges a small image", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape photo so its width is the max edge", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: VISION_MAX_EDGE, height: 1176 });
  });

  it("scales a portrait photo so its height is the max edge", () => {
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: VISION_MAX_EDGE });
  });

  it("leaves degenerate sizes as they are", () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe("downscaleForVision", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null where the browser has no createImageBitmap", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect(await downscaleForVision(blob())).toBeNull();
  });

  it("draws a downscaled JPEG and releases the decoded bitmap", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4032, height: 3024, close }))
    );
    const context = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as never);
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValue("data:image/jpeg;base64,SMALL");

    const result = await downscaleForVision(blob());

    expect(result).toBe("data:image/jpeg;base64,SMALL");
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      VISION_MAX_EDGE,
      1176
    );
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", expect.any(Number));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns null when the file cannot be decoded, without throwing", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("unsupported image format");
      })
    );
    await expect(downscaleForVision(blob("image/heic"))).resolves.toBeNull();
  });

  it("returns null and still releases the bitmap when there is no 2D context", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 10, height: 10, close }))
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    expect(await downscaleForVision(blob())).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
