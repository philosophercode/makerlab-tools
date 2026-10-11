# Demo Admin Mode — Design Spec (amendment to the demo pass, 2026-10-07)

**Date:** 2026-10-11
**Status:** Requested by the owner (Isaac Steinberg) for the ISAM demo on 11 October — built on `v5/demo-admin`
**Target:** the app (repository root)

## 1. Summary

While `DEMO_ADMIN=1`, every visitor who is **not signed in** is the *demo
identity* ("Demo admin" in the header). They see the admin surface as a director
does, and may do two things: **add equipment** (published at once) and **report
a problem**. Everything else is read-only, and no account can be changed. Unset
the variable and the app is exactly what it was. Signed-in people of any role
are never affected; staff still sign in with the header's Sign in button.

## 2. The flag

`DEMO_ADMIN` — `1` or `true` turns it on, anything else leaves it off. Read at
call time (`lib/demo-admin/config.ts`). For a live demo only: turn it off
straight after.

## 3. The identity

`resolveIdentity` and `resolveIdentityFromHeaders` call `visitorIdentity()` only
where no session resolved. With the flag on it answers
`{ role: "demo_admin", userId: null, email: null, name: "Demo visitor" }` with
the visitor's per-IP `rateLimitKey`. `anonymousIdentity()` itself never answers
demo, so MCP (`mcp-caller.ts`) and every failure path stay anonymous.
`demo_admin` is not a stored role: it is outside `IDENTITY_ROLES`, so
`isRole`/`storedRoleOr` can never read it from the database or a client, and it
is not in the `roles` object handed to Better Auth's admin plugin.

## 4. Security model: seeing is not doing

- **`can()` — what you may do — is fail-closed for the demo.** Its grants are
  `tools.add`, `catalog.view_drafts` and `catalog.view_serials` only. Every
  server action, route and capability still asks `can()`, so a write path
  nobody thought about refuses the demo.
- **`canView()` — what you may see — is new.** For every real role it *is*
  `can()`. For the demo it is `super_admin`'s grants. Only page gates, the
  admin nav (`surfacesFor`), `canReachAdmin` and three read-only server actions
  (`authorizeAdminView`: the tool editor's read, the refresh picker, the
  cleaned-image preview) use it.
- **No `userId`.** The demo identity carries none, so every path that needs a
  person (account, tokens, OAuth consent, proposals, imports, shifts, the
  Notion mirror) refuses it. Better Auth's `user`/`session` endpoints need a
  real session, which the demo never has.
- The **Mirror** and **MCP proposals** pages are a person's own; the demo is
  not offered them (`personal` surfaces).

## 5. The two writes

- **One actor row.** Intake records a person at every step (FKs to `user`), so
  the demo's writes are attributed to one row, `demo-admin-actor`
  (`lib/demo-admin/actor.ts`): created on first use, stored role `user`, address
  `demo-admin@demo.invalid` (outside the sign-in domain, so no session or token
  can ever act as it). It is attached only where the demo may write: chat
  `identify_tools`, `POST /api/uploads`, `POST /api/pending-tools/research`,
  tickets, and the demo approval. All demo visitors share it — and its research
  allowance (100 items a day).
- **Add equipment.** The chat names the item, the card researches it, and the
  review page's **Approve** publishes it. `approvePending` routes the demo to
  `approveAsDemo` (`lib/demo-admin/approve.ts`): limiter, parse, then an
  **owner check** (the item's `created_by` must be the demo actor) in place of
  `tools.approve`/`tools.publish`, then `PENDING_APPROVE.run`. The demo can
  work and publish only the demo's own pending items (`canActOnPendingTool`);
  no other approval, publish, archive, restore or add-as-unit is reachable.
- **Report a problem.** Already open to every visitor (chat `report_issue`,
  the quick report form). The demo's tickets are the actor's (so they claim the
  demo's photos), still spend the anonymous ticket slots, and land flagged
  `demo` like a demo pass's: in the queue, out of the counts, no staff email.
  Demo chat turns count in the `demo` usage audience.

## 6. Addresses and sign-ups

Addresses are masked **on the server** before a page hands rows to a client
island: `i***@cornell.edu` (`lib/demo-admin/mask-email.ts`) — the People roster
(and a name that is an address), blocked emails, maintenance reporters and
correction reporters. `catalog.export` and `insights.export` are not granted.
**Demo sign-ups are never shown**: `/admin/users/demo-signups` is a 404 for the
demo, its CSV route answers 404, and the People page shows neither the link nor
the count.

## 7. Sample people

For the demo identity only, the People page appends twenty made-up people
(`lib/demo-admin/sample-people.ts`: 15 `user`, 5 `admin`, on `example.edu`),
each tagged **Sample**. They are generated in code, never stored, and the whole
roster is read-only for that viewer. Real signed-in viewers never see them.

## 8. Known limits

- The chat allowance is the anonymous one per IP (`RATE_LIMIT_ANON_CHAT`), or a
  demo pass's when the visitor holds one.
- A banned or out-of-domain session also falls back to the demo identity while
  the flag is on (read-only, masked).
