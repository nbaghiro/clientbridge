# Clientbridge product surfaces

Clientbridge consists of the provider web app, the provider mobile app, the public Connect app, the marketing site, and the component playground. The working tree reviewed on October 7, 2026 contains 31 web page modules, 32 mobile screen modules, 12 Connect page modules, 46 shared domain modules, and 65 component story files. Module counts are not screen counts: a page can contain multiple tabs, editors, dialogs, and record views.

The provider apps share behavior through `@clientbridge/app-core` and render it separately for the browser and React Native. Most reads use a local PowerSync replica. Money, bookings, document publishing, and almost all edits call server commands. Connect uses public HTTP endpoints without a replica. The marketing site produces static HTML. The playground renders real UI components with example data.

## Architecture and ownership

| Layer               | Implementation                                                                                                                                                        | Practical consequence                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider web        | [App routes](../../../frontend/apps/web/src/App.tsx), React, React Router, Vite, Tailwind                                                                                   | Five destinations plus Setup; most nested work areas are composed inside page modules.                                                                                      |
| Provider mobile     | [App navigator](../../../frontend/apps/mobile/App.tsx), Expo, React Native, React Navigation                                                                                | Four bottom tabs; Inbox, Setup, Search, Notifications, and record subpages use the root stack.                                                                              |
| Shared behavior     | [Domain modules](../../../frontend/packages/app-core/src/domain), [hooks](../../../frontend/packages/app-core/src/hooks.ts), [copy](../../../frontend/packages/app-core/src/strings.ts) | SQL, form state, validation, lifecycle actions, pricing previews, and status presentation are largely shared.                                                               |
| Shared UI contracts | [Props](../../../frontend/packages/app-core/src/ui.ts), [web components](../../../frontend/packages/ui/src/web), [native components](../../../frontend/packages/ui/src/mobile)          | Each component has separate DOM and native renderers with a common contract. Web details are panels/dialogs; native details are generally sheets.                           |
| Design tokens       | [Tokens](../../../frontend/packages/tokens/src), [design source](../../design/app-explorer.html)                                                                                  | Theme output feeds CSS/Tailwind and native values. Intent colors, icons, and copy are centralized.                                                                          |
| Authentication      | [Session client](../../../frontend/packages/api-client/src/session.ts), platform auth adapters                                                                              | Access/refresh tokens; one refresh at a time, with a browser Web Lock across tabs. Web stores tokens in localStorage; mobile uses SecureStore. Sign-out clears the replica. |
| Local reads         | [Schema](../../../frontend/packages/sync/src/schema.ts), [connector](../../../frontend/packages/sync/src/connector.ts), [sync rules](../../../infra/powersync/sync-rules.yaml)          | PostgreSQL WAL changes reach device SQLite through PowerSync. Role-scoped buckets determine which rows and columns arrive.                                                  |
| Writes              | [API router](../../../backend/src/clientbridge/api/router.py), services, [commands](../../../backend/src/clientbridge/core/command.py)                                            | Services own mutations and authorization. Commands commit the result, audit rows, and optional idempotency response together.                                               |
| Money               | [Ledger](../../../backend/src/clientbridge/services/ledger.py), [frontend derivations](../../../frontend/packages/app-core/src/domain/ledger.ts)                                  | Invoice balances, order status, liabilities, commissions, fees, and payouts derive from accounts and entries. Money uses integer cents.                                     |
| Background work     | [Worker schedule](../../../backend/src/clientbridge/tasks/worker.py)                                                                                                        | Reminders, unpaid-booking expiry, broadcasts, overdue notices, entitlement expiry, device pruning, reconciliation, reviews, and intake forms run outside the UI.            |

Only regular `hours` rows are currently writable through [sync upload](../../../backend/src/clientbridge/sync/upload.py). Exception hours are command-only. Form editors and contract publishing use HTTP commands; older architecture prose describing those as direct SQLite writes is stale. Local preferences such as notification read state are device-local.

Offline reads and queued regular-hours edits are implemented. This does not imply offline booking creation, checkout, or other server commands. Loading/error/retry presentation is composed through `useLoad`, `useReplicaLoad`, `Loaded`, `Skeleton`, and `LoadFailed`.

## Navigation and permissions

[Navigation policy](../../../frontend/packages/app-core/src/domain/navigation.ts) is shared by both provider apps. [Web links](../../../frontend/apps/web/src/lib/links.ts) and [mobile links](../../../frontend/apps/mobile/src/lib/links.ts) translate logical destinations and create/open intents into platform routes.

| Area     | Owner and admin                                                                 | Staff and contractor                                                  |
| -------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Today    | Business agenda, money, attention queue, team, setup and filing prompts         | Own visits, next client, gaps, earnings and relevant messages         |
| Schedule | Team calendar, classes and repeating visits                                     | Own synced calendar and permitted booking actions                     |
| Clients  | Shared directory, records, cleanup and wallet management                        | Shared directory and operational records; money management restricted |
| Payments | Invoices, Sales, Gift cards, Refunds, Staff pay, Tax returns, Payouts, Reports  | Sales; sales history is separately restricted                         |
| Inbox    | Messages, Reviews, Broadcasts, Forms, Contracts                                 | Messages                                                              |
| Setup    | Start, Business, Services, Team, Getting paid, Taxes, Online booking, Reminders | Team and own regular hours/time off                                   |

