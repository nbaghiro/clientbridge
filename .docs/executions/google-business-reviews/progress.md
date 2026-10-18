# Google Business Profile implementation progress

## Planning baseline

- Date: 2026-10-18.
- Base: `origin/main` at `dd35920e`.
- Branch: `feat/google-business-reviews`.
- Worktree: `/Users/naib/Documents/code/clientbridge-google-reviews`.
- Scope of this PR: researched Google integration plan plus removal of internal review collection, with an approved cleanup migration. No live database, cloud deployment or external profile changes.
- Official Google API, OAuth, policy and Pub/Sub documentation and Pulumi OAuth resource documentation are linked beside the relevant decisions in [plan](plan.md).
- Repository audit covered reviews, public feedback, delivery boundaries, shared web/mobile hooks, Pulumi service enablement, secrets, workload identities and deployment configuration.

## External prerequisites

| Item                                | Current evidence                                                                     | Next action                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Live project inspection             | gcloud read-only commands failed with expired credentials requiring reauthentication | Operator runs `gcloud auth login`, checks enabled APIs and project number   |
| GBP Basic API Access                | Not verified; no approval evidence in this planning change                           | Confirm eligible profile and apply/check approval for the intended project  |
| OAuth clients and publishing        | Existing credentials belong to sign-in; dedicated GBP setup not verified             | Create clients, record callback/consent/verification status without secrets |
| Google account notification setting | No live account queried                                                              | Inspect with the customer's consent before configuring a topic              |
| Google integration schema approval | Still proposed; separate from the approved internal collection removal | Approve concrete Google operational schema before implementation |
| Live pilot profile                  | Not selected                                                                         | Identify consenting owner and genuine review for reply smoke tests          |

## Validation

Documentation formatting, local relative links, task dependency integrity and staged diff checks are required before commit. Record commit-hook results below. Runtime integration tests from the earlier audit do not validate a Google integration and are not presented as such.

## Implementation handoff

Start G1 and G2 from tasks.json. Build contract types/recording fakes while Google prerequisites are pending. Do not deploy gated resources, add model definitions, create migrations or claim live integration before their respective prerequisites. Keep completed evidence and outstanding work here after each phase; update task states only when acceptance criteria pass.

## Internal collection removal

The user expanded scope to remove internal feedback entirely and explicitly approved the concrete cleanup on 2026-10-18. Changes remove the public form and embed, local review actions, public testimonials/ratings, review notifications and client timeline feedback. Invitations link directly to the saved Google URL, carry booking identity and remain visible as request history. Demo fixtures, marketing copy, product docs, design mockups and tests are updated.

Migration cb0019 copies rows with actual request timestamps into `review_requests`, preserving IDs and tenant/client/booking references; it drops `reviews` and `businesses.review_hold_at`, and deletes old review command replay payloads. Unrequested feedback is not fabricated into invitation history. The downgrade refuses to pretend deleted feedback can be recovered; restoring it requires a backup. API/sync contracts and message catalogs are regenerated. No live database or cloud changes have been made.

Focused validation: 55 backend tests and 59 frontend tests passed. The commit hook enforces formatting, lint/type checks, generated-contract consistency, backend coverage, frontend timezone tests and infrastructure tests on the exact staged tree; final results are recorded in PR #39. GBP OAuth, review reads/replies, Pulumi provisioning and reliable queued invitation delivery remain planned work, not shipped capabilities.
