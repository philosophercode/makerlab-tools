import { CSV_BOM } from "./csv";
import { DEMO_SIGNUP_CSV_HEADERS, demoSignupsCsv, demoSignupsCsvFilename } from "./demo-signups-csv";

/** The demo sign-ups CSV (demo pass spec 2026-10-07 §5.6). */

const RECORD = {
  name: "Ada Lovelace",
  email: "ada@example.org",
  institution: "Analytical Engines Lab, London",
  role: "lab_manager",
  runsMakerspace: true,
  useCase: "=HYPERLINK(\"http://evil.example\")",
  consentToContact: true,
  passExpiresAt: new Date("2026-10-25T15:00:00.000Z"),
  spentUsd: 0.123456,
  chargedTurns: 7,
  lastUsedAt: null,
  createdAt: new Date("2026-10-11T15:00:00.000Z"),
};

describe("demoSignupsCsv", () => {
  it("writes one row per sign-up under English headers, consent included", () => {
    const csv = demoSignupsCsv([RECORD, { ...RECORD, email: "b@example.org", role: null, runsMakerspace: null, useCase: null, consentToContact: false }]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(DEMO_SIGNUP_CSV_HEADERS.join(","));
    expect(lines[1]).toContain('2026-10-11T15:00:00.000Z,Ada Lovelace,ada@example.org,"Analytical Engines Lab, London",lab manager,yes,');
    expect(lines[1]).toContain(",yes,2026-10-25T15:00:00.000Z,0.1235,7,");
    expect(lines[2]).toContain(",b@example.org,");
    expect(lines[2]).toContain(",,,,no,");
  });

  it("defuses a formula a visitor typed", () => {
    expect(demoSignupsCsv([RECORD])).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
  });

  it("names the file by the day it was downloaded", () => {
    expect(demoSignupsCsvFilename(new Date("2026-10-11T23:00:00Z"))).toBe("demo-signups-2026-10-11.csv");
  });
});