The shell adds Create, global search, notifications, recent clients, account actions, setup progress, and a sync indicator. Create offers booking, sale, invoice, estimate, client, message, and time off; staff omit invoice and estimate. Web search uses a command palette and keyboard shortcut; mobile has a search screen. Server checks remain authoritative even when a control is hidden.

The backend principal supports `X-Business-Id` for users with multiple memberships. The current app shell has no business switcher, and several local selectors take the first business/member row. Multi-business account switching is not a completed product surface.

## Entry and account surfaces

| Surface                | Current behavior                                                                                                          | Implementation                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in                | Email/password, password visibility, inline validation, failed-attempt handling, and a Google button                      | [Web Login](../../../frontend/apps/web/src/pages/Login.tsx), [mobile Login](../../../frontend/apps/mobile/src/screens/Login.tsx), [auth hook](../../../frontend/packages/app-core/src/domain/auth.ts), backend `services/auth.py` |
| Create account         | `/signup` starts the web form in signup mode; name/email/password validation and token installation                       | Same auth form; `POST /auth/register`. The normal web sign-in form currently prefills demo credentials.                                                                                                         |
| Password recovery      | Request reset email, sent state, resend countdown, return to sign-in                                                      | Shared auth hook calls `/auth/forgot-password`. No dedicated token-consuming new-password screen is registered in either app navigator.                                                                         |
| Accept invitation      | `/accept-invite?token=…`; name/password, missing-code state, joining and auth handoff                                     | [AcceptInvite](../../../frontend/apps/web/src/pages/AcceptInvite.tsx), `useAcceptInviteForm`, backend `services/staff.py`. No native invite screen is registered.                                                     |
| New business           | Business name, slug, province and tax summary; waits for the created business to sync                                     | [Onboarding](../../../frontend/apps/web/src/pages/Onboarding.tsx), mobile counterpart, `useOnboardingForm`, `/v1/onboarding`                                                                                          |
| Bootstrap and sign-out | Splash/loading until auth and initial replica are ready; onboarding when no business exists; clear local data on sign-out | Both App roots, platform PowerSync adapters, web `SignOutDialog`                                                                                                                                                |

Google OAuth exists on the backend, but the current provider UI calls `googleUnavailable()` and shows configuration guidance instead of starting OAuth. Both provider sign-out handlers clear local credentials and the replica without calling `/auth/logout`; the [backend logout endpoint](../../../backend/src/clientbridge/api/auth.py) supports refresh-token-family revocation, but that action is not wired into those handlers.

## Today

[Today](../../../frontend/apps/web/src/pages/Today.tsx) composes the owner and staff variants from [today.ts](../../../frontend/packages/app-core/src/domain/today.ts). Owner Today combines the local agenda, unpaid invoices, messages, reviews, low stock, pending earnings, and setup progress with a remote dashboard summary. Money has its own loading state so a failed summary does not have to hide the schedule. Its actions lead into schedule, checkout, invoices, inventory, reports, and setup; invoice reminders and booking check-in are commands.

Staff Today centers on the next/current client, own agenda, working hours, gaps, tomorrow's count, previous visit, and accrued earnings. `visitAction` determines whether a visit offers check-in, checkout, or no action. Web uses a wider dashboard and native uses scrolling cards and sections. Supporting layouts live in each app's `TodayParts.tsx`.

## Scheduling

| Surface          | Built behavior                                                                                                                                                             | Shared and backend implementation                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calendar board   | Day/week controls, member lanes, off-hours, current-time line, visit/class cards, rail summaries, selection, drag/move/resize and undo on web                              | [Schedule](../../../frontend/apps/web/src/pages/Schedule.tsx), `ScheduleGrid`, `ScheduleRail`; [bookings.ts](../../../frontend/packages/app-core/src/domain/bookings.ts). Slots, bookings, hours, staff and resources supply the view. |
| Booking composer | Search client/pet, service, member, date/time, deposit explanation, note, notification choice and simple weekly repeat                                                     | `useBookingComposer`; web `BookingComposer`, native `BookingComposerSheet`; `/v1/bookings` or `/v1/recurrences`                                                                                                            |
| Booking record   | Client/pet facts, history, notes, add-ons, deposit collection, messaging, station/resource selection, rescheduling and lifecycle actions                                   | Web `BookingPanel`, native `BookingSheet`, `useBookingDetail`, `useBookingActions`, `useCollectDeposit`                                                                                                                    |
| Move and resize  | Local availability preview, debounced server conflict check, optimistic display, committed PATCH and undo                                                                  | `useMoveEvent`, `planMove`, `/v1/bookings/{id}/check`. Server checks hours, exceptions, staff/resource overlaps and capacity.                                                                                              |
| Classes          | Upcoming sessions, capacity, attendee roster, waitlist, add attendee, check-in/undo/no-show, promote when a seat is free, bulk check-in and message class                  | [Classes](../../../frontend/apps/web/src/pages/Classes.tsx), [classes.ts](../../../frontend/packages/app-core/src/domain/classes.ts), `/v1/classes/{slot}/roster` and `/message`                                                       |
| Repeating visits | Series list with attention/ending filters; create rule, preview dates and clashes, choose alternatives, inspect history, change one/following/all and cancel future visits | [Recurrences](../../../frontend/apps/web/src/pages/Recurrences.tsx), `SeriesComposer`, [recurrences.ts](../../../frontend/packages/app-core/src/domain/recurrences.ts), backend recurrence service in `bookings.py`                    |

The backend distinguishes a slot's time/capacity from individual bookings on that slot. Canceling the last live/waiting booking releases its slot. Deposits have lifecycle states and ledger effects; completion, no-show, cancellation, invoice creation and deposit application are connected behavior rather than independent status labels.

