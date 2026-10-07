# Port plan

This is the map for moving the approved explorations (`.scratchpad/explore`, picks in `PICKS.md`) into the real apps. Phase 1 built the shell and the shared foundations listed below. Phase 2 ports the remaining screens in three lanes that work in parallel: A (accounts, clients, messaging), B (catalog, sales, invoices, money) and C (scheduling, online booking and shop). Each lane ports its picks to web, mobile and, where clients see it, Connect.

## How a screen moves over

- The view-model goes into `packages/app-core/src/domain/<concept>.ts` and reads the replica with `useQuery` SQL. Every exported SQL constant gets a case in `sql.test.ts`. Writes are functions that take `ApiLike`.
- Copy moves from the epic's `strings.ts` into the matching group of `strings.ts`.
- `openLink(target)` from `harness/links.ts` becomes `useOpenLink()` from the app's `lib/links.ts` (web: `apps/web/src/lib/links.ts`, mobile: `apps/mobile/src/lib/links.ts`). Targets are the `ShellTarget` union in `domain/navigation.ts`. A page that can be opened on a record or a create form reads the link with `useLinkIntent({ onCreate, onOpen })` on web, or the `create` and `open` route params on mobile.
- `usePreviewState()` and the per-epic load gates become `useReplicaLoad(sources, empty)` from `domain/sync.ts` for replica reads, with `useRemote(load)` from `hooks.ts` for server-only figures. A failed load is the shared `LoadFailed` component; loading is `Skeleton`; nothing yet is `Empty` with a next step.
- When a pick needs a small backend change (a column, a DTO field, a filter, a simple endpoint), build it with a migration, a service method that scopes through `scoped()`, a role gate, the four-part tests and `make gen-api` or `make gen-sync-schema`. When it needs a feature that is its own Jira story, hide or disable the control with a short explanation from `strings.ts` and list it in the lane's report.

## Decisions that apply everywhere

- Credit notes are numbered after the invoice or sale they credit: `creditNoteNumber(1143, 1)` gives `CN-1143-1`, and a sale number with a prefix gives `CN-S-1044-1`.
- Every invoice pay link uses one host: `pay.clientbridge.ca/i/<token>` (`payLinkUrl` in app-core, `pay_base_url` on the server, `/i/:token` in Connect).
- Void invoices are left out of board counts; the invoice list has a Void filter.
- Optional estimate add-ons start unticked.
- GST/HST and PST returns are recorded separately.
- Card fees are always read from Stripe's balance transaction, never a fixed rate.
- The onboarding wizard starts empty.

## Shared pieces from phase 1

| Piece                                                                                                                                                 | Where                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web shell: sidebar, Create menu with single-key shortcuts, ⌘K palette, bell panel, setup progress card, account menu, offline strip, sign-out warning | `apps/web/src/components/AppShell.tsx`, `CommandPalette.tsx`, `NotificationsPanel.tsx`, `SignOutDialog.tsx`                                                                                        |
| Mobile shell: tab bar with the centre create sheet and Book again, search and notifications screens, sign-out warning                                 | `apps/mobile/src/components/TabBar.tsx`, `screens/Search.tsx`, `screens/Notifications.tsx`, `lib/session.ts`                                                                                       |
| Today for owners and staff                                                                                                                            | `domain/today.ts` (`useOwnerToday`, `useStaffToday`, `useTodayActions`, `visitAction`), web `pages/Today.tsx`, mobile `screens/Today.tsx`                                                          |
| Shell view-model                                                                                                                                      | `domain/navigation.ts` (`useShellNav`, `createActionsFor`, `ShellTarget`, `DESTINATION_TARGET`)                                                                                                    |
| Setup progress and first-run checklist                                                                                                                | `domain/business.ts` (`useSetupProgress`, `bookingPageUrl`)                                                                                                                                        |
| Search over the replica                                                                                                                               | `domain/search.ts` (`useGlobalSearch`, `highlight`)                                                                                                                                                |
| Notifications derived from synced rows                                                                                                                | `domain/notifications.ts` (`useNotifications`)                                                                                                                                                     |
| Sync state, pending changes, device-only values                                                                                                       | `domain/sync.ts` (`useSyncState`, `useReplicaLoad`, `useDevicePref`, `useDeviceList`)                                                                                                              |
| Load states                                                                                                                                           | `hooks.ts` (`useLoad`, `useRemote`), `LoadFailed` in `packages/ui`                                                                                                                                 |
| Pickup queue                                                                                                                                          | `domain/pos.ts` (`usePickupOrders`, `pickupOrder`, `nextPickupStatus`, `pickupActions`)                                                                                                            |
| Date and format helpers                                                                                                                               | `datetime.ts` (`relativeDay`, `relativeDayTime`, `stampLabel`, `weekdayDay`, `daysUntil`), `format.ts` (`parseCents`, `formatPhone`, `phoneDigits`, `firstName`), `staffName` in `domain/staff.ts` |
| Check-in                                                                                                                                              | `POST /v1/bookings/{id}/check-in`, `checked_in_at` on bookings                                                                                                                                     |
| Pickup times                                                                                                                                          | `ready_at` and `picked_up_at` on orders                                                                                                                                                            |
| Staff names on devices                                                                                                                                | `name` on the staff row                                                                                                                                                                            |

