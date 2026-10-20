# Google Business Profile implementation progress

## Planning baseline

- Date: 2026-10-18.
- Base: `origin/main` at `dd35920e`.
- Branch: `feat/google-business-reviews`.
- Worktree: `/Users/naib/Documents/code/clientbridge-google-reviews`.
- Scope of this PR: researched Google integration plan plus removal of internal review collection, with an approved cleanup migration and Google-first web/mobile UI. No live database, cloud deployment or external profile changes.
- Official Google API, OAuth, policy and Pub/Sub documentation and Pulumi OAuth resource documentation are linked beside the relevant decisions in [plan](plan.md).
- Repository audit covered reviews, public feedback, delivery boundaries, shared web/mobile hooks, Pulumi service enablement, secrets, workload identities and deployment configuration.

## External prerequisites

| Item                                | Current evidence                                                                     | Next action                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Live project inspection             | gcloud read-only commands failed with expired credentials requiring reauthentication | Operator runs `gcloud auth login`, checks enabled APIs and project number   |
| GBP Basic API Access                | Not verified; no approval evidence in this planning change                           | Confirm eligible profile and apply/check approval for the intended project  |
| OAuth clients and publishing        | Existing credentials belong to sign-in; dedicated GBP setup not verified             | Create clients, record callback/consent/verification status without secrets |
| Google account notification setting | No live account queried                                                              | Inspect with the customer's consent before configuring a topic              |
| Google integration schema approval  | Still proposed; separate from the approved internal collection removal               | Approve concrete Google operational schema before implementation            |
| Live pilot profile                  | Not selected                                                                         | Identify consenting owner and genuine review for reply smoke tests          |

## Validation

Documentation formatting, local relative links, task dependency integrity and staged diff checks are required before commit. Record commit-hook results below. Runtime integration tests from the earlier audit do not validate a Google integration and are not presented as such.

## Implementation handoff

Start G1 and G2 from tasks.json. Build contract types/recording fakes while Google prerequisites are pending. Do not deploy gated resources, add model definitions, create migrations or claim live integration before their respective prerequisites. Keep completed evidence and outstanding work here after each phase; update task states only when acceptance criteria pass.

## Internal collection removal

The user expanded scope to remove internal feedback entirely and explicitly approved the concrete cleanup on 2026-10-18. Changes remove the public form and embed, local review actions, public testimonials/ratings, review notifications and client timeline feedback. Invitations link directly to the saved Google URL, carry booking identity and remain visible as request history. Demo fixtures, marketing copy, product docs, design mockups and tests are updated.

Migration cb0022 copies rows with actual request timestamps into `review_requests`, preserving IDs and tenant/client/booking references; it drops `reviews` and `businesses.review_hold_at`, and deletes old review command replay payloads. Unrequested feedback is not fabricated into invitation history. The downgrade refuses to pretend deleted feedback can be recovered; restoring it requires a backup. API/sync contracts and message catalogs are regenerated. No live database or cloud changes have been made.

Focused validation: 55 backend tests and 59 frontend tests passed. The commit hook enforces formatting, lint/type checks, generated-contract consistency, backend coverage, frontend timezone tests and infrastructure tests on the exact staged tree; final results are recorded in PR #39. GBP OAuth, review reads/replies, Pulumi provisioning and reliable queued invitation delivery remain planned work, not shipped capabilities.

## Google-first UI and provider boundary

Web and mobile now share an online Google review view-model. The manual Google URL editor is removed. The UI supports mandatory Google authorization, account/location selection with pagination, review pagination and ratings, public reply create/edit/delete confirmation, disconnect and reconnect states, and invitation controls gated on a loaded active profile with a Google-provided review URL. Google content stays in memory, separate from PowerSync invitation history. Reply mutations retain their idempotency key on retry, preserve uncertain drafts and only show provider-confirmed changes. Business switches invalidate pending reads.

The HTTP provider adapter implements Google OAuth with PKCE, account/location discovery, review reads and reply writes/deletes, with fixed Google hosts, resource validation, bounded responses, timeouts and redacted errors. Boundary tests exercise Google HTTP responses. This adapter is not yet registered with application dependencies.

**Runtime limitation:** only the manager-gated `GET /v1/reviews/google` availability endpoint is implemented. It truthfully returns `unavailable`; all other UI actions are unreachable in the current runtime. The browser/native UI contracts below are implemented against recording HTTP boundaries in tests, not a running persistent OAuth service. No authorization, review fetch or reply publication can succeed against the application yet. The existing backend invitation worker still uses the saved manual URL until the approved Google schema/backend replacement lands; this UI change does not claim to change that worker.

