// @vitest-environment node
import { siteConfig } from "../../site-config";
import type { DueSubject, TicketSubject } from "../subjects";
import { escapeHtml, excerpt, EXCERPT_MAX, subjectLine, SUBJECT_MAX } from "./html";
import { DUE_LINES_MAX, renderMaintenanceDue } from "./maintenance-due";
import { renderTicketFiled } from "./ticket-filed";

/**
 * The email templates (email notifications spec §6, §8 "Untrusted input",
 * §10 unit): ticket text comes from a student through a model, so it is
 * escaped, capped and kept out of headers and links; the official logo heads
 * every email (amendment 2026-10-07).
 */

const ORIGIN = "https://makerlab.example";

function ticket(overrides: Partial<TicketSubject> = {}): TicketSubject {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    title: "Laser not firing",
    description: "Pressed start, the head moves but no beam. Tried re-homing.",
    priority: "high",
    status: "open",
    toolName: "Trotec Speedy 400",
    unitLabel: "Speedy #2",
    reporterName: "Jordan Lee",
    reporterSignedIn: true,
    createdAt: new Date("2026-10-07T20:12:00Z"),
    ...overrides,
  };
}

function renderTicket(overrides: Partial<TicketSubject> = {}, surface: "chat" | "mcp" | null = "chat") {
  return renderTicketFiled({
    ticket: ticket(overrides),
    surface,
    origin: ORIGIN,
    ticketUrl: `${ORIGIN}/admin/maintenance#ticket-11111111-2222-3333-4444-555555555555`,
    unsubscribeUrl: `${ORIGIN}/notifications/unsubscribe?t=v1.abc.def`,
    filedAt: "4:12 PM",
  });
}

describe("ticket.filed email", () => {
  it("names the machine, the title and the priority in the subject", () => {
    expect(renderTicket().subject).toBe("New ticket on Trotec Speedy 400: Laser not firing (High)");
    expect(renderTicket({ toolName: "", priority: null }).subject).toBe("New ticket: Laser not firing");
  });

  it("says what, where, who and links to the ticket and the off switch, in both parts", () => {
    const email = renderTicket();
    for (const part of [email.text, email.html]) {
      expect(part).toContain("Trotec Speedy 400");
      expect(part).toContain("Speedy #2");
      expect(part).toContain("High");
      expect(part).toContain("Jordan Lee (signed in)");
      expect(part).toContain("/admin/maintenance#ticket-11111111-2222-3333-4444-555555555555");
      expect(part).toContain("/notifications/unsubscribe?t=v1.abc.def");
      expect(part).toContain("4:12 PM");
    }
  });

  it("names a unit labelled with its tool's own name once", () => {
    const email = renderTicket({ unitLabel: "Trotec Speedy 400" });
    expect(email.text).not.toContain("Unit:");
    expect(email.text).toContain("Machine: Trotec Speedy 400");
  });

  it("heads the HTML with the official logo PNG on a white band", () => {
    const { html } = renderTicket();
    expect(html).toContain(`src="${ORIGIN}${siteConfig.logoPng}"`);
    expect(siteConfig.logoPng).toMatch(/\.png$/);
    expect(html).toContain('bgcolor="#ffffff"');
  });

  it("says how the report came in: signed in, via a connected app, unverified, anonymous", () => {
    expect(renderTicket({}, "mcp").text).toContain("Jordan Lee, via a connected app");
    expect(renderTicket({ reporterSignedIn: false }).text).toContain("Jordan Lee (name not verified)");
    expect(renderTicket({ reporterName: "", reporterSignedIn: false }).text).toContain("Reported anonymously");
  });

  it("escapes a script in the title and description; nothing typed becomes markup", () => {
    const email = renderTicket({ title: "<script>alert(1)</script>", description: '<img src=x onerror="steal()">' });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;steal()&quot;&gt;");
  });

  it("keeps newlines out of the subject line and caps it", () => {
    const email = renderTicket({ title: "Broken\r\nBcc: everyone@example.com\nagain", toolName: "X".repeat(200) });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.length).toBeLessThanOrEqual(SUBJECT_MAX);
  });

  it("caps the description excerpt", () => {
    const long = "word ".repeat(400);
    const email = renderTicket({ description: long });
    expect(email.text).not.toContain(long.trim());
    expect(excerpt(long).length).toBeLessThanOrEqual(EXCERPT_MAX);
  });

  it("never shows an address, even when the reporter typed one as their name", () => {
    // The loader never selects the reporter's email; this proves the template
    // adds none of its own.
    const email = renderTicket({ reporterName: "Jordan" });
    expect(email.text).not.toMatch(/@/);
    expect(email.html).not.toMatch(/mailto:/);
  });

  it("leaves the off switch out when no token could be signed", () => {
    const email = renderTicketFiled({ ...{ ticket: ticket(), surface: "chat", origin: ORIGIN, ticketUrl: `${ORIGIN}/x`, filedAt: "9:00 AM" }, unsubscribeUrl: null });
    expect(email.text).not.toContain("Turn off these emails");
    expect(email.html).not.toContain("Turn off these emails");
  });
});

