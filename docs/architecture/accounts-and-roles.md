# Accounts, roles and permissions

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## Accounts, roles and permissions (Phase 4)

**Better Auth runs the way it is meant to be run**, on the Drizzle adapter over
the same `getDb()` handle everything else uses. It owns four tables — `user`,
`session`, `account`, `verification` (`src/lib/db/schema/auth.ts`, migration
`0003`). The stateless `makerlab.identity` cookie is **retired**:
`src/lib/auth/session-cookie.ts` has no importers and is awaiting deletion
approval. Do not mint one.

- **Sessions are rows.** The cookie carries only a token; `resolveIdentity`
  looks the session and its user up on every request. That is why a role change
  lands on the person's next request and a ban bites immediately — **with one
  exception, a floor address, described under `AUTH_SUPER_ADMIN_EMAILS`
  below.** Better Auth's cookie cache is deliberately off.
- **Roles** are `anonymous` (never a row) plus the stored `user | admin |
  super_admin` (`src/lib/db/schema/vocabulary.ts`, which also backs the
  `user_role_check` constraint). `student` and `staff` are gone; today's `admin`
  is the old `staff`, and today's `super_admin` is the old `admin`.
- **What each role may do is declared in code**, not in a table:
  `src/lib/auth/permissions.ts` (`statement` / `ac` / `roles` / `can()`), the
  same declaration the admin plugin is configured with. **One check,
  everywhere:** routes, server actions and capability composition call
  `can(identity, "tools.add")`; client components call it with the role
  `/api/identity` reports, to hide a control. Hiding is presentation; the
  server check is the control.
- **Capabilities declare `requiredPermission`**, enforced once by
  `capabilitiesForIdentity` in `src/lib/capabilities/access.ts` — never inside a
  tool's `run()`.
- **Students see only the last four characters of a unit's serial**; whole
  serials are staff-only (`catalog.view_serials`, admins and super admins;
  data platform spec amendment 2026-10-06). The catalogue reads build units
  with no `serial` field, only `serialMasked` (`•••• 9831`,
  `src/lib/serial-mask.ts`; nothing for a serial of four characters or fewer),
  so cached pages, the kiosk and every prompt carry no whole serial.
  `src/lib/unit-serials.ts` swaps in the whole serial for staff on the tool
  page, in the chat's focused tool and in `get_unit_details` /
  `get_tool_details`. Like reporter names, that is a field narrowed in a
  result, not a refused tool.
- **Staff mark themselves on shift** (`shifts.set`, admins and super admins;
  on-shift spec 2026-10-07). The same permission decides who may *appear*:
  the public roster runs each shift's account through `evaluateUser` (floor
  and ban, as a sign-in would) and `can(…, "shifts.set")`, so somebody demoted
  or banned while on shift drops off. Students see first name and last
  initial only (`lib/on-shift/names.ts`).
- **`AUTH_STAFF_EMAILS` / `AUTH_ADMIN_EMAILS` are retired.** Nothing reads them.
  The one env list left is **`AUTH_SUPER_ADMIN_EMAILS`, a floor, not a roster**
  (`src/lib/auth/super-admins.ts`): a listed address is created as
  `super_admin` and resolves as `super_admin` whatever its row says. It is the
  bootstrap (no user row exists until somebody signs in) and the lock-out
  guarantee.
- **"Whatever its row says" includes `banned`**, and that is the one exception
  to "a ban bites immediately". `identityFromSession` reads the floor *before*
  the ban check, so a listed address keeps resolving `super_admin` on a session
  it already holds. It does not rescue a *sign-in*: the admin plugin throws
  `BANNED_USER` from its own `session.create.before` hook, which runs ahead of
  anything this app can register, so the row itself has to change.
  `src/lib/auth/floor-role.ts` (`reconcileSuperAdminFloor`) is where it does —
  called from `/admin/users`' `authorize()` after the permission check, it
  writes the floor's `role` **and** clears `banned` on the caller's own row, so
  the first admin write a recovered director performs makes ordinary sign-in
  work again. It only ever promotes and unbans, only for an address the
  environment already names, and it records both as audit events with a null
  actor. It exists because `can()` honours the floor and the admin plugin does
  not: the plugin reads the stored `role` and `banned` for itself, so a row left
  disagreeing produces an opaque `failed` on every save.
