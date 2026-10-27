# Product functionality and end to end coverage plan

This initial outline is superseded by the [comprehensive product and E2E brief](comprehensive-e2e-brief.md), compiled from fifteen separate category audits. Use that brief for current product semantics, named test evidence, reproduced checks, candidate defects and the expanded scenario catalogue. In particular, its corrections cover roles, financial-source merges, stock holds, check-in warnings, refund/earnings rules, notification guarantees and capabilities that are not yet exposed in the UI.

Source review dated 23 October 2026. This is a technical product map and proposed coverage plan, not a test execution report. Existing test implementations, services, models, shared frontend logic, and CI configuration provide the baseline. No application tests or sandbox transactions were run for this review.

The strongest existing evidence is in backend business-rule tests, authentication journeys, sync isolation, and a small genuine Stripe sandbox suite. The largest remaining gap is complete transactions through the web and native interfaces, including their asynchronous consequences. Keep the useful existing tests and add explicit coverage for these boundaries.

## How a complete operation works

Provider web and mobile share `frontend/packages/app-core/src/domain` view models. Most provider reads come from authorized local SQLite data populated by PowerSync. A command goes through FastAPI to a service and PostgreSQL; committed changes then travel through the WAL and PowerSync to devices. Connect is a separate public React application using slug/token HTTP endpoints without a replica. Platform administration and the marketing site are separate applications too.

`core/command.py` wraps selected mutations, their audits, and stored idempotent responses in a transaction. Repeated keys are scoped by business and action; changed payloads are rejected. Advisory locks serialize identical command keys. This does not make a database transaction atomic with Stripe, email, or a device: recovery and observation across those boundaries need separate tests.

Weekly hours have a durable local outbox with expected revisions, predecessor relationships, replay, and conflict recovery. General booking and payment writes are server commands, not arbitrary offline replica edits. `packages/sync/src/connector.ts` explicitly rejects direct replica writes.

A complete transactional test should prove the initiating UI, authoritative state, downstream effects, and eventual visible state. For example: click Pay → one payment → balanced accounting → one receipt intent → paid balance on a second device → same balance after reload. A success toast alone proves very little of this chain.

## Existing coverage and its limits

Inventory counts are source files, not executed tests or coverage percentages: 161 backend `test_*.py` files recursively, 8 web E2E files, 4 Connect E2E files, 6 sync E2E files, and 11 top-level native YAML flows. Parametrization and loops make file counts unsuitable as completeness metrics.

| Existing suite | Useful evidence to retain | Boundary it does not establish |
| --- | --- | --- |
| `backend/tests/test_*.py` | Real database business rules, tenancy, races, accounting, jobs, public endpoints; `test_flows_*` already combines domains | Most provider adapters are fakes; in-process HTTP and rolled-back fixtures do not prove production process boundaries, WAL propagation, or browser/native wiring |
| `frontend/packages/app-core/src/domain/*.test.ts` | Shared view-model calculations, validation, transitions, error handling | Actual web/native rendering and real service integration |
| `frontend/apps/web/e2e/auth.e2e.ts` | Signup, mailed verification, recovery, other-device invalidation, authenticator setup/login, invitation identity | Every role, step-up operation, native identity flow, and external Google login |
| `frontend/apps/web/e2e/web.e2e.ts` | Broad navigation, permissions in the UI, dialogs, business timezone, accessibility | Many flows open and close editors or cancel confirmations without committing business changes |
| Web offline/history/catch-up tests | Production offline shell, history outside the replica window, payment settling UI | `catchUp.e2e.ts` deliberately fulfills the payment request without a database write; it tests a stalled UI state, not real settlement replication |
| Web payment-account tests | Unavailable Stripe tools and payout pagination/navigation | Payout responses are intercepted; these do not validate actual payout reconciliation |
| Connect browser tests | Real no-deposit booking/request and cancellation; public links, navigation, drafts, embed focus, accessibility | Several failure/shop/payment states use intercepts or stop before payment/signing/submission; classify each case individually |
| Sync E2E | Real role projections, business isolation, revocation, replica lifecycle, hours replay including a lost response | Native process termination, all product writes, and every UI path |
| Native Maestro | Actual app navigation, role visibility, sheets, startup, recovery; Android release APK runs in CI | Business transactions are intentionally mostly unsubmitted; iOS client-editor regression remains outside default discovery per the native README |
| Stripe contract tests | Real adapter request/response compatibility against stripe-mock | Stripe state transitions, genuine events, provider side effects |
| Stripe sandbox tests | 8 gateway tests and 5 application payment tests; genuine signed events, replay, refunds, decline/retry, repair, tenant isolation | Browser Stripe SDK, full PAD settlement, Terminal collection, full subscription lifecycle, and committed multi-process sync |
| Site browser tests | Built pages, links, images, responsive layout and accessibility | Deployed host routing and successful contact delivery across all environments |

