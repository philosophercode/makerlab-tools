import { z } from "zod";
import { listFeedbackQueue } from "../data/feedback";
import { listProjectsForModeration } from "../data/projects";
import { listUsers } from "../data/users";
import { fenceUntrusted, OTHERS_TEXT_NOTE } from "../web/fence";
import type { Capability, CapabilityTool } from "./types";

/**
 * The reads the generated action tools need (assistant–GUI parity spec §3.4):
 * resolving "Luis" to one account, "the Glowforge correction" to one row.
 * Each is gated like the page it mirrors — `users.manage` for People,
 * `feedback.manage` for corrections, `projects.moderate` for projects — and
 * enforced once, by `capabilitiesForIdentity`.
 *
 * **Emails are masked** (§11 answer 6): `find_people` tells two Luises apart
 * with `l***@cornell.edu`, and no address reaches the model whole. **Text
 * other people wrote is fenced** (§8.4): a correction's report and a
 * project's write-up are data, never instructions.
 *
 * Chat only for now; which of these MCP gets is phase 7's question.
 */

/** `luis@cornell.edu` → `l***@cornell.edu`. Anything not shaped like an address is hidden whole. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

// ── find_people ─────────────────────────────────────────────────────

const FIND_PEOPLE_LIMIT = 10;

interface FindPeopleInput {
  query: string;
}

interface PersonMatch {
  id: string;
  name: string;
  role: string;
  title: string | null;
  email_masked: string;
  signed_in_yet: boolean;
}

const findPeopleTool: CapabilityTool<FindPeopleInput, { count: number; people: PersonMatch[] }> = {
  name: "find_people",
  description:
    "Find people on the roster by name, title or email address, for a change to one of them. Returns each match's id, name, role, custom title (null means the role's default) and a masked email to tell two people apart. Super admins only.",
  inputSchema: z.strictObject({
    query: z.string().min(1).max(100).describe("A name, part of a name, a title or an email address"),
  }),
  kind: "read",
  chatOnly: true,
  requiredPermission: "users.manage",
  run: async (input) => {
    const needle = input.query.trim().toLowerCase();
    const people = (await listUsers())
      .filter((person) =>
        [person.name, person.email, person.title ?? ""].some((field) => field.toLowerCase().includes(needle))
      )
      .slice(0, FIND_PEOPLE_LIMIT)
      .map(
        (person): PersonMatch => ({
          id: person.id,
          name: person.name,
          role: person.role,
          title: person.title,
          email_masked: maskEmail(person.email),
          signed_in_yet: person.firstSignedInAt !== null,
        })
      );
    return { count: people.length, people };
  },
};

// ── list_corrections ────────────────────────────────────────────────

const OPEN_CORRECTION_STATUSES = new Set(["new", "reviewed"]);

const listCorrectionsTool: CapabilityTool<Record<string, never>, { count: number; corrections: string }> = {
  name: "list_corrections",
  description:
    "List the corrections still waiting (new or reviewed), as /admin/corrections shows them: each one's id, tool, field and status, with the reporter's words fenced as untrusted text. Staff only.",
  inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  kind: "read",
  chatOnly: true,
  requiredPermission: "feedback.manage",
  run: async () => {
    const open = (await listFeedbackQueue()).filter((row) => OPEN_CORRECTION_STATUSES.has(row.status)).slice(0, 50);
    const lines = open.map((row) =>
      [
        `- id: ${row.id} · tool: ${row.toolName || "(none)"} · field: ${row.fieldFlagged ?? "(none)"} · status: ${row.status}`,
        `  report: ${oneLine(row.issueDescription, 400)}`,
        row.suggestedFix ? `  suggested fix: ${oneLine(row.suggestedFix, 300)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return {
      count: open.length,
      corrections: fenceUntrusted("the corrections queue (reports written by visitors)", lines.join("\n") || "(none)", OTHERS_TEXT_NOTE),
    };
  },
};

// ── list_project_queue ──────────────────────────────────────────────

const listProjectQueueTool: CapabilityTool<Record<string, never>, { count: number; projects: string }> = {
  name: "list_project_queue",
  description:
    "List submitted projects, unpublished first, as /admin/projects shows them: each one's id, title, author and whether it is published, with the write-up fenced as untrusted text. Staff only.",
  inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  kind: "read",
  chatOnly: true,
  requiredPermission: "projects.moderate",
  run: async () => {
    const rows = (await listProjectsForModeration({ limit: 50 })).map((project) =>
      [
        `- id: ${project.id} · title: ${oneLine(project.title, 120)} · author: ${project.authorName || "Anonymous"} · ${project.published ? "published" : "not published"}`,
        project.body ? `  write-up: ${oneLine(project.body, 300)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    return {
      count: rows.length,
      projects: fenceUntrusted("the project queue (write-ups by students)", rows.join("\n") || "(none)", OTHERS_TEXT_NOTE),
    };
  },
};

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const adminReads: Capability = {
  id: "admin-reads",
  // The actions capability's prompt names these; nothing of their own to add.
  promptFragment: () => "",
  tools: [
    findPeopleTool as unknown as CapabilityTool<unknown, unknown>,
    listCorrectionsTool as unknown as CapabilityTool<unknown, unknown>,
    listProjectQueueTool as unknown as CapabilityTool<unknown, unknown>,
  ],
};
