# Executions

Each execution that is planned or in progress has a folder with its plan, task state and progress, so unrelated work doesn't collect in the main docs. When an execution is implemented, move anything durable into the main docs and delete its folder; git keeps the history.

| Execution | State | Documents |
| --- | --- | --- |
| Google reviews: finish and launch | Waiting on Google's approval of the Business Profile API | [Plan](google-business-reviews/plan.md), [progress](google-business-reviews/progress.md) |
| Web replica storage | Waves 0 to 2 merged; the switch to OPFS in every browser is pending | [Plan](web-storage/plan.md), [progress](web-storage/progress.md) |
| Demo seed simplification | On hold until the demo businesses have been tested | [Plan](demo-simplification/plan.md) |

Use a new folder for a separate execution. Record tested behaviour, remaining work and snapshot-specific evidence in its progress document; keep reusable system decisions in the main docs.
