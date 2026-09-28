// @vitest-environment node
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { reportHeartbeat } from "./heartbeat";

/**
 * The heartbeat against MSW: a ping per run, `/fail` on failure, and never a
 * throw — a monitor being down must not fail the nightly job.
 */

const PING = "https://hc-ping.example/abc-123";

function capture(status = 200) {
  const hits: string[] = [];
  server.use(
    http.post(`${PING}*`, ({ request }) => {
      hits.push(new URL(request.url).pathname);
      return new HttpResponse(null, { status });
    })
  );
  return hits;
}

beforeEach(() => {
  vi.stubEnv("CRON_HEARTBEAT_URL", PING);
});

describe("reportHeartbeat", () => {
  it("pings the URL after a good run", async () => {
    const hits = capture();
    await reportHeartbeat(true);
    expect(hits).toEqual(["/abc-123"]);
  });

  it("pings <url>/fail after a failed run", async () => {
    const hits = capture();
    await reportHeartbeat(false);
    expect(hits).toEqual(["/abc-123/fail"]);
  });

  it("does nothing when CRON_HEARTBEAT_URL is unset", async () => {
    vi.stubEnv("CRON_HEARTBEAT_URL", "");
    const hits = capture();
    await reportHeartbeat(false);
    expect(hits).toEqual([]);
  });

  it("refuses a plain-http or malformed URL without calling out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hits = capture();
    vi.stubEnv("CRON_HEARTBEAT_URL", "http://hc-ping.example/abc-123");
    await reportHeartbeat(true);
    vi.stubEnv("CRON_HEARTBEAT_URL", "not a url");
    await reportHeartbeat(true);
    expect(hits).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("swallows a monitor outage and never logs the URL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(http.post(`${PING}*`, () => HttpResponse.error()));

    await expect(reportHeartbeat(true)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("abc-123");
    warn.mockRestore();
  });

  it("reports a non-2xx answer without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    capture(500);
    await expect(reportHeartbeat(true)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[cron] heartbeat answered 500");
    warn.mockRestore();
  });
});
