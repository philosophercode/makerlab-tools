import { CATALOG_CACHE, HEALTH_CACHE } from "./cache";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

describe("CATALOG_CACHE", () => {
  it("caches for 1h stale / 24h revalidate / 7d expire", () => {
    expect(CATALOG_CACHE).toEqual({
      stale: HOUR,
      revalidate: DAY,
      expire: 7 * DAY,
    });
  });

  // The regression this profile exists to prevent: Next's "minutes" profile
  // revalidates every 60s, which is ~1,400 needless Notion round-trips a day for
  // a catalog edited a few times a week. If someone quietly shortens this back
  // toward minute-level polling, this fails.
  it("never revalidates more often than hourly", () => {
    expect(CATALOG_CACHE.revalidate).toBeGreaterThanOrEqual(HOUR);
  });

  it("orders the window stale <= revalidate <= expire", () => {
    expect(CATALOG_CACHE.stale).toBeLessThanOrEqual(CATALOG_CACHE.revalidate);
    expect(CATALOG_CACHE.revalidate).toBeLessThanOrEqual(CATALOG_CACHE.expire);
  });
});

describe("HEALTH_CACHE", () => {
  it("caches the Notion probe for ~30s", () => {
    expect(HEALTH_CACHE.stale).toBe(30);
    expect(HEALTH_CACHE.revalidate).toBe(30);
  });

  // A monitor polling every minute must not become a Notion call per poll, and
  // the window must still be short enough that an outage shows up in minutes.
  it("stays well under a minute of revalidation", () => {
    expect(HEALTH_CACHE.revalidate).toBeLessThan(60);
    expect(HEALTH_CACHE.stale).toBeLessThanOrEqual(HEALTH_CACHE.revalidate);
    expect(HEALTH_CACHE.revalidate).toBeLessThanOrEqual(HEALTH_CACHE.expire);
  });
});
