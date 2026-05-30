import { nextCacheMock } from "../../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { revalidateTag } from "next/cache";
import { POST } from "./route";

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/revalidate", {
    method: "POST",
    headers,
  });
}

describe("POST /api/admin/revalidate", () => {
  it("returns 503 with {ok:false} when ADMIN_REVALIDATE_SECRET is unset", async () => {
    // The route treats an empty string as unset (`if (!secret)`).
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "");

    const res = await POST(makeRequest({ "x-admin-secret": "anything" }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("returns 403 {ok:false, error:'forbidden'} when the x-admin-secret header is missing", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "s3cret");

    const res = await POST(makeRequest());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "forbidden" });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("returns 403 {ok:false, error:'forbidden'} when the x-admin-secret header is wrong", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "s3cret");

    const res = await POST(makeRequest({ "x-admin-secret": "wrong" }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "forbidden" });
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it("returns 200 {ok:true, tag:'catalog'} and calls revalidateTag when the secret matches", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "s3cret");

    const res = await POST(makeRequest({ "x-admin-secret": "s3cret" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, tag: "catalog" });
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("catalog", "minutes");
  });
});
