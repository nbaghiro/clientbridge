# Design pass plan

This plan carries the desktop design we settled on (Today, Schedule, Clients, Inbox and the Payments tabs) across every remaining page, then brings the mobile app to the same standard. It also lists what to test first, page by page, so each batch starts from a known state.

Snapshot: `origin/main` at `c97e5eb7` on October 24, 2026, rebased onto `a9366132` on October 25. Line numbers below refer to `c97e5eb7`. The work runs on the `design-pass` branch in the main checkout, which the local stack (web :8700, API :8701, Connect :8709) serves.

## What changed on main since the last review

The previous review read `eea0e1cb`. Twelve commits have landed since.

| Commit | Change | Effect on this plan |
| --- | --- | --- |
| `a74f6557` | Vertical gaps for clinics, trades, day camps, driving schools and auto detailing | New Setup section **Rooms & equipment** (`/setup/rooms-and-equipment`, `pages/Resources.tsx`, web and mobile). Classes rebuilt around **Programs** (`ProgramBoard`, `ProgramForm`, `RosterAttendee`) with a Sessions / Programs switch in the Schedule header. Schedule gains a rooms filter, and its hours widen to fit a draft. **Treatment notes** and client forms in the booking panel and the client's subjects. Team removal lists affected schedules. New shared twin `RepeatingGroup`. Connect booking steps reworked. Four migrations (staff on items, a subject on packages, resources, foreign key indexes). |
| `74c5ee74` (#57) | The new booking draft scrolls into view late in the day | Small `ScheduleGrid` change. |
| `c634c659` | Day-dependent e2e steps | Tests only. |
| `34b021af` and seven others | Foreign key indexes, Firebase push keys, staging seed, Gateway route, uvicorn keep-alive | Infra and CI only. The Firebase file for mobile is no longer in git (`frontend/apps/mobile/.gitignore`). |

## The patterns every page should use

These already exist and are the reference. New work composes them and does not add another container.

| Pattern | Pieces | Used by |
| --- | --- | --- |
| A. Frame | `PageFrame` (centred, 88rem, 2rem padding), corner `Backdrop` from `AppShell` | Every signed-in page, directly or through its host |
| B. Host with tabs | `PageFrame` › `PageHeader` › `Tabs` › body | Schedule (`ScheduleFrame`), Inbox, Payments |
| C. Working card with a rail | One `rounded-lg border bg-surface shadow-card` card, list or grid on the left, `<aside>` on the right, `FILL` height when it should fill the window | Schedule calendar, Inbox messages, Classes, Repeat visits |
| D. Desk | `DeskBar` (switcher, summary, action) › `Stat` row › `ListPage` › `DeskPanel` record from the right | Invoices, Gift cards, Refunds, Payouts, Reports |
| E. Paper drawer | `Modal variant="drawer" size="xl"`, form column beside `DocumentPane` | Invoice and estimate records, `DocEditor` |
| F. Setup section | `PageHeader` › `Panel`s, full width of the section column, optional preview column | Getting paid, Plan, Sales tax, Online booking, Reminders |
| G. Record | `ClientRecordView` (inline or drawer) on `DetailView` | Clients, Inbox "Open record" |

## Inventory and status

**On the design (reference, test only):** Today, Schedule calendar, Clients and the client pages, Inbox messages and Reviews, Invoices, Gift cards, Refunds, Payouts, Reports, Getting paid, Plan, Sales tax, Online booking, Reminders.

**Close (small, mechanical fixes):** Classes and Programs (new), Repeat visits, Staff pay, Sales, Services & products, Tax returns, and the three narrow Setup sections.

**Behind (needs a real pass):** Rooms & equipment (new), Broadcasts (record and composer), Forms and Contracts (editor and detail views), Team & hours.

**Mobile:** structurally complete, visually inconsistent (see Batch 7).

## Findings from the screenshot pass

Check these before or during the batches. Only F1 is confirmed in code; the rest need a quick look in the app.

| # | Finding | Where | Status |
| --- | --- | --- | --- |
| F1 | A full stop after a time doubles up: "on Tuesday, October 27 at 9:00 a.m.. Change or cancel". The en-CA time format already ends in "a.m." or "p.m.". | 11 backend messages with `{when}.` in `backend/src/clientbridge/locales/en_CA.po` (reminder, confirmation, seat opened and others), about 10 app messages (for example `en-CA.json:2962` "Moved to {when}.") | Confirmed. Every reminder and confirmation sent to a client carries it. |
| F2 | Today shows the five ended visits with a tick and "6 done, 0 to go"; Schedule lists the same five under "Needs closing" and Reminders under "still open". | `TodayParts.tsx`, `ScheduleRail.tsx`, `Reminders.tsx` | Check whether the tick means "checked in". If so, the wording differs, not the data. |
| F3 | Payouts shows "Deposited $10,346.80, last 30 days" above "No payouts yet". | `Payouts.tsx` | Likely the local Stripe placeholders. Rerun `stripe_setup --apply --write-db` and look again. |
| F4 | A business with no classes still shows the Classes tab and the Sessions / Programs switch, and its empty state is a dashed card inside the card. | Harbourside `/schedule/classes`, `Classes.tsx:109` | Design decision: hide the tab when the catalog has no classes or programs, or keep it as a way in. |
| F5 | Rooms & equipment rows lead with an empty square that reads as a checkbox. | `pages/Resources.tsx` | Confirmed visually. |
| F6 | Sales stacks two rows of pill tabs (New sale / Orders / History, then Products / Services / All). | `POS.tsx:77` | Covered by Batch 4. |
| F7 | Birchbark's client list is dominated by "Alex …" clients with a pet named Hazel. | Demo seed | Demo realism only. Out of scope for the design pass. |

## Batches

Each batch is one commit on `design-pass`, after typecheck, eslint and `make gen-strings` on the changed files; the branch merges as one PR. Each lists what changes, then what to test. Mobile changes stay in Batch 7 unless a shared twin changes.

### Batch 0. Test the reference pages first

Walk the reference pages once on :8700 so later batches compare against a known baseline.

- Shell: sidebar, + Create menu (all seven entries), ⌘K, the bell, the account menu, PlanBanner.
- Today (owner and a staff login such as `diego@birchbark.example`): KPIs, agenda, Needs you actions (Remind opens the send review), Team today, sales tax card, recent activity. Check F2.
- Schedule calendar: day and week, drag to move and resize, new booking draft and composer in the rail, rooms filter on Harbourside, booking panel with treatment notes, check-in, complete and no-show.
- Clients: list, search, select and merge, record card, history and subjects pages, wallet (cards, packages, subscriptions).
- Inbox messages: thread list, thread, details rail, Open record. Reviews: queue and automation.
- Payments: Invoices and Estimates (paper drawer, DocEditor, send review, record payment), Gift cards, Refunds (three views and a dispute), Payouts (check F3), Reports (each report and the bookkeeper pack).
- Setup: Getting paid, Plan, Sales tax, Online booking (three tabs), Reminders (check the preview text against F1).

### Batch 1. Copy fix for the doubled full stop (F1)

This is a correctness fix, not a layout change, so it goes first and through a normal PR, because it touches backend messages and tests.

- Rephrase each message so a time value never ends a sentence. For example, "Reminder: you have an appointment with {business} on {when}. Change or cancel: {link}" can become "Reminder: your appointment with {business} is on {when}, and you can change or cancel it here: {link}". Decide per message rather than adding a formatter rule, so word order stays in the catalog as the conventions require.
- Run `make gen-messages` and `make gen-strings`, and update the notification tests that assert the text.
- Test: Reminders preview on Birchbark, a booking confirmation in Mailpit (:8715), and the `en-XA` pass.

### Batch 2. Schedule tabs (Classes, Programs, Repeat visits)

- `components/SeriesComposer.tsx:67`: drop the `PageFrame` wrapper. The composer now lives in a drawer (`Recurrences.tsx:224`), so it gets double padding and an 88rem cap inside the drawer.
- `pages/Recurrences.tsx:253`: replace `mx-auto max-w-3xl px-8 py-8` in the record with the same padding the Classes record uses, so both rails read the same.
- `pages/Recurrences.tsx:303` and `:337`: the figure strip and the dates list become `Panel` (or the `SummaryStrip` used by Classes for the figures).
- `pages/Classes.tsx:109` and `ProgramBoard.tsx:40`: when there is nothing to show, render `Empty` straight in the card instead of a dashed card inside it. Decide F4.
- Decide where the Sessions / Programs switch sits. It is in the header beside New booking today; Payments puts a switcher in the `DeskBar` row. Recommendation: keep it in the header on Classes only, and hide it when there are no programs.
- Test: Birchbark, Ridgeline and Lakeside Classes (sessions and programs), roster add, check in, waitlist, message everyone; Repeat visits filters, a clash, change and cancel series, new series drawer.

### Batch 3. Inbox segments (Broadcasts, Forms, Contracts)

The list views already match. The record, editor and detail views do not.

- `pages/Broadcasts.tsx:334`: the broadcast record uses the old fixed `DetailView` overlay. Move it to `DeskPanel`, as Earnings and Gift cards do.
- `pages/Broadcasts.tsx:427`: the sent screen is a hand-sized `mx-auto max-w-lg py-16` block. Show the confirmation as a `Notice` above the list, or an `Empty`-style card in the frame, and return to the list.
- The composer replaces the whole segment. Move it into a drawer with the preview beside the form, matching `DocEditor` (pattern E), so the segment keeps its tabs.
- `pages/Forms.tsx:204`, `:245`, `:310`: the editor sections, question list and preview become `Panel`s. Consider the editor as a drawer with the live question preview beside it, as above.
- `pages/Contracts.tsx:236`, `:281`: the detail view swapped in place with a "Templates" back link. Make it a `DeskPanel` (or a paper drawer, since a contract is a document), and the version and signer lists `Panel`s.
- Test: create, schedule, send and open a broadcast; opt-outs and the consent export; create a form, reorder questions, send to a client, open responses; create a contract version, send, open signatures.

### Batch 4. Payments tabs that are not yet on the desk pattern

- `pages/POS.tsx:77`: put the New sale / Orders / History switcher in a `DeskBar`, with the action on the right. The Products / Services / All filter stays with the catalog list, so the two pill rows stop stacking (F6).
- `pages/POS.tsx:240`: the hand-rolled list becomes `Panel flush`.
- `pages/Earnings.tsx`: add a `DeskBar` with the period summary and an "Approve all" action if one exists, so the row of controls matches the other tabs.
- `pages/Remittances.tsx:123` and `:160`: the amount card and the due-period card become `Panel`s (the due card can keep its warning tone through `Panel`'s intent or a `Notice` header). Keep the two-column layout. Add a `DeskBar` with the filing period summary and Record filed return.
- Test: a full sale (walk-in and with a client, discount, card and cash), orders board, sales history and a sale record; staff pay approve and pay; record a filed return and download the CSV.

### Batch 5. Setup sections

- Width: `pages/Business.tsx:46`, `pages/Security.tsx:27` and `:34`, `components/GetSetUp.tsx:18` clamp to `max-w-3xl`, while the other sections fill the column. Pick one rule. Recommendation: forms keep a two-column grid at full width with an optional preview column (as Sales tax and Reminders do), and drop the clamp.
- `pages/Business.tsx:239`: the brand preview becomes a `Panel` in a preview column beside the form, matching Sales tax.
- `pages/Catalog.tsx:220`: the hand-rolled block becomes `Panel flush`.
- `pages/Team.tsx:391`: the person record moves from the old `DetailView` overlay to `DeskPanel`.
- `pages/Hours.tsx:316`: give "Hours and time off" a section heading that matches the page header above it, or split it into its own Setup section if the page reads as two pages.
- `pages/Resources.tsx` (Rooms & equipment): use the same table as Services & products: name, kind (room, table, car, equipment), upcoming visits, status, with Rename and Turn off in a row menu or the record panel. Replace the empty-square glyph (F5) with a room or equipment icon from `app-core/icons.ts`.
- Test: edit and save each form, Get set up links, invite, resend and revoke, open a teammate, add time off, close the business, add and rename a room, turn one off and confirm the schedule filter updates.

### Batch 6. Today and the shell, small leftovers

- `pages/Today.tsx:87`, `:379`, `:446`: three hand-rolled cards become `Panel`s.
- Check that the corner `Backdrop` does not sit under scrolled content on short windows.
- Test at 1280, 1440 and 1920 wide, and at the `useWide` breakpoint (1280) where rails become drawers.

### Batch 7. Mobile

Restart Metro (:8707) from a worktree on `origin/main` first. It still serves the shared checkout, and the Firebase file now comes from outside git.

- Headers: the four tabs each build their own title (Today 24, Inbox 28, Clients 26, Schedule 26). Use the shared `PageHeader` twin, or a `TabHeader` built on it, at one size.
- Sheet headers: `SheetHeader` is private to `ClientSheets.tsx`; `DocEditor` and others repeat it, and `SendToClient`, `RecordPayment` and `CheckInSheet` use a left title. Promote one sheet header into `@clientbridge/ui` (it would need a web twin, which can be the `Modal` header) and use it everywhere.
- Cards: 28 files define their own `card` style, 61 places hard-code `borderWidth: 1` (the token is 1.5, used once). Replace with `Panel`, or `theme.borderWidth` where a raw card is justified.
- Type: titles across screens run from 15 to 32. Settle on the scale the web uses (display 24 for page titles, 17 for section titles).
- Fonts: mobile renders in the system font. Load Schibsted Grotesk and Geist Mono with `expo-font`, which is a dependency change to confirm first.
- Structure: `ClientScreens.tsx` and `GetSetUp.tsx` are screens living in `components/`; `Loaded` is exported twice (`components/Loaded.tsx` and `components/Stock.tsx`). Move and dedupe.
- Navigation: Payments has no tab or menu entry; it is reached only from Today and the + fan. Decide whether it belongs in the fan, on Today, or as a fifth tab.
- New screens from `a74f6557` (Resources, ProgramBoard, TreatmentNotes) should be checked against the same rules as they are new.
- Test on the "Clientbridge iPhone 17 Pro" simulator and the existing Android emulator: each tab, the + fan, a booking sheet, a sale with Tap to Pay in test mode, Setup screens.

### Batch 8. Connect (later)

Connect had its booking steps reworked in `a74f6557` and its hosts split in `eea0e1cb`. Run `make dev-connect` (:8709) and walk the business page, booking, manage, shop, pay, estimate and receipt pages on Birchbark and Harbourside before deciding on any design work there.

## Order and effort

| Batch | Scope | Size |
| --- | --- | --- |
| 0 | Baseline test of reference pages | One sitting |
| 1 | Doubled full stop (F1) | Small, through a PR |
| 2 | Schedule tabs | Small |
| 3 | Inbox segments | Medium |
| 4 | Payments tabs | Small to medium |
| 5 | Setup sections | Medium |
| 6 | Today and shell leftovers | Small |
| 7 | Mobile | Large, split by item |
| 8 | Connect | After a walk-through |

Open decisions before starting: F4 (hide Classes when empty), the Setup width rule, whether composers (broadcast, form) move to drawers, adding `expo-font` on mobile, and where Payments lives on mobile.
