# Executions

Each execution that is planned or in progress owns its plan and progress so unrelated work does not accumulate in the documentation root. When an execution is implemented, move anything durable into the main docs and delete its folder.

| Execution     | Plan and tracking                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling    | [Plan](scheduling/plan.md), [design gaps](scheduling/design.md), [task queue](scheduling/tasks.json), [progress](scheduling/progress.md). |
| Deploy        | [Plan](deploy/plan.md), [task queue](deploy/tasks.json), [progress](deploy/progress.md).                                                  |
| Mobile deploy | [Progress](deploy-mobile/progress.md).                                                                                                    |

| Platform admin | [Plan](platform-admin/plan.md), [task queue](platform-admin/tasks.json), [progress](platform-admin/progress.md). |

Use a new folder for a separate execution. Record tested behavior, remaining work and snapshot-specific evidence in its progress document; keep reusable system decisions in the main docs.

- [Product hardening](product-hardening/plan.md) — fixes on `hardening/product-invariants`; all findings, resolutions and approved schemas in the plan; [QA checklist and results](product-hardening/qa.md).

- [Google reviews: finish and launch](google-business-reviews/plan.md) — proposed; gaps from the 2026-10-29 audit of `main`, Google setup, testing and rollout; [runbook](google-business-reviews/runbook.md), [progress](google-business-reviews/progress.md).

- [Visit flow](visit-flow/plan.md) — check-in requirements and checkout on `feat/visit-flow`; [schema proposal](visit-flow/schema.md), [task queue](visit-flow/tasks.json), [progress](visit-flow/progress.md).

- [Demo seed simplification](demo-simplification/plan.md) — on hold until the demo businesses have been tested; eleven fingerprint-proven commits that remove about 600 to 700 lines without changing demo data.

- [Connect hosts](connect-hosts/plan.md): one host per kind of Connect page and a subdomain per business page, on `connect-hosts`; [QA checklist](connect-hosts/qa.md).
- [End to end testing](e2e/README.md): the audit families still to cover, with the [audit families](e2e/families.json) and [decisions to review](e2e/decisions.md).
- [Real Stripe in CI](stripe-real-tests/plan.md): a pool of QA merchants, a real-Stripe API suite on every pull request and the browser lane on payments changes and nightly; [progress](stripe-real-tests/progress.md).
- [Web replica storage](web-storage/plan.md): the web replica on OPFS in every browser, with the open decisions listed in the plan.
