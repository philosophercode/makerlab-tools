// @vitest-environment node
import { plainPhoto, qrPhoto, qrPng } from "../../../test/images/qr-photo";
import { dataUrlBytes, decodeQrCodes } from "./decode";

/**
 * The server-side decoder against photo-like fixtures (QR labels amendment):
 * a plain code, one small in a big noisy frame, one turned and softened, and
 * a photo with no code. Real `sharp` and `jsqr`; no network.
 */

const URL = "https://makerlab-ai.vercel.app/tools/form-4?src=qr";

describe("decodeQrCodes", () => {
  it("reads a plain code", async () => {
    expect(await decodeQrCodes(new Uint8Array(await qrPng(URL)))).toEqual([URL]);
  });

  it("reads a small code in a big phone-sized photo", async () => {
    const photo = await qrPhoto(URL, { width: 4000, height: 3000, codeSize: 380, left: 2600, top: 300 });
    expect(await decodeQrCodes(new Uint8Array(photo))).toEqual([URL]);
  });

  it("reads a code that is turned and slightly out of focus", async () => {
    const photo = await qrPhoto(URL, { rotate: 23, blur: 1.2 });
    expect(await decodeQrCodes(new Uint8Array(photo))).toEqual([URL]);
  });

  it("reads a small, far-off code at the largest size it tries", async () => {
    const photo = await qrPhoto(URL, { width: 3000, height: 2250, codeSize: 200, rotate: 8 });
    expect(await decodeQrCodes(new Uint8Array(photo))).toEqual([URL]);
  });

  it("finds nothing in a photo without a code, and in bytes that are not an image", async () => {
    expect(await decodeQrCodes(new Uint8Array(await plainPhoto()))).toEqual([]);
    expect(await decodeQrCodes(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
    expect(await decodeQrCodes(new Uint8Array())).toEqual([]);
  });

  it("skips a file over the size limit without decoding it", async () => {
    const toRgba = vi.fn();
    expect(await decodeQrCodes(new Uint8Array(10), { maxBytes: 5, toRgba })).toEqual([]);
    expect(toRgba).not.toHaveBeenCalled();
  });

  it("stops trying sizes once the budget is spent", async () => {
    let clock = 0;
    const toRgba = vi.fn(async () => {
      clock += 1000;
      const width = 20 + clock / 1000;
      return { data: new Uint8Array(width * 20 * 4).fill(255), width, height: 20 };
    });
    await decodeQrCodes(new Uint8Array(10), { budgetMs: 1500, toRgba, now: () => clock });
    expect(toRgba).toHaveBeenCalledTimes(2);
  });

  it("never throws when decoding does", async () => {
    const toRgba = vi.fn(async () => {
      throw new Error("corrupt");
    });
    expect(await decodeQrCodes(new Uint8Array(10), { toRgba })).toEqual([]);
  });
});

describe("dataUrlBytes", () => {
  it("reads base64 data URLs and nothing else", () => {
    expect(Array.from(dataUrlBytes("data:image/png;base64,AQID")!)).toEqual([1, 2, 3]);
    expect(dataUrlBytes("https://blob.example/x.png")).toBeNull();
    expect(dataUrlBytes(undefined)).toBeNull();
  });
});