Native Schedule shares the board, availability, composer and lifecycle hooks but renders its own navigation, calendar and sheets. Browser tests of calendar dragging do not establish native gesture behavior.

## Clients and records

[Clients](../../../frontend/apps/web/src/pages/Clients.tsx) is both a directory and the entry point to record subpages. [clients.ts](../../../frontend/packages/app-core/src/domain/clients.ts) builds the directory, records, history, forms and cleanup operations. Backend concepts are `clients`, `subjects`, `notes`, and `consents`.

| Surface       | Current behavior                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Directory     | Search, active/archive views and segments, tags, select rows, bulk tags and archive. Managers can open the merge flow.                                                                                                                                 |
| Client editor | Name/contact, preferred channel, marketing consent, tags, duplicate suggestions and initial pet fields. Uses client commands.                                                                                                                          |
| Record detail | Contact/actions, lifetime value and visit facts where available, upcoming visits, pets, pinned/recent notes and manager wallet summary. Deep links can open records from other surfaces.                                                               |
| History       | `/clients/:id/history` on web and a native stack screen; assembled timeline of visits, documents, payments, messages and notes, with filtering and note composer.                                                                                      |
| Pets          | `/clients/:id/pets`; pet cards, attributes, visit context, add/edit forms. The storage abstraction is `subjects`, but this UI currently presents pets and pet-specific fields.                                                                         |
| Wallet        | `/clients/:id/payment-methods`; saved methods/default/detach, card entry, packages/session usage and subscription cancellation. Web includes bank/PAD entry; native card entry uses Stripe's native UI.                                                |
| Merge         | Choose survivor and contact-field values, preview related information, confirm. The server rejects merging away a record with ledger accounts or active saved methods, moves references, consolidates channel threads and soft-deletes the old record. |

Web implements these with `ClientEditor`, `ClientHistory`, `ClientPets`, `ClientWallet`, and `ClientMerge`. Native uses `ClientScreens` and `ClientSheets`. This is substantial shared behavior with separate platform composition, not a web page wrapped in a native shell.

## Payments

[Payments](../../../frontend/apps/web/src/pages/Payments.tsx) selects eight work areas. They share documents, line pricing, checkout, ledger derivations, and role policy.

### Invoices and estimates

[Invoices](../../../frontend/apps/web/src/pages/Invoices.tsx) has invoice/estimate switching, list segments/search, summary figures, record panels and a shared document editor. [billing.ts](../../../frontend/packages/app-core/src/domain/billing.ts) owns the desks, editor state, line/order discounts, tax previews, totals, printed-document mapping and lifecycle actions.

Invoices support drafting/editing, sending, voiding, pay-link copying, payment history, recording payment, requesting an e-Transfer, and document/receipt preview. Estimates support drafting/editing, sending, accept/decline, decline reasons, expiration presentation and conversion into an invoice. Documents connect to bookings and catalog line snapshots. Issued tax information is preserved; later catalog changes do not rewrite an issued bill.

`RecordPayment` handles cash, received e-Transfer, cheque and saved-card payment paths. `InteracRequest` handles requested amount, expiration/channel, prior requests and instructions. The `payments` service authorizes payment changes; Stripe and Interac settlement update the ledger. Document balances and paid/overdue presentation are derived rather than maintained as unrelated totals in the page.

### Sales and checkout

[POS](../../../frontend/apps/web/src/pages/POS.tsx) contains Register, Orders and manager History. [pos.ts](../../../frontend/packages/app-core/src/domain/pos.ts) is a large shared view-model covering the ticket and front desk.

- Register combines today's visits with service/product tiles, category/search controls, walk-ins or a linked client, quantities, service attribution, discounts and deposit application.
- Ticket and payment sheets handle discount reasons, limits and manager PIN approval, tips and tip allocation, cash tender/change, saved/new cards, receipts and completion.
- Native adds Stripe Terminal Tap to Pay through `Terminal.tsx`; web disables that option and uses browser card entry. A native development build and supported/simulated reader are required.
- Orders combines held desk tickets and online pickup work. Pickup moves from unfulfilled to ready to picked up. History and detail show lines, payments, tips, receipts and permitted void/refund actions.
- Gift cards, packages and memberships launch dedicated entitlement sale sheets so purchasing one also creates the corresponding entitlement/liability.

Backend `orders.py` creates/updates/holds sales, serializes numbering, starts card/cash/Terminal payment paths and records pickup/receipt actions. `inventory.py` moves tracked stock when payment/refund state changes. Retail commission accrual lives in `earnings.py`.

### Gift cards and entitlements

[GiftCards](../../../frontend/apps/web/src/pages/GiftCards.tsx) is a wallet for gift cards, packages and memberships, not only gift cards. [entitlements.ts](../../../frontend/packages/app-core/src/domain/entitlements.ts) supplies client/type filtering, cards and meters, purchase forms, detail/history, redemption, session consumption and subscription cancellation. Backend purchases create pending entitlements that activate after successful payment. Refund and expiry behavior also affects the ledger. Packages/subscriptions appear in client wallets as well as this central desk.

### Refunds and disputes

[Refunds](../../../frontend/apps/web/src/pages/Refunds.tsx) contains payment selection, credit notes and disputes. [refunds.ts](../../../frontend/packages/app-core/src/domain/refunds.ts) builds refund availability, full/partial amount selection, reason/notification choice, server preview and history. The server preview uses ledger allocation for the amount, taxes, tips and other liabilities being reversed. Numbered credit notes identify recorded refunds. Dispute detail shows status/deadline and links to Stripe for response; it is not a local evidence-submission editor. Refunds for cash, cheque and e-Transfer record an external return of money.

