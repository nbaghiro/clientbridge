# Google Business Profile implementation progress

## Current execution — 2026-10-20

User approved continuous implementation in a new branch from main, with no commits, pushes or PRs. Worktree: `/Users/naib/Documents/code/clientbridge-google-complete`; branch: `feat/google-business-reviews-complete`; base: `5e0bad49`.

The approved schema is the final two-table slice in schema.md: encrypted connections and durable reply operations, removal of businesses.google_review_url, and preservation of invitation history. Existing review_requests_enabled and scheduling/cooldown behavior remain. No new internal review collection or Google-content replica is introduced. Pub/Sub and extra scheduling columns are deferred.

## Application implementation

- Availability distinguishes disabled configuration from an unlinked business.
- Application OAuth start/callback/completion uses session/tenant binding, single-use state, PKCE and short-lived Redis handoff data.
- KMS encrypts refresh tokens and owner-authored reply intent with tenant/record context.
- Account/location selection, online reviews, generation checks, disconnect and reply-operation worker are wired.
- Invitations resolve Google's location metadata and use the existing durable delivery queue.
- Both apps have structured setup/unavailable states and profile help. Generated contracts and catalogs updated.
- Pulumi configuration gates GBP services, dedicated KMS resources and OAuth secrets.

## Validation

- Latest focused lifecycle/security suite: 10 passed, including independent-session concurrency, tenant/session binding, stale generation and ambiguous-write reconciliation.
- Frontend package tests passed, including 510 shared tests in each of three timezone runs.
- Infrastructure suite: 103 passed, including gated Google APIs and isolated KMS keys.
- Production web build and browser unavailable/unlinked/empty-profile regression passed; desktop and phone-width overflow/accessibility checks included.
- Final `make check` passed: formatting/lint/types/code generation, 2,331 backend tests with 93.28% coverage (50 deselected by the standard gate), frontend package/timezone suites and 103 infrastructure tests.
- Table-policy registration, the reviewed sync snapshot and the idempotency error-code assertion are corrected and verified in that final run.
- Changes remain uncommitted on the implementation branch; no push, PR or merge was performed. Temporary browser preview servers were stopped.

Native-device and real-Google walkthroughs have not been performed. Automated results do not establish live readiness.

## External prerequisites

Google API approval, enabled-service quota, dedicated OAuth clients, consent publishing and a consenting live pilot remain unverified. A cloud preview against the configured GCS state backend failed with Google `invalid_grant` / `invalid_rapt`; gcloud and ADC credentials require reauthentication. No live schema migration, cloud deployment, Google reply or client invitation has been performed during implementation.

Live testing must use a named consenting profile, approved reply content and an explicitly selected invitation recipient. Automated and simulated provider tests cannot establish production OAuth approval or provider behavior.

## PR review follow-up — 2026-10-20

The user subsequently authorized committing/pushing, PR creation, fixing review findings, merging after validation, and preparing the main worktree for localhost testing. PR #45 contains the implementation.

The follow-up preserves connection management when Google reads fail, surfaces terminal reply errors, and commits invitation batches independently per business. A second review also identified and corrected a retry invariant: failed readback of an uncertain write must remain reconciliation-only, never become queued write work. Regression tests cover permission/read failures, definite write rejection, uncertain readback failures, and independent-session tenant-lock release.

Local configuration is documented in `.env.example`; Google Business Profile uses separate credentials from Google sign-in. Gcloud still reports expired authentication; actual project API approval, OAuth credentials and ADC/KMS access remain prerequisites for a real localhost pilot.
