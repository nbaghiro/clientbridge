# Reviews

Reviews describe a particular source snapshot. Their findings and validation results are evidence, not a replacement for the current architecture or an active task tracker.

| Area             | Documents                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Backend          | [System review](backend/overview.md), [cross-cutting principles](backend/principles.md), [file inventory](backend/files.csv). |
| Product surfaces | [Web and Connect](product/web-and-connect.md), [native mobile](product/mobile.md).                                            |
| CI               | [Workflow, flakiness and timings, 2026-10-12](ci/2026-10-12-ci-review.md).                                                    |

The backend hardening execution that answered these findings was closed on 2026-10-13 with one of its 45 tasks done; its plan and task queue are in git history at `c72aee9b` (`.docs/executions/backend-hardening/`), and the current fixes are planned in the codebase review execution. The ledger audit of 2026-10-12 was resolved and folded into the architecture doc.
