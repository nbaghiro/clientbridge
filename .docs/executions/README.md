# Executions

Each execution that is planned or in progress owns its plan and progress so unrelated work does not accumulate in the documentation root. When an execution is implemented, move anything durable into the main docs and delete its folder.

| Execution       | Plan and tracking                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling      | [Plan](scheduling/plan.md), [design gaps](scheduling/design.md), [task queue](scheduling/tasks.json), [progress](scheduling/progress.md). |
| Deploy          | [Plan](deploy/plan.md), [task queue](deploy/tasks.json), [progress](deploy/progress.md).                                                  |
| Mobile deploy   | [Progress](deploy-mobile/progress.md).                                                                                                    |

| Platform admin | [Plan](platform-admin/plan.md), [task queue](platform-admin/tasks.json), [progress](platform-admin/progress.md). |

Use a new folder for a separate execution. Record tested behavior, remaining work and snapshot-specific evidence in its progress document; keep reusable system decisions in the main docs.

- [Product hardening](product-hardening/plan.md) — fixes on `hardening/product-invariants`; all findings, resolutions and approved schemas in the plan; [QA checklist and results](product-hardening/qa.md).
