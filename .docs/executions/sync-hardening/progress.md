# Sync reliability progress

Status: executing after the user’s “go”. See tasks.json for individual acceptance status; the full plan is not complete.

The [plan](plan.md) defines implementation contracts and release criteria. The [task queue](tasks.json) contains 27 dependency-ordered tasks covering all 16 findings in the [assessment](../../reviews/sync/assessment.json).

## Planning evidence

- Reviewed the actual connector, session store, web/native lifecycle, upload endpoint, generated schema, sync rules, CI and infrastructure.
- Existing sync authentication/upload suite: 34 passed at the review snapshot.
- Rollback-only API probes reproduced repeated DELETE returning 403, invalid hours accepted, string false stored as true, malformed time returning 500 and unknown column returning 500. The probe left no rows behind.
- Controlled transport probes reproduced lost refresh response leading to sign-out on retry and permanent upload rejection leaving the transaction unacknowledged.
- API and PowerSync readiness checks passed at review time. These checks do not prove the missing failure cases are resolved.
- The dependency graph and S01–S16 coverage were validated during planning. Runtime/source changes by other sessions must be reconciled at SH00.

## Decisions carried into execution

- Keep PowerSync, the shared domain layer, and server-authoritative money/booking commands.
- Preserve queued edits during automatic reauthentication; reserve destructive discard for explicit user action.
- Introduce durable replay identities and typed upload validation before enabling new offline hours behavior.
- Use a narrowly scoped versioned hours outbox and pending overlay; do not create a general offline command framework.
- Support explicit selected-business context across web, iOS and Android.
- Build actual-service authorization tests before changing sync projections or migrating to Streams.
- Pin service versions; migrate to equivalent Streams before introducing selective history.
- Use disposable verification resources and retain the main seeded database and existing simulator setup.

## Next action after go

Start SH00. Record the current combined baseline, assign ownership of overlapping backend-hardening tasks, and confirm the isolated test resource lifecycle. Then follow `execution_order` in tasks.json; dependencies supersede task-number ordering.

For each task, record implemented contracts, verification commands/results, source snapshot, migrations/generated artifacts, compatibility impact and unresolved limitations. Mark complete only after its acceptance criteria pass. No commits, pushes or production deployment are included in the pending execution authorization.

## Execution evidence — 2026-10-09

- Baseline archived in `.scratchpad/sync-hardening/baseline.{json,tar.gz}` at `dc594143e6f7c384b5055579bdfb06839bbe503b`. Existing UI, public media and demo edits are concurrent work and preserved.
- Baseline sync authentication/upload suite: 34 passed. Source migration head was `cbpayments02`.
- Verification uses a disposable PostgreSQL container and a read-only dump of the primary database. No main database migration, reseed or simulator changes.
- SH03: typed DTO/service separation, merged PATCH validation, strict SQLite booleans, bounded operations and streamed request bytes, whole-batch rollback, database checks. All-day windows remain valid per the existing model contract. Audited copy has zero invalid schedules; `cbsync01` applied only to the copy. Focused suite: 58 passed; strict mypy passed.
- Full backend suite: 1,353 passed, one concurrent demo-gallery expectation failure (`test_public_profile_uses_brand_contract_and_only_active_team`); details in `.scratchpad/sync-hardening/backend-tests.log`. This is not a clean full gate.
- SH01: actual installed browser SDK test passes close/reopen identity persistence, local-only metadata persistence, total queue counts and successor preservation. Completion does **not** undo the optimistic row; safe rejection reconciliation remains unproven and is not enabled.
- SH02: disposable pinned-image integration harness and deterministic independent tenant/role fixtures are under verification. `make test-sync` owns creation and cleanup; no live demo dependency.

## Upload and identity implementation — continuing

