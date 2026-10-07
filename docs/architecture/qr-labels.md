# QR labels

> Moved verbatim from `AGENTS.md` on 2026-09-29, when `AGENTS.md` became an
> index. Paths are relative to the repository root.

## QR labels (`/admin/inventory/qr`, `/api/qr/[slug]`, `get_tool_qr_code`)

QR codes spec amendment 2026-09-29 ("QR labels in the app"). Staff print a code
for each machine; anybody who scans it lands on that tool's page. No migration,
no new permission, no model call.

- **One URL format.** `src/lib/qr/urls.ts` owns `?src=qr` and
  `toolQrTargetUrl(origin, slug)`; the label script, `QrArrivalNotice`, the
  admin sheets, the tool page's dialog, the image route and the assistant all
  import it — never spell the URL again. The origin is `qrSiteUrl()`
  (`NEXT_PUBLIC_SITE_URL` → `https://${VERCEL_PROJECT_PRODUCTION_URL}` →
  `https://makerlab-ai.vercel.app`), never the request host: a label outlives
  a preview deployment. Pages compute it on the server and pass URLs down.
- **`src/lib/qr/*` is shared and pure** (except `png.ts`, server-only): the
  matrix and its path (`matrix.ts`), the label layout and sheet packing in
  millimetres (`label-layout.ts`), the label SVG (`label-svg.ts`), the PDF
  (`label-pdf.ts`, `pdf-lib`, Helvetica — a standard font, nothing embedded),
  the styler settings (`settings.ts`). Its relative imports carry `.ts` so the
  label script runs it under plain Node (`npm run qr:labels -- --pdf`).
- **The admin page** (`tools.edit`, linked from the inventory header; a
  `loading.tsx` like every admin folder) lists published tools only and hands
  them to `components/admin/qr/QrLabelStudio`, which does the rest in the
  browser: preview, PDF (`pdf-lib` loaded on the first click), one-click print
  through a hidden frame, SVG/PNG of one label. Printing writes nothing — no
  server action, no audit, nothing for the parity guard. The style lives in
  `localStorage` (try/catch), read after hydration (`useHydrated`).
- **`GET /api/qr/[slug]`** is public, published-only (draft, archived and
  unknown are one 404), limited per hashed IP (`ROUTE_TIERS.qr`, no cookie),
  CDN-cached. The tool page's `ToolQrButton` (beside `FlagButton`, which takes
  `inline` there) and the chat's `ToolQrCard` load their images from it.
- **`get_tool_qr_code`** (`capabilities/qr.ts`, capability `qr`) is a read for
  every role, anonymous included, chat only; it writes a `data-tool-qr` part.
  It is not a proposal and not an outside-content read, so neither the
  confirmation card nor taint applies. Its name must stay clear of the deny
  list's words (`download`, `export`… would forbid it).
- **Codes in chat photos.** The chat route reads QR codes in the turn's
  photos (`lib/chat/photo-qr.ts` → `lib/qr/decode.ts`: `jsqr` over `sharp`
  pixels at 1600/1000/2400 px, ≤1.5 s an image, ≤4 images, 2.5 s a turn,
  never throws) and matches them with `lib/qr/match.ts` (our hosts only,
  `/tools/<slug|id|Notion id>`). The prompt gets a "QR codes in this
  message's photos" section of server-resolved hints — a published tool's
  slug and name, "not published", or "an external site". **A decoded payload
  never reaches the prompt**: it is text off a sticker anybody could print.
- **Unit labels** (amendment 2026-10-06, spec §13). A unit's code is the
  tool's with `&unit=<token>` (`unitQrTargetUrl`; the token is the unit
  uuid's first eight hex characters, `unitQrToken`). The token is resolved
  only among that tool's own units (`unitForToken`, after `parseUnitToken`
  validates it); no match, or two, names no unit. The studio's **Tools /
  Units** switch lists every non-retired unit of every published tool (the
  page hands each row its units from `listToolUnitOptions`); a unit's label
  puts the tool's name on one line and the unit's under it, in the room a
  second name line takes, so the 2″ code stays above 25 mm.
  `QrArrivalNotice` names the unit and offers **Report a problem with this
  unit**, which opens the chat seeded with the unit's name: the report form
  is the assistant's `report_issue`. `findUnit` resolves a unit id exactly
  and prefers the focused tool's units for a shared label, and the photo hint
  names the unit and its id for a unit code. `/api/qr/[slug]`, the tool
  page's dialog and `get_tool_qr_code` stay tool-only.
- **Size defaults.** The 1″ preset, and a custom size whose code would fall
  under 25 mm, start with the wordmark and the extra line off
  (`withSizeDefaults`, applied only when the size changes; `showExtra` keeps
  the words while the line is off).
- **Tests:** `lib/qr/*.test.ts`, `app/api/qr/[slug]/route.test.ts`,
  `lib/chat/photo-qr.test.ts` (photo-like fixtures from `test/images/qr-photo.ts`),
  `capabilities/qr.test.ts`, `app/admin/inventory/qr/page.test.tsx`,
  `components/admin/qr/QrLabelStudio.test.tsx`,
  `components/tool/ToolQrButton.test.tsx`, `components/chat/ToolQrCard.test.tsx`,
  `scripts/generate-qr-labels.test.ts`; eval case `qr-code-calls-tool`.