Current CI is much broader than the README's older five-job description. `.github/workflows/ci.yml` includes backend, infrastructure, contract, frontend, build, images, site, Connect, codegen, sync, web, and Android build/shard jobs. `.github/workflows/stripe-qa.yml` is a separate manual, main-only workflow using a protected `stripe-sandbox` environment. Passing ordinary CI does not imply that sandbox workflow ran.

## Product sections and scenario catalogue

The IDs below identify proposed coverage obligations. They are not claims that corresponding tests already pass. Each semicolon-separated boundary should become a separately traceable case or parameter row. Existing tests should satisfy an obligation when their assertions genuinely prove it.

### 1 Identity, access and business onboarding

**How it works.** Kratos owns identity/session flows; application principals derive business membership and role from the database on requests. Web uses cookies and mobile uses session tokens. Business selection, API scoping, database permissions, and PowerSync projections jointly define isolation. Onboarding creates the business context and settings consumed by booking, billing, and public pages. A valid identity alone is not authorization for a business.

**Evidence:** `core/deps.py`, `services/auth.py`, `services/business.py`, `integrations/kratos.py`; `test_auth*`, `test_security.py`, `test_scoping.py`, `test_business_onboarding.py`, web authentication E2E and sync revocation E2E.

**Cases:**

- **AUTH01:** New signup → actual verification email/code → onboarding → provider home → reload. Assert one identity linkage, one business, correct owner membership, and correct replica.
- **AUTH02:** Existing account login, logout, password recovery, password change, authenticator login and sensitive-action step-up. Verify other sessions are revoked where specified; network failure must not masquerade as logout.
- **AUTH03:** Invited existing/new user accepts only with the matching email. Exercise expired, revoked, reused and wrong-account invitations, verification in another tab, and simultaneous seat claims.
- **AUTH04:** Owner, manager and staff: inspect each protected read and mutation through both UI and direct API. Substitute another business's object IDs, selected-business header, file IDs and public tokens. Assert zero leaked data and zero side effects.
- **AUTH05:** Downgrade/remove membership while a second device is open, offline, or sending work. On reconnect, inaccessible rows disappear; unsent hours follow explicit recovery semantics.
- **AUTH06:** Cookie Origin/CORS, expired sessions, stale verification flow, unavailable identity service, account recreation, and admin-host separation retain explicit error and recovery behavior.

### 2 Business configuration, catalog and team

**How it works.** Settings control timezone, province, tax registration, branding, public policies, reminders, and merchant readiness. Catalog items define services/products/entitlements and their price, tax class, booking characteristics and online availability. Staff membership, hours, invitations and pay settings influence scheduling, permissions, seat billing and earnings.

**Evidence:** `services/business.py`, `catalog.py`, `staff.py`, `hours.py`; `test_catalog*`, `test_staff*`, `test_hours*`, `test_business_province.py`.

**Cases:**

- **SET01:** Create/update service, product, package and subscription catalog entries in the UI; verify fresh provider and Connect views. Cover hidden/archived items, missing photos and unavailable online offerings.
- **SET02:** Change timezone/province/tax registration and verify the exact allowed changes after documents have been issued. Historical tax and amounts must not be silently recomputed.
- **SET03:** Invite, resend, revoke, change role/pay and remove staff; verify future visits need reassignment/cancellation as prescribed and historical records remain readable.
- **SET04:** Configure branding, booking approvals/deposits, reminders and pickup settings; verify their customer-facing effects rather than only saved toggles.
- **SET05:** Invalid duration/price/tax class, duplicate identities, deleted references and stale editors reject without partial changes. Confirm role restrictions server-side.

### 3 Scheduling, classes and the visit lifecycle

**How it works.** A `Slot` reserves staff time and capacity; `Booking` holds a client's seat and lifecycle. Bookings distinguish pending, confirmed, completed, canceled, no-show and waitlisted. Working hours, exceptions, time off, buffers and existing slots determine availability. Recurrences generate occurrences. Departure/check-in/completion, add-ons, estimates, deposits, forms and checkout connect scheduling to other domains. Denormalized booking start/staff fields support sync windows and staff projections.

**Evidence:** `models/scheduling.py`, `services/bookings.py`; extensive `test_bookings_*`, `test_public_booking_*`, `test_flows_booking.py`, `test_flows_visits.py`.

**Cases:**

