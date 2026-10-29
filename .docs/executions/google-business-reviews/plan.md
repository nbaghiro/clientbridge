# Google reviews: finish and launch plan

Proposed 2026-10-29 from an audit of `main` at `8a41a363`. It continues the first execution (PRs #39, #43 and #45); its research plan, schema proposal and task queue are in git history at `9e49d5d2`. Nothing here is approved yet: the Phase 0 decisions and each schema change need explicit approval before work starts (CLAUDE.md). Backend paths are relative to `backend/src/clientbridge/` and frontend paths to `frontend/`.

## Goal

The plan is finished when Google reviews arrive on every surface below, in production and in the demo, for every business whose owner connects a Google Business Profile. No owner or admin sees "Google reviews are coming soon" outside a deliberate pause (3.15), and staff never see Reviews, by design. Every row has automated coverage (Phase 9) and passes the final walk (10.6).

| Surface                                              | Done when                                                                                                                                      | Today                                                                                                                    | Steps                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Inbox → Reviews, web and mobile                      | Connect and choose a location; rating, count and reviews; replies with their moderation state; the invitation setting, suggestions and history | Built; never run against Google or on a device                                                                           | 3.1-3.11, Phase 4, 5.2-5.5, 6.1-6.5 |
| Today, web and mobile                                | Rating, count and unanswered reviews, linking to Reviews; a connect prompt until connected                                                     | Nothing                                                                                                                  | 3.13, 4.7, 5.6, 6.6                 |
| Client record, web and mobile                        | "Ask for a Google review", disabled with the reason when the client can't be asked                                                             | Nothing                                                                                                                  | 4.7, 5.8, 6.6                       |
| Completed visit, booking and receipt, web and mobile | "Ask for a Google review" for that booking                                                                                                     | Only the suggestions list in Reviews                                                                                     | 4.7, 5.8, 6.6                       |
| Setup and the setup checklist, web and mobile        | Connection status and the invitation setting, visible before connecting; a "Connect Google reviews" task                                       | The setting is hidden until connected                                                                                    | 5.7, 6.6                            |
| Command palette (web) and shell links (both)         | Each opens Reviews                                                                                                                             | The `reviews` link target exists and nothing uses it (`apps/web/src/lib/links.ts:24`, `apps/mobile/src/links.ts:96-101`) | 5.1, 6.6                            |
| Notifications: push (mobile) and the feed (both)     | A new or changed review alerts owners and admins and opens Reviews                                                                             | Nothing                                                                                                                  | 3.12, 5.10, 6.7                     |
| The client's text message                            | One neutral text with the location's Google review link and opt-out wording                                                                    | No opt-out wording; sent at 08:00, inside quiet hours                                                                    | 3.7                                 |
| Connect post-visit page and receipt                  | "Review us on Google" for every client with a completed visit                                                                                  | Nothing                                                                                                                  | 7.1                                 |
| Demo businesses                                      | Every row above, with simulated reviews                                                                                                        | "Coming soon"                                                                                                            | 3.14                                |
| Local, staging and production                        | The connect card, never "coming soon" by accident                                                                                              | "Coming soon" everywhere                                                                                                 | 1.5, 1.11, 2.6, 3.15, 10.3          |

## Where it stands

Google reviews is built but has never run against Google. The first execution shipped OAuth with PKCE and session binding, one location per business, live review reads, durable reply operations reconciled by reading back, and neutral SMS invitations, on web and mobile. Nothing outside the code exists: no Business Profile API access, no OAuth client for it, no consent configuration, no applied cloud resources, and no live or device test. All 19 review e2e families are open, 8 of them P0.

| Area    | State                                                                                        | Where                                                                          |
| ------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Backend | Built: 13 routes under `/v1/reviews`, two server-only tables, two jobs                       | `{api,schemas,services,models}/reviews.py`, `integrations/google_business.py`  |
| Web     | Built: Inbox → Reviews tab, owners and admins only                                           | `apps/web/src/pages/Reviews.tsx`                                               |
| Mobile  | Built, same tab; never run on a device; one Android bug (6.1)                                | `apps/mobile/src/screens/Reviews.tsx`                                          |
| Shared  | One view-model and 85 `reviews.*` catalog messages                                           | `packages/app-core/src/domain/reviews.ts`                                      |
| Connect | Nothing, by decision                                                                         |                                                                                |
| Infra   | Gated by `googleBusinessEnabled`, which no stack sets; never applied; no Pub/Sub or alerts   | `infra/pulumi/cloud/google_business.py`, `infra/pulumi/kubernetes/settings.py` |
| Google  | Nothing: no API access, OAuth client or consent screen                                       | Phase 1                                                                        |
| Tests   | Backend suites pass against fakes; web e2e uses mocked routes; Maestro reaches "unavailable" | `backend/tests/test_reviews*.py`, `apps/web/e2e/shell.e2e.ts:1392`             |
| Demo    | Every demo business shows "unavailable": no connection rows and no product-side fake         | `backend/tests/google_business.py` (test-only fakes)                           |

## Where it lives in the apps

Both apps put Reviews in Inbox as a segment only owners and admins see: web at `/inbox?segment=reviews` (`apps/web/src/pages/Inbox.tsx:55-82`, `packages/app-core/src/domain/navigation.ts:140-146`), mobile in the Inbox tab (`apps/mobile/src/screens/Inbox.tsx:62-85`). The OAuth callback returns web users to that tab and native users to `clientbridge://reviews/google` (`services/reviews.py:716-719`).

Keep that home. Reviews are client communication, both apps already agree, and the top-level Reviews item in `.docs/design/app-explorer.html:293` predates the five-destination nav. Every other surface in the goal is missing today.

## Phase 0: decide

Each decision has a recommendation; the steps that depend on it name it.

| #    | Decision                            | Recommendation                                                                                                                                                                                                                      |
| ---- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1  | Home for Reviews                    | Keep Inbox → Reviews and add the other surfaces in the goal.                                                                                                                                                                        |
| 0.2  | Invitation send time                | 09:00 business time, when quiet hours end (`services/business.py:161-168`). The job runs at 08:00 today, inside the window broadcasts respect. A per-business hour is a later schema change.                                        |
| 0.3  | Opt-out wording in the invitation   | Add it, as broadcasts do: `{business}: Thanks for choosing us! Leave a review on Google: {link} Reply {keyword} to opt out.` A review request is likely a commercial electronic message under CASL; confirm with counsel (1.8).     |
| 0.4  | Invitations that can't be texted    | Refuse a manual request with a specific code and skip an automatic one, without recording a request or starting the 30-day cooldown. Today both record a request, and a manual one returns 201, even when no text is queued.        |
| 0.5  | Clients sharing a phone number      | One invitation per number per 30 days, matching the one-per-number rule `fix/messaging-shared-numbers-and-limits` adds for broadcasts and class messages.                                                                           |
| 0.6  | Google's grant on disconnect        | Revoke it when the disconnecting user has no other active connection, otherwise unlink locally. Allow disconnect while the feature flag is off. Google's API policies require giving up access when a client disassociates.         |
| 0.7  | Reply operations stuck in `unknown` | Let the owner dismiss one after its first failed read-back and offer Google's `reviewReplyUrl`. Today it blocks that review for up to 7 days.                                                                                       |
| 0.8  | Lapsed plan (PLN09, REV16)          | Cancel queued reply operations at lapse; disconnect stays allowed (`api/plans.py:43`).                                                                                                                                              |
| 0.9  | Scope                               | Every surface in the goal ships before the production allowlist is emptied (10.3), including new-review alerts by polling, the Today card, the Connect link and the demo simulator. Pub/Sub, review photos and multi-location wait. |
| 0.10 | Production pilot                    | A settings allowlist of business IDs for the first production weeks (3.10).                                                                                                                                                         |
| 0.11 | Google project                      | Keep `clientbridge-platform`. Its consent screen is shared with Google sign-in (operations.md, "Google OAuth"), whose basic scopes are unaffected by adding `business.manage`.                                                      |
| 0.12 | Cloud changes                       | Make every change in the Pulumi program (`infra/pulumi/`), as the rest of the platform is: APIs, keys, grants, secrets, DNS records, alerts and stack flags. Use the console only where Google has no API (see below).              |

Two schema changes follow, each to be presented with exact DDL, data impact and rollback: a partial unique index on `review_requests` (3.9) and, for alerts, a review watermark on `google_business_connections` (3.12). Nothing else here changes the schema.

### Infrastructure as code (0.12)

Nothing is enabled, created, granted or edited by hand in the Cloud console or with a `gcloud` command that writes. A change goes in a pull request to `infra/pulumi/`. An administrator applies the cloud stack (`Pulumi.cloud.yaml` says so), and `deploy.yml` applies the environment stacks. Provider credentials reach Secret Manager only through `providers_init.py`. `gcloud` is used only to sign in and to read.

Google has no API for four things, so they stay in the console, as the sign-in OAuth clients and the Firebase terms already do (operations.md, "Google OAuth" and "Mobile app"):

| Console-only                                                                                 | Why                                                                                                                                                       | What goes through code                                                     |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| The Basic API Access application (1.3)                                                       | A support form; approval arrives as quota, not as a quota preference that `cloud/quotas.py` could request                                                 | The APIs it covers (1.1), the quota check and the quota alert (2.5)        |
| Consent screen: branding, audience, data access, publishing status and test users (1.4, 1.6) | Google Auth Platform has no API or Pulumi resource for an External app; the IAP brand API was the only one, covered only Internal apps, and is deprecated | The Search Console verification record for `clientbridge.ca` (1.4)         |
| OAuth clients for the review callback (1.5)                                                  | Same; the IAP client API covered only IAP's own brand                                                                                                     | Their ID and secret, through `providers_init.py` into Secret Manager (2.4) |
| Google Business Profile manager access (1.2, 1.10)                                           | Owned by the businesses, not the Cloud project                                                                                                            | Nothing                                                                    |

Record each console setting in operations.md (8.1), so it can be checked and recreated. If Google ships an API or Pulumi resource for any of them, move it into the cloud stack.

## Phase 1: outside setup

Start on day one. Google publishes no timeline for its approvals, and they gate every live step; Phases 2 to 9 proceed alongside.

**1.1 Get into the Cloud project and enable the APIs from code.** Run `gcloud auth login` and `gcloud auth application-default login`. The last attempt failed with `invalid_rapt`. Then, in one pull request to `infra/pulumi/`:

- Enable the Business Profile APIs whatever the flag says. Move `cloud/google_business.APIS` into the always-on list at `cloud/services.py:50-53`, leaving `cloud/google_business.py` to create only the key, which stays behind `googleBusinessEnabled`. Update `test_google_business_resources_are_gated_and_use_a_separate_key` (`tests/test_program.py:1531`) to match. The application form (1.3) and its quota both need the APIs enabled, and turning on an API grants nothing until Google approves the project.
- Export the project number from the cloud stack. `__main__.py:49` already computes it.

An administrator previews and applies the cloud stack. Record `pulumi stack output projectNumber --stack cloud` in progress.md.

**1.2 Line up a qualifying Business Profile.** The applicant must manage a profile that has been verified and active for 60+ days and lists a website, and needs a Business Profile Organization account and the Cloud project ([prerequisites](https://developers.google.com/my-business/content/prereqs)). Use Clientbridge's own profile if it qualifies, otherwise a pilot business that adds you as a manager. Record the profile, its verification age and the applicant email.

**1.3 Apply for Basic API Access.** Use the [GBP API contact form](https://support.google.com/business/contact/api_default), choose "Application for Basic API Access", give the project number, and send it from an owner or manager email of that profile. Approval shows as quota on the APIs enabled in 1.1: 0 QPM means not approved, 300 QPM approved. Read it without changing anything, with `gcloud alpha services quota list --service=mybusinessbusinessinformation.googleapis.com --consumer=projects/<number>` or on the APIs page. If Google refuses, fix the gap and reapply. A later quota increase goes through the same form, not `cloud/quotas.py`.

**1.4 Configure the consent screen** in Google Auth Platform. This is console-only, since there is no API for it. Set:

- app name, logo, support email, homepage, privacy policy and terms URLs;
- the authorized domain `clientbridge.ca`;
- audience External;
- under data access, `https://www.googleapis.com/auth/business.manage`.

Verify the domain in Search Console with a DNS TXT record. Add the `google-site-verification` value to the cloud stack's DNS config (`cloud/dns.py`, next to `clientbridge:mailRecords`) and apply it; don't add it at the registrar or in Cloud DNS by hand. Record how the console classifies the scope, and every value set here, in operations.md.

**1.5 Create three OAuth clients**, type Web application, separate from the sign-in clients. This is console-only, like the sign-in clients. Each ID and secret goes into Secret Manager through `providers_init.py` (2.4), and the dev pair into `backend/.env`. Never paste one into the Secret Manager console.

- dev: `http://localhost:8701/v1/reviews/google/callback` (`.env.example:39`)
- staging: `https://api.staging.clientbridge.ca/v1/reviews/google/callback`
- production: `https://api.clientbridge.ca/v1/reviews/google/callback`

The route is `/v1/reviews/google/callback` (`api/reviews.py:87`).

**1.6 Run a consent smoke test now.** Set the publishing status to In production. Like test users, it is a console-only setting. Then consent with a Google account that is neither a test user nor a project member. The OAuth 2.0 Playground with the dev client's credentials is enough, since consent needs no API access. Since July 2026 developers have reported that `business.manage` shows as non-sensitive, offers nothing to verify, and still returns `Error 403: access_denied` to outside users ([thread](https://discuss.google.dev/t/oauth-business-manage-shown-as-non-sensitive-in-auth-platform-but-backend-blocks-all-external-users-with-error-403-access-denied-no-submit-for-verification-path-exists/384175)); no fix had been posted by 2026-10-21. If you hit it:

- open a Google Cloud support case citing the thread;
- run staging and the pilot in Testing, with pilot owners as test users (at most 100, and their refresh tokens expire after 7 days, which the app already turns into Reconnect);
- treat production as blocked until it is fixed.

If the console asks for verification instead, submit the scope justification and a video showing connect, choosing a location, reading, publishing a reply deliberately, and disconnecting.

**1.7 Update the privacy policy and site copy.** The policy names Google only for sign-in (`apps/site/locales/en-CA.json:1021`). Add what Business Profile access reads, that only an encrypted refresh token is kept, that review content is fetched live and not stored, and how to disconnect and revoke access, as Google's API Services User Data Policy requires. Replace the copy that still describes the manual link ("Save your Google review link…", `apps/site/locales/en-CA.json:389, 853, 1641, 1899, 2391, 2637`), then run `make gen-strings`.

**1.8 Clear the messaging rules.** Ask counsel to confirm the invitation text under CASL (sender identified, opt-out included) and, for any US clients, TCPA sending hours. Confirm the Twilio sender registration (A2P 10DLC campaign or toll-free verification) lists review invitations among its use cases and sample messages.

**1.9 Check brand and review policies.** Show Google's attribution as supplied ("Reviews from Google"), don't imitate the Business Profile interface, follow Google's brand permissions, and imply no partnership ([GBP API policies](https://developers.google.com/my-business/content/policies)). Invitations stay neutral and go to every eligible client. Google's [contribution policy](https://support.google.com/contributionpolicy/answer/7400114) forbids selectively soliciting positive reviews, discouraging negative ones, offering incentives and asking for particular content. Put the no-incentive rule in the business terms.

**1.10 Recruit pilot businesses.** Two or three consenting owners with verified profiles: one with enough reviews to page, one service-area business without a storefront address, and one with no reviews if you can find one. Get written consent for reads and for a named reply, edit and delete on a genuine review, plus a designated phone for invitations. Google has no sandbox; never create a review to test with.

**1.11 Give developers their own key, in code.** A local run needs `GOOGLE_BUSINESS_KMS_KEY` and ADC that can use it (runbook). Add a `dev` key ring and key to `cloud/google_business.py`, granted encrypter/decrypter to a `clientbridge:googleBusinessDevelopers` list in `Pulumi.cloud.yaml`, and export its ID. Then local runs never touch staging's key, and adding a developer is a one-line pull request rather than a console grant. Cover it in the infra suite.

Phase exit: the APIs enabled from the cloud stack; non-zero quota on the Business Profile APIs; three OAuth clients; consent works for an outside account, or the blocker is filed and the Testing fallback recorded; privacy policy and site copy published; counsel's answer recorded; pilots recruited.

## Phase 2: infrastructure

Every step here is a change to `infra/pulumi/` with tests in `infra/pulumi/tests/` (`make lint-infra test-infra`). It is applied by an administrator for the cloud stack and by `deploy.yml` for the environment stacks, never by hand in the console (0.12).

**2.1 Read the flag at call time.** `kubernetes/settings.py:105-109` reads `googleBusinessEnabled` at import, so the infra suite never sees the enabled path. Move the read into the functions. Then test the enabled path's secret containers, readers, mounts, environment variables, IAM members and `protect`, and add an environment-stack test with the flag on (`infra/pulumi/tests/test_program.py:1531`).

**2.2 Limit the secrets to the API and worker.** `GOOGLE_BUSINESS_CLIENT_ID` and `GOOGLE_BUSINESS_CLIENT_SECRET` also reach the migrate step and the demo seed CronJob through `MIGRATE_SECRETS` (`kubernetes/settings.py:123-139`, `kubernetes/seed.py:35-44`). Split them out.

**2.3 Pass the KMS key through the stack reference.** Read the cloud stack's `{env}GoogleBusinessKmsKey` export through the reference the environment stack already holds (`infra/pulumi/__main__.py:160`), and drop the hand-copied `googleBusinessKmsKey`. Fail with a clear message when the environment flag is on but the cloud stack's isn't; today that is a KeyError at `__main__.py:190-193`.

**2.4 Give the secrets a way in.** Add both to `providers_init.py` (read from stdin, never from arguments), `.env.staging.example` and the settings and secrets tables in operations.md. This is the only way the OAuth client from 1.5 reaches an environment.

**2.5 Alert on the integration** in `cloud/observability.py`, from the log events in 3.8:

- a reply operation `unknown` for over an hour;
- a failed `process_google_operations` run;
- a spike in `reconnect_required`;
- sustained Google 429 or 5xx responses;
- KMS failures;
- Business Profile API usage above 80% of the approved quota, from the project's `serviceruntime` quota metrics, as the compute quotas already alert (`cloud/quotas.py`).

**2.6 Enable staging**, through code, in this order:

1. A pull request sets `clientbridge:googleBusinessEnabled: true` in `Pulumi.cloud.yaml`. An administrator previews and applies the cloud stack, which creates the key and the empty secret containers.
2. Populate the two secrets with `providers_init.py`.
3. A pull request sets the flag in `Pulumi.staging.yaml`. The merge deploys it through `deploy.yml`.
4. Check that `GET /v1/reviews/google` returns `disconnected` for an owner, not `unavailable`.

Production follows in 10.3. The cloud stack lists only staging today (`Pulumi.cloud.yaml:13-14`).

Phase exit: the infra suite covers the enabled path; staging answers `disconnected`; and the only Google settings made outside code are the four console-only ones in 0.12.

## Phase 3: backend

Land `fix/messaging-shared-numbers-and-limits` first; it fast-forwards `main` and ties STOP to the phone number, which 3.7 builds on. Run `make gen-api` after any route or schema change and `make gen-messages` after editing the backend catalog.

**3.1 Read Google's 2026 review fields** (`integrations/google_business.py:65-89`). Unknown fields are ignored, so nothing breaks today, but these matter:

- `reviewReply.reviewReplyState` (PENDING, APPROVED or REJECTED; April 2026) and `policyViolation` (July 2026). Today a reply Google rejects in moderation looks published.
- `reviewReplyUrl` (July 2026), Google's own reply page for the review.
- `starRating: STAR_RATING_UNSPECIFIED`, which the strict `Literal` rejects, failing the whole page with a 502.
- `reviewMediaItems` (April 2026): leave it unparsed until photos have a product decision.

Read-back confirms a reply only when its text matches and its state isn't REJECTED. A rejection fails the operation with a new code, `google_reply_rejected`, carrying the violation. Source: [Google's change log](https://developers.google.com/my-business/content/change-log).

**3.2 Return API schemas, not integration models.** `GET /v1/reviews/google/reviews` returns the integration's `GoogleReviews` with `response_model_by_alias=False` (`api/reviews.py:139-141`). The generated client therefore has camelCase types the API never sends, and app-core keeps hand-written types (`packages/app-core/src/domain/reviews.ts:154-187`). Add response schemas to `schemas/reviews.py`: the page, each review, the reply with state and violation, the reply URL, `maps_uri`, and `last_success_at` on availability. Map to them in the service, run `make gen-api`, and use the generated types.

**3.3 Take Google calls out of locks and cache tokens.** Every read holds the business's advisory lock and a database transaction across KMS and Google calls with 20-second timeouts, and every page load costs a KMS decrypt, a token refresh and a location read.

- Cache the access token in Redis per connection and generation until 60 seconds before it expires; the first schema review allowed this.
- Cache the location's title, `newReviewUri` and `mapsUri` for 24 hours (Google allows up to 30 days). Status and invitations read the cache.
- Hold the lock only for state changes: completion, selection, disconnect and claiming operations. In `select`, check the role before taking the lock (`services/reviews.py:401`).
- Reuse one KMS client and a Redis connection pool instead of creating them per call.

**3.4 Make errors mean what they say.**

- A transient Google or KMS failure on a manual request returns 503 `google_unavailable`, not 409 `google_reconnect_required` (`services/reviews.py:96-102`).
- Save `reconnect_required` when status sees a 401 (`:297-298`), outside the command's transaction, which currently rolls it back.
- Use a new `google_reply_pending` for "a reply is already in progress" instead of `google_stale_reply` (`:536`), whose message says the reply changed on Google.
- In the worker, honour `Retry-After`, back off exponentially with jitter instead of a flat 5 minutes, and cap retries with the `attempts` column, which nothing reads today.

**3.5 Fix the callback and the connection lifecycle.**

- An unknown or expired `state` redirects back to the app with a result instead of showing 409 JSON in the browser (`complete_google_callback`, `services/reviews.py:690-695`).
- `error=access_denied` records `google_consent_denied`, so the apps can say the owner declined.
- Rate-limit the unauthenticated callback (`core/ratelimit.py`).
- Disconnect works with the flag off as a local wipe. Today `authorize()` returns 503, so stored tokens can't be erased.
- Revoke per 0.6 with `gateway.revoke` (`integrations/google_business.py:229`, never called), best effort and never blocking the unlink. Override `revoke` in `FakeGoogle`, which would make a real HTTP call today.
- Audit authorization completion, location selection, disconnect and the switch to reconnect-required, with identifiers only. Run selection through `run_command`, since it claims a location unique across businesses. The apps already send idempotency keys for selection and disconnect, which the backend ignores.
- Send web returns to the page in 5.2 instead of the full app.

**3.6 Unstick reply operations.**

- Add `POST /v1/reviews/google/operations/{id}/dismiss` (owners and admins) per 0.7. It erases the sealed draft.
- Use `FOR UPDATE SKIP LOCKED` on the due-operations query in `run_google_operations`, so two workers never claim the same rows.
- Cancel queued operations when the plan lapses, per 0.8.

**3.7 Fix invitations** (`services/reviews.py`, `services/notifications.py:1195-1310`, `locales/en_CA.po:421`).

- Add the opt-out wording per 0.3.
- Move the send hour per 0.2 (`businesses_at_hour(db, now, 8)` at `services/reviews.py:153`, asserted by `tests/test_jobs.py:135`), and update the app hint that promises "the morning after".
- Before recording a request, check that the client can be texted (has a mobile number, and the number isn't stopped), per 0.4. Manual requests get `no_mobile_number` or a new `client_opted_out`.
- Send one invitation per number per 30 days, per 0.5.
- Leave archived clients out of the automatic job (REV09). Today it only checks `deleted_at`, whatever `test_review_requests_skip_archived_clients` suggests.
- Send a manual invitation at once with `send_queued`, as forms do (`api/forms.py:31`), instead of waiting for the next minute's cron.
- Have the preview refuse when no Google link exists (`services/previews.py:162-169`) instead of rendering a placeholder.
- Remove the unused `notify` and `notifier` parameters.

**3.8 Log what the integration does.** Neither `services/reviews.py` nor `integrations/google_business.py` has a logger. Emit structured events (action, outcome, Google status, latency and connection id), never tokens, authorization codes, review text or drafts. These events feed 2.5.

**3.9 Enforce one request per booking in the database** (needs approval). Count duplicates read-only on staging and production, then add a partial unique index on `review_requests(business_id, booking_id) WHERE booking_id IS NOT NULL` in a new migration, and map the conflict to `review_already_requested`.

**3.10 Allow a production allowlist** per 0.10: `GOOGLE_BUSINESS_PILOT_BUSINESSES` (comma-separated business IDs; empty means all). Businesses outside it see `unavailable` with the reason `not_launched` (3.15).

**3.11 Clean up.**

- `google_invitation_url` takes its gateway, vault and flow store as arguments instead of calling `get_*` itself (`services/reviews.py:799`).
- A disconnect that has nothing to do returns the full availability, not a bare state.
- Demo IDs use the `rr_` prefix (`backend/scripts/demo_engine.py:1586-1601`) where architecture.md documents `rrq_`.
- Read `key_version` for key rotation, or plan to drop it.

**3.12 New-review alerts (needs approval).** A jittered job every 15 to 30 minutes reads the first page of each active connection and compares it with a stored watermark: the newest `updateTime` seen, which is an identifier, not content. New or updated reviews alert owners and admins through the staff push path (`services/notifications.py:1312`) and a new notification-feed kind. Budget the calls against the approved quota, which staging and production share. Keep Pub/Sub, with its account-level notification setting, a JWT-verified `/webhooks/google-business` and the event tables deferred in the first schema review, for when polling's cost or latency hurts. When it comes, its topic, push subscription and the grant to Google's publisher account go in the cloud stack.

**3.13 Today summary.** `GET /v1/reviews/google/summary` returns the rating, the total, unanswered reviews on the first page and the newest review's time, served from the 24-hour cache.

**3.14 Demo simulator.** Add a demo-only gateway with canned reviews and in-memory replies, enabled for demo businesses as simulated sends are, and labelled as demo data in the app. Without it, Reviews can't be demoed.

**3.15 Say why Reviews is unavailable.** Today `unavailable` means at least one of the five settings is missing (`integrations/google_business.py:403-413`), and both apps then say "Google reviews are coming soon". Add a reason to the availability response: `not_launched` when the integration isn't configured or the business is outside the allowlist (3.10), and `paused` when it is switched off for a business that has a connection, as in a rollback (10.5). Treat a partial configuration as an operator error: when `GOOGLE_BUSINESS_ENABLED` is true and another setting is empty, fail at startup so the rollout stops, instead of showing owners "coming soon".

Phase exit: `make check` passes, each changed route clears the four-part matrix, and the milestone audit is done.

## Phase 4: shared view-model

**4.1 Map every error code.** Use the generated types from 3.2. Map `google_not_found`, `google_invalid_resource`, `idempotency_key_reused` and the new codes from 3.1, 3.4, 3.5 and 3.7 in `googleCodeMessage` (`packages/app-core/src/domain/reviews.ts:196`) and `failureMessage`. `useRequestReview` shows a fixed message (`reviews.ts:131`), which hides the 30-day refusal `review_recently_requested`.

**4.2 Separate page errors from reply errors.** One `error` serves both, so a reply error appears at the top of the page with "Try again", which reloads and discards the open draft (`reviews.ts:250-251`).

**4.3 Count reply bytes the way the server does.** The server trims before counting (`services/reviews.py:504-506`); the apps count the untrimmed text, and only on submit. Expose the bytes left for a live counter, disable Publish past 4,096, and word the limit in plain language in the catalog.

**4.4 Show moderation and outcome states**: in moderation, published, or rejected with its reason; still sending (queued or running) as distinct from unknown; plus "Open on Google" from the reply URL and dismissal (3.6).

**4.5 Fix the connect flow.**

- `close()` runs in a `finally` (`reviews.ts:436-438`), so a close that throws replaces every connect error (6.1). Catch it.
- After a dismissal, keep polling `complete` for up to two minutes; the handoff survives that long after the callback (`services/reviews.py:714`).
- Give declined, expired and blocked their own messages.
- Make Cancel during the post-completion load clear the loading state.

**4.6 Suggest only clients who can be asked.** `REVIEW_SUGGESTIONS_SQL` (`reviews.ts:19`) looks back 3 days where the job looks back 7, and ignores the cooldown, missing numbers and stopped numbers (`consents.phone`, from the messaging branch). So "Ask" can be refused, or record a request that sends nothing. Mirror the server's eligibility, and page the history, since `REVIEW_REQUESTS_SQL` has no limit. Share one `useRequestReview` between the suggestion list and the request sheet, so "Requested" agrees in both (mobile `Reviews.tsx:389, 443`).

**4.7 Add hooks for the new entry points**: the Today summary (3.13), and an "Ask for a review" action that takes a client and an optional booking.

**4.8 Test the shared logic.** In `reviews.test.ts`, cover native connect, cancel, failed and expired authorization, a close that throws, deleting a reply, account and location paging, the byte count, moderation states and the new codes. Cover eligibility in `sql.test.ts`. The suite runs in three time zones.

## Phase 5: web

**5.1 Keep the home and add the ways in** (0.1): put the unused `reviews` target in the command palette (`apps/web/src/components/CommandPalette.tsx`), the Today card (5.6) and Setup (5.7).

**5.2 Finish the popup handoff.** Today:

- Google's redirect loads the whole staff app inside the popup until the next poll closes it.
- A popup closed by hand goes unnoticed for up to 10 minutes.
- A blank popup can be left open (`apps/web/src/pages/Reviews.tsx:39-51`).

Google's sign-in pages may sever the opener (COOP), which also makes `popup.closed` read true while the popup is still open, so neither `postMessage` nor `popup.closed` is reliable. Add a small return page outside the app shell. It announces the result on a same-origin `BroadcastChannel`, tries `window.close()`, and says "You can close this window" if that is refused. Keep polling `complete` as the source of truth, and open the popup only after the action is accepted.

**5.3 Polish the list**: stars in the summary, "View on Google" from `maps_uri`, "Edited" when the update and create times differ, dates through `datetime.ts` in the business zone, moderation badges, and the time of the last successful fetch. A "Needs a reply" filter over the loaded pages is fine; stored aggregates are not (GBP API policies).

**5.4 Finish the reply modal**: a live byte counter, the draft kept on error, "Open on Google" when the outcome is unknown or rejected, and dismissal.

**5.5 Fix the copy.** Keep "Google reviews are coming soon" for `not_launched` only. For `paused`, say Google reviews are temporarily unavailable and keep Disconnect (3.5, 3.15). Make the automation hint match 0.2. Change the catalog only, run `make gen-strings`, and update the shell walk that asserts today's wording (`apps/web/e2e/shell.e2e.ts:806-812`).

**5.6 Add a Today card**: rating, count and unanswered reviews, linking to the tab. Owners and admins only, with a one-time "Connect Google" prompt while disconnected.

**5.7 Make the settings reachable.** The "Ask after each visit" toggle renders only while connected (`Reviews.tsx:187`). Show it in Setup with the connection status, disabled with a reason until a location is linked. Add a "Connect Google reviews" task to the setup checklist (`packages/app-core/src/domain/business.ts:766-813`) when the integration is available.

**5.8 Ask from the records.** Add "Ask for a Google review" to the client record (without a booking) and to a completed visit, booking and receipt (with the booking), through the existing preview-then-send path. Disable it, with the reason, when the client was asked in the last 30 days or can't be texted.

**5.9 Make history useful**: page it and link each request to its visit. Showing delivery status needs a read over the deliveries keyed `review:{request_id}`; decide whether that is worth a backend endpoint.

**5.10 Show review alerts in the notification panel** (from 3.12), opening Inbox → Reviews.

## Phase 6: mobile

**6.1 Fix the Android connect bug.** `WebBrowser.dismissAuthSession()` throws `ERR_UNAVAILABLE` on Android: expo-web-browser 57.0.3 has no native auth session there, and its Android module has no `dismissBrowser` (`node_modules/expo-web-browser/build/WebBrowser.js:205-217`). Because the hook calls it in a `finally`, every connect error turns into the generic message. Call it on iOS only (`apps/mobile/src/screens/Reviews.tsx:56-58`), and land 4.5 with it.

**6.2 Don't treat an Android dismissal as a cancel.** The Custom Tab fallback reports `dismiss` whenever the app becomes active before the redirect arrives (`Reviews.tsx:49-54`), which abandons a handoff that may already be complete. Use the grace polling from 4.5.

**6.3 Handle the deep link outside the auth session.** Nothing listens for links (no `Linking` listener or `getInitialURL`), so a late or cold-start `clientbridge://reviews/google` lands on Today. Open Inbox → Reviews and resume. Every build uses the `clientbridge` scheme (`apps/mobile/app.config.ts:77`), so Android shows a chooser when two builds are installed. Per-build schemes change the native fingerprint and need a store build (engineering.md, "Mobile changes"), and the backend's native return URL would move into settings (`services/reviews.py:717`).

**6.4 Add pull to refresh.** Add `onRefresh` and `refreshing` to the `ListPage` contract in `packages/app-core/src/ui.ts` and to both twins, and refresh when the app returns to the foreground.

**6.5 Match web.** Stop the disconnect modal closing mid-request, and disable the delete confirmation's Cancel while busy (web guards both). Show the invitations heading, then bring in 4.2 to 4.4 and the states from 5.5.

**6.6 Add the entry points**: the Today card (`apps/mobile/src/screens/TodayParts.tsx`); "Ask for a review" on client and booking records and the sale ticket; the connection status and invitation setting in Setup; and the shell `reviews` link.

**6.7 Push for new reviews** (from 3.12): route a tap to Inbox → Reviews (`apps/mobile/src/push.ts:62-70`) and add the kind to the notification feed (`packages/app-core/src/domain/notifications.ts:48-56`).

**6.8 Ship it the right way.** JavaScript and copy changes go out as an EAS update. A scheme, intent filter or associated-domain change needs a store build and App Review. Compare fingerprints before merging.

## Phase 7: Connect

Public pages show no Google content, by decision: cached content may be kept for at most 30 days and needs its attribution, and testimonial widgets were left out of scope.

**7.1 Add a "Review us on Google" link** on the post-visit manage page and the receipt, shown to every client with a completed visit, using the cached `newReviewUri` from the public payload. Test it in each page's Connect e2e file (`apps/connect/e2e/<publicPage>.e2e.ts`).

## Phase 8: docs

**8.1 Bring the docs up to date.**

- operations.md: add a Google Business section covering:
  - the stack keys, the KMS exports (environments and dev) and the developer list;
  - the three plain settings, the two secrets and who reads them;
  - each console-only setting from 0.12 and its value, as the Firebase and sign-in sections do;
  - the alerts and a link to the runbook.

  Also remove the out-of-date "Internal review removal deployment" section (`:423`).

- architecture.md: add `process_google_operations` (every 15 seconds) to the worker schedule, and describe moderation states, caching and revocation.
- launch-readiness.md: update CLI-47 and the stale QA steps at `:1175`, `:1237`, `:1241` and `:1245`.
- Also: demo.md `:40` and `:252`; engineering.md `:682` and the walkthrough notes; `.docs/reviews/product/web-and-connect.md:58, 146`; `.docs/reviews/product/mobile.md:156-158, 206`; the comment at `packages/app-core/src/domain/clients.ts:991`.

**8.2 Close out.** When the feature is live, move what lasts into architecture.md and operations.md and delete this folder and its README entry.

## Phase 9: testing

Each step clears the four-part matrix (happy path, each 4xx, security and tenancy, idempotency and edges). Each phase ends with `make check` and the milestone audit.

**9.1 Fill the backend gaps.** Nothing tests these today:

- the accounts, locations and replies/delete routes;
- the native redirect, a callback carrying `error`, flow expiry and `pending`;
- `google_location_in_use` and 503 `google_not_configured`;
- the switch to `reconnect_required` on `invalid_grant`, the 7-day expiry, and cancellation when the actor loses the role;
- a rate-limited write being requeued, staff getting 403 on every Google route, and `can_request=false`;
- the real `RedisGoogleFlowStore` (GETDEL and TTL) against the test tier's Redis.

Add the new behaviour from Phase 3 to `test_reviews.py`, `test_reviews_connections.py`, `test_reviews_google.py` and `test_jobs.py`.

**9.2 Keep golden responses.** Scrub real responses from the pilot into `backend/tests/fixtures/google_business/` (anonymous reviewer, rating only, translated text, media, replies pending and rejected, unspecified rating, paging). Run them through `HttpGoogleBusinessGateway` with `httpx.MockTransport`, as the Stripe fixtures are run.

**9.3 Add a credentialed smoke test (REV19)** in `backend/tests/sandbox/`, which `make test-sandbox` runs, skipped without a pilot refresh token and KMS access. It covers a token refresh, accounts, locations, the first reviews page and a KMS round trip with its context, and only reads.

**9.4 Give e2e a Google stand-in.** The P0 families need OAuth, reads and replies end to end. Run a fake Google on the test tier and point the gateway's base URLs at it through settings honoured only when `ENV=dev`, so production keeps fixed upstreams.

**9.5 Write the web cases** in a new `apps/web/e2e/reviews.e2e.ts`: REV01, REV02, REV04 to REV07 and REV12 to REV18, plus one case per web surface in the goal (Today card, client record, visit and receipt actions, Setup, command palette, notification panel). Register each case in `backend/e2e/cases.json` with its families, keep the existing shell walk, and extend the demo walk (`shell.e2e.ts:1531`) to expect simulated reviews. The lane already runs the en-XA pass, axe checks and phone widths.

**9.6 Write the journey.** In `apps/web/e2e/journeys/communication.journey.ts`: ask for a review from a completed visit, find the text in Mailpit with the Google link and the opt-out wording, reply STOP, and see the next request refused (REV07, REV11). The automatic job's hour, window and cooldown stay in `test_jobs.py` under the frozen clock (REV08, REV10). A worker-in-the-loop case can enqueue the cron entry as `backend/e2e/stack.py:388` does.

**9.7 Write the Maestro flows** on the Android lane: `apps/mobile/e2e/reviews.yaml` and `reviews.connect.yaml`. Cover connecting through the stand-in with the deep-link return, dismissing and resuming, choosing a location, replying and disconnecting (REV03), plus each mobile surface in the goal (Today card, record actions, Setup, and a review push opening Reviews). Make the existing flows (`messaging.yaml:26-28`) assert the state they reach.

**9.8 Run the shared and web unit tests** from 4.8 under `make test-frontend`.

**9.9 Do a device pass** on a physical iPhone and an Android phone, and record the results in progress.md:

- connect, cancel partway, and background the app during consent;
- connect with two builds installed, and decline consent;
- choose among many accounts and locations;
- reply with emoji near the byte limit, see moderation pending, then edit and delete;
- disconnect, and reconnect after revoking access at myaccount.google.com/permissions;
- go offline.

**9.10 Run the live pilot** on staging with the profiles from 1.10. Follow the runbook's checklist, and add a 7-day token expiry in Testing, a revocation, a reconnect, the quota observed, and an invitation to the designated phone. Record the evidence in progress.md.

## Phase 10: rollout

**10.1 Staging.** Do 2.6, then connect your own profile, then the pilot businesses.

**10.2 Production entry criteria:**

- API access approved.
- Consent works for an outside account that isn't a test user (1.6).
- 9.9 and 9.10 recorded.
- The alerts from 2.5 have an owner.
- The P0 families are covered, and every row of the goal has an automated case.
- 1.7 and 1.8 published.

**10.3 Production**, through code, as in 2.6:

1. Add `prod` to `clientbridge:environments` in `Pulumi.cloud.yaml`, if the deploy work hasn't. The administrator applies the cloud stack.
2. Populate the secrets with `providers_init.py`.
3. Set the flag and the allowlist from 3.10 in `Pulumi.prod.yaml`. The approved production deploy applies them.
4. Watch for two weeks, then empty the allowlist with another stack-config pull request.

**10.4 Mobile.** Ship an EAS update or a store build (6.8).

**10.5 Rollback.** Turn off the environment stack's `googleBusinessEnabled` and deploy. Don't change the Deployment with `kubectl`, and leave the cloud stack's flag on, so the key and the secrets stay. `GOOGLE_BUSINESS_ENABLED=false` stops Google calls; connected businesses see the `paused` state (3.15) and can still disconnect (3.5). Invitations stop too, because they need the linked profile's URL. Don't drop the tables or destroy the key; keep the encrypted rows until someone approves what happens to them (runbook).

**10.6 Walk every surface.** With a pilot business in production and a demo business, go through each row of the goal on web, an iPhone and an Android phone, and record the result in progress.md. The plan is done when every row passes, the allowlist is empty, and no environment shows "coming soon".

## Order of work

1. Day one: settle Phase 0, apply 1.1 (the APIs from code), and send 1.2 to 1.6, which starts Google's clock.
2. While Google reviews the application: 2.1 to 2.5, all of Phase 3, Phases 4 to 7, and 9.1, 9.2 and 9.4 to 9.8, updating docs (8.1) as you go.
3. When Google approves: 2.6, 9.3, 9.9 and 9.10.
4. Phase 10, ending with the surface walk (10.6).

## Risks

| Risk                                        | Effect                                  | Mitigation                                                 |
| ------------------------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| No published timeline for API access        | Live steps wait                         | Apply on day one; build against fakes and the stand-in     |
| `business.manage` blocked for outside users | Production owners can't connect         | Smoke test (1.6), a Testing-mode pilot, a support case     |
| 7-day refresh tokens in Testing             | Pilot owners reconnect weekly           | Expected; the app already turns expiry into Reconnect      |
| One quota for staging and production        | Staging traffic eats production's quota | Caches (3.3), a polling budget (3.12), the 429 alert (2.5) |
| Replies held or rejected by moderation      | A reply looks live when it isn't        | 3.1, 4.4                                                   |
| Review gating or incentives by businesses   | Google removes reviews or penalizes     | Neutral invitations to every eligible client; terms (1.9)  |
| Messaging law                               | Complaints and penalties                | 0.3, 1.8                                                   |
| Native changes need App Review              | Slower mobile fixes                     | Keep 6.1, 6.2 and 6.4 JavaScript-only                      |
| Console-only Google settings drift          | A consent or client change goes unseen  | Recorded in operations.md (8.1), rechecked in 10.6         |
