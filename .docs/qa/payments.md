# Payments QA checklist

This is the maintained Stripe QA inventory for web, public Connect, admin and native mobile.
Implementation reference: [payments](../payments.md). Execution order, CI isolation and recordings:
[automation plan](payments-automation.md). Status as of 2026-10-18: **planned unless explicitly recorded
below**. A row describes required coverage, not a claim that every variant is currently supported or tested.

## How to execute and report

Run against fresh application data and Stripe test objects; historic seeded payments have fixture
provider IDs and cannot serve as live refund or reconciliation fixtures. Use two businesses, an owner,
an administrator, a staff member, a platform administrator and clients belonging to each business.
Include the same client identity in both businesses to check Customer isolation.

For every ID, record: commit, environment, preconditions, actions, expected and actual UI/API behavior,
Stripe IDs, local product state, ledger assertions, result, evidence links and cleanup. Expand each listed
variant into a separate test/result. Use `planned`, `passed`, `failed`, `blocked`, or `not applicable`
with a reason; retries and assisted steps must remain visible. Missing product behavior becomes a gap,
not a passing test. Record expected amounts in integer cents and their currency.

Layers: **R** = deterministic backend/frontend regression; **S** = real Stripe sandbox API/webhooks;
**B** = Playwright through the running application; **N** = native mobile using existing Maestro;
**M** = assisted/manual or provider/device-dependent. Multiple layers are complementary.

## Setup, access and account settings

| ID     | Scenarios and required assertions                                                                                                                                                                                                                                    | Layers     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| SET-01 | Fresh setup, rerun and concurrent setup: exactly one connected account per business; correct capabilities and metadata; stable customer-only account upgraded when merchant setup starts.                                                                            | R, S, B    |
| SET-02 | Two businesses and shared client identity: Customers and saved methods belong to the correct connected account; repeated/concurrent creation does not duplicate Customers.                                                                                           | R, S       |
| SET-03 | Incomplete, pending, restricted, payouts-paused and ready onboarding: requirements, requirement errors and enabled charges/payouts match Stripe; return from onboarding and Refresh update app state. Complete terms and any required verification with an operator. | R, S, B, M |
| SET-04 | Owner/admin access; staff, unauthenticated and expired-session denial; business switch; forged cross-business account/payment/client IDs; no cross-tenant reads, mutations or Account Sessions.                                                                      | R, B       |
| SET-05 | Payment settings: available versus pending funds, empty/restricted notices, embedded account management, close/reopen, loading and provider failure. Confirm production authentication remains enabled.                                                              | R, S, B, N |

## Payouts

| ID     | Scenarios and required assertions                                                                                                                                                                                                                                                  | Layers     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| OUT-01 | Change supported daily, weekly and monthly schedules through the embedded UI; reload and retrieve Stripe settings. Verify anchors, other business unchanged and original schedule restored.                                                                                        | R, S, B    |
| OUT-02 | Manual schedule and invalid schedule/anchor input: supported choice persists; rejected changes leave settings unchanged. Do not offer unsupported country/account options.                                                                                                         | R, S, B    |
| OUT-03 | Fund a test account, wait for available balance, request a standard payout through the app; amount/currency/destination and available-balance change agree with Stripe. Insufficient funds, missing bank and disabled payouts fail clearly.                                        | R, S, B    |
| OUT-04 | Pending, in-transit, paid, failed and canceled payouts: status and totals follow current Stripe state; refresh/reopen works; no duplicate sale revenue. Exercise states with supported sandbox fixtures, otherwise label provider coverage blocked and retain regression coverage. | R, S, B    |
| OUT-05 | Payout list pagination/history, concurrent refresh and provider outage: no false zero balance or success; correct business after switching; automatic payout does not race fixture funding.                                                                                        | R, S, B, N |

## Client collections and sales

| ID     | Scenarios and required assertions                                                                                                                                                                                                        | Layers     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| COL-01 | Public invoice full payment and saved-card collection: correct business, Customer, amount, currency, fees, receipt and paid state; merchant funds stay on its connected account.                                                         | R, S, B    |
| COL-02 | Decline, additional authentication, cancellation, expired/invalid link and already-paid invoice: truthful result, no premature fulfillment; retry succeeds once.                                                                         | R, S, B    |
| COL-03 | Double submit, concurrent tabs and timeout after provider acceptance: one logical collection/fulfillment; replay returns the original result and balanced journals only once.                                                            | R, S, B    |
| COL-04 | Booking deposit success/failure/abandonment: confirmation follows payment policy; cancellation/refund and invoice application preserve amounts without collecting the deposit twice.                                                     | R, S, B, N |
| COL-05 | Shop/desk sale: items, taxes, stock and receipt agree; failed/retried/duplicate payment cannot decrement inventory or fulfill twice.                                                                                                     | R, S, B, N |
| COL-06 | Saved card setup, default change, removal, expired card and decline: methods stay with the correct scoped Customer; unrelated client/business cannot access them.                                                                        | R, S, B, N |
| COL-07 | PAD setup link, authorization/mandate, expired or failed setup, pending debit, success and failure: asynchronous states do not prematurely mark payment settled; mandate references and retries remain correct.                          | R, S, B    |
| COL-08 | Merchant membership purchase, renewal, failed renewal, retry and cancellation at the supported boundary: entitlements and invoice settlement agree with current Stripe state; use compatible Test Clocks for lifecycle advancement.      | R, S, B    |
| COL-09 | Gift card/package purchase, issue, redeem, exhausted balance, duplicate redemption and permitted refunds: value/use counts and ledger agree; unsupported refund policies are explicit.                                                   | R, S, B    |
| COL-10 | Terminal known client and walk-in: correct Customer or no Customer, reader connect/disconnect, approve/decline/cancel/retry; one payment per attempt outcome. Simulator covers supported cases; physical reader/device remains separate. | R, S, N, M |

