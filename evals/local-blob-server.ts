import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createLocalBlobBackend, type LocalBlobBackend } from "@/lib/blob-local";

/**
 * The eval's own file server: a local Blob store (`blob-local.ts`) in a temp
 * folder, served over HTTP on 127.0.0.1 exactly as `GET /api/dev-blob/<path>`
 * serves `.blob-data/` in development — public files with their stored
 * content type, private and missing ones 404.
 *
 * It exists so the eval's manuals have addresses that **resolve**: the
 * `citations_resolve` assertion GETs every cited PDF (manual text spec
 * amendment 2026-09-28), which the old `https://eval.blob.test/…` addresses
 * never could.
 */

export interface LocalBlobServer {
  store: LocalBlobBackend;
  origin: string;
  /** The public URL of a stored pathname. */
  url(pathname: string): string;
  close(): Promise<void>;
}

const PREFIX = "/api/dev-blob/";

export async function startLocalBlobServer(root: string): Promise<LocalBlobServer> {
  const store = createLocalBlobBackend(root);
  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "").split("?")[0]);
    if (req.method !== "GET" || !path.startsWith(PREFIX)) {
      res.writeHead(404).end("Not found");
      return;
    }
    store
      .read(path.slice(PREFIX.length))
      .then((blob) => {
        if (!blob || blob.meta.access !== "public") {
          res.writeHead(404).end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": blob.meta.contentType,
          "Content-Length": String(blob.body.byteLength),
          "Cache-Control": "no-store",
        });
        res.end(Buffer.from(blob.body));
      })
      .catch(() => res.writeHead(404).end("Not found"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    store,
    origin,
    url: (pathname) => `${origin}${PREFIX}${pathname.split("/").map(encodeURIComponent).join("/")}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
