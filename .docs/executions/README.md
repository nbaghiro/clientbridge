# Executions

Each execution that is planned or in progress owns its plan and progress so unrelated work does not accumulate in the documentation root. When an execution is implemented, move anything durable into the main docs and delete its folder.

| Execution         | Plan and tracking                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Messaging         | [Plan](messaging/plan.md), [progress](messaging/progress.md).                                                                             |
| Scheduling        | [Plan](scheduling/plan.md), [design gaps](scheduling/design.md), [task queue](scheduling/tasks.json), [progress](scheduling/progress.md). |
| Backend hardening | [Plan](backend-hardening/plan.md), [task queue](backend-hardening/tasks.json), [progress](backend-hardening/progress.md).                 |

Use a new folder for a separate execution. Record tested behavior, remaining work and snapshot-specific evidence in its progress document; keep reusable system decisions in the main docs.
