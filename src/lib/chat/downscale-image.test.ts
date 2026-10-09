import {
  ORIGINAL_UPLOAD_MAX_BYTES,
  PHOTO_JPEG_QUALITY,
  PICKED_PHOTO_MAX_BYTES,
  PNG_KEEP_MAX_BYTES,
  VISION_MAX_EDGE,
} from "../images/photo-rules";
import { preparePhoto } from "./downscale-image";

/**
 * What the chat uploads for a picked photo (data platform spec amendment
 * 2026-10-08). jsdom has neither `createImageBitmap` nor a canvas, so both are
 * stood in for — an `OffscreenCanvas` that records what is drawn and encoded —
 * and the assertions are about sizes, formats, the orientation option and the
 * fallback, not pixels. `FileReader` is jsdom's own, so the model's copy is a
 * real `data:` URL of what was "encoded".
 */

interface Encoded {
  type: string;
  quality?: number;
}

class FakeCanvas {
  static instances: FakeCanvas[] = [];
  /** Whether `getImageData` reports a transparent pixel. */
  static transparent = false;
  /** How large an encoded PNG comes out. */
  static pngBytes = 1000;
  /** Whether `getContext` answers at all. */
  static noContext = false;

  width: number;
  height: number;
  background: string | null = null;
  drawn: [number, number] | null = null;
  encoded: Encoded[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    FakeCanvas.instances.push(this);
  }

  getContext() {
    if (FakeCanvas.noContext) return null;
    const canvas = this; // eslint-disable-line @typescript-eslint/no-this-alias
    const context = {
      fillStyle: "",
      imageSmoothingQuality: "low",
      fillRect() {
        canvas.background = context.fillStyle;
      },
      drawImage(_bitmap: unknown, _x: number, _y: number, width: number, height: number) {
        canvas.drawn = [width, height];
      },
      getImageData(_x: number, _y: number, width: number, height: number) {
        const data = new Uint8ClampedArray(width * height * 4).fill(255);
        if (FakeCanvas.transparent) data[data.length - 1] = 0;
        return { data };
      },
    };
    return context;
  }

  async convertToBlob({ type, quality }: Encoded) {
    this.encoded.push({ type, quality });
    const size = type === "image/png" ? FakeCanvas.pngBytes : 100;
    return new Blob([new Uint8Array(size)], { type });
  }
}

function bitmap(width: number, height: number) {
  return { width, height, close: vi.fn() };
}

function photo(name: string, type: string, size?: number): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

function stubDecode(result: ReturnType<typeof bitmap> | { reject: unknown }) {
  const decode = vi.fn(async () => {
    if ("reject" in result) throw result.reject;
    return result;
  });
  vi.stubGlobal("createImageBitmap", decode);
  return decode;
}