- SH01 verified with actual installed web SDK/SQLite and service 1.26.1: stable transaction identity after reopen, complete queue counts, durable rejected-intent storage and authoritative reconciliation. Checkpoint requests remain an optional alpha API; no production path depends on them.
- SH03 complete: explicit typed/bounded service uploads, whole-envelope rollback and audited database constraints. 65 focused cases passed before receipt extensions; strict types/lint passed.
- SH04 implements v2 durable client envelopes and actor/device/operation receipts committed atomically with writes, hash mismatch rejection, membership rechecks, 90-day fail-closed retry age and bounded receipt pruning. Lost-response/reopen client test passed; receipt tests include concurrent duplicate requests. Legacy envelope support remains.
- SH07/SH09 are being integrated together because preserving an automatic reauthentication queue without binding it to an actor would allow a different login to upload it. Shared lifecycle controller serializes storage transitions; shared app-core session hook locks views, exposes initialization/discard failure and bounds initialization to 30 seconds. Actual SQLite tests pass account/environment separation, same-account pending preservation and unknown-legacy quarantine. Unknown legacy work is retained, not assigned from a guessed account; UI exposes a recovery notice. Native UI verification is still outstanding.
- Session transport uses generation invalidation and actor-bound sync fetches; six focused client tests pass, including late refresh, timeout and persisted refresh-attempt identity across lost response/restart.
- SH08 implements serialized server rotations and encrypted five-minute same-attempt replay. Different-attempt replay still revokes the family; expired encrypted outcomes are pruned. Production requires a separate `REFRESH_REPLAY_KEY`. Concurrent rotation test passes. `cbsync02` and `cbsync03` remain isolated-test migrations only.
- SH11 rechecks token type, live user and live family for API access and sync-token exchange. Newly issued access tokens carry the family ID. Legacy tokens are limited to the existing short access lifetime; PowerSync token default is now five minutes. Focused auth tests include logout/revocation and malformed/long-lived legacy credentials.
- SH13 foundation uses actual total queue count and treats an unreadable queue as unknown during sign-out confirmation, rather than reporting zero or the 50-row preview length.
- Current gates are running; no main-database migration, commit, push or production deployment has occurred. The remaining tasks are not marked complete.

## Business isolation and projections — continuing

- SH02 complete: repeated pinned disposable-service runs pass 13 tests and remove per-run resources. The test PostgreSQL copy remains temporary during backend verification.
- SH12: selected business gates the app, scopes domain SQL (including nested aggregates), and binds API actions through refresh retries. Actual-service multi-business role/list/detail/aggregate case passes. All 205 domain tests, seven session tests, web/mobile TypeScript checks pass. Native UI acceptance is outstanding.
- Session initialization errors offer retry and sign-in again while retaining queued edits. Cross-tab identity replacement invalidates in-flight work. Full cross-tab/native failure coverage remains outstanding.
- SH16: explicit projections replace all wildcard data queries; local schema uses their union. Removed unused provider references, private storage keys and booking/order capabilities; retained invoice/estimate/signature sharing capabilities used by product flows. Seven regression tests prove model expansion does not automatically expand replicas. Real-service role pay/tax tests pass. Expanded negative-column and live-revocation probes are in progress.
- Superseding earlier isolated-only migration notes: re-audited main hours (zero invalid rows), backed up to `.scratchpad/sync-hardening/pre-migration.dump`, and applied cbsync01–cbsync03 to the main local Docker database. No reseed/reset. Current local head is cbsync03. No production deployment, commit or push.
- Latest full backend suite: 1,376 passed, two failures. Missing sync_receipts policy was fixed and targeted policy/schema tests pass; existing concurrent demo-gallery expectation failure remains separate. Not a clean final gate yet.

## User correction: no compatibility scaffolding; schema approval required