- **BOOK01:** Provider creates → reschedules → departs/checks in → completes a visit; customer and second staff device see each permitted transition. Undo check-in and repeated actions must preserve the intended state.
- **BOOK02:** Connect new-client request → owner approval; returning-client booking; “any staff” assignment; optional and required add-ons. Reject a deleted service, wrong subject or newly unavailable time at final submission.
- **BOOK03:** Two real committed clients compete for the same final slot/seat. Exactly the permitted capacity succeeds; the losing UI offers a fresh selection. Include buffers, overlapping services and concurrent hours edits.
- **BOOK04:** Class with multiple seats → fill → waitlist → cancellation → promotion. Test duplicate enrollment, client already seated, canceled class, queue order and late payment for a released seat.
- **BOOK05:** Daily/weekly/monthly series → change one/future occurrences → cancel. Cover month-end, leap day, DST gaps/folds, business/device zones, conflicts and canceled exceptions; assert actual occurrence timestamps.
- **BOOK06:** Deposit pending → collected → applied at checkout; cancel/refund; no-show/forfeit; unpaid hold expiry. Race payment against expiry/cancellation and prove money and capacity remain consistent.
- **BOOK07:** Customer manage link reschedules/cancels at either side of cutoff, exceeds permitted moves, is refreshed/replayed, or targets an unavailable slot. Notification and deposit consequences are part of the result.
- **BOOK08:** Required intake/check-in constraints, automatic completion, reminder quiet hours, booking near midnight, time-off stranding warnings and old visits outside sync windows.

### 4 Client records, subjects and returning customers

**How it works.** Clients own contact information, tags, consent, history and financial relationships. Subjects model the person/pet/place being served with typed attributes. Merge must move relationships safely, not just hide a duplicate row. Returning-customer verification uses a business-scoped challenge and short-lived token to expose the correct profile. Current code allows three challenge requests in 15 minutes, five verification attempts, a 10-minute code and a 30-minute verified session.

**Evidence:** `services/clients.py`, `subjects.py`, `notes.py`, `returning.py`; `test_clients*`, `test_subjects*`, `test_notes.py`, `test_returning.py`.

**Cases:**

- **CRM01:** Create/edit client and subject → book → add note/photo → reload/history search. Verify trimmed fields, normalized phones, duplicate contacts, Unicode names and optional fields.
- **CRM02:** Merge populated records with visits, invoices, entitlements, messages, forms and subjects. Assert references, balances and consent survive according to merge rules; reject self/cross-business merge and stale source.
- **CRM03:** Archive/restore, bulk tag/archive and edit restricted fields as staff. Assert archived records cannot be used where prohibited while historical documents remain valid.
- **CRM04:** Returning customer requests and uses actual captured email/SMS code. Test wrong/expired/reused code, request and attempt thresholds, ambiguous shared contact, changed contact, archived client and wrong business. Unrecognized contacts must not disclose another client's profile.

### 5 Estimates, invoices and public payment documents

**How it works.** Shared line pricing handles quantities, discounts and tax. Estimates can be sent, accepted/declined and converted or used to arrange a visit. Issued invoices create receivables and fixed tax amounts; payment/refund entries determine financial balances. Public tokens provide access to a specific estimate, invoice or receipt. Numbering, issue, conversion and payment need server authority.

**Evidence:** `services/billing.py`, `lines.py`, `public.py`, `ledger.py`; `test_billing_*`, `test_public_estimate.py`, `test_public_pay.py`, `test_flows_billing.py`.

**Cases:**

- **BILL01:** Compose estimate → send → customer opens actual message link → accepts → convert/book → issue invoice → customer pays → both interfaces and receipt agree.
- **BILL02:** Decline, revise, resend, repeat acceptance and simultaneous conversion. Exactly one allowed conversion/booking; stable links and historical content follow the implemented version rules.
- **BILL03:** Mixed taxable/exempt lines, fractional calculation boundaries, fixed/percent discounts, zero total and inclusive prices. Assert independent cent-level expected amounts.
- **BILL04:** Partial payment → remaining payment → partial/full refund and credit note. Cover overpayment/over-refund, paid/void document, duplicate click and stale balance.
- **BILL05:** Draft edit versus issued-document restrictions; concurrent invoice numbering; overdue worker; expired/unknown token; print/download and old-history retrieval.

### 6 Sales desk, online shop, inventory and pickup

**How it works.** Orders combine products, services and visit-related lines. Checkout fixes terms and can apply deposits, gift-card value, cash/card/Terminal payment and tips. Inventory movements and held orders govern stock availability; unpaid-order cleanup releases holds. Online shop adds public cart/contact/pickup flows and order links. Settlement, refunds and earnings share accounting with invoices.

**Evidence:** `services/orders.py`, `inventory.py`, `public_orders.py`, `public.py`; `test_orders*`, `test_public_shop.py`, `test_public_orders.py`, `test_flows_sales.py`.

**Cases:**

- **SALE01:** Build desk cart → discount/tip → pay cash with change → receipt → inventory and earnings update. Resume held cart and reload after payment.
- **SALE02:** Public cart → contact/pickup → real payment → merchant sees order → ready notification → customer order link. Revisit cart/product URLs and reload each step.
- **SALE03:** Two customers buy the last unit; race manual sale against online hold. Assert one reservation/sale and correct stock; retry, abandoned checkout and expired hold release exactly the appropriate movement.
- **SALE04:** Partial/full refund with configured restock, failed refund, duplicate refund, changed quantity and void unpaid order. Stock, cash, tips, tax and commission must agree.
- **SALE05:** Cart contains hidden/deleted item, changed price, wrong-business item, unavailable pickup date or customer changes business. Server recalculates trusted totals and isolates drafts.
- **SALE06:** Multiple visits on a sale, already-charged visit, deposit application and removed add-on. One visit must not be charged twice or retain a consumed deposit after the sale is reversed.

