# What the MakerLab assistant can do

The assistant is the chat button on every page (on admin pages, **Ask the
assistant** in the section bar). What it can do depends on who is signed in:
it is offered exactly what your account could do by hand, never more.

The full list, by role — generated from the same definitions the assistant
runs on — is the public page **`/assistant`** ("What MakerLAB AI can and can't
do"), linked from the chat, About, `/mcp` and the product page.

## Everybody

- Find equipment ("what can cut acrylic?"), explain how a machine works from its
  manual, with page references, and say whether a unit is working.
- File a maintenance problem ("Prusa #1's nozzle is clogged") and report a
  mistake on a tool's page. It tries to help you fix the problem first.
- Give you a tool's QR code ("can I have a QR code for this device?"): the code
  appears in the chat with Download PNG and SVG links, and scanning it opens
  the tool's page — the same code the lab's machine labels carry
  (`get_tool_qr_code`, published tools only). Staff print sheets of labels from
  **Inventory → QR labels**.
- Recognise a machine from a photo of its label: attach a photo with one of the
  lab's QR codes in it and the assistant knows which tool it is. The server
  reads the code; only our own tool links are used (a code for a tool that is
  not published, or for another website, identifies nothing and is never
  followed).

## Lab staff (SuperMakers and directors)

The assistant can prepare almost anything you do in `/admin`, in a sentence:

| Ask | What it prepares |
|---|---|
| "Resolve these: replaced the belt" (tickets ticked on Maintenance) | Resolve each ticket with that note |
| "Log maintenance on the WEN: replaced the belt" | A completed maintenance record (work already done) |
| "Dismiss that correction", "Publish Casey's lamp project" | The correction's status; the project in the gallery |
| "Publish the Glowforge", "Mark the Form 4 as reviewed" | The tool's catalogue state |
| "Retire Prusa #3", "Add a unit to the Trotec", "Add the SOP link" | Units and links |
| "Approve these" (items ticked on Intake), "Research the two drills" | Intake approvals and research |
| "Remove these rows" (ticked on an imported list's review) | Imported lists |
| "Sync the Notion mirror", "Pause the mirror" | The mirror's running controls |

Directors can also ask for **people** changes: "Add luis@cornell.edu as an admin
with title Supermaker", "Set Niti's title to Tech Lead", "Make Luis a user".
Making someone a super admin, changing a super admin's role, granting research
allowances, removing someone and blocking or unblocking an address are done on
the **People** page only; the assistant says so.

### Nothing changes until you press Confirm

The assistant never makes a change itself. It puts a **card** in front of you
showing exactly what will change — read from the database, not written by the
assistant — and the change happens only when you press **Confirm**. Typing "yes"
in the chat does not confirm anything. Confirming checks your permission and
every rule again, just as the button on the page would; if the record changed
since the card was drawn, nothing is saved and the card says what it is now.

- **Cards expire after an hour.** Ask again if one did.
- **Several records, one card.** "Approve these" gives one card with a checkbox
  per item; untick any you do not want.
- **Things that cannot be undone** — archiving a tool, deleting a unit, removing
  a link, discarding an intake item — are one at a time, and you type the name
  on the card to confirm.
- **Several things at once.** Send one photo of a whole bench, several photos,
  or a list ("a drill press, two Ryobi batteries and a Cricut"): the assistant
  puts every item it finds on one card — the same machine in two photos once,
  two of a kind as one row of two, anything it cannot name unticked and marked
  "Not sure". Tick what you want and press **Add to research** (it shows how
  much of today's allowance that uses and about what it costs, and asks first),
  **Just add to intake** for later, or **Discard**.
- **Research costs money.** Research, a different image, name suggestions,
  re-processing a manual and refreshing research come as cards that show how
  much of today's allowance is left.
- **"These", "this", "here"** mean the page you are on and the rows you have
  ticked; the assistant asks when nothing is ticked.
- **After reading outside text** (a web page, a manual, a ticket or an imported
  list) in the same message, the assistant will not prepare changes to people or
  anything that cannot be undone, and says so. Ask again in a new message.

## An assistant on your own computer (MCP)

Claude Code, ChatGPT and other assistants can connect to MakerLab as you (see
[`mcp.md`](mcp.md)). They can prepare the same queue and catalogue changes, but
those wait in **Assistant proposals** (`/admin/proposals`) for up to 7 days,
where only you can confirm them. Changes to people, anything that cannot be
undone, and anything that spends research budget are never available to them.

## What it will not do

Create or show access tokens, answer a sign-in consent screen, connect or
disconnect the Notion mirror (connecting needs a Notion secret), change the
language, upload files for you, or edit a tool's fields directly — for fields it
proposes a change, with its sources, that staff accept on the tool's page or the
Refresh page.

Whatever your role, it never touches the **super admin** role, research
allowances, removing people or blocking addresses (the People page), secrets or
environment variables, deployments or hosting, the database, backups, the audit
trail, anyone's full email address, and it never sends emails or messages
(owner decision 2026-09-27).
