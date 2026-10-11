# Executions

Each execution that is planned or in progress owns its plan and progress so unrelated work does not accumulate in the documentation root. When an execution is implemented, move anything durable into the main docs and delete its folder.

| Execution         | Plan and tracking                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend hardening | [Plan](backend-hardening/plan.md), [task queue](backend-hardening/tasks.json), [progress](backend-hardening/progress.md).                           |
| Localization      | [Plan](localization/plan.md), [task queue](localization/tasks.json), [progress](localization/progress.md). English-only foundation, ready to start. |

Use a new folder for a separate execution. Record tested behavior, remaining work and snapshot-specific evidence in its progress document; keep reusable system decisions in the main docs.