- All future schema/model/migration changes require explicit approval before creation or application, including test databases. Recorded in CLAUDE.md and the execution policy. The project supports one current implementation; no old-client compatibility window is required.
- Schedule revisions address simultaneous-edit conflicts, independently of compatibility. The dual old/new hours write-path implementation was withdrawn. Removed its staff model field, router registration, locking/revision hooks and unfinished endpoint from active code. Draft files, including the already-tested migration, are preserved only under `.scratchpad/sync-hardening/unapproved-hours-draft/` for traceability, not executable migration discovery.
- Read-only confirmation: main Docker database remains at cbsync03; disposable cb-sync-verification is at cbsync04. No schema changes or rollback were executed after the user's correction. The test database's applied cbsync04 definition is archived; do not run Alembic against that database until its disposition is approved.
- Already applied to main before the correction: cbsync01 (four hours validation constraints), cbsync02 (sync_receipts with replay identity/hash/result and indexes), cbsync03 (four nullable encrypted refresh-replay fields on sessions). Backup: `.scratchpad/sync-hardening/pre-migration.dump`. Their retention or rollback needs explicit review; none was silently reversed.
- Existing earlier compatibility additions (optional legacy upload envelopes, sidless-token acceptance, legacy replica discovery) still require coordinated source cleanup. The revised plan removes those requirements; this entry does not claim all compatibility code has been removed.
- Latest verification before correction: 15 real service/browser cases and 114 focused backend cases passed. Hours aggregate work was incomplete and is not counted as verified or shipped.

## Revised-plan continuation authorized

- User explicitly authorized continuing the revised plan, including needed DB reverts/updates. General schema approval policy remains in force for unrelated future changes.
- Reverted only the abandoned cbsync04 on the disposable test database using its archived downgrade. Main and test databases now both report cbsync03; test staff.hours_revision is absent. Main demo rows were not reset or reseeded. Kept cbsync01–03 as current validation/reliability mechanisms, not compatibility layers.
- Removed runtime legacy-file discovery/bindings and its UI notice. Replica initialization opens only the current identity-scoped filename. Existing abandoned files are not deleted.
- Removed sidless-token acceptance; issuer requires a family ID. Backend test clients now use actual persisted sessions. Removed optional old upload envelopes and optional refresh-attempt IDs. Logout has a separate refresh-token-only DTO; it does not require a refresh attempt.
- Removed the legacy identity fallback in cross-tab session identification. Regenerated the API contract. Verification is running; this does not mark the full execution complete.

### Current-contract cleanup checkpoint

- 226 focused backend cases, 15 actual-service/browser cases, 208 shared-domain cases and eight API-client cases pass; web/mobile/sync TypeScript checks pass. Full backend: 1,384 passed, the known concurrent demo-gallery failure, and one connection-setup error (Docker/PostgreSQL SSL upgrade rejection) under investigation. No blanket clean-suite claim.
- Source lint and strict backend typing pass. Test harness cleans all per-run service containers; the shared temporary test copy remains during implementation.

## Single current hours path — verified checkpoint

- Superseding the earlier cbsync03 checkpoint: after the user's explicit authorization, installed the single current `staff.hours_revision` concurrency counter (cbsync04) in both main Docker DB and the temporary verification copy. Main backup: `.scratchpad/sync-hardening/pre-current-hours.dump`. No reseed/reset. The abandoned draft on the disposable copy was downgraded before the current migration was applied.
- Removed generic `/sync/upload`, row-reflection/write-policy code, generic client CRUD transport and their superseded tests. The sole recurring-week write is the typed `/v1/hours/{staff_id}/week` command; seven days, scoped active-member authorization, stable row IDs, revision conflict protection and atomic replay receipts. Existing split shifts fail for review rather than being flattened.
- Web and mobile share the local-only hours outbox and editor. Attempted payloads remain immutable; rejected weeks retain intent and block only dependent edits. Pending counts include the outbox. Cancellation is bounded even when a transport ignores the signal. The editor retains its opening revision and checks the observed local proposal before coalescing, preventing silent overwrites from another editor.
- 37 focused backend cases pass; 208 shared-domain tests pass. Actual-service suite: 19 passed, including real API commit → deliberately lost response → SQLite reopen → exact replay → PowerSync revision observation and outbox cleanup. Four outbox fault cases pass. Backend lint and strict source typing pass. Final frontend lint and refreshed lifecycle cases are being checked; native device acceptance and later plan phases remain outstanding.
- Updated current architecture and repository guidance to describe the command/outbox contract. Historical progress above records intermediate experiments and is superseded by this section where they differ.