## Screens by epic

| Epic          | Flow                                               | Pick                                                  | Lane                   |
| ------------- | -------------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| 01 Accounts   | Sign-up, sign-in and reset                         | A                                                     | A                      |
| 01 Accounts   | Onboarding and business profile                    | B (checklist builds on `useSetupProgress`)            | A                      |
| 01 Accounts   | Team invites and roles                             | A, with C's read-only staff view                      | A                      |
| 01 Accounts   | Stripe connect and payout status                   | A                                                     | A                      |
| 01 Accounts   | Tax registration and tax classes                   | A, with B's small-supplier wording                    | A                      |
| 02 Clients    | List and record                                    | A                                                     | A                      |
| 02 Clients    | Add, edit and archive                              | A                                                     | A                      |
| 02 Clients    | Pets and other subjects                            | A                                                     | A                      |
| 02 Clients    | Notes and history                                  | A                                                     | A                      |
| 02 Clients    | Saved cards and bank accounts                      | A                                                     | A                      |
| 02 Clients    | Tags and duplicate merging                         | B                                                     | A                      |
| 03 Catalog    | List and quick edits                               | A                                                     | B                      |
| 03 Catalog    | Services and classes                               | A                                                     | B                      |
| 03 Catalog    | Products with images                               | B on web, A on mobile                                 | B                      |
| 03 Catalog    | Stock and restock                                  | A                                                     | B                      |
| 03 Catalog    | Packages, memberships and gift cards               | A                                                     | B                      |
| 04 Scheduling | Calendar and booking lifecycle                     | A                                                     | C                      |
| 04 Scheduling | Hours, time off and closures                       | A on web, B on mobile                                 | C                      |
| 04 Scheduling | Recurring bookings                                 | A to book, B's series record                          | C                      |
| 04 Scheduling | Classes, rooms and stations                        | A, with B's station picker                            | C                      |
| 04 Scheduling | Reminders and end of day                           | A                                                     | C                      |
| 05 Online     | Booking page with deposit                          | A                                                     | C                      |
| 05 Online     | Booking add-ons                                    | B                                                     | C                      |
| 05 Online     | Online shop and pickup                             | A for clients; staff side is the front desk board     | C (Connect), B (board) |
| 05 Online     | Client cancel and reschedule                       | A                                                     | C                      |
| 06 Sales      | Sales with services and products                   | B                                                     | B                      |
| 06 Sales      | Card and Tap to Pay with receipts                  | A                                                     | B                      |
| 06 Sales      | Tips                                               | B at the desk, A's choice on the pay link             | B                      |
| 06 Sales      | Discounts                                          | A, with B's staff limit and approval                  | B                      |
| 06 Sales      | History, orders and pickup                         | B, with A's order panel (uses `usePickupOrders`)      | B                      |
| 07 Invoices   | Estimates                                          | A                                                     | B                      |
| 07 Invoices   | Invoices and pay link                              | A                                                     | B                      |
| 07 Invoices   | Recording payments                                 | A                                                     | B                      |
| 07 Invoices   | PDFs                                               | A                                                     | B                      |
| 07 Invoices   | Selling packages and memberships                   | A                                                     | B                      |
| 07 Invoices   | Interac e-Transfer                                 | B, with A's inbox once a bank feed exists             | B                      |
| 07 Invoices   | Refunds and chargebacks                            | A, with B's dispute case view                         | B                      |
| 08 Money      | Reports                                            | A, with C's bookkeeper export                         | B                      |
| 08 Money      | Tax returns and remittance                         | B, opening A's worksheet                              | B                      |
| 08 Money      | Stripe reconciliation and payouts                  | A                                                     | B                      |
| 08 Money      | Staff pay                                          | A                                                     | B                      |
| 08 Money      | Money on Today                                     | B (Today's figures already use the dashboard summary) | B                      |
| 09 Messaging  | Inbox                                              | A                                                     | A                      |
| 09 Messaging  | Broadcasts                                         | A, with B's consent log                               | A                      |
| 09 Messaging  | Reviews                                            | A                                                     | A                      |
| 09 Messaging  | Intake forms                                       | A                                                     | A                      |
| 09 Messaging  | Contracts                                          | A                                                     | A                      |
| 10 Shell      | Navigation, Today, search, notifications, patterns | A (B's sign-out warning)                              | done in phase 1        |
