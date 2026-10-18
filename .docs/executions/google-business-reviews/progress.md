# Google Business Profile implementation progress

## Planning baseline

- Date: 2026-10-18.
- Base: `origin/main` at `dd35920e`.
- Branch: `feat/google-business-reviews`.
- Worktree: `/Users/naib/Documents/code/clientbridge-google-reviews`.
- Scope of this PR: researched execution plan, proposed schema, task queue and repository index entry. No runtime, schema, cloud deployment or external profile changes.
- Official Google API, OAuth, policy and Pub/Sub documentation and Pulumi OAuth resource documentation are linked beside the relevant decisions in [plan](plan.md).
- Repository audit covered reviews, public feedback, delivery boundaries, shared web/mobile hooks, Pulumi service enablement, secrets, workload identities and deployment configuration.

## External prerequisites

| Item                                | Current evidence                                                                     | Next action                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Live project inspection             | gcloud read-only commands failed with expired credentials requiring reauthentication | Operator runs `gcloud auth login`, checks enabled APIs and project number   |
| GBP Basic API Access                | Not verified; no approval evidence in this planning change                           | Confirm eligible profile and apply/check approval for the intended project  |
| OAuth clients and publishing        | Existing credentials belong to sign-in; dedicated GBP setup not verified             | Create clients, record callback/consent/verification status without secrets |
| Google account notification setting | No live account queried                                                              | Inspect with the customer's consent before configuring a topic              |
| Schema approval                     | Proposed in schema.md; no changes applied                                            | Approve concrete final schema before implementation                         |
| Live pilot profile                  | Not selected                                                                         | Identify consenting owner and genuine review for reply smoke tests          |

## Validation

Documentation formatting, local relative links, task dependency integrity and staged diff checks are required before commit. Record commit-hook results below. Runtime integration tests from the earlier audit do not validate a Google integration and are not presented as such.

## Implementation handoff

Start G1 and G2 from tasks.json. Build contract types/recording fakes while Google prerequisites are pending. Do not deploy gated resources, add model definitions, create migrations or claim live integration before their respective prerequisites. Keep completed evidence and outstanding work here after each phase; update task states only when acceptance criteria pass.