### 7 Payments, merchant onboarding and Stripe

**How it works.** Stripe Connect merchant accounts receive direct charges; the platform takes an application fee. The adapter manages merchant status, account components, customers, methods, payment/setup intents, subscriptions, refunds and payouts. Signed webhooks and reconciliation apply external outcomes to local payments and accounting. Payment methods belong to the correct connected account. PAD and Terminal have additional setup/collection and asynchronous lifecycle requirements.

**Evidence:** `services/payments.py`, `integrations/stripe.py`, `api/webhooks.py`; `test_payments*`, `test_webhooks*`, `tests/contract`, `tests/e2e`.

**Cases:**

- **PAY01:** Finish merchant onboarding/status refresh and enter each embedded account component. Unready/restricted account prevents unsupported collection; return/refresh preserves navigation.
- **PAY02:** Actual browser card checkout succeeds, declines, requires authentication, is canceled, loses network after confirmation, or is refreshed. Server balance remains authoritative; retry cannot create a second successful collection.
- **PAY03:** Save/default/detach card; charge saved card where supported; setup link succeeds/expires/is revoked. Wrong client/business/account method must fail before external mutation.
- **PAY04:** PAD setup/mandate → pending collection → success/failure → revoked mandate/retry. An accepted setup or pending debit must never be asserted as settled funds.
- **PAY05:** Duplicate, delayed, reordered, invalid-signature and wrong-account events; API request times out after Stripe accepts it; repair before/after late webhook. Assert unique journal legs and correct final payment state.
- **PAY06:** Partial/full/external refund, failure/pending outcome, application-fee treatment, dispute opened/won/lost and payout paid/failed. Verify provider source amounts against ledger deltas and displayed history.
- **PAY07:** Terminal simulated reader discovery → collect → confirm → cancel/disconnect/retry. Keep physical Tap to Pay/device authorization and real reader connectivity in a separately reported device lane.

### 8 Gift cards, packages and customer subscriptions

**How it works.** These are prepaid entitlements, distinct from the provider's own Clientbridge plan. Purchases activate gift-card balances or package rights; redemption/session consumption and expiry affect liabilities and recognition through ledger entries. Customer subscriptions synchronize recurring payment periods and status from Stripe.

**Evidence:** `services/entitlements.py`, `models/catalog.py`, `services/ledger.py`; `test_entitlements_*`, `test_flows_sales.py`, subscription flow in `test_flows_billing.py`.

**Cases:**

- **ENT01:** Sell and activate gift card → redeem partially → finish balance → refund original/redeeming sale where supported. Test insufficient balance, wrong business and simultaneous final-balance redemption.
- **ENT02:** Buy package → cover eligible visit → consume final session → cancel/refund/expire. Ineligible service/client, exhausted package, double completion and simultaneous final-session consumption cannot grant extra service.
- **ENT03:** Customer subscription start → renewal → failed renewal → recovery → cancellation. Assert periods/status and entitlement rules after each event, including duplicate/reordered events.
- **ENT04:** Expiry and breakage worker on either side of expiry; repeated run; refund after consumption. Preserve the implemented product policy explicitly rather than inventing a refund rule in the test.

### 9 Ledger, tax, staff earnings and reports

**How it works.** Append-oriented journal entries model receivables, money, tax, deposits, deferred value, fees and staff liabilities. Account balances are maintained by database triggers. Unique entry references/legs prevent duplicate postings. Tax uses date-effective provincial rates, exact arithmetic, per-jurisdiction rounding, registration and tax class; issued amounts are preserved. Reports and remittances read these financial facts. Earnings progress through approval/payment and reverse with related transactions.

**Evidence:** `models/ledger.py`, `services/ledger.py`, `tax.py`, `reports.py`, `remittances.py`, `earnings.py`; `test_ledger*`, `test_tax*`, `test_reports*`, `test_remittances*`, `test_earnings*`.

**Cases:**

- **FIN01:** One independently calculated fixture covers invoice/sale, deposit, tip, Stripe/application fees, staff pay and refund. Assert journals balance per currency and account deltas, UI totals and exports agree.
- **FIN02:** Parameterize every implemented province/date/tax-class/registration/inclusive combination at the calculation/API layer. Browser examples cover exclusive, inclusive, mixed tax and historical-rate behavior. Include one-cent allocations and refunds.
- **FIN03:** Approve/pay staff in bulk, retry payment recording and reverse a source transaction before/after approval/payment. Assert ownership, payable, amounts and historical labels.
- **FIN04:** File federal/provincial return → record remittance → reopen report; repeated filing, period boundary, refund in later period and partial remittance cannot silently change filed history.
- **FIN05:** Income, sales-by-item, payout, T4A and CSV/ZIP exports for empty and populated periods, non-ASCII names and spreadsheet-sensitive text. Reconcile numeric content, not only download success.
- **FIN06:** Reconciliation identifies missing/foreign sources and drift without inventing payments; repeat repair is idempotent; admin acknowledgement preserves the underlying evidence.

