# Web replica storage: progress

## Gates, 2026-10-27

Re-checked at the start of wave 0 with `gh api`, the WebKit Bugzilla REST API and `npm view`. Nothing changed since the plan was written the same day.

| Gate                                                   | Status                                                                  | Last change |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ----------- |
| G1. powersync-js 785, multi-tab deadlocks              | Open                                                                    | 2026-10-20  |
| G2. Chrome renderer crash on Windows (comment on 785)  | No Chromium issue linked yet. Our own run is T8.                        | 2026-10-20  |
| G3. powersync-js 808, Safari init hang                 | Open                                                                    | 2026-10-09  |
| G4. powersync-js PR 811, `pagehide` termination        | Open, not merged                                                        | 2026-06-18  |
| G5. WebKit 316904, worker locks kept on navigation     | NEW                                                                     | 2026-10-09  |
| G6. wa-sqlite 341, concurrent open hang                | Open                                                                    | 2026-09-29  |
| G7. `@powersync/web` pinning wa-sqlite 2.0.10 or later | None. 2.5.0 is the latest and pins 2.0.7; wa-sqlite's latest is 2.0.10. | 2026-10-19  |

## Decisions

D1 to D5 are answered in the plan, each as recommended.

## Waves

| Wave | Tasks                                                                                                  | Status                                                       |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 0    | T0                                                                                                     | Done 2026-10-27                                              |
| 1    | T1 bench harness, T2 PowerSync upgrade, T3 replica lifecycle, T4 precache, `persist()` and diagnostics | T2, T3 and T4 merged 2026-10-27; T1 in #73, waiting to merge |
| 2    | T5 navigation and locks, T6 sign-out cleanup, T7 sync suite in three engines                           | Done on `web-storage`, one PR                                |
| 3    | T8 gate run                                                                                            | Waiting on waves 1 and 2 on staging                          |

## Wave 1 results

