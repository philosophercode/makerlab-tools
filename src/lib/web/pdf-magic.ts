/**
 * Whether bytes open like a PDF: `%PDF-` within the first kilobyte (the PDF
 * spec tolerates a little leading junk). The one check every server-side PDF
 * download makes before it stores the bytes or hands them to a model as
 * `application/pdf` — a declared content type proves nothing.
 *
 * Plain Node, no imports: step code uses this.
 */

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

/** How far into the body `%PDF-` may appear. */
export const PDF_MAGIC_WINDOW = 1024;

export function hasPdfMagic(bytes: Uint8Array): boolean {
  const window = Math.min(bytes.byteLength, PDF_MAGIC_WINDOW);
  outer: for (let i = 0; i + PDF_MAGIC.length <= window; i += 1) {
    for (let j = 0; j < PDF_MAGIC.length; j += 1) {
      if (bytes[i + j] !== PDF_MAGIC[j]) continue outer;
    }
    return true;
  }
  return false;
}