### 10 Messages, broadcasts, consent and notifications

**How it works.** Conversations collect outbound/inbound communications; broadcasts select recipients and run asynchronously. Consent is recorded per channel, with withdrawal/expiry and SMS STOP/START behavior. Durable deliveries use stable keys, claims and retry windows for migrated notification paths. Acceptance by a provider is separate from delivery confirmation. Current expired sending leases become `ambiguous`, and must not be blindly resent.

**Evidence:** `services/messaging.py`, `consents.py`, `notifications.py`, `deliveries.py`; `test_messaging*`, `test_consents.py`, `test_notifications*`, `test_deliveries.py`.

**Cases:**

- **MSG01:** Provider sends → captured outbound message → signed inbound reply → thread/unread updates on another device → mark read. Duplicates, old history and wrong destination cannot create duplicate/cross-business conversations.
- **MSG02:** Immediate/scheduled broadcast → eligible recipients only → cancel or provider failure. Recheck withdrawals and expired implied consent at dispatch; test recipients changing after scheduling.
- **MSG03:** SMS STOP blocks sending and cannot be overridden by staff consent toggle; START re-enables under the implemented rules. Exercise email unsubscribe, complaint, bounce and repeated callbacks.
- **MSG04:** Booking/payment/form/reminder produces the expected delivery intent; worker retry after outage and restart preserves business state. Email success plus SMS failure cannot repeat an already accepted email.
- **MSG05:** Crash before dispatch versus after provider acceptance; lease expiry becomes visible ambiguity. Distinguish queued, accepted, delivered, failed and ambiguous in assertions and admin views.
- **MSG06:** Quiet hours, locale, links, attachment ownership, no SMS number, invalid device token and push registration/removal; push tap opens the correct record on supported native devices.

### 11 Forms, contracts and files

**How it works.** Forms define typed fields and snapshot the definition when a response request is created. Public submission validates answers, signatures and file ownership. Contracts track versions and a specific signature request; signing must attest to the version presented. Files use upload authorization, object storage, completion checks and later linking/sharing; public media and private records have different visibility.

**Evidence:** `services/forms.py`, `contracts.py`, `files.py`, `public.py`; `test_forms*`, `test_contracts*`, `test_files*`, `test_flows_engagement.py`.

**Cases:**

- **DOC01:** Build typed form → send → open captured link → complete fields/signature/upload → submit → provider reads response. Required checkbox, rating, options, unknown keys and malformed values reject correctly.
- **DOC02:** Edit/delete/recreate field after sending/submission. Historical response retains original meaning and new requests use the new definition; reload must not mutate a submitted response.
- **DOC03:** Send contract → client reads → signs or declines → provider and signed copy agree. Publish a new version while signing; stale content cannot receive a valid signature for unseen text. Retry/resend cannot duplicate acceptance.
- **DOC04:** Upload/link/replace/remove photo or attachment; wrong MIME/size, missing object, incomplete upload, foreign file and unauthorized sharing are rejected. Prune pending uploads without deleting referenced content.
- **DOC05:** Expired/unknown/consumed public token, browser back/resubmit and parallel submissions. Assert final immutable evidence and correct public completion screen.

### 12 Reviews and Google Business integration

**How it works.** Review requests connect completed work to the business's review destination. Google connection authorization, account/location selection, review reads and reply operations use provider adapters and queued operations. Unavailable, unlinked and linked-with-no-reviews are distinct states.

**Evidence:** `services/reviews.py`, `integrations/google_business.py`; `test_reviews*` and the Google empty/error browser case.

**Cases:** **REV01:** eligible completed visit → one request with correct destination, excluding recently requested/ineligible clients. **REV02:** connect → select account/location → list/paginate → reply → observe saved reply. **REV03:** wrong OAuth state, denied access, expired credentials, provider quota/outage, disconnect during queued reply and retry. Use deterministic provider fixtures in PR CI and a credentialed provider smoke lane where account permissions permit it.

### 13 Clientbridge plans and seat billing

**How it works.** Platform subscription billing controls provider access, plan edition and staff seats. `/v1` mounts a plan-write dependency; services separately govern serving/public access. Live invitations reserve seats. Stripe checkout, subscription changes and seat reconciliation determine billing/access transitions. This is financially and operationally separate from subscriptions sold by a merchant to clients.

**Evidence:** `services/plans.py`, `api/plans.py`, `api/router.py`; `test_plans.py`, `test_plans_seats.py`, shared `domain/plans.ts`.