### Staff pay

[Earnings](../../../frontend/apps/web/src/pages/Earnings.tsx) displays pending/approved/paid figures, people and earning lines, selection, approval and recording payment. [earnings.ts](../../../frontend/packages/app-core/src/domain/earnings.ts) groups ledger-derived earnings. The backend accrues service and retail earnings, moves them through approval/payment journals, and reverses still-pending earnings when qualifying sales are reversed. This is commission/payable tracking; the screen is not a full payroll filing or bank-disbursement product.

### Tax returns

[Remittances](../../../frontend/apps/web/src/pages/Remittances.tsx) shows filing periods, due/late/filed states, GST/HST and provincial worksheets, input-tax-credit entry, confirmation/date, payment-recording choice, history and CSV. [remittances.ts](../../../frontend/packages/app-core/src/domain/remittances.ts) calls reports and `/v1/payments/remittances`; backend `remittances.py` derives periods and records filing/payment information. It records filing activity; it does not submit a government return from the page.

### Payouts

[Payouts](../../../frontend/apps/web/src/pages/Payouts.tsx) shows Stripe balance, deposited amounts, fees, recent payouts, selected payout facts and recent charges. [payouts.ts](../../../frontend/packages/app-core/src/domain/payouts.ts) reads replicated accounts and journals. Returned payouts are recognized through reversal journals; unknown fees have a pending state. It does not initiate an on-demand payout.

### Reports

[Reports](../../../frontend/apps/web/src/pages/Reports.tsx) supplies period selection, income, payment-method distribution, item sales, GST/HST, provincial tax, T4A and monthly bars, with CSV and a selectable ZIP bookkeeper pack. [reports.ts](../../../frontend/packages/app-core/src/domain/reports.ts) fetches a server summary; backend `reports.py` uses the business timezone and ledger/data queries. Web offers browser download/print presentation; native uses sharing and its own report layout. These financial aggregates are a notable exception to replica-only reads.

## Inbox and client communications

| Surface    | Current behavior                                                                                                                                                            | Implementation                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Messages   | Thread filters/search, conversation list, timeline/bubbles, quick replies, SMS/email channel, new message, read state and contextual client details                         | [Inbox](../../../frontend/apps/web/src/pages/Inbox.tsx), [messaging.ts](../../../frontend/packages/app-core/src/domain/messaging.ts), backend `messaging.py`; Twilio/Postmark adapters and inbound webhooks                    |
| Reviews    | Rating summary/distribution, published/held/hidden records, reply editor/suggestion, request review, moderation and Google review link settings                             | [Reviews](../../../frontend/apps/web/src/pages/Reviews.tsx), [reviews.ts](../../../frontend/packages/app-core/src/domain/reviews.ts), backend `reviews.py`                                                                     |
| Broadcasts | Reach/opt-out/implied-consent overview, consent export, audience by tags, channel, preview/SMS segments, immediate or scheduled send, details/results, duplicate and cancel | [Broadcasts](../../../frontend/apps/web/src/pages/Broadcasts.tsx), [broadcasts.ts](../../../frontend/packages/app-core/src/domain/broadcasts.ts), backend `messaging.py` and `consents.py`; scheduled job sends due broadcasts |
| Forms      | Library, question editor, types/options/help/required/reordering, live preview, signature/send rule, explicit save and send-to-client dialog                                | [Forms](../../../frontend/apps/web/src/pages/Forms.tsx), [forms.ts](../../../frontend/packages/app-core/src/domain/forms.ts), backend `forms.py`; field/response rows and automatic intake job                                 |
| Contracts  | Template library, new contract, text editor and publish version, request signatures, request history, resend/copy link, signed copy                                         | [Contracts](../../../frontend/apps/web/src/pages/Contracts.tsx), [contracts.ts](../../../frontend/packages/app-core/src/domain/contracts.ts), backend `contracts.py`; versioned text preserved for signed requests             |

Consent is more than a checkbox: the service records changes by channel and handles SMS STOP/START and preference links. Marketing sends and transactional messages follow different checks. Provider notification copy is assembled centrally in backend `notifications.py`.

## Setup

[Setup](../../../frontend/apps/web/src/pages/Setup.tsx) composes the following sections. Native registers separate setup stack screens and combines Team with Hours.