- **Everything stays optional.** `AUTH_SECRET` alone gives database sessions;
  the two `GOOGLE_*` variables are what make *starting* one possible, and
  without them `/api/auth/sign-in/social` answers 503 and the header says
  sign-in is not set up. With neither, nobody is signed in and the catalogue and
  chat are unchanged. **Sign-in unlocks; it never gates the front door.**
- **A refused sign-in is a page with a way out** (auth spec amendment 2026-10-07).
  Every Google sign-in sends `prompt=select_account`, so Google shows its account
  chooser instead of reusing whichever account the browser holds. When the create
  hook refuses an address (outside the domain, or blocked) it leaves a ten-minute,
  HttpOnly, `AUTH_SECRET`-signed cookie, `makerlab.refused_sign_in`, naming the
  address and the page the sign-in started from (`src/lib/auth/refused-sign-in.ts`).
  `/auth/rejected` and `/auth/blocked` read it (`readRefusedSignIn`, inside Suspense)
  and say "<address> can't be used: <why>", then offer **Use a different Google
  account**: sign out, then Google sign-in again back to that page
  (`switchGoogleAccount`). The address is never put in a URL. The after-hook's
  refusal of an existing out-of-domain row deletes the session it was given, row and
  cookie, before redirecting. With `hd` in force (no `AUTH_ALLOWED_EMAILS`), Better
  Auth's claim check refuses a personal account first with `unable_to_get_user_info`,
  and the auth route sends that to `/auth/rejected` too.
- **Testing a role needs no Google.** `test/utils/session.ts` seeds a `user` and
  a `session` row and mints the cookie Better Auth would have set; the demo seed
  ships one account per role for E2E. See `test/README.md`.
- **Developing as a role needs no Google either — locally.** With
  `DEV_AUTO_SIGN_IN=1` (and `AUTH_SECRET`) in `.env.local`, `npm run dev` serves
  `GET /api/dev/sign-in?as=<email>&next=<path>`: a real Better Auth session via a
  `SERVER_ONLY` endpoint (`src/lib/auth/dev-sign-in-plugin.ts` — no
  `/api/auth/*` URL), so the create hook, the floor role and the ban check are
  Better Auth's own and cannot drift from Google sign-in. Guards in
  `src/lib/auth/dev-sign-in.ts`; each refuses with **404**: `NODE_ENV` must be
  `development`, `VERCEL` unset, `DEV_AUTO_SIGN_IN` exactly `1`, the request's
  Host loopback with no forwarded visitor address (tunnels refused), the address
  allowed and not banned. `DEV_AUTO_SIGN_IN_EMAIL` is the default `as`, and
  `/api/identity` adds `devSignIn: true` for an anonymous caller who passes the
  guards, which is the only time the header shows "Sign in as (dev)". Audited
  as `auth.dev_sign_in`. **Never set either variable on a deployment** — a
  Vercel build that has `DEV_AUTO_SIGN_IN` fails (`next.config.ts`,
  `dev-sign-in-build-check.ts`).
- **`created_by` / `updated_by` now reference `user.id`** (`on delete set null`),
  the foreign keys Phase 1 deferred. A write whose author is not a row is
  refused — correct, because in production that id comes from a session.
- **So do the three other columns that name a person**, as of migration `0004`:
  `tools.last_reviewed_by`, `maintenance_logs.assigned_to_user_id` and
  `projects.published_by`, which Phase 5 is the first code to write. They share
  `userReference()` in `src/lib/db/schema/helpers.ts` with `actorColumns()` — a
  fourth spelling of the same foreign key is the thing to avoid. All are
  `on delete set null`: removing a person must never remove the work, which is
  why `last_reviewed_at`, `assigned_to_name` and `published_at` are worth
  keeping beside them. They are what is left when the account goes.