**Cases:** **PLAN01:** trial → checkout → active → renewal failure/lapse → recover; verify allowed reads, blocked writes and public availability for each actual state. **PLAN02:** upgrade/downgrade/month-year change and portal return without trusting redirect alone. **PLAN03:** accept/revoke/expire invitations, remove staff, concurrent last seat, and failed seat-sync job. Provider quantity and local reserved/billable seats must converge. **PLAN04:** repeat/reorder platform events and trial reminders without duplicate seat charges or notices.

### 14 Sync, offline operation and device lifecycle

**How it works.** Authorized streams contain only permitted rows/columns. Devices use account/environment-scoped replicas, windowed data and API-backed older history. Weekly hours proposals remain local until accepted and later observed at the expected revision. Authentication replacement, signout, revocation and reconnect must isolate caches and preserve or explicitly resolve pending work.

**Evidence:** `frontend/packages/sync/src/{lifecycle,hours,history,connector}.ts`, `infra/powersync/sync-rules.yaml`; all six sync E2E files plus web offline/history/catch-up.

**Cases:** **SYNC01:** A writes a real booking/payment/client change → B observes exact values without reload → reload retains them. **SYNC02:** offline shell/restart with valid then expired offline access; only supported offline writes work. **SYNC03:** edit hours offline → kill/restart → replay; lose response after commit → replay once; conflicting editor → explicit resolution. **SYNC04:** identity/business/environment switch with queued work, multi-tab lease races and role revocation; query underlying replica as well as visible UI. **SYNC05:** old history pagination/cache expiry, moved booking across sync window, deletion and empty initial sync. **SYNC06:** API available/sync down and API down/sync available show accurate pending/settling/error states and recover without double submission.

### 15 Platform administration, site and deployment

**How it works.** The admin application queries businesses, people, payments, activity, access, operations and email tooling through separate authorization. Operational actions include editions, SMS assignment and drift acknowledgement. The marketing site builds static pages and routes contact through its handler. Embedded Connect adds host-page integration. Environment-derived origins, API paths and image/storage URLs are part of the deployed product.

**Evidence:** `frontend/apps/admin/src`, `services/admin.py`, `api/admin.py`, `services/site.py`, site application, deployment workflows; `test_admin.py`, `test_site.py`, site and Connect embed E2E. No dedicated admin browser E2E configuration was found in the reviewed app.

**Cases:** **OPS01:** non-admin denied on host/API; admin browses/searches/paginates and performs each supported mutation with audit evidence. **OPS02:** delivery ambiguity, drift and failed operations surface the correct source records; acknowledgements do not erase financial evidence. **OPS03:** email preview/test send uses the intended transport and recipient; SMS assignment validates uniqueness/ownership. **OPS04:** deployed site contact success/failure, rate limit/honeypot, signup/demo links, correct environment origins and deep-link refresh. **OPS05:** embedded booking open/resize/complete/close, focus restoration, message-origin validation and mobile scroll. **OPS06:** production container boot, migration, health/readiness, worker availability, static assets, cache update and rollback-compatible deployment smoke.

## Shared failure and boundary matrix

Apply this matrix to every relevant mutating scenario; use API tests for the exhaustive combinations and representative browser/native tests for actual user recovery.

| Dimension | Required boundaries |
| --- | --- |
| Authorization | owner/manager/staff, unrelated tenant, removed membership, public token, platform admin |
| State | valid predecessor, wrong predecessor, terminal state, archived/deleted dependency, stale UI |
| Retry | double click; identical key/body; same key/different body; lost response after commit; reload/back |
| Concurrency | final seat/unit/session/balance, simultaneous refund/conversion, worker versus user action |
| Time | just before/at/after expiry or cutoff; midnight; DST; leap/month end; business/device timezone |
| Money | zero, one cent, uneven allocation, inclusive/exclusive tax, partial/full reversal, currency mismatch |
| Network | offline before request; timeout after acceptance; sync delay; provider outage; recovery |
| Async | duplicate/reordered event, missed event repaired, worker restart/lease expiry, two workers |
| Data | empty/large/paginated history, Unicode, normalized contacts, foreign references, file limits |
| Presentation | actual navigation, deep link/reload, focus/error recovery, narrow screen, pseudo locale, native keyboard |

Do not promise that a finite suite covers every possible combination. Completeness should mean all agreed behaviors, allowed/forbidden transitions and high-risk interactions have named evidence, with explicitly tracked residual risk.

## Test architecture to build

### Preserve four complementary execution layers

