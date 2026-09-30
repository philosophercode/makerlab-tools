"use server";

import { PEOPLE_SET_NAME, PEOPLE_SET_ROLE, PEOPLE_SET_TITLE } from "../../../lib/actions/people";
import { PEOPLE_ADD, PEOPLE_REMOVE, PEOPLE_UNBLOCK_EMAIL } from "../../../lib/actions/people-roster";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type {
  AddPersonInput,
  AddPersonResult,
  AdminActionResult,
  RemoveUserResult,
  SetNameResult,
  SetTitleResult,
  UnblockEmailResult,
} from "./action-result";

/**
 * The writes `/admin/users` performs (data platform spec §5.2, §8; auth spec
 * amendment 2026-09-25 for Remove and Unblock).
 *
 * **Each is a one-line wrapper** over its action definition in
 * `src/lib/actions/people*.ts` (assistant–GUI parity spec §3.1). A server
 * action is a POST endpoint with a generated name, reachable without the page
 * that offers it, so it trusts nothing the page sent about who is asking: the
 * identity comes from the session cookie here, and `performAction` runs the
 * same gate (limiter, sign-in, `users.manage`), the floor reconciliation, the
 * action's own refusals and its audit — the path the assistant's confirmation
 * card will take in phase 2. Refusals are values the island renders; a change
 * that lands without its audit event is a success with a warning.
 */

export async function setUserRole(input: { userId: string; role: string }): Promise<AdminActionResult> {
  return performAction(PEOPLE_SET_ROLE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function setUserTitle(input: { userId: string; title: string | null }): Promise<SetTitleResult> {
  return performAction(PEOPLE_SET_TITLE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function setUserName(input: { userId: string; name: string }): Promise<SetNameResult> {
  return performAction(PEOPLE_SET_NAME, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function addPerson(input: AddPersonInput): Promise<AddPersonResult> {
  return performAction(PEOPLE_ADD, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function removeUser(input: { userId: string; block: boolean; reason?: string }): Promise<RemoveUserResult> {
  return performAction(PEOPLE_REMOVE, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

export async function unblockBlockedEmail(input: { email: string }): Promise<UnblockEmailResult> {
  return performAction(PEOPLE_UNBLOCK_EMAIL, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