Pending approval is the exact three-part schema proposal in [schema.md](schema.md): connection table, operation table and manual URL column removal. No new model or migration for those changes has been created. Google API access, dedicated OAuth credentials, KMS/Pulumi deployment and a consenting pilot remain external prerequisites.

### UI contract for the backend slice

All paths use `/v1/reviews/google`; they supersede the draft plan's alternate route spelling. Only `/` below is implemented server-side in this slice.

| Method/path                        | Contract                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/`                            | state (`unavailable`, `disconnected`, `selecting`, `active`, `reconnect_required`), connection_id, generation, location `{name,title}` or null, can_request |
| POST `/authorization`              | `{platform: web/native}` → `{authorization_url,flow_token}`; authenticated actor/business, PKCE and independent opaque completion secret                    |
| POST `/authorization/complete`     | `{flow_token}` → `{state: pending/complete/failed}`; authenticated same actor/business; no tokens in URLs or replica                                        |
| GET `/accounts`                    | optional page_token → `{choices:[{name,title}],next_page_token}`                                                                                            |
| GET `/locations`                   | account_name and optional page_token → choices                                                                                                              |
| POST `/location`                   | `{account_name,location_name}` + Idempotency-Key; validate ownership/verification before activation                                                         |
| GET `/reviews`                     | optional page_token → `{reviews,average_rating,total_count,next_page_token}` using snake_case Google DTO fields; no local client matching                   |
| POST `/replies`, `/replies/delete` | `{review_id,comment,expected_reply_revision}` + Idempotency-Key → `{id,state}` durable operation; deletion uses null comment                                |
| GET `/operations/{id}`             | owner-scoped operation state; queued/running/confirmed/failed/unknown/canceled                                                                              |
| POST `/disconnect`                 | `{}` + Idempotency-Key; invalidate generation and credentials; leave Google content untouched                                                               |

OAuth callback registration must use a fixed backend HTTPS callback and a fixed completion destination; mobile completion destination is `clientbridge://reviews/google`. Web opens a dedicated authorization window. Do not accept caller-supplied redirect URLs. Google review payloads use `review_id`, reviewer `{display_name,anonymous}`, `star_rating`, `comment`, create/update timestamps and nullable reply `{comment,update_time}`.

Focused validation for this slice: 33 backend tests and 12 shared view-model tests passed. Backend lint/type/structure checks and all 11 frontend package type checks passed. Full staged-tree pre-commit results are recorded in PR #39; browser/device flows require CI and live Google verification remains outstanding.

## Main branch conflict resolution

Merged `origin/main` through `cfc44acf`, preserving the Google-first screens and the newer searchable client picker with person media. Regenerated API, locale and sync outputs from the merged sources. Renumbered the approved, undeployed internal-review cleanup to `cb0022` after `cb0021` because main now owns `cb0019`–`cb0021`; the cleanup data operations and rollback behavior are unchanged. No live database was modified.

## CI walkthrough repair

Run 39177895198 tested GitHub's merge with main `b1eeb3e7`, whose demo seed changed after the previous merge. Updated staff-pay navigation to a seeded payee, mobile payout setup to the ready state, and Cedar Coast booking navigation to its populated catalog. The booking/manage walkthrough now uses a no-deposit service, so it creates and cancels a real booking without requiring Stripe credentials that CI does not provide. The deposit/slot-conflict boundary test remains in place. Merged the same main commit locally to validate the actual CI tree.

## Review request guards (2026-10-19)

Shipped without schema changes, ahead of the settings in [schema](schema.md):

- A client gets at most one review request in 30 days, from the morning job or an owner's request (`review_recently_requested`). The job asks for the latest completed visit only and skips archived clients.
- Invitation emails carry the broadcast unsubscribe link, and a client whose latest email consent is withdrawn gets the invitation only by text.
- `PATCH /v1/business` no longer accepts `google_review_url`, so an account cannot send clients an arbitrary link. The column stays until the connection slice replaces it.

- Approved and added on 2026-10-19: `businesses.review_requests_enabled` boolean, not null, default true (cb0024). The morning job skips a business that turns it off; manual requests still send. Owners and admins change it from the Reviews screen. The send hour, delay and configurable cooldown in [schema](schema.md) remain proposals.