1. **Rules and contracts:** retain backend integration, shared view-model and provider contract tests. Add missing exhaustive calculations/transitions here. These are fast enough to test far more combinations than a browser suite.
2. **Real application journeys:** production web/Connect builds, actual API, committed PostgreSQL, Kratos, PowerSync, Redis/worker and object storage. Deterministic provider doubles belong at the outbound provider boundary. Do not fulfill the application's successful mutation endpoint in a test claiming complete application behavior.
3. **Real provider journeys:** separately credentialed Stripe sandbox and selected notification/Google integration checks. Keep genuine signatures, connected-account scope and provider IDs in their evidence.
4. **Native and deployed journeys:** Android/iOS for actual native modules and lifecycle; deployed staging for ingress, cookie/origin rules, assets, webhook destinations and worker configuration.

Provider fault intercepts remain valuable, but label them as recovery/UI evidence. A physical terminal/device result must not be inferred from a browser viewport or creation of a `card_present` intent.

### Fixtures and isolation

- Create a scenario factory with unique run/scenario/business/client IDs and a small explicit baseline. API setup is appropriate unless setup itself is the behavior under test.
- Use separate committed databases/stacks per shard where practical, and per-test businesses inside them. Shared seeded demo accounts remain suitable for read-only smoke tours; transactional tests must not compete for the same slot, stock, auth identity or consent.
- Retain rollback fixtures for existing integration tests. They cannot substitute for committed data visible to separate API/worker processes and PowerSync.
- Authenticate independent owner/staff/customer browser contexts. Reuse storage state only for unrelated authenticated scenarios; use fresh identities for recovery, revocation and invitation tests.
- Freeze/control the application clock per isolated stack for cutoff/job tests. Coordinate browser display time when relevant. Use wall clock for real auth/provider signatures and Stripe test clocks only for supported Billing resources; never assume one clock controls all services.
- Deliver email to Mailpit and SMS/push to inspectable doubles in deterministic CI. Capture messages by scenario correlation, not “latest inbox message.” Trigger signed inbound callbacks separately.
- Use controlled worker execution for time-sensitive rules plus at least one real scheduler-to-worker smoke. Existing browser jobs do not explicitly start an arq worker, so asynchronous delivery coverage needs additional orchestration.
- Cleanup must run on failure and be scoped to test-owned data. Preserve failed-run evidence before teardown. Never reset a developer's shared database to gain isolation.

### Assertions and diagnostics

Every transactional case records input IDs, command/idempotency key, expected state transition, independent numeric expectations, expected side effects and forbidden effects. Assert persistence after reload and visibility from another authorized observer when sync is part of the feature.

Use condition-based waits for the specific row/revision/balance or delivery state. Replace the fixed 6-second sync delay and 500-ms navigation delay in the broad web tour as it is hardened. Prefer role/label selectors and uniquely created records over `button.block.first()` from mutable demo data. Playwright's guidance supports isolated tests and retrying web assertions rather than fixed timing assumptions: [best practices](https://playwright.dev/docs/best-practices).

On failure retain Playwright trace/screenshots, native logs/video where available, API/worker/PowerSync/auth logs, a scoped database state summary, expected-versus-actual accounting, and sanitized provider references. Redact public access tokens, credentials, payment client secrets and personal data from shared artifacts. Do not treat “passes on retry” as clean evidence; track flaky results separately.

## Stripe sandbox automation

Keep `make test-stripe-qa` as the strict entry point. Unlike the generic optional `make test-e2e`, it fails missing prerequisites and skipped tests, creates an isolated test database, namespaces provider objects, performs cleanup, and records results with the commit. Its local lock and CI concurrency group already help serialize shared merchant use.

The runner requires `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_PLATFORM`, `STRIPE_TEST_CONNECTED_ACCOUNT` and `STRIPE_TEST_OTHER_ACCOUNT`. It verifies test mode, platform identity, two distinct CAD merchants, `clientbridge_qa=payments` metadata, and enabled charges/payouts. Local `--profile clientbridge` loads a CLI test key internally; CI explicitly refuses CLI-profile loading and uses protected credentials. During this review the CLI config had test keys in the `clientbridge` and `default` profiles, but none of the four runner variables were exported. Account readiness and CI secret configuration remain unverified.

Once account IDs are configured, readiness can be checked without charging:

```sh
make test-stripe-qa STRIPE_QA_ARGS="--profile clientbridge --preflight"
```

The existing payment harness forwards genuine Stripe events to a capture server, verifies/filter them to owned objects, then deliberately posts them into the in-process application. That is useful event/ledger evidence. Add a separate committed-stack journey where the listener forwards to the running application, the worker runs, and actual provider and Connect browsers observe settlement through their normal paths.

Expand in this order:

