/**
 * The words of the staff emails, in English (email notifications spec §2
 * "Localised bodies in v1", amendment 2026-10-07).
 *
 * Staff mail is admin copy, and admin copy is English (AGENTS.md). It lives
 * here rather than in `messages/en.json` because templates render inside
 * workflow steps, which run under plain Node outside Next and cannot load
 * `next-intl`'s request config. When a stored per-person locale arrives
 * (translation pass), these move to an `email` namespace.
 */

export const PRIORITY_LABEL: Readonly<Record<string, string>> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const copy = {
  ticketFiled: {
    subject: (tool: string, title: string, priority: string) =>
      `${tool ? `New ticket on ${tool}` : "New ticket"}: ${title}${priority ? ` (${priority})` : ""}`,
    heading: "A new maintenance ticket",
    intro: (site: string, time: string) => `A ticket was filed on ${site} at ${time}.`,
    machine: "Machine",
    unit: "Unit",
    priority: "Priority",
    reportedBy: "Reported by",
    noMachine: "No machine named",
    signedIn: (name: string) => `${name} (signed in)`,
    viaApp: (name: string) => `${name}, via a connected app`,
    named: (name: string) => `${name} (name not verified)`,
    anonymous: "Reported anonymously",
    open: "Open the ticket",
    why: "You get this because you work maintenance tickets.",
    unsubscribe: "Turn off these emails",
  },
  maintenanceDue: {
    subject: (overdue: number, dueToday: number) => {
      const parts = [overdue > 0 ? `${overdue} overdue` : "", dueToday > 0 ? `${dueToday} due today` : ""].filter(Boolean);
      return `Shift checklist: ${parts.join(", ")}`;
    },
    heading: "Recurring maintenance due",
    intro: (date: string) => `What the Shift checklist holds for ${date}.`,
    overdue: (count: number) => `Overdue (${count})`,
    dueToday: (count: number) => `Due today (${count})`,
    daysOverdue: (days: number) => (days === 1 ? "1 day overdue" : `${days} days overdue`),
    labWide: "General lab upkeep",
    more: (count: number) => `and ${count} more on the checklist`,
    open: "Open the Shift checklist",
    why: "You get this because you work maintenance. It comes at 8:00 on days when something is due.",
    unsubscribe: "Turn off this reminder",
  },
} as const;