beforeEach(() => {
  FakeCanvas.instances = [];
  FakeCanvas.transparent = false;
  FakeCanvas.pngBytes = 1000;
  FakeCanvas.noContext = false;
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("preparePhoto — a photo the browser can read", () => {
  it("decodes once, applying the photo's own orientation", async () => {
    const decoded = bitmap(4032, 3024);
    const decode = stubDecode(decoded);
    const file = photo("IMG_0412.jpg", "image/jpeg");

    await preparePhoto(file);

    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledWith(file, { imageOrientation: "from-image" });
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it("asks again without options in a browser that rejects them", async () => {
    const decode = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("The provided value 'from-image' is not a valid enum value"))
      .mockResolvedValueOnce(bitmap(800, 600));
    vi.stubGlobal("createImageBitmap", decode);

    const result = await preparePhoto(photo("a.jpg", "image/jpeg"));

    expect(result.kind).toBe("ready");
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[1]).toHaveLength(1);
  });

  it("uploads a 2048 px JPEG instead of a 12 MP original, and draws the model's 1568 px copy from the same bitmap", async () => {
    stubDecode(bitmap(4032, 3024));

    const result = await preparePhoto(photo("IMG_0412.jpg", "image/jpeg"));

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.upload.type).toBe("image/jpeg");
    expect(result.upload.name).toBe("IMG_0412.jpg");
    const [stored, vision] = FakeCanvas.instances;
    expect(stored.drawn).toEqual([2048, 1536]);
    expect(vision.drawn).toEqual([VISION_MAX_EDGE, 1176]);
    // JPEG has no alpha: both are painted white first.
    expect([stored.background, vision.background]).toEqual(["#ffffff", "#ffffff"]);
    expect(stored.encoded).toEqual([{ type: "image/jpeg", quality: PHOTO_JPEG_QUALITY }]);
    expect(vision.encoded).toEqual([{ type: "image/jpeg", quality: PHOTO_JPEG_QUALITY }]);
    expect(result.visionDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("sends the stored JPEG to the model too when it is already small enough", async () => {
    stubDecode(bitmap(1200, 900));

    const result = await preparePhoto(photo("small.jpg", "image/jpeg"));

    expect(result.kind).toBe("ready");
    expect(FakeCanvas.instances).toHaveLength(1);
    expect(FakeCanvas.instances[0].drawn).toEqual([1200, 900]);
    expect(result.kind === "ready" && result.visionDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("reads HEIC where the browser can (Safari) and uploads it as a JPEG", async () => {
    stubDecode(bitmap(4032, 3024));

    const result = await preparePhoto(photo("IMG_0413.HEIC", "image/heic"));

    expect(result.kind).toBe("ready");
    expect(result.kind === "ready" && result.upload.name).toBe("IMG_0413.jpg");
    expect(result.kind === "ready" && result.upload.type).toBe("image/jpeg");
  });
});

describe("preparePhoto — PNG or JPEG", () => {
  it("keeps a small PNG with transparency a PNG; the model still gets a JPEG on white", async () => {
    stubDecode(bitmap(1600, 1000));
    FakeCanvas.transparent = true;

    const result = await preparePhoto(photo("cutout.png", "image/png"));

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.upload.type).toBe("image/png");
    expect(result.upload.name).toBe("cutout.png");
    const [stored, vision] = FakeCanvas.instances;
    expect(stored.background).toBeNull();
    expect(stored.encoded).toEqual([{ type: "image/png", quality: undefined }]);
    expect(vision.background).toBe("#ffffff");
    expect(vision.encoded[0].type).toBe("image/jpeg");
    expect(result.visionDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("makes a transparent PNG a JPEG when the PNG would be too large", async () => {
    stubDecode(bitmap(1600, 1000));
    FakeCanvas.transparent = true;
    FakeCanvas.pngBytes = PNG_KEEP_MAX_BYTES + 1;

    const result = await preparePhoto(photo("render.png", "image/png"));

    expect(result.kind === "ready" && result.upload.type).toBe("image/jpeg");
    expect(result.kind === "ready" && result.upload.name).toBe("render.jpg");
  });

  it("makes an opaque PNG — a screenshot — a JPEG", async () => {
    stubDecode(bitmap(1170, 2532));

    const result = await preparePhoto(photo("screenshot.png", "image/png"));

    expect(result.kind === "ready" && result.upload.type).toBe("image/jpeg");
    // Checked for transparency without encoding a PNG it would not keep.
    expect(FakeCanvas.instances[0].encoded).toEqual([]);
  });
});

describe("preparePhoto — a photo the browser cannot read", () => {
  it("uploads the original as it is (HEIC in Chrome), for the server to convert", async () => {
    stubDecode({ reject: new DOMException("The source image could not be decoded.", "InvalidStateError") });
    const file = photo("IMG_0414.HEIC", "image/heic");

    const result = await preparePhoto(file);

    expect(result).toEqual({ kind: "original", upload: file });
    expect(FakeCanvas.instances).toHaveLength(0);
  });

  it("types an untyped .heic, as Chrome on Windows leaves it", async () => {
    stubDecode({ reject: new Error("unsupported") });

    const result = await preparePhoto(photo("IMG_0415.heic", ""));

    expect(result.kind).toBe("original");
    expect(result.kind === "original" && result.upload.type).toBe("image/heic");
    expect(result.kind === "original" && result.upload.name).toBe("IMG_0415.heic");
  });

  it("uploads the original where there is no createImageBitmap or no canvas", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    expect((await preparePhoto(photo("a.jpg", "image/jpeg"))).kind).toBe("original");

    const decoded = bitmap(800, 600);
    stubDecode(decoded);
    FakeCanvas.noContext = true;
    expect((await preparePhoto(photo("b.jpg", "image/jpeg"))).kind).toBe("original");
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it("refuses an unreadable photo too large to send as it is", async () => {
    stubDecode({ reject: new Error("unsupported") });

    const result = await preparePhoto(photo("IMG_0416.HEIC", "image/heic", ORIGINAL_UPLOAD_MAX_BYTES + 1));

    expect(result).toEqual({ kind: "tooLarge" });
  });

  it("refuses a photo over the picked-photo limit without decoding it", async () => {
    const decode = stubDecode(bitmap(8064, 6048));

    const result = await preparePhoto(photo("huge.jpg", "image/jpeg", PICKED_PHOTO_MAX_BYTES + 1));

    expect(result).toEqual({ kind: "tooLarge" });
    expect(decode).not.toHaveBeenCalled();
  });
});

describe("preparePhoto — without OffscreenCanvas", () => {
  it("draws on a <canvas> instead", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    stubDecode(bitmap(4032, 3024));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage,
    } as never);
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback: BlobCallback, type?: string) =>
        callback(new Blob([new Uint8Array(10)], { type: type ?? "image/png" }))
      );

    const result = await preparePhoto(photo("IMG_0417.jpg", "image/jpeg"));

    expect(result.kind).toBe("ready");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1536);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, VISION_MAX_EDGE, 1176);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", PHOTO_JPEG_QUALITY);
  });

  it("does not store a PNG where the browser cannot write the JPEG it was asked for", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    stubDecode(bitmap(800, 600));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    // A browser that cannot encode the type asked for hands back a PNG.
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array(10)], { type: "image/png" }))
    );
    const file = photo("c.jpg", "image/jpeg");

    expect(await preparePhoto(file)).toEqual({ kind: "original", upload: file });
  });
});