1. Public invoice and booking-deposit card checkout through the real UI, including authentication-required, decline and retry. Retain a small browser/provider bridge; keep the larger state matrix at the API layer.
2. Online shop and desk sale payment, refund, fee and inventory coupling.
3. Saved methods and PAD setup plus asynchronous debit outcomes, subject to sandbox capability support.
4. Customer subscriptions and platform plans using supported Billing test clocks; advance, wait for processing, deliver events, and assert app access/entitlement state. Stripe recommends a separate CI sandbox so clocks and objects do not interfere with local development: [Billing simulations](https://docs.stripe.com/billing/testing/test-clocks).
5. Disputes, payout/reconciliation behavior and merchant capability changes. Track any sandbox operation that cannot reproduce a production transition as a simulator/contract/manual boundary.
6. Native Terminal simulated collection; retain physical-device checks for hardware and platform-specific behavior. Stripe provides simulated readers and also recommends physical-card hardware testing: [Terminal testing](https://docs.stripe.com/terminal/references/testing).

Use test PaymentMethods for server-side scenarios and genuine Stripe.js inputs for the small UI bridge. Exercise delayed/duplicate/unordered events, signatures and raw request-body handling according to the actual endpoint contract: [Stripe testing](https://docs.stripe.com/testing), [webhooks](https://docs.stripe.com/webhooks). Do not load-test Stripe's sandbox; run capacity/race stress against deterministic local adapters.

## CI rollout and acceptance

| Lane | Trigger | Scope and gate |
| --- | --- | --- |
| Existing rules/build/contracts | Every PR | Keep existing gates; preserve branch coverage without equating it to journey completeness |
| Critical committed-stack journeys | Every PR | AUTH01/AUTH04, BOOK01/BOOK03/BOOK06, BILL01/BILL04, SALE01/SALE03, FIN01, DOC01/DOC03, SYNC01/SYNC03; shard isolated stacks |
| Broader UI and accessibility | Every PR or scheduled according to measured duration | Existing tours plus remaining workflows; Chromium first, then WebKit/Firefox coverage for storage/auth/checkout risk |
| Stripe sandbox | Protected main/manual initially; then scheduled and release candidate | Strict no-skip runner; two reserved merchants; genuine webhook and provider evidence; no secrets for untrusted fork code |
| Native | Retain Android PR shards; add transactional shards and scheduled iOS | Native collection/setup, offline restart, permissions, push/deep links and device-specific regressions |
| Deployment smoke | Staging deploy and release candidate | Actual hosts/origins, auth cookie, public tokens, storage, worker, embedded surfaces and webhook routing |

Set runtime budgets after measuring the first isolated journeys rather than choosing an arbitrary test count. Keep a short dependable PR gate and larger scheduled matrices. A required lane that did not execute, skipped prerequisites, or used stale results is not a pass.

### Implementation sequence

1. **Coverage ledger:** split the scenario catalogue into atomic rows with ID, acceptance rule, platform, role/state/time dimensions, existing test path and assertion, missing boundary, tier, owner, status and last evidence commit. Review existing `test_flows_*` before adding duplicates. Inventory all router operations, public handlers, worker functions, UI actions and model status transitions; reconcile each to rows, including deliberately unsupported actions.
2. **Reliable harness:** committed per-shard stack, factories, independent contexts, provider sinks, clock/job controls, condition-based sync waits, diagnostics and scoped cleanup. Acceptance: the same critical test passes alone, in shuffled order and in parallel with unrelated scenarios.
3. **Revenue and isolation first:** full booking/deposit/checkout/refund journeys, stock/capacity races, cross-business negatives and independent ledger assertions. Reuse historical hardening regressions for overselling, stale contract version, lost receipts, form validation/snapshots and payment replay.
4. **Complete the remaining product sections:** CRM merges, documents/uploads, messaging/consent, entitlements, staff pay, reports, plans, reviews, admin and marketing. A visible control is mapped to either a transactional case, read-only check or an explicit unavailable capability.
5. **Provider/native/deployment depth:** broaden strict Stripe lane, native transactions, scheduled iOS and deployed smoke. Bring the known iOS client-editor regression into an explicit tracked lane; do not count its exclusion as coverage.
6. **Prove sensitivity and maintain it:** deliberately break representative invariants in disposable changes—duplicate payment posting, cross-tenant read, over-capacity booking, lost receipt intent—and verify the assigned tests fail for the expected reason. Establish clean-run and flake history, preserve failures, and require coverage-row updates for changed functionality.

### Definition of confidence

A section is covered when every agreed capability and transition has a named test at the appropriate layer, every critical journey has real UI-to-persistence evidence, and each external/device boundary has either current execution evidence or a clearly recorded limitation. Money cases require independent cent-level reconciliation; authorization cases require absence of unauthorized effects; async cases require eventual completion or the correct observable recovery state.

For initial acceptance, use a proposed minimum of ten consecutive clean scheduled runs for the new critical lane, plus a release-candidate run on the exact commit. This is a stability check, not a statistical guarantee. No unresolved critical financial/isolation failure, silent skip, stale evidence, or unexplained flaky critical test should be counted as release confidence.

The recommended first detailed design session is the visit-to-payment journey: online request/deposit → approval → intake → check-in → checkout → receipt → earnings/tax → refund/cancellation. It exercises the most important cross-domain invariants and establishes reusable fixtures for much of the rest of the product.
