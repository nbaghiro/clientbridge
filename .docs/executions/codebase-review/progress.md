# Codebase review progress

The review is complete. T01 is in progress: H1 and H2 were fixed in `6b3966e3` (failed notices are retried instead of marked sent, and the reminder, overdue and intake jobs commit after each send), with the attempt count and L23 still open. The [task queue](tasks.json) is the status source; the [plan](plan.md) holds the findings, delivery order and schema approvals.

## Snapshot

| Item               | Value                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Reviewed code      | `main` at `7ec6612e`, content identical to the Stripe branch head `bfb46f1b`                                                      |
| First pass         | `08eb5c9f`; every finding was re-checked on `bfb46f1b`                                                                            |
| Repowise           | 0.56.0 through `uvx`, `--no-prose --embedder mock`, telemetry disabled, provider keys unset; the re-run added `--no-editor-setup` |
| Database and tests | Not used; every verdict comes from reading the code                                                                               |
| Review dates       | 13 October 2026                                                                                                                   |

## Results by stage

| Stage                       | Result                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repowise on `08eb5c9f`      | Health 7.39, 15 files at risk; three fix-first items, two credential items, five dead-code candidates.                                                                                                 |
| Repowise on `bfb46f1b`      | Health 7.37, 17 files at risk; the same recommendations, with `services/business.py` and `scripts/stripe_setup.py` new among the lowest-scoring files.                                                 |
| Five-angle review           | Backend risk, backend performance, frontend, dead code and test gaps, functional map.                                                                                                                  |
| Verification                | Every finding traced and challenged; refuted claims and partial claims corrected.                                                                                                                      |
| Re-check on the Stripe head | None of the earlier findings fixed; one partly fixed (test gaps); two doc findings widened; one severity lowered (auth docs, High to Medium); six new findings in the added code (M5, M6, L20 to L23). |

## Final counts

| Severity | Findings |
| -------- | -------- |
| High     | 3        |
| Medium   | 21       |
| Low      | 27       |
| Refuted  | 11       |

## Evidence

Raw outputs stay in the session scratchpad and are not part of the repository: the Repowise reports (`repowise-out/` and `repowise-pr4/`), the five review reports (`analysis/`), the five verification reports (`verify/`) and the three re-check reports (`verify-pr4/`). The plan cites file and line for every finding, so the reports are not needed to act on it.

## Side effects to clean up

The first Repowise run added a `repowise` MCP server and three `repowise-augment` hooks to the user's global `~/.claude/settings.json`. They need removing by hand; the hooks are inert while `repowise-augment` is not on the path.