## Refunds, disputes and recovery

| ID     | Scenarios and required assertions                                                                                                                                                                                                                                                                                                                                                                                                                        | Layers  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| REC-01 | Full, partial and multiple refunds; over-refund and concurrent requests rejected; duplicate replay safe; failed refund restores the correct accounting state.                                                                                                                                                                                                                                                                                            | R, S, B |
| REC-02 | Refund initiated in Stripe Dashboard/API arrives through verified webhook and appears in application history with correct product/ledger effect.                                                                                                                                                                                                                                                                                                         | R, S, B |
| REC-03 | Dispute opened, inquiry/escalation, won/lost and delayed fee: current status, principal and fees recorded once; stale events cannot reverse newer state. Refunds refused while a dispute is open or lost; a loss after a partial refund, on a partly used gift card or package, or on a deposit books the excess to `loss` and never takes sales or tax below zero. Verify available details/links; log missing evidence-management UI as a product gap. | R, S, B |
| REC-04 | Temporarily withhold a genuine webhook; verified redelivery repairs state. Replay duplicates and old events after newer events; one journal and one notification intent per logical effect.                                                                                                                                                                                                                                                              | R, S    |
| REC-05 | Run the replay job (`replay_missed_events`) and reconciliation for undelivered or unresolved payments, refunds and membership invoice payments; use original payment timestamps, correct account scope and no duplicate fulfillment.                                                                                                                                                                                                                     | R, S    |
| REC-06 | Remove delivery from a controlled test path, then run source reconciliation: missing supported journals repaired; unsupported adjustments/mismatches reported without invented balancing entries. Second run is a no-op.                                                                                                                                                                                                                                 | R, S    |
| REC-07 | Provider timeout/rate limit/outage, partial batch failure and restart: successful repairs persist, failed work remains retryable and observable; pagination does not silently truncate history.                                                                                                                                                                                                                                                          | R, S    |
| REC-08 | Fees and balances: charge, application fee, Stripe fee, refund, dispute and payout reconcile by source/currency. Platform billing never enters merchant revenue; balanced entries alone are insufficient without source equality.                                                                                                                                                                                                                        | R, S    |

## Platform billing and operational surfaces

| ID     | Scenarios and required assertions                                                                                                                                                                                               | Layers  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| OPS-01 | Platform trial, Checkout, plan change, proration, seats, portal and cancellation: platform customer-account/subscription references and business entitlements agree; no mixing with merchant client memberships.                | R, S, B |
| OPS-02 | Platform past-due/lapsed/recovered subscription and stale events: access follows the documented entitlement policy and current subscription state; Test Clock use only where supported by the account model.                    | R, S, B |
| OPS-03 | Admin business/client/payment lookup, Stripe links, status/history and activity: correct account-specific destination and chronology, denied non-admin access; recovery controls tested only if implemented.                    | R, S, B |
| OPS-04 | Receipts/notifications: recipient, totals, currency, business details, public links and rendering; retries do not duplicate delivery intent. Capture locally by default; real sends only to an explicitly agreed QA inbox.      | R, B, M |
| OPS-05 | Web/Connect responsiveness, keyboard focus, error copy and return navigation; slow network, offline, reload, back and double-click: clear pending/error state and no unsafe financial replay.                                   | R, B    |
| OPS-06 | Native Getting Paid/Payouts and relevant collection flows: login, business switching, embedded browser return, refresh and background/resume. Responsive browser coverage does not count as native coverage.                    | R, N, M |
| OPS-07 | Wallet and physical Terminal/device behavior, supported OS versions, external authentication and bank-delivery expectations: record device/provider prerequisites and manual result. Sandbox cannot prove actual bank delivery. | N, M    |

## Evidence already available and remaining blockers

The [dated sandbox verification record](../payments.md#sandbox-verification-record--2026-10-18)
records successful CLI schedule round trips, invalid-value rejection, account isolation and real Account
Session configuration. These are **partial OUT-01/OUT-02 and SET-05 evidence**, not embedded UI sign-off.
The isolated component harness is not a recording of the authenticated application.

Birchbark still needs onboarding details, a bank and terms acceptance; Cedar Coast has a test bank and
still needs terms acceptance. Recheck readiness before any run because provider state changes. Neither
successful funded payouts nor embedded schedule editing have been signed off. Dedicated CI merchants,
webhook isolation, browser recordings and the real-sandbox workflow remain to be implemented.

Existing regression/contract results are summarized in the working change's validation record; they do
not establish that this checklist has run end to end. Attach fresh results to a commit before release.

## Sign-off

- Every variant has a result and evidence; critical collections, authorization, isolation, payouts,
  refunds and ledger recovery pass at all applicable automated layers.
- Blocked/manual cases have an explicit owner and disposition; no skipped provider test counts as pass.
- Real-app recordings cover setup/settings, schedule editing/payout, invoice, deposit, sale, membership,
  refund and admin investigation, plus native recordings where supported.
- Provider state and local accounting reconcile for owned fixtures; cleanup and original schedules are
  verified. Sandbox limitations and outstanding product gaps are carried into [launch readiness](../launch-readiness.md).

Recovery scenarios exercise Stripe's own redelivery, the hourly replay job (`replay_missed_events`) and
source reconciliation. The older pending-payment recovery job was removed.
