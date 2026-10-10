# Sync P2 hardening plan

This execution resolves the ten P2 findings (S07–S16) in the [sync assessment](../../reviews/sync/assessment.json). It continues the [sync reliability execution](../sync-hardening/plan.md), which stopped when its session moved to other work on 2026-10-09; that plan's contracts for health, catch-up, projections, operations and scale remain the design reference. Task status lives in [tasks.json](tasks.json) and verified outcomes in [progress.md](progress.md).

## Boundaries

Schema and database-privilege changes need explicit approval of their concrete design before any model, migration or role edit, including on disposable databases. W6 (roles and publication) and W8 (`files.uploaded_at`) were approved on 2026-10-10 as described in their sections; any other schema change found necessary is proposed separately. The app is in early development, so each change replaces the previous behavior rather than adding a compatibility path. Tests that change data run against disposable stacks, or against the demo account with the prior state recorded and restored afterwards. The shared iOS simulator and Android emulator are reused, never duplicated, and only the clientbridge `adb reverse` forwards (8701, 8704) are toggled.

## Workstreams

| #   | Workstream                                 | Findings      | Outcome                                                                                                                                                                                                                               |
| --- | ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | Sync health in every shell                 | S08, S16      | One `syncNotice` decision in app-core, rendered by the web shell and above the mobile tab bar; first-sync failure with retry; uploads reported only after a change has waited 15 seconds; refresh recovery after a failed token save. |
| W2  | Read-after-command catch-up                | S09           | `expectArrival`/`useArrival` hold a screen in a bounded "arriving" state after a successful command, then a "late" notice, without a failure prompt or resubmission. Applied to recorded invoice payments and collected deposits.     |
| W3  | Replica security evidence                  | S12, S13, S06 | A reviewed per-stream projection snapshot with audience invariants; a real-service check that every role receives no column outside its projection in any synced table; a signing-key rotation drill.                                 |
| W4  | Hours conflicts on device                  | S07           | Offline edit, force-close, concurrent server change and resolution on the Android emulator; a conflict rebases only the user's changed days onto the current server week.                                                             |
| W5  | Sync Streams                               | S15           | Edition 3 streams with equivalent auto-subscriptions and unchanged timestamps, proven identical to the previous rules for six identities; migration and rollback rehearsed with a queued edit.                                        |
| W6  | Replication least privilege and monitoring | S11           | Separate migrator, API, replication-source and storage roles; a publication limited to synced tables, generated from the sync config; `make replication-health` for readiness, slot, retained WAL and lag.                            |
| W7  | Scale                                      | S10           | Measured replica size and query time for 1k/10k/50k clients and 100k/1M history rows; keyset pagination and virtualized long lists where measurements require it; totals from the server rather than a truncated replica.             |
| W8  | Attachments and device storage             | S14           | `files.uploaded_at` set by a verified complete-upload command; pending uploads hidden and pruned after 24 hours; same-user data locked during reauthentication; offline file availability labeled.                                    |
| W9  | Close-out                                  | all           | Full failure matrix, CI, maintained docs updated to the implemented behavior, the sync-hardening tracker closed with an accurate status, and a commit breakdown.                                                                      |

## Approved changes

W6 creates `clientbridge_migrator` (schema owner, runs Alembic), `clientbridge_api` (data access without DDL), `powersync_source` (`REPLICATION` plus `SELECT` on synced tables) and `powersync_storage_owner` (owner of `powersync_storage` only). The `powersync` publication changes from `FOR ALL TABLES` to the synced tables, so sessions, tokens, refresh replays and receipts are no longer streamed to the replication service. No row changes. Rollback points the connections back at `clientbridge`, recreates the publication for all tables and drops the roles.

W8 adds a nullable `files.uploaded_at`. `POST /v1/files/{id}/complete` sets it after confirming the object exists in storage, and readers treat rows without it as pending: they are not shown as attachments and are excluded from public media. A job deletes pending rows and their objects after 24 hours. Existing rows are backfilled from a storage check. Rollback drops the column. On-device database encryption is out of scope.

## Release criteria

Each task is complete with evidence or deferred with the guarantee it leaves unmet. At each workstream boundary the backend, frontend and real-service gates run; at close-out the full CI-equivalent set runs locally before pushing. Commits and pushes happen only when requested.