function due(overrides: Partial<DueSubject> = {}): DueSubject {
  return {
    labDate: "2026-10-07",
    overdue: [{ title: "Clean the lens", toolName: "Trotec Speedy 400", unitLabel: "Laser A", dueOn: "2026-10-04", overdueDays: 3 }],
    dueToday: [
      { title: "Empty the dust bin", toolName: "", unitLabel: "", dueOn: "2026-10-07", overdueDays: 0 },
      { title: "Check the <resin> tank", toolName: "Form 4", unitLabel: "", dueOn: "2026-10-07", overdueDays: 0 },
    ],
    ...overrides,
  };
}

function renderDue(subject: DueSubject = due()) {
  return renderMaintenanceDue({
    due: subject,
    origin: ORIGIN,
    checklistUrl: `${ORIGIN}/admin/maintenance/checklist`,
    unsubscribeUrl: `${ORIGIN}/notifications/unsubscribe?t=v1.abc.def`,
    dateLabel: "Wednesday, October 7",
  });
}

describe("maintenance.due email", () => {
  it("counts the tasks that came due in the subject", () => {
    expect(renderDue().subject).toBe("Shift checklist: 3 recurring tasks came due");
    expect(renderDue(due({ overdue: [], dueToday: due().dueToday.slice(0, 1) })).subject).toBe("Shift checklist: 1 recurring task came due");
  });

  it("lists each task with its machine, lab-wide upkeep and lateness, today's first, and links to the Shift checklist", () => {
    const email = renderDue();
    expect(email.text).toContain("Due today (2)");
    expect(email.text).toContain("Came due earlier (1)");
    expect(email.text.indexOf("Due today (2)")).toBeLessThan(email.text.indexOf("Came due earlier (1)"));
    expect(email.text).toContain("- Clean the lens · Trotec Speedy 400 · Laser A · 3 days overdue");
    expect(email.text).toContain("once for each due date");
    expect(email.text).toContain("- Empty the dust bin · General lab upkeep");
    expect(email.text).toContain(`Open the Shift checklist: ${ORIGIN}/admin/maintenance/checklist`);
    expect(email.text).toContain("Wednesday, October 7");
    expect(email.html).toContain("Check the &lt;resin&gt; tank");
    expect(email.html).toContain(`src="${ORIGIN}${siteConfig.logoPng}"`);
  });

  it("shows at most DUE_LINES_MAX lines per section and counts the rest", () => {
    const many = Array.from({ length: DUE_LINES_MAX + 4 }, (_, i) => ({ title: `Task ${i}`, toolName: "", unitLabel: "", dueOn: "2026-10-07", overdueDays: 0 }));
    const email = renderDue(due({ overdue: [], dueToday: many }));
    expect(email.text).toContain(`Task ${DUE_LINES_MAX - 1}`);
    expect(email.text).not.toContain(`Task ${DUE_LINES_MAX} ·`);
    expect(email.text).toContain("and 4 more on the checklist");
  });
});

describe("html helpers", () => {
  it("escapes the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });

  it("flattens a subject to one line", () => {
    expect(subjectLine("a\nb\r\nc\u2028d")).toBe("a b c d");
  });
});
