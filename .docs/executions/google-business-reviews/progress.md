# Google reviews: progress

Evidence for [the plan](plan.md). Record each step's result here, with the date.

## Carried over from the first execution

PRs #39, #43 and #45 shipped the code; their own progress log is in git history at `9e49d5d2`. At handover:

- `make check` passed with backend, frontend and infra suites, against fakes only. No native-device or real-Google walkthrough has been done.
- Google API approval, Business Profile quota, the review OAuth clients, consent publishing and a consenting pilot were all unverified.
- A cloud preview failed with Google `invalid_grant` / `invalid_rapt`; gcloud and ADC needed reauthentication.
- No live migration, cloud deployment, Google reply or client invitation had been performed.

## Phase 1: outside setup

- 1.1 — gcloud and ADC reauthenticated. The cloud stack enables the Business Profile APIs whatever `googleBusinessEnabled` says and exports `projectNumber`; infra suite 123 passed. Pending: an administrator's preview and apply, then the project number below.
  - Project number: _pending apply_