| Section              | Current behavior                                                                                                                                                           | Implementation                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Get set up           | Progress checklist, tasks/deep links, business branding editor, logo upload, accent/tagline, public booking preview/link and dismissal                                     | Web/native `GetSetUp`, [business.ts](../../../frontend/packages/app-core/src/domain/business.ts), [files.ts](../../../frontend/packages/app-core/src/domain/files.ts)                                                         |
| Business             | Profile fields, locale, timezone/province and billing details from the shared field definitions; save state                                                                | [Business](../../../frontend/apps/web/src/pages/Business.tsx), `useBusinessForm`, `PATCH /v1/business`                                                                                                                  |
| Catalog              | Catalog/products/inventory views, filters/categories/search, add-kind picker and item editors                                                                              | [Catalog](../../../frontend/apps/web/src/pages/Catalog.tsx), [catalog.ts](../../../frontend/packages/app-core/src/domain/catalog.ts), platform `ItemEditor`                                                                   |
| Services and classes | Price/tax, duration/buffers, class capacity, deposit policy and online booking flags                                                                                       | Service editor; item commands; scheduling uses these settings                                                                                                                                                     |
| Products             | SKU, cost, image, retail price, tracking/opening stock/low threshold and online-sale visibility                                                                            | Product editor; stock commands and public media URLs                                                                                                                                                              |
| Plans and gifts      | Package coverage/session count/validity; membership billing interval, included visits/perk; gift amounts                                                                   | Plan editor; catalog definitions feed dedicated entitlement purchase flows                                                                                                                                        |
| Inventory            | Tracked stock, low/out-of-stock/value summaries, restock, receiving multiple delivery lines, supplier/reference and movement history                                       | Web/native `Stock`, `useInventory`, `useRestockForm`, `useReceiveDelivery`, backend `inventory.py`                                                                                                                |
| Team                 | Member list/detail, role access explanation, invite multiple emails, pending invitations, copy/resend/revoke, role/removal actions and service/retail pay configuration    | [Team](../../../frontend/apps/web/src/pages/Team.tsx), [staff.ts](../../../frontend/packages/app-core/src/domain/staff.ts), backend `staff.py`                                                                                |
| Hours                | Weekly member grid/editor, own-hours restriction, time off and business closures, affected visits requiring attention                                                      | [Hours](../../../frontend/apps/web/src/pages/Hours.tsx), [hours.ts](../../../frontend/packages/app-core/src/domain/hours.ts). Regular hours sync-write; exceptions use `/v1/time-off`.                                        |
| Getting paid         | Stripe connection/KYC phases, outstanding requirements/deadline, enabled capabilities/balance, onboarding link and refresh                                                 | [GettingPaid](../../../frontend/apps/web/src/pages/GettingPaid.tsx), [gettingPaid.ts](../../../frontend/packages/app-core/src/domain/gettingPaid.ts), `/v1/connect/status` and `/onboard`                                     |
| Taxes                | Registered/small-supplier choice, province, registration numbers, filing frequency, worked example, per-item tax class and bulk update                                     | [Taxes](../../../frontend/apps/web/src/pages/Taxes.tsx), [taxes.ts](../../../frontend/packages/app-core/src/domain/taxes.ts), backend tax/business/catalog services                                                           |
| Online booking       | Page/share/embed/QR, services and staff online visibility, lead time/horizon/slot spacing/new-client approval; add-on offers; client move/cancel limits and deposit policy | [OnlineBooking](../../../frontend/apps/web/src/pages/OnlineBooking.tsx), `OnlineBookingSettings`, [onlineBooking.ts](../../../frontend/packages/app-core/src/domain/onlineBooking.ts), `/v1/online-booking`                   |
| Reminders            | SMS/email preview from the actual server message, sent count, open visits and completion/no-show actions                                                                   | [Reminders](../../../frontend/apps/web/src/pages/Reminders.tsx), [reminders.ts](../../../frontend/packages/app-core/src/domain/reminders.ts). Channel checkboxes are fixed/disabled; this is not a custom automation builder. |

Online booking is implemented on mobile too. Older documentation calling it web-only is stale.

## Global and supporting surfaces

- **Search:** [search.ts](../../../frontend/packages/app-core/src/domain/search.ts) searches local records and provides navigation/create results, highlights, keyboard selection and recent queries. Web uses `CommandPalette`; native uses `SearchScreen`.
- **Notifications:** [notifications.ts](../../../frontend/packages/app-core/src/domain/notifications.ts) derives a seven-day activity feed from synced payments, bookings, messages, reviews and invoices. Read/seen state is per-device, not a synchronized server notification inbox. Native push registration is separate.
- **Printing:** `DocumentPreview`, `PrintedDocument`, `DocTotals` and `PayCode` share document data through [printing.ts](../../../frontend/packages/app-core/src/domain/printing.ts). This is reusable invoice/estimate/receipt presentation rather than separate business records.
- **Files:** Presigned upload flows create file rows and send bytes to S3-compatible storage. Item and brand images use public media endpoints. Public form attachments have type and size validation.
- **Developer tools:** Web `DebugPanel` is gated by dev mode; native `DebugOverlay` exposes replica/sync state. Web debug tools include tables and a query view. They are not navigation destinations for ordinary customers.

## Native-specific composition and boundaries

The [mobile product surface map](mobile.md) expands this into a screen-by-screen native review, including every embedded payments/inbox area, client records, editors, platform integrations, routing gaps and repeatable Maestro walkthroughs.

The 32 [native screen modules](../../../frontend/apps/mobile/src/screens) cover the same operational areas as web. Client history/pets/wallet and setup onboarding also have screens under `src/components`. Payments and Inbox switch their subareas inside a screen; other details use the native stack or modal sheets. The native app is not exercised by the browser walkthrough of the provider web app.