### Production signing protection — implemented, further service drill pending

- Non-development settings now require RS256, a configured RSA private key (at least 2048 bits), a distinct production key ID, and the existing application/refresh/webhook secrets. Missing or invalid keys fail during settings initialization; there is no production ephemeral-key fallback.
- JWKS supports a bounded operational overlap configured as key-ID → public PEM values. The active signer uses the configured key ID; verification keys cannot reuse that ID or contain private material. Configuration and old/new token round-trip coverage: 25 auth/signing/harness tests pass. A PowerSync-service cache/rotation drill remains outstanding before SH19 is complete.

### Current gate and resource checkpoint

- Full backend gate: 1,341 passed, 24 deselected, one known demo-gallery expectation failure (`gallery_urls` is empty under concurrent media/seed changes). No connection-setup errors in this run. The removed generic CRUD tests were replaced by current command/receipt/constraint cases; counts differ from the earlier interim suite.
- Frontend lint, structure/unused-code checks, web/mobile typing and all 208 domain tests pass. Current lifecycle tests verify local-only outbox retention across reauthentication/account switching and deletion only on explicit discard. Nine session-client cases include successful 204 commands, which previously threw while parsing an empty response.
- Main API health and PowerSync readiness both return 200. Main database remains cbsync04. Removed the temporary `cb-sync-verification` container after backend verification; disposable service harness resources were already removed by their finally cleanup. No extra iOS simulator was started; existing iPhone and Android emulator are reused for native checks.
- Pinned main PostgreSQL/PowerSync images to the already-running digests and replaced suppressed bootstrap errors with fail-fast idempotent SQL (two successful runs). Broader role separation/monitoring work remains pending; no production-hardening completion claim.

### Native verification investigation

- The existing iPhone navigation run failed at session restoration. Temporary bounded diagnostics identified `ExpoSecureStore.getValueWithKeyAsync` failing with “A required entitlement isn't present”; this happens before opening/updating the replica. The installed app is linker-signed with no application entitlements. Its missing outbox table is therefore not evidence of a migration failure. Temporary diagnostic source edits have been removed.
- Restarted the single existing Metro server with a cleared bundler cache; retained all simulator/app data. Rebuilding the same iPhone target with normal simulator signing. Reduced build concurrency to two jobs after observing host memory pressure; Android automation was stopped while the build completes. Neither native run is a pass yet.

### Native startup fixes and service recheck

- Corrected the actual Android startup failure: SQLite cannot UPSERT a PowerSync view. Business selection now uses a shared transaction that verifies the business and replaces the local selection with delete/insert. The actual-service business-scope test calls this production helper for first selection, reselection and switching, rather than bypassing it with hand-written SQL.
- iPhone signed build succeeded using the existing simulator and two build jobs. Installed over the same bundle without clearing its data. The saved session now restores and the native scoped-startup/hours-editor regression passes (25 seconds). The same Android regression passes (30 seconds).
- Rechecked the real service/browser suite after the selection fix: all 19 cases pass, with disposable resources cleaned. Current native smoke coverage is startup and editor reads; offline submission/conflict/force-close acceptance remains open.

### Verified continuation checkpoint

- Current source checks pass: frontend lint/structure/unused-code checks; web, mobile and sync typing; backend lint/strict typing/structure/format checks. The 19 real-service cases and both actual native startup/editor regressions pass. Full backend retains the one documented demo-gallery fixture failure.
- Main Docker database is cbsync04, backed up before the hours update. No shared demo reset, production deployment, commit or push. Only the existing iPhone simulator and Android emulator were used; no temporary database/container remains. Metro was restarted once with a cleared cache; the rebuilt iPhone app was installed without clearing its storage.
- Remaining execution gates include full native offline-write/conflict/force-close tests, bounded storage-failure/session recovery, diagnostics, general read-after-command behavior, complete per-table authorization fixtures, database role separation/monitoring, service key-rotation rehearsal, Streams parity, large-data pagination/performance, storage protection and attachment recovery. Task states remain open for those requirements.
