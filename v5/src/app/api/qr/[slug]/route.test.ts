// @vitest-environment node
import { nextCacheMock } from "../../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { getDb, resetDbForTests } from "../../../../lib/db/client";
import { tools } from "../../../../lib/db/schema/index";
import { qrMatrix, qrPathData } from "../../../../lib/qr/matrix";
import { ROUTE_TIERS } from "../../../../lib/rate-limit";
import { GET } from "./route";

/**
 * `GET /api/qr/<slug>` (QR labels): a published tool's code as SVG or PNG,
 * encoding the same `?src=qr` address every label carries; a draft, an
 * archived tool and an unknown slug are one 404; bad queries are 400; the
 * limiter runs first.
 */

let ipCounter = 0;
function request(slug: string, query = "", ip = `10.30.0.${++ipCounter}`) {
  const req = new Request(`https://makerlab-ai.vercel.app/api/qr/${slug}${query}`, { headers: { "x-forwarded-for": ip } });
  return GET(req, { params: Promise.resolve({ slug }) });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PGLITE_DATA_DIR", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tools.example.edu");
});

afterEach(() => {
  resetDbForTests();
  vi.unstubAllEnvs();
});

describe("GET /api/qr/[slug]", () => {
  it("answers a published tool's code as SVG by default, cached, encoding the label address", async () => {
    const res = await request("form-4");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toMatch(/^public, max-age=3600/);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="form-4-qr.svg"');
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    // The modules drawn are exactly the code for the label URL — no decoder
    // needed: the path is a pure function of the matrix.
    const expected = qrPathData(qrMatrix("https://tools.example.edu/tools/form-4?src=qr", "H"), 4);
    expect(svg).toContain(`d="${expected}"`);
    expect(svg).toContain("<title>QR code: Form 4</title>");
  });

  it("answers a PNG at the asked size, as an attachment when downloading", async () => {
    const res = await request("trotec-speedy-400", "?format=png&size=256&download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="trotec-speedy-400-qr.png"');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR width/height, big-endian at bytes 16–23: square, and within one
    // module of the asked size: whole-pixel modules keep the edges crisp.
    const view = new DataView(bytes.buffer);
    const modules = qrMatrix("https://tools.example.edu/tools/trotec-speedy-400?src=qr", "H").size + 8;
    expect(view.getUint32(16)).toBe(view.getUint32(20));
    expect(view.getUint32(16)).toBeLessThanOrEqual(256);
    expect(view.getUint32(16)).toBeGreaterThan(256 - modules);
  });

  it("404s a draft, an archived tool and an unknown slug alike", async () => {
    const db = await getDb();
    await db.insert(tools).values([
      { slug: "draft-lathe", name: "Draft lathe", published: false },
      { slug: "gone-laser", name: "Gone laser", published: true, archivedAt: new Date("2026-01-01T00:00:00.000Z") },
    ]);
    for (const slug of ["draft-lathe", "gone-laser", "no-such-tool"]) {
      const res = await request(slug);
      expect(res.status, slug).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("400s an unknown format and a size out of bounds", async () => {
    expect((await request("form-4", "?format=gif")).status).toBe(400);
    expect((await request("form-4", "?format=png&size=64")).status).toBe(400);
    expect((await request("form-4", "?format=png&size=4096")).status).toBe(400);
    expect((await request("form-4", "?format=png&size=big")).status).toBe(400);
  });

  it("answers 429 past its tier before reading the catalogue", async () => {
    const ip = "10.30.99.1";
    for (let i = 0; i < ROUTE_TIERS.qr.limit; i++) {
      // A bad query still spends the window, and reads nothing.
      expect((await request("form-4", "?format=gif", ip)).status).toBe(400);
    }
    const res = await request("form-4", "", ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});
