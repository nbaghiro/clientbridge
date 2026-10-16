# Executions

Each execution that is planned or in progress owns its plan and progress so unrelated work does not accumulate in the documentation root. When an execution is implemented, move anything durable into the main docs and delete its folder.

| Execution       | Plan and tracking                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling      | [Plan](scheduling/plan.md), [design gaps](scheduling/design.md), [task queue](scheduling/tasks.json), [progress](scheduling/progress.md). |
| Codebase review | [Plan](codebase-review/plan.md), [task queue](codebase-review/tasks.json), [progress](codebase-review/progress.md).                       |
| Deploy          | [Plan](deploy/plan.md), [task queue](deploy/tasks.json), [progress](deploy/progress.md).                                                  |
| Mobile deploy   | [Progress](deploy-mobile/progress.md).                                                                                                    |

| Platform admin | [Plan](platform-admin/plan.md), [task queue](platform-admin/tasks.json), [progress](platform-admin/progress.md). |

Use a new folder for a separate execution. Record tested behavior, remaining work and snapshot-specific evidence in its progress document; keep reusable system decisions in the main docs.
