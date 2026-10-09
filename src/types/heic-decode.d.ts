/**
 * `heic-decode` (ISC) ships no types. Only what `src/lib/images/heif.ts` uses:
 * `all()` lists a file's images with their size before any is decoded, so a
 * caller can refuse an oversized one without paying for the decode.
 */
declare module "heic-decode" {
  export interface DecodedHeifImage {
    width: number;
    height: number;
    /** RGBA, 4 bytes a pixel, row by row. */
    data: Uint8ClampedArray;
  }

  export interface HeifImageHandle {
    width: number;
    height: number;
    decode(): Promise<DecodedHeifImage>;
  }

  export type HeifImageList = HeifImageHandle[] & { dispose(): void };

  interface HeicDecode {
    (input: { buffer: ArrayBufferLike | Uint8Array }): Promise<DecodedHeifImage>;
    all(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<HeifImageList>;
  }

  const decode: HeicDecode;
  export default decode;
}
