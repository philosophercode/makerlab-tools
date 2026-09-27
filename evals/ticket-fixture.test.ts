import { nextCacheMock } from "../test/mocks/next-cache";
import { listMaintenanceQueue } from "@/lib/data/maintenance";
import { resetDbForTests } from "@/lib/db/client";
import { EVAL_TICKET_TITLE, seedEvalTickets } from "./ticket-fixture";

vi.mock("next/cache", () => nextCacheMock());

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  resetDbForTests();
});

it("puts one open Form 4 ticket in the queue list_open_tickets reads, once", async () => {
  await seedEvalTickets();
  await seedEvalTickets();
  const matches = (await listMaintenanceQueue()).filter((ticket) => ticket.title === EVAL_TICKET_TITLE);
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ status: "open", toolSlug: "form-4" });
});
