import { createTranslator } from "next-intl";
import messages from "../../../messages/en.json";
import { SERIES_DAYS } from "../../lib/data/admin-overview";
import { tileContent } from "./admin-tiles";

/**
 * What each home tile says from its counts (UI system spec §8.1): the
 * headline, whether it is waiting work, and — the case that would embarrass
 * us — a loader that failed is "Could not be read", never a 0.
 */

const t = createTranslator({ locale: "en", messages, namespace: "admin" }) as unknown as (
  key: string,
  values?: Record<string, string | number>
) => string;

const series = (last: number) => [...new Array<number>(SERIES_DAYS - 1).fill(0), last];

it("says a failed or missing count could not be read, with nothing implying a number", () => {
  for (const counts of [null, undefined]) {
    const tile = tileContent("maintenance", counts, t);
    expect(tile.unreadable).toBe(true);
    expect(tile.content).toEqual({ value: null, note: "Could not be read" });
  }
});

it("makes open tickets waiting work, with urgent ones as a bad fact and a 30-day trend", () => {
  const { content, unreadable } = tileContent("maintenance", { open: 4, inProgress: 1, urgent: 2, series: series(3) }, t);
  expect(unreadable).toBe(false);
  expect(content).toMatchObject({ value: 4, unit: "open tickets", waiting: true });
  expect(content.facts).toContainEqual({ label: "High or critical", value: 2, tone: "bad" });
  expect(content.series?.label).toBe("3 tickets reported in the last 30 days, 3 today");
});

it("does not call the inventory's attention flags waiting work", () => {
  const { content } = tileContent(
    "inventory",
    { total: 5, published: 4, draft: 1, archived: 0, needsAttention: 3, noPhoto: 0, noManual: 2, neverReviewed: 3 },
    t
  );
  expect(content.waiting).toBeFalsy();
  expect(content.facts).toContainEqual({ label: "No photo", value: 0, tone: "ok" });
  expect(content.facts).toContainEqual({ label: "No manual", value: 2, tone: "warn" });
});

it("says the mirror's state in words, not a number", () => {
  expect(tileContent("mirror", { state: "paused" }, t).content).toEqual({ value: null, note: "Paused" });
});