| Area                    | Native implementation and difference                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cards and bank accounts | Native Stripe components collect cards. [ClientScreens](../../../frontend/apps/mobile/src/components/ClientScreens.tsx) can show saved bank accounts, but directs new bank-account entry to web.                                                                                                                                                        |
| Tap to Pay              | [Terminal](../../../frontend/apps/mobile/src/components/Terminal.tsx) initializes, discovers a reader, connects at the business's location, retrieves the payment intent, collects and confirms. It models connecting/ready/collecting/done/error and needs a development build with supported hardware or a simulated reader. Expo Go is insufficient. |
| Documents               | [DocumentPreview](../../../frontend/apps/mobile/src/components/DocumentPreview.tsx) renders the common letterhead document and shares its public URL through the native share sheet. It does not generate a PDF attachment itself.                                                                                                                      |
| Report export           | [Reports](../../../frontend/apps/mobile/src/screens/Reports.tsx) shares CSV as text with a filename title. Its bookkeeper panel offers individual exports; the web implementation can download a ZIP.                                                                                                                                                   |
| External actions        | Phone/SMS, Google-review links and Stripe onboarding use `Linking`; booking-page sharing uses the native share sheet. Keyboard avoidance and safe-area treatment are implemented in native layouts.                                                                                                                                               |
| Push                    | [Push adapter](../../../frontend/apps/mobile/src/lib/push.ts) requests permission, registers an Expo token and configures foreground presentation. Errors do not block startup. No notification-tap navigation listener is registered here.                                                                                                             |
| Incoming links          | The Expo config declares the `clientbridge` scheme, but the current `NavigationContainer` has no linking configuration. Incoming URL-to-screen routing is not demonstrated by that scheme declaration alone.                                                                                                                                      |

## Connect client surfaces

[Connect routes](../../../frontend/apps/connect/src/App.tsx) use a business slug or URL token as the credential. The app imports the PowerSync-free `app-core/public` entrypoint and uses `createPublic…Client` factories. `PublicFrame`, `PublicPage`, `PublicDocument` and `PublicStatus` supply business branding, responsive layout, loading, missing-link, error and completion presentation.

