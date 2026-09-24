/**
 * The vocabulary every admin write shares (spec §8, §4.11).
 *
 * Its own module, and free of any directive, because both ends need it: a
 * `"use server"` module may export only async functions, and a client island
 * renders these codes without wanting `next/headers` and the limiter in its
 * graph. Phase 4 discovered that shape in `app/admin/users/action-result.ts`;
 * Phase 5 has four more surfaces, so the shared half moved here.
 */

/**
 * Why an admin action refused before it got as far as its own subject.
 *
 * The same four on every surface, checked in the same order, so a page never
 * has to explain a refusal in terms of the page it happens to be. Each surface
 * unions its own codes on top.
 *
 * - `not_signed_in` / `not_permitted` — told apart on purpose: one is
 *   actionable and the other is not, and showing the wrong one is how a page
 *   feels broken.
 * - `rate_limited` — `ADMIN_ACTION_TIER`, 120/min per person (§8).
 * - `failed` — the write did not land. Deliberately opaque to the browser.
 */
export type AdminGateError = "not_signed_in" | "not_permitted" | "rate_limited" | "failed";

/**
 * A change that landed with less than the full guarantee behind it.
 *
 * - `audit_unavailable` — the row changed and `audit_events` did not record it.
 * - `image_not_attached` — an intake approval created the tool, but the product
 *   image the admin chose could not be downloaded, stored or attached, so the
 *   tool has no cover from it (gateway spec §5.2 step 4).
 *
 * **It rides on `ok: true`, and that is the whole idea.** The audit insert is a
 * second statement, after the change it describes has committed; reporting its
 * failure as a failure would make the island restore the previous value and
 * leave the page asserting a state the database no longer holds — the one thing
 * `RoleSelect` promises never to do. Reporting nothing would leave a hole in the
 * trail nobody was told about (§4.11, Article 4). So it is a success that says
 * what is missing, and every code has an `admin.warnings.<code>` message.
 */
export type AdminActionWarning = "audit_unavailable" | "image_not_attached";
