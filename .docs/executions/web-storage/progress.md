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

| Wave | Tasks                                                                                                  | Status                                             |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| 0    | T0                                                                                                     | Done 2026-10-27                                    |
| 1    | T1 bench harness, T2 PowerSync upgrade, T3 replica lifecycle, T4 precache, `persist()` and diagnostics | T2 and T4 merged 2026-10-27; T1 and T3 in progress |
| 2    | T5 navigation and locks, T6 sign-out cleanup, T7 sync suite in three engines                           | Waiting on T3 (and T2 for T7)                      |
| 3    | T8 gate run                                                                                            | Waiting on waves 1 and 2 on staging                |

## Wave 1 results

- **T2** (#71, merged without waiting for CI): `@powersync/web` 2.5.0, common 2.4.0, react 2.1.0, react-native 2.3.3, shared-internals 1.4.0. The wa-sqlite override stays at 2.0.10, since 2.5.0 pins 2.0.7. The web app's direct wa-sqlite dependency, its knip ignore and its Vite `optimizeDeps` entry are gone. The changelogs list no breaking change that affects us.
- **T4** (#72, merged without waiting for CI): the service worker precaches 22 files and 6.32 MB, down from 32 files and 10.44 MB; wasm went from 7.21 MB to 3.40 MB. Persistence is asked once per profile after the first sync (D4). The dev panel shows the storage kind, `enableMultiTabs`, `persisted()`, the replica size and the held and pending locks. The filter is `scripts/precache.ts` rather than `.mjs`, because `vite.config.ts` imports it under strict tsc.
- Neither had a complete CI run before merging. The first full run is on `main`.