| Route                 | Surface and flow                                                                                                                                                                     | Shared behavior                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/b/:slug`            | Business landing, branding, service summary, book and shop entry points                                                                                                              | `usePublicBusiness` in [publicBooking.ts](../../../frontend/packages/app-core/src/domain/publicBooking.ts)                                         |
| `/book/:slug`         | Choose service, member/date/time, enter client/pet/contact details, choose offered products, confirm, deposit checkout if needed, pending/confirmed result, calendar and manage link | `usePublicBookingFlow`, `BookingSteps`, backend public booking service; server availability and booking policy                               |
| `/m/:token`           | Booking facts, cancellation rules, move picker, allowed cancellation and done states                                                                                                 | `useManageBooking`; server enforces cutoffs/move limits and permitted deposit refund                                                         |
| `/i/:token`           | Invoice lines/tax/balance, optional tip, card or e-Transfer, paid state and print                                                                                                    | [publicPay.ts](../../../frontend/packages/app-core/src/domain/publicPay.ts), Stripe Elements and public payment endpoints                          |
| `/i/:token/etransfer` | Recipient/reference/amount instructions, copyable details, waiting/paid state and return to invoice                                                                                  | `usePublicInterac`; a pending request and settlement status                                                                                  |
| `/e/:token`           | Estimate, accept/decline/reason, expired/answered states and print                                                                                                                   | [publicEstimate.ts](../../../frontend/packages/app-core/src/domain/publicEstimate.ts); provider conversion remains a separate action               |
| `/r/:token`           | Receipt, lines, totals/payment information and print                                                                                                                                 | [publicReceipt.ts](../../../frontend/packages/app-core/src/domain/publicReceipt.ts)                                                                |
| `/form/:token`        | Dynamic questions, completion progress, required validation, file uploads, submit and already-completed state                                                                        | [publicForm.ts](../../../frontend/packages/app-core/src/domain/publicForm.ts), shared `FormQuestion`; server validates response                    |
| `/contract/:token`    | Read versioned contract, typed/drawn signature, printed name and consent, sign/decline, signed copy                                                                                  | [publicContract.ts](../../../frontend/packages/app-core/src/domain/publicContract.ts), `ContractDocument`, `SignaturePad`                          |
| `/review/:token`      | Rating and text, submission/thanks, optional onward Google review action                                                                                                             | [publicReview.ts](../../../frontend/packages/app-core/src/domain/publicReview.ts)                                                                  |
| `/prefs/:token`       | Marketing email/SMS choices, save, unsubscribe all, and one-click email unsubscribe/resubscribe presentation                                                                         | [publicPreferences.ts](../../../frontend/packages/app-core/src/domain/publicPreferences.ts); transactional reminder explanation is separate        |
| `/shop/:slug`         | Product/category browsing, cart quantities, contact details, payment, pickup completion                                                                                              | [publicShop.ts](../../../frontend/packages/app-core/src/domain/publicShop.ts); server validates online flags and stock and creates an online order |
| Unknown route         | Explicit not-found page                                                                                                                                                              | Connect catch-all route                                                                                                                      |

The public app is not a signed-in client portal with an account dashboard. Its client experiences are independently tokenized documents and booking/payment flows.

### Embedded Connect

[embed.js](../../../frontend/apps/connect/public/embed.js) defines five custom elements: `connect-booking`, `connect-pay`, `connect-form`, `connect-contract`, and `connect-review`. They create iframes with `?embed=1`, payment permission and content-driven height. [embed.ts](../../../frontend/apps/connect/src/embed.ts) reports resize and completion messages. The loader checks the sending frame and its origin before resizing or dispatching `connect:success`. Other Connect routes exist as pages but do not currently have custom-element definitions in this loader.

## Marketing site

[Routes](../../../frontend/apps/site/src/routes.tsx) define 15 regular pages and a 404. `scripts/prerender.ts` emits static HTML for each page; production HTML does not require the React runtime to display its content. Fonts are local, photos are generated in multiple formats/sizes, and route metadata feeds canonical/social tags, a sitemap and generated share images.

| Page family            | Content and construction                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home `/`               | Hero, service-provider examples, capability/feature/payment sections, pricing, proof and closing actions. Composed from `src/sections` with typed content modules.                                                                               |
| Solutions `/solutions` | Industry cards and shared capabilities; links to trade pages.                                                                                                                                                                                    |
| Eight trade pages      | `/solutions/pet-grooming`, `/salons`, `/fitness`, `/cleaning`, `/tutoring`, `/wellness`, `/photography`, `/trades` beneath `/solutions`. One `TradePage` template consumes trade/brand content and selects booking/schedule/bill/client mockups. |
| Features `/features`   | Capability catalogue assembled from content and shared marketing sections.                                                                                                                                                                       |
| Pricing `/pricing`     | Plan/payment pricing content, included capabilities and signup actions. This site is not a billing settings screen.                                                                                                                              |
| Privacy and terms      | `Legal.tsx` renders introductions and titled sections, but the section bodies currently use placeholder content from `content/pages.ts`.                                                                                                         |
| Credits `/credits`     | Photo/source/license table from `content/photos.ts`.                                                                                                                                                                                             |
| 404                    | Static missing-page content and a home link.                                                                                                                                                                                                     |

The site's product mockups are purpose-built components under `src/mocks`, fed by demo content. They do not query the provider app. Sign-in/signup links lead to web; the demo-business link leads to Connect. Testimonial placeholder content is explicitly present in the content and trade-page implementation.

## Component playground

[Playground stories](../../../frontend/apps/playground/src/stories) cover 65 component files. [Routes](../../../frontend/apps/playground/src/routes.ts) support a gallery, component/example links, web/native comparison, iPhone/Android frames and themes. Controls expose selected props; examples include import/code snippets. Native previews use React Native Web, including Stripe substitutes where a native API cannot run in a browser.

The catalogue spans actions and form controls; navigation and layout; loading/empty/error/sync states; list/detail/data displays; calendar/time selection; messaging/reviews; and payment/document/signature components. Each story uses a shared kit to render equivalent examples through web and native implementations. Existing uncommitted component/playground work is part of the working tree inspected here.

Browser story rendering does not test native navigation, SecureStore, push permissions/delivery, the native keyboard, native modal/gesture behavior, or physical Tap to Pay hardware.

## Findings to carry forward

- **Observed intermittent sign-out error:** one provider walkthrough reached Sign in but logged `401 GET /v1/staff/team` during sign-out. [App.tsx](../../../frontend/apps/web/src/App.tsx) clears credentials, awaits replica clearing, then unmounts authenticated routes; [useTeam](../../../frontend/packages/app-core/src/domain/staff.ts) reloads when the local member count changes. This ordering is a plausible cause, not a verified fix. A subsequent shell walkthrough passed. Keep this as a race to investigate; the console-error assertion remains in place.
- **Resolved preview compatibility issue:** both playground phone loops initially failed with `global is not defined`. The built React Native Web animation cleanup referenced `global.cancelAnimationFrame`. The playground Vite config now maps `global` to `globalThis`; both complete phone loops passed after rebuilding.
- **Incomplete entry flows:** Google sign-in displays an unavailable message; reset-email request exists without a registered new-password entry screen; native invite entry is absent; provider sign-out does not invoke the backend refresh-session revocation endpoint. These are implementation findings, not failures of the new validation tests.
- **Product boundaries:** no completed business switcher; marketing legal/testimonial placeholders remain; native push-tap/deep-link navigation needs follow-up. Staff pay records payment and tax returns record filing/payment; neither is a full payroll or government-submission workflow.
- **Coverage boundaries:** browser checks do not establish physical native behavior, every business mutation, external-provider settlement, offline conflict recovery, or all empty/error/expired states. The public invalid-link matrix is narrower than full token-expiry/replay coverage.

## Reusable verification

The browser suites exercise the real application implementations. Provider web and Connect require the seeded local API/database; provider web also requires PowerSync. The site and playground run against fresh static builds. Backend integration tests use rollback isolation, but the browser fixtures use the persistent demo business and can mint links/create test records. `make seed` truncates/recreates demo data and is not required for an ordinary repeat run against an already seeded stack.

```sh
UV_CACHE_DIR=/tmp/uv-cache make test-web
UV_CACHE_DIR=/tmp/uv-cache make test-connect
make test-site
make test-playground
```

The similarly named `make test-e2e` is the backend real-Stripe test tier, not these browser suites. `UV_CACHE_DIR` works around this machine's unwritable default uv cache; it is not an app requirement.

For a navigable screenshot record of the provider walkthrough and Connect phone pages:

```sh
UV_CACHE_DIR=/tmp/uv-cache E2E_CAPTURE_SURFACES=1 make test-web
UV_CACHE_DIR=/tmp/uv-cache E2E_CAPTURE_SURFACES=1 make test-connect
```

Web and Connect produce local HTML reports and retain traces/screenshots for failures. Optional provider screenshots record the state at the end of each named action step; a step that opens a client from Inbox ends on Clients. They are walkthrough evidence, not pixel-baseline visual regression tests or a complete gallery of every intermediate dialog. Capture waits for main content and loading indicators to settle. Run a given app's suite once at a time because its default artifact directory and managed server are shared. The default test ports are separate: web 8721, playground 8722, and Connect 8723.

| Suite                          | What it establishes                                                                                                                                  | Boundary                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Web `web.e2e.ts`               | Owner/staff shell, destinations, record/editor/dialog rendering, navigation, role visibility and selected keyboard interactions                      | Many action dialogs are canceled, so this is a broad smoke walkthrough rather than proof of every mutation.                |
| Web `auth.e2e.ts`              | Sign-in/signup/reset validation at desktop and phone width, password visibility, Google unavailable state, signup deep link and missing invite token | No account creation, real reset email, OAuth or native authentication automation.                                          |
| Connect `connect.e2e.ts`       | Existing public booking/manage/shop/payment/document flows, every public page at phone width, invalid-link states and no writes from invalid links   | Card settlement, legal signing, review submission and every post-submit state are not all exercised by this browser suite. |
| Site `site.e2e.ts`             | All sitemap pages without JS, desktop/phone overflow and images, serious/critical accessibility issues, internal links/assets and 404                | Static marketing behavior.                                                                                                 |
| Playground `playground.e2e.ts` | All stories on web and both native browser frames, comparison/gallery, accessibility, focus indicators and selected control interactions             | Component examples, not the full native app.                                                                               |
| Backend tests                  | 93 top-level test files plus contract tests across tenant/role gates, commands, payment/booking lifecycles, jobs, reports and public endpoints       | Separate from browser runs and real external-provider/hardware verification.                                               |

CI currently runs site, Connect and playground browser jobs. The provider web walkthrough is a local Make target and has no corresponding CI job in `.github/workflows/ci.yml`.

### Results from this review

| Check          | Result on October 7, 2026                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider web   | All 11 tests passed in the complete run after correcting route readiness. This includes the three new auth tests and all eight owner/staff walkthroughs.                                                                                            |
| Connect        | All 9 tests passed, including 12 valid pages at phone width and 12 invalid-link states.                                                                                                                                                             |
| Marketing site | All 63 tests passed against a fresh build.                                                                                                                                                                                                          |
| Playground     | All 140 tests passed in a complete fresh-build run during takeover, including all stories in both phone frames, accessibility, focus, and hover contrast. |
| Static checks  | Web and Connect type checks passed; playground's build passed both web and native TypeScript checks. Targeted E2E ESLint and Prettier checks passed.                                                                                                |

An earlier provider run caught the intermittent sign-out 401 described above; a later passing run does not establish that the race is fixed. Early runs also encountered local-stack startup delays and a collision between overlapping runs of the same app. Those interrupted/failed runs are not counted as passes. The production provider UI and authentication implementation were not changed in this review.

The reusable changes add auth validation/deep-link tests, public phone-layout and invalid-link matrices, real content checks for Payments destinations, per-section Setup checks, optional walkthrough screenshots, and failure traces/HTML reports. The playground change is limited to its Vite compatibility configuration. Existing component/style changes in the working tree were preserved.

Reports for this review are kept locally under `.scratchpad/product-review/`: `web` contains a passing eight-walkthrough run, `connect` contains the passing nine-test run, and `web-ready` contains the two passing shell/schedule reruns after improving screenshot readiness. The latter screenshots were visually checked to show loaded content. To retain future reports outside an app's default folder, set `PLAYWRIGHT_HTML_OUTPUT_DIR` to an absolute directory when invoking its E2E command. Reports, traces and screenshots are generated artifacts and are not source-controlled. The entire backend/unit-test gate was not rerun for these browser-test and documentation changes.


### Claude-session takeover verification

The interrupted exploration resync is repaired in `.scratchpad/explore`: current row fixtures,
explicit preview compatibility exports, date/time controls, icon names, and fixture-backed public
shop/invoice/booking clients. Historical preview helpers remain isolated from production app-core.
The web and native TypeScript programs both pass. The preview README documents maintenance and
`npm run verify:frames`; screenshots and its JSON report live under `.scratchpad/shots/`.

The production gate was rerun during takeover: formatting, frontend/backend lint and structure,
all application type checks, code-generation consistency, 1,190 backend tests (95.16% coverage),
201 app-core tests, and six site unit tests passed. All four web application builds passed.
The complete provider browser suite passed all 11 tests, and the fresh marketing build passed all
63 browser tests. The provider test sign-in helper now submits once and waits for the authenticated
screen instead of retrying a button that disappears after a successful sign-in. This is a test
readiness fix; it does not claim to fix the separately observed sign-out race.

Connect now defaults to test port 8723, avoiding accidental reuse of the playground server on 8722.
Generated Playwright reports/results are excluded from ESLint as well as Git. Existing review tests
and documentation from the other session were preserved.

The complete playground rerun passed all 140 tests. Connect browser journeys use separate synthetic
`2001:db8::/32` client addresses through the local API's forwarded-client header so independent
contexts do not exhaust one localhost rate-limit bucket. This changes only browser-test traffic;
production limits and their backend tests are unchanged.

The final complete Connect rerun passed all nine tests, including all 12 phone pages and all 12 invalid-link states.

The final preview sweep passed all 447 frames across 140 explorations (desktop, iPhone, and Android
where supported), with zero reported runtime/console errors. The report is
`.scratchpad/shots/verification/frames.json`. Representative screenshots across all 11 epics were
compared with earlier captures; 22 current captures are in `.scratchpad/shots/takeover/`. The migrated
pet birthday picker was also exercised: selecting Today updated the form with no JavaScript errors.
These browser-native previews do not establish native-device gesture or hardware behavior.

The unstarted production Connect redesign and Stripe white-label proposals remain separate follow-up
work. No commits, pushes, or deployment were performed as part of takeover. Concurrent mobile Inbox
accessibility/e2e edits from another session were preserved and are outside the verification above.
