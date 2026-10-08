# Backend hardening progress

Execution started on 7 October 2026 after the user's “go.” Work uses one low-effort subagent at a time, with primary-agent review. The [task queue](tasks.json) is the status source; the [plan](plan.md) defines dependencies and acceptance criteria.

## Current work

T00 completed the baseline in `.scratchpad/backend-hardening/execution`, isolated from the changing shared checkout. The snapshot is based on `9372caf405c987e94b3574a37e1c539686754fff` plus 1,034 captured source/document files. Hashes are in `.scratchpad/backend-hardening/manifest.json`; immutable contents are retained in `baseline.tar.gz` with its SHA-256 file.

The dedicated database is `clientbridge_hardening_20261007`. Fresh migrations and a guarded seed succeeded with object uploads disabled and provider credentials empty. The seed created 2,724 rows. The shared database was not migrated or reseeded.

## Baseline evidence

| Check | Snapshot result |
|---|---|
| Frozen backend/frontend dependency installation | Passed. |
| Backend formatting and structure | Passed. |
| Backend typing | One existing `no-any-return` error in `tests/test_payments_pad.py:63`; concurrent edits have since changed that root file. |
| Backend default tests | 1,291 passed, two failed, 24 deselected; 95.02% coverage. |
| Baseline failures | Brand clearing retains the seeded avatar when an uploaded logo is implicitly removed; review the logo/derived-avatar transition before changing the assertion. The pay-link tip fixture has no eligible service line. Exact traces are in `backend-test.log`. |
| Frontend checks | Formatting, typing, 207 tests, all four builds and site content passed. Structure fails on an unused `onboard` export; Knip reports duplicate Connect exports in playground `StripeStub.tsx`. |
| Code generation | Passed against the captured isolated index; generated hashes stayed unchanged. |
| Provider contracts | 17 passed, four skipped because stripe-mock lacks Account Sessions. No live provider calls. |
| Browser/native baseline | Chromium is absent; isolated PowerSync and native builds are not provisioned by T00; full client verification remains part of the execution plan. |

These failures predate hardening changes. Exact commands and outcomes are retained in `.scratchpad/backend-hardening/results.json`, `results-indexed.json` and `T00-summary.json`. Current-root PAD helper typing already differs from the captured failing version; preserve the concurrent fix during integration.

T01a is complete and integrated after review: the 44 tables have explicit scope, tenant-key and model-domain declarations. The metadata guard rejects unclassified tables and invalid declarations. All 17 targeted scoping/inventory tests, changed-file Ruff/mypy and the structure check passed against the dedicated database. Evidence is under `.scratchpad/backend-hardening/execution/backend/.scratchpad/t01a/`.

The [permissions inventory](permissions.md) records concrete foreign keys and indirect references. This is a foundation for authorization work; it does not add RLS or change runtime access. Route, job, public-capability and relationship enforcement decisions remain before T01 is complete. The original audit's separate 1,222-pass result is not reused for this expanded snapshot.

## Documentation organization

The user's requested cleanup moved backend and product reviews to `../../reviews/`, moved execution plans into their own folders, and added an exploration area and documentation index. The immutable baseline archive keeps the earlier layout; current task references use the new layout.