- **T2** (#71, merged without waiting for CI): `@powersync/web` 2.5.0, common 2.4.0, react 2.1.0, react-native 2.3.3, shared-internals 1.4.0. The wa-sqlite override stays at 2.0.10, since 2.5.0 pins 2.0.7. The web app's direct wa-sqlite dependency, its knip ignore and its Vite `optimizeDeps` entry are gone. The changelogs list no breaking change that affects us.
- **T4** (#72, merged without waiting for CI): the service worker precaches 22 files and 6.32 MB, down from 32 files and 10.44 MB; wasm went from 7.21 MB to 3.40 MB. Persistence is asked once per profile after the first sync (D4). The dev panel shows the storage kind, `enableMultiTabs`, `persisted()`, the replica size and the held and pending locks. The filter is `scripts/precache.ts` rather than `.mjs`, because `vite.config.ts` imports it under strict tsc.
- **T3** (merged with this plan): `ReplicaController.close()` keeps the file, and an optional `remove` hook runs after `discard()`. `removeReplicaFiles(name)` lives in `@clientbridge/sync/files`, a web-only subpath so the mobile typecheck stays free of DOM types. It removes the database, `-journal` and `-wal` files only while holding the `ahp:/<name>` lock. The sync suite opens `OPFSCoopSyncVFS`. The lifecycle cases passed 120 runs in Chromium and 6 of 6 in Firefox, and WebKit waits for T7. A new Chromium-only case shrinks the origin's quota through CDP.
- **Finding from T3:** in Chromium, a write past the quota reaches PowerSync only as `disk I/O error`, because `OPFSCoopSyncVFS` reports a short write as `SQLITE_IOERR_WRITE` and no wa-sqlite VFS returns `SQLITE_FULL`. `STORAGE_FULL` in app-core now also matches `disk I/O error`, which means any other OPFS I/O failure also shows as a full device. The precise alternative is a pnpm patch to wa-sqlite's `jWrite`, which needs Naib's decision.
- **T1** (#73): the harness is in `packages/sync/bench/`, using synthetic rows at Cedar Coast's real row counts (24,361 rows, the largest core business). `storage-bench.yml` runs on Linux, macOS (with Safari) and Windows (with Chrome and Edge, and 30 crash runs each). Local smoke numbers on an M4 Pro, one or two runs each:
  - First checkpoint in Chromium: IndexedDB 3.8 to 4.1 s on disk, OPFS about 1.1 s on disk, memory about 0.7 s. In Firefox, OPFS took 2.4 to 3.0 s.
  - **WebKit on IndexedDB: 31 s in a private context and 54 s on disk.** The prototype measured 4.2 s on 19k rows with wa-sqlite 2.0.6. Whether the 2.0.10 override or the larger data set explains the gap is not yet known, and Safari private windows use this path today. The workflow run should settle it.
  - Real first sign-in for Cedar Coast: 3.65 s in Chromium (IndexedDB) and 6.17 s in WebKit (OPFS, on disk). The WebKit replica file is 50.3 MiB.
  - Wasm from the bench's build: 6.9 MB across four files.
- `main`'s CI run 40586879483 on `f1a6066c` passed every job, which covers T2, T3 and T4.

## Wave 2 results

- **T5** (on `web-storage`): `leave(url, how)` in `lib/powersync.ts` closes an OPFS replica (bounded at 2 seconds) before `location.assign` or `location.replace`, and replaces the navigations in `Plans.tsx`, `Security.tsx` and `Login.tsx`. `usePlan` now awaits its `open`, so the plan button stays busy while the replica closes. An eslint rule (`no-restricted-syntax`) rejects `location.assign`, `.replace`, `.reload` and `location.href` assignments in `apps/web/src` outside `lib/powersync.ts` and `AdminLogin.tsx`; a planted call fails `pnpm lint`. `pagehide` starts `replica.close()`, and `pageshow` with `persisted` runs the session's full restore. `boundedOpen` in app-core fails an open after 20 seconds with `replica_stuck`, which `useReplicaSession` maps to `"stuck"` and the shell shows with `sync.openStuckTitle` and `sync.openStuckBody`.
- `XB-E2E-21` passed locally in Chromium, Firefox and WebKit (macOS, Playwright 1.63). It blocks service workers, since WebKit doesn't route a controlled page's requests; the WebKit profile fixture now passes `serviceWorkers` through, which `BILL-PILOT-02` also asked for and silently didn't get.
- **Q3, WebKit 316904 without `leave()`:** not reproduced on Playwright's macOS WebKit. With `leave()`'s close bypassed, `XB-E2E-21` passed 3 of 3; with both `leave()` and the `pagehide` close bypassed, 3 of 3 again. Linux WebKit wasn't run locally; its CI lane runs the case with the fix in place, so it shows only that the fix holds, not whether the bug reproduces there.
- **T6** (on `web-storage`): `ReplicaController` gets the web `remove` hook, which lists the name in `cb_replica_trash`, retries `removeReplicaFiles` every 500 ms for 5 seconds and drops the name once the files are gone. `connectPowerSync` takes its own name off the list, retries the rest and removes probe leftovers; the probe now holds a shared `.clientbridge-opfs-probe` lock, so the sweep never deletes a running probe's file. A restore that finds no session closes the replica instead of pausing it, and also retries the list, which the plan didn't call for: in WebKit a second tab's stalled open can take the file after the signing-out tab's 5 seconds, and without it the file stayed until that account signed in again (1 of 3 local runs). `replicaFilename(identity)` is exported from `@clientbridge/sync` so the page knows its own name before opening.
- `XB-E2E-20` passed locally 5 of 5 in WebKit and 3 of 3 in Chromium and Firefox, where it proves little until T9 because the replica is still in IndexedDB there.
- **Finding, WebKit two tabs (G1):** in Playwright's macOS WebKit with an on-disk profile, a second tab never opens the OPFS replica the first tab holds, even after 15 seconds idle and a retry; it shows the stuck-open message after 20 seconds. `f1a6066c`, before T5 and T6, behaves the same (the second tab stays on the splash past 60 seconds), so it predates this wave. `XB-E2E-20` keeps the second tab open but waits for it to load only in Chromium and Firefox. T7's concurrent-claim case in WebKit and T8 should confirm whether this is Playwright's WebKit, macOS only, or real Safari, before the switch.
- **T7** (on `web-storage`): the sync suite's lifecycle cases also run in Firefox and WebKit, with WebKit on a temporary on-disk profile (`packages/sync/e2e/engines.ts`), and CI's sync job installs both browsers. `make test-sync` passed 40 of 40 (28 Chromium, 6 Firefox, 6 WebKit). The concurrent-claim case passed 20 of 20 in each engine, and the removal cases needed no extra wait in WebKit.
- PLN-E2E-01 now compares only the plan rows of the shared demo businesses, since other cases add staff to them at the same time.
