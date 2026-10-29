# Google reviews: progress

Evidence for [the plan](plan.md). Record each step's result here, with the date.

## Carried over from the first execution

PRs #39, #43 and #45 shipped the code; their own progress log is in git history at `9e49d5d2`. At handover:

- `make check` passed with backend, frontend and infra suites, against fakes only. No native-device or real-Google walkthrough has been done.
- Google API approval, Business Profile quota, the review OAuth clients, consent publishing and a consenting pilot were all unverified.
- A cloud preview failed with Google `invalid_grant` / `invalid_rapt`; gcloud and ADC needed reauthentication.
- No live migration, cloud deployment, Google reply or client invitation had been performed.

## Phase 1: outside setup

- 1.1 — Applied 2026-10-29. The cloud stack enables Cloud KMS and the Business Profile APIs whatever `googleBusinessEnabled` says, except `mybusiness.googleapis.com` (the v4 reviews API): Google refused to enable it (403) before approval, so it now waits for the flag. Only the API services were applied (`--target`); the cloud stack's other pending changes (the `max_slot_wal_keep_size` flag on Cloud SQL, the `ledger-drift` metric filter and the `webhook-rejections` metric and alert) are still to apply.
  - Project number: 162823908109
