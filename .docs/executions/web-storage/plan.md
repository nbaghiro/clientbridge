# Web replica storage: OPFS on every browser

Status: planned, not started. Written 2026-10-27 on `web-storage` and re-based the same day onto `main` at `2d2cb40c`, which includes the e2e suite (PR #59). No product code changes in this branch.

The web app keeps its PowerSync replica in two storage systems today. Chromium and Firefox use IndexedDB. WebKit uses the origin private file system (OPFS) when a probe shows it can open a sync access handle, and IndexedDB otherwise, which is what happens in a private window. This plan moves every regular window to one system, OPFS through wa-sqlite's `OPFSCoopSyncVFS`, chosen by the probe on every engine. The per-engine selection code is deleted. What a context that refuses OPFS uses is decision D1: it is IndexedDB today, and this plan recommends memory.

The plan is gated on upstream fixes and our own measurements. Two of the five entry gates are open today (see [Entry gates](#3-entry-gates)), and the Chrome on Windows crash report is the one that can block the switch outright.

## Recommendation in short

1. `OPFSCoopSyncVFS` on Chromium, Firefox and WebKit, selected by a capability probe, never by engine name.
2. Where the probe fails, the replica uses the fallback chosen in D1. Today that's IndexedDB, chosen for #59 so a private window keeps unsent working-hours edits across a reload. The recommendation is memory (`InMemoryVfs`): the shell shows that this window doesn't keep data, and the page asks before closing while working-hours edits are unsent. The evidence on both sides is in [5.1](#51-storage-selection).
3. `@powersync/web` 2.5.0 or later. `@journeyapps/wa-sqlite` is already forced to 2.0.10 by a pnpm override in `frontend/package.json`; the override goes once a `@powersync/web` release pins 2.0.9 or later.
4. Sign-out deletes the database file, and a startup sweep deletes files that an earlier sign-out failed to remove, plus any `clientbridge-*` IndexedDB database left from before the switch (with the D1 caveat in 5.7).
5. Before any full-page navigation the app closes the replica, which is our workaround for WebKit's lock bug 316904.
6. The service worker stops precaching the wasm builds the app no longer loads. That removes about 6 MB of the current 7.1 MB of precached wasm if D1 is memory, and about 3.8 MB if it stays IndexedDB, which needs the Asyncify build.
7. Existing IndexedDB replicas in regular windows are not migrated. They are deleted, and the replica resyncs. Unsent working-hours edits in them are lost, so staging testers drain their outbox before the deploy.

## 1. Goal and end state

The goal is one client-side storage system for the web replica in regular windows. When this plan is done:

- Chromium, Firefox and WebKit (desktop, iPadOS and iOS) open the replica with `WASQLiteVFS.OPFSCoopSyncVFS`. No code reads `navigator.vendor` or the user agent to choose storage.
- A context where OPFS sync access handles fail opens the replica with the D1 fallback (`InMemoryVfs` as recommended, or `IDBBatchAtomicVFS`). That is the only other path, it is chosen only by the probe, and the debug panel shows which one is in use.
- `ReplicaStorage` in app-core is `"opfs"` plus the D1 fallback (`"memory"` or `"indexeddb"`). The `EngineVendor` type and the vendor argument are gone. If D1 is memory, the `indexeddb` arm and the `VFS.indexeddb` entry in `apps/web/src/lib/powersync.ts` go too.
- Sign-out leaves no replica file behind for that account.
- The production bundle's precache holds only the wasm builds the app loads: `wa-sqlite.wasm` (the synchronous build `OPFSCoopSyncVFS` and `InMemoryVfs` use), plus `wa-sqlite-async.wasm` if D1 keeps IndexedDB.
- Web and mobile run the same SQLite engine semantics over different storage (see [6](#6-web-and-mobile-after-the-change)).

Out of scope: mobile storage, encryption at rest, `OPFSWriteAheadVFS` (it opened only in Chromium in the harness, since it needs `readwrite-unsafe` handles), and `AccessHandlePoolVFS` (single connection; it failed the two-tab check in the harness with `NoModificationAllowedError`).

## 2. Where we start

This describes `main` at `2d2cb40c` (2026-10-27).

- `apps/web/src/lib/powersync.ts` maps `ReplicaStorage` to a VFS (`indexeddb` → `IDBBatchAtomicVFS`, `opfs` → `OPFSCoopSyncVFS`; there is no memory arm), resolves it once per page, opens the replica through `ReplicaController`, and calls `navigator.storage.persist()` on every connect.
- `replicaStorage(vendor, opfsSyncAccess)` in `packages/app-core/src/domain/sync.ts` returns `indexeddb` unless `navigator.vendor` is Apple's. On WebKit it runs the probe and returns `opfs` when it passes and `indexeddb` when it doesn't. Chromium and Firefox would pass the probe too, so the engine still comes from the vendor string.
- `apps/web/src/lib/opfsProbe.ts` runs in a worker. It creates `.clientbridge-opfs-probe`, opens and closes a sync access handle, removes the file and posts `true`, or posts `false` on any error. The page treats a worker error as refused. There is no timeout, and every probe uses the same file name.
- A private WebKit window therefore opens its replica in IndexedDB straight away, without PowerSync's three one-second OPFS retries, and keeps the outbox across reloads in that window.
- `ReplicaController` (`packages/sync/src/lifecycle.ts`) names each replica `clientbridge-<hash>.db` from the API URL, PowerSync URL and user id, claims it with a `sync.identity` row in one write transaction, and refuses a replica claimed by another identity. `discard()` calls `disconnectAndClear()` and `close()`. Neither removes the file.
- Offline writes go only through `hours_outbox`, a local-only table. Online commands go straight to the API. So the unsent work a replica can hold is working-hours edits.
- Sign-out (`AppShell` → `sync.recheck()`) warns when the outbox isn't empty (`sync.signOutBody`), then `discard`.
- The service worker (`apps/web/scripts/service-worker.js`, filled in by the `offline-shell` plugin in `vite.config.ts`) precaches every emitted asset except source maps. A production build from an earlier commit of this work held four wasm builds (7.1 MB): `wa-sqlite` 1.1 MB, `wa-sqlite-async` 2.3 MB, `mc-wa-sqlite` 1.3 MB and `mc-wa-sqlite-async` 2.5 MB, plus every VFS chunk twice (page and worker). Re-measure on `main` in T1.
- Versions in the lockfile: `@powersync/web` 2.4.2, `@powersync/common` 2.3.1, `@powersync/react` 2.0.2, `@powersync/react-native` 2.3.1 with `@op-engineering/op-sqlite` 18.2.5. `@journeyapps/wa-sqlite` is 2.0.10, forced by `pnpm.overrides` in `frontend/package.json` past the 2.0.6 that `@powersync/web` 2.4.2 pins. `apps/web/package.json` also lists `@journeyapps/wa-sqlite` `^2.0.10` directly, with matching entries in `vite.config.ts` (`optimizeDeps.exclude`) and `knip.json` (`ignoreDependencies`); no source file imports it.
- E2e: the WebKit lane runs in an on-disk profile (`test` in `apps/web/e2e/support/session.ts`), because Playwright's WebKit contexts refuse OPFS. `XB-E2E-17` signs in from a plain Playwright context, checks that the replica is one `clientbridge-*` IndexedDB database, reloads, and checks the same database reopens and Today opens. It runs in all three engines. `XB-E2E-05` and `OFF-E2E-01` carry `@no-webkit`, for a Playwright service-worker limit unrelated to storage.
- `.docs/executions/e2e/decisions.md` records that in one Linux CI run, a private WebKit window on IndexedDB waited about 30 seconds after a reload before its queries answered, behind the sync's write lock. `XB-E2E-17` checks that Today opens on the reopened replica, not how fast every panel fills.

## 3. Entry gates

Status checked on 2026-10-27 with `gh api` and the WebKit Bugzilla REST API. Re-check each one when the work starts and write the result in `progress.md`.

| Gate                                                                                                                                                                                                                                                                                  | Status 2026-10-27                                                                                                                                     | How to check                                                                                                                                                                            | If it is still open                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1. powersync-js 785**, `OPFSCoopSyncVFS` multi-tab deadlocks in Chrome and Safari                                                                                                                                                                                                  | Open, last updated 2026-10-20. Maintainers couldn't reproduce it in Chrome.                                                                           | `gh api repos/powersync-ja/powersync-js/issues/785`; read new comments and the web CHANGELOG.                                                                                           | Not blocking by itself. Our harness's two-tab and the sync suite's concurrent-claim cases must pass 20 of 20 runs on each engine (see [7](#7-measurement-plan)).                                                                                                        |
| **G2. Chrome OPFS renderer crash** (comment on 785, 2026-10-19): Chrome 155, Windows 11, `0xC0000005` in `FileSystemSyncAccessHandle::truncate` and `write` on the dedicated worker, 10 crashes in 14 OPFS runs against 0 in 20 IndexedDB runs, with `@powersync/web` 2.4.2 and 2.5.0 | No Chromium issue linked yet. The maintainer asked for the link on 2026-10-20 with no reply. No fix known.                                            | Look for the Chromium issue in 785's thread; run our own check (T3): the bench harness and the web first-sync flow on Chrome stable, Windows runner and a Windows device, 30 runs each. | **Blocking.** If our Windows runs crash at all, we wait for a Chrome fix and stay on the current split. If they don't crash in 30 runs, we go ahead, keep watching the report and keep the rollback path ready. There is no workaround we can own for a renderer crash. |
| **G3. powersync-js 808**, `OPFSCoopSyncVFS` init hangs on refresh in Safari                                                                                                                                                                                                           | Open, last updated 2026-10-09: still seen on iPadOS 26.6.1 after a long lock and a navigation, in Safari and Chrome for iOS.                          | `gh api repos/powersync-ja/powersync-js/issues/808`                                                                                                                                     | Our workaround (5.3): close the replica before programmatic navigations and on `pagehide`, plus an open watchdog with a recovery message. Proceed only if the real-device checks in T3 pass.                                                                            |
| **G4. powersync-js PR 811**, defer OPFS worker termination on `pagehide`                                                                                                                                                                                                              | Open since 2026-01-04, mergeable state "dirty". A maintainer doubts `pagehide` closes the race (2026-06-18).                                          | `gh api repos/powersync-ja/powersync-js/pulls/811`                                                                                                                                      | Not required. We do the equivalent in the app (5.3). If it merges, adopt the release and drop our `pagehide` handler.                                                                                                                                                   |
| **G5. WebKit 316904**, locks held by workers aren't returned on `location.href` changes                                                                                                                                                                                               | NEW, last changed 2026-10-09. Reproduces on macOS 26 and iPadOS 26.6.1; the lock stays held until the browser quits.                                  | `curl -s 'https://bugs.webkit.org/rest/bug/316904?include_fields=status,resolution,last_change_time'`                                                                                   | Same workaround as G3. We don't wait for it, since it affects the OPFS path WebKit regular windows already run on today.                                                                                                                                                |
| **G6. wa-sqlite 341**, concurrent opens of a fresh `OPFSCoopSyncVFS` file hang                                                                                                                                                                                                        | Open, last updated 2026-09-29. The deferred hand-over fix is in 2.0.7; a 5-second retry on a held handle (`InvalidStateError` in WebKit) is in 2.0.9. | `gh api repos/rhashimoto/wa-sqlite/issues/341`                                                                                                                                          | Covered by the 2.0.10 override already on `main` and by the sync suite's "tabs opening the same fresh replica at once both claim it" case running on OPFS.                                                                                                              |

**Versions to target.** `@powersync/web` 2.5.0 (2026-10-19) with `@powersync/common` 2.4.0, `@powersync/shared-internals` 1.4.0 and `@powersync/react` 2.1.0. It pins `@journeyapps/wa-sqlite` 2.0.7 exactly, so the existing override to 2.0.10 stays (2.0.10's `src` is identical to 2.0.9, which carries the held-handle retry and the `close()` fixes). When a `@powersync/web` release pins 2.0.9 or later, use it and remove the override. Mobile moves to `@powersync/react-native` 2.3.3 in the same task, so both apps share one `@powersync/common`. Remove the direct `@journeyapps/wa-sqlite` dependency from `apps/web/package.json` and its `knip.json` ignore if the build still works without it, since PowerSync's copy is the one the worker loads.

## 4. Evidence so far

The measurement harness is in this session's scratchpad (`vfs-bench/`), with its findings in `REPORT.md` and the full tables in `results/latest-tables.md` (raw data in `results/2026-10-27T18-42-58-696Z/`). It opens a PowerSync database with the app's schema through each VFS, applies one first checkpoint of about 19,000 synthetic rows through the real `powersync_control` path with no network, reads, reopens, runs two tabs writing 200 rows each, reloads ten times, relaunches the browser and clears. It runs each engine in a Playwright context ("ephemeral", which browses privately) and an on-disk profile ("persistent").

Scope of these numbers: one machine (Apple M4 Pro, 24 GB, macOS 26.3.1), Playwright 1.63.0 running Chromium 153, Firefox 155 and WebKit 26.6 headless, `@powersync/web` 2.4.2 and wa-sqlite 2.0.6 (the harness predates the 2.0.10 override), medians of five runs. They are local VFS costs, not end-to-end sync times. Linux, Windows, real Safari, Chrome and Firefox, and phones and tablets were not measured.

| On-disk profile     | First checkpoint, 19k rows | Cold open | Reopen | Ten reloads (open, ms) |
| ------------------- | -------------------------- | --------- | ------ | ---------------------- |
| Chromium, IndexedDB | 1,906 ms                   | 146 ms    | 46 ms  | 48 to 62               |
| Chromium, OPFS      | 754 ms                     | 87 ms     | 57 ms  | 52 to 67               |
| Firefox, IndexedDB  | 2,822 ms                   | 187 ms    | 82 ms  | 71 to 102              |
| Firefox, OPFS       | 2,784 ms                   | 175 ms    | 105 ms | 85 to 103              |
| WebKit, IndexedDB   | 4,171 ms                   | 258 ms    | 187 ms | 145 to **5,786**       |
| WebKit, OPFS        | 659 ms                     | 128 ms    | 86 ms  | 77 to 141              |

Other results from the same run:

- **Private-style contexts.** WebKit refused OPFS with `UnknownError` for every OPFS VFS, and the refusal failed in about 2 seconds without hanging. Chromium and Firefox accepted it. Chromium's private OPFS was slower than its on-disk OPFS (4,097 ms against 754 ms for the checkpoint) and slower than its private IndexedDB (1,531 ms). Firefox's private IndexedDB was the slowest and most scattered case (median 6,465 ms, 3,693 to 25,180), against 2,016 ms for its private OPFS. WebKit's private IndexedDB took 3,307 ms, and its reopen times across ten reloads ranged from 120 to 1,827 ms.
- **The Linux stall.** The WebKit IndexedDB stall behind `decisions.md` (XB-E2E-03/04) didn't reproduce on this Mac. The scatter above is the same path, slower but not stuck.
- **Two tabs.** In every on-disk profile, and in the private contexts that opened OPFS, `OPFSCoopSyncVFS` and `IDBBatchAtomicVFS` kept all 400 rows from two writing tabs with `integrity_check` `ok`. `AccessHandlePoolVFS` failed in the second tab, as documented.
- **Size.** The 19,000 rows make a 39.3 MB SQLite file on every VFS. The browsers' usage estimates for it ranged from 25 MB (Chromium, IndexedDB) to 79 MB (Firefox, IndexedDB).
- **Clearing.** After `disconnectAndClear()`, the rows are gone but the 39.3 MB file keeps its size, with 38.1 MB of free pages. `VACUUM` shrinks the SQLite file to 1.2 MB. The browser's usage estimate dropped with it only for Firefox's OPFS (39.8 to 1.7 MB); Chromium's and WebKit's OPFS estimates and every IndexedDB estimate stayed up. So clearing doesn't free storage. Whether deleting the file does is measured in T5.
- **In memory.** The checkpoint took 494 to 620 ms across the three engines. Rows don't survive a reload, as expected, and in WebKit each tab gets its own database, so two tabs don't see each other's rows.
- **Playwright's macOS WebKit keeps OPFS outside the profile folder**, under `~/Library/WebKit/org.webkit.Playwright/WebsiteData`. The harness wipes it before and after each run; any e2e check of OPFS contents on macOS WebKit needs the same care.

The research behind the gates and the design, with sources, is `storage-research.md` in the same scratchpad.

## 5. Design

### 5.1 Storage selection

One function decides, once per page: `replicaStorage(probe)` returns `"opfs"` when the probe grants sync access and the D1 fallback otherwise. The vendor argument goes away.

The probe stays in its worker (`opfsProbe.ts`), since `createSyncAccessHandle` exists only in workers. Two changes:

- It gets a 5-second timeout in `powersync.ts`. A probe that doesn't answer counts as refused, so a hung probe can't hold the splash screen. The timeout is the one case where a regular window could land on the fallback, which is why the debug panel records the result, and why the memory path, if chosen, is visible (5.8).
- It uses a unique file name per run (`.clientbridge-opfs-probe-<random>`), so two tabs probing at once don't collide on one handle.

**The fallback for refused contexts (D1).** IndexedDB is the current fallback, chosen for #59, and PowerSync's docs name it as the fallback for Safari private browsing. This plan recommends memory instead, and leaves the choice to the user.

For memory:

- A single storage system is the goal. An IndexedDB fallback keeps a second VFS, the Asyncify wasm build (about twice the size of the synchronous one) in the bundle and precache, a narrower IndexedDB sweep, and a second set of storage tests for the rarest context.
- The refused context we know of is WebKit's private window, which puts it on WebKit's IndexedDB, the path we moved WebKit's regular windows away from. On it, the harness measured reopen times of 120 to 1,827 ms in a private context and 145 to 5,786 ms on disk on one Mac with wa-sqlite 2.0.6. On `main` with 2.0.10, one Linux CI run waited about 30 seconds after a reload before queries answered (`decisions.md`). WebKit 309251 affects IndexedDB on iOS 26.0 to 26.4.
- A private window deletes its storage when it closes anyway. IndexedDB adds survival across reloads within that window.
- The local cost of a memory replica is small: 494 to 620 ms for the 19k-row checkpoint in the harness.

For IndexedDB:

- It's in place and covered by `XB-E2E-17` in all three engines, so it needs no new code or copy.
- Unsent working-hours edits survive a reload or an accidental close-and-reopen of a tab within the private window. With memory they're lost unless uploaded first, which the unload prompt guards but doesn't prevent.
- Tabs of one private window share the replica. With memory in WebKit, each tab holds its own copy and syncs on its own.
- A reload doesn't need a full resync over the network. With memory it does, and offline reload in a private window isn't possible. The network cost is unmeasured (T1).

The recommendation rests on the reload stall: a 30-second wait on a reload is worse for the person than a resync, and memory removes the last WebKit IndexedDB path. If T1 shows the private-window resync of the largest core business is slow on a normal connection, that weakens the case for memory. If the user keeps IndexedDB, the plan keeps the Asyncify build and the `indexeddb` arm, limits the IndexedDB sweep as described in 5.7, and drops the memory copy and unload prompt.

Firefox's real private windows are unmeasured. Playwright's Firefox context accepted OPFS, but it isn't the same as a private window. Whatever the answer, the probe decides, so the code doesn't change; only the expected result in `XB-E2E-17` and the device checklist does.

### 5.2 Multi-tab

`OPFSCoopSyncVFS` always runs the database in a dedicated worker per tab (`vfsRequiresDedicatedWorkers`). Tabs share the file cooperatively: a tab takes the file's access handles when it needs them, and other tabs ask for them through Web Locks and a `BroadcastChannel`. The sync stream runs in a `SharedWorker` when PowerSync's `enableMultiTabs` is on, so one tab syncs for all.

PowerSync turns `enableMultiTabs` off when `SharedWorker` is missing, the user agent matches `Android|iPhone|iPod|iPad`, or `window.safari` exists. The plan keeps that default. With it off, each tab syncs on its own and shares status over `BroadcastChannel`, and only one tab holds the sync at a time.

| Platform                            | Database                                         | Sync                                                           | Two or three tabs                                                                             |
| ----------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Chrome, Edge, Firefox desktop       | dedicated worker per tab                         | `SharedWorker`                                                 | Tabs take turns on the file; one sync                                                         |
| Safari macOS                        | dedicated worker per tab                         | per tab                                                        | Tabs take turns on the file; one active sync at a time                                        |
| Safari and Chrome on iOS and iPadOS | dedicated worker per tab                         | per tab (unless iPadOS reports a desktop UA, open question Q3) | Same as Safari macOS; background tabs are suspended, which releases nothing until they resume |
| Chrome Android                      | dedicated worker per tab                         | per tab (UA match)                                             | Same                                                                                          |
| Fallback, memory (D1)               | per tab (no `SharedWorker` on Safari) or shared  | as above                                                       | Tabs don't share data in Safari; each holds its own copy                                      |
| Fallback, IndexedDB (D1)            | as PowerSync resolves it for `IDBBatchAtomicVFS` | as above                                                       | Tabs share the database                                                                       |

The harness's two-tab case and the sync suite's concurrent-claim case run on OPFS in all three engines, and the e2e suite adds a three-tab case (`XB-E2E-19`). Record the resolved `enableMultiTabs` and the VFS in the debug panel, so a device check can read them.

### 5.3 Web Locks and worker lifetime

PowerSync's database worker holds `db-lock-<file>` while it works, and `OPFSCoopSyncVFS` holds per-file locks while a tab owns the handles. In WebKit, a dedicated worker's locks aren't released when the page changes `location.href` (WebKit 316904), and the next page's open waits until Safari quits (powersync-js 808).

We own three mitigations:

1. **Close before leaving.** Add `replica.close()` to `ReplicaController`: stop uploads and history, disconnect and `db.close()`, keeping the file. A web helper `leave(url, how)` in `apps/web/src/lib/powersync.ts` awaits it (bounded at 2 seconds) and then calls `location.assign` or `location.replace`. Every programmatic full-page navigation uses it: `pages/Plans.tsx`, `pages/Security.tsx`, `pages/Login.tsx`, and `AdminLogin.tsx` (which also reloads). `window.open` into a new tab isn't affected.
2. **Close on `pagehide`.** A `pagehide` listener starts `replica.close()`. It can't be awaited, so it narrows the window rather than closing it, which is the maintainer's point on PR 811. User reloads and back or forward navigations go through this path.
3. **Open watchdog.** If `replica.activate` hasn't resolved in 20 seconds, the shell shows a recovery state (5.8) with Try again, and the debug panel records `navigator.locks.query()` so a report shows who holds what. A retry can't free a lock WebKit never returns, so the message tells the person to quit and reopen the browser.

A page that closes its replica on `pagehide` and is then restored from the back-forward cache needs to reopen it. T6 handles `pageshow` with `persisted` set by running the same restore as a focus event, and `XB-E2E-21` covers going back.

### 5.4 Service worker precache

The `offline-shell` plugin precaches every emitted file. `loadModuleAndVfs` imports each wasm build and VFS by a static string, so the bundler emits all of them whether or not the app selects them. After the switch, the app loads the synchronous `wa-sqlite` build, `OPFSCoopSyncVFS`, `MemoryVFS` and `FacadeVFS`, plus `wa-sqlite-async` and `IDBBatchAtomicVFS` if D1 keeps IndexedDB.

Change the plugin to leave out of `ASSETS` the files the app can't load: `mc-wa-sqlite*` (the encryption builds; we pass no key), the `AccessHandlePoolVFS` and `OPFSWriteAheadVFS` chunks, and, if D1 is memory, `wa-sqlite-async*` and the `IDBBatchAtomicVFS` chunk. The pattern list lives next to the VFS map so the two change together, and a unit test of the plugin's filter fails if `wa-sqlite-*.wasm` (the synchronous build) is missing or an excluded build is present. In the build measured earlier this drops about 6 MB from the install with memory, or about 3.8 MB with IndexedDB. The files still exist on the server; they're only not precached.

`XB-E2E-05` already reads the cache keys after an offline restore; extend it to assert the synchronous wasm is cached and the excluded builds aren't.

### 5.5 `navigator.storage.persist()`

Keep asking, and stop asking again once granted:

- Call `navigator.storage.persisted()` first and call `persist()` only when it returns false.
- Record both results in the debug panel and in the device checklist.

Chromium grants or refuses silently by heuristic. Safari decides by heuristic too, with installed web apps as the documented case that qualifies. Firefox shows a permission prompt, so whether we ask on Firefox at all is decision D4.

### 5.6 Quotas and eviction

At 39.3 MB for 19k rows, the replica fits every documented quota: Chromium and Safari 17+ allow about 60% of disk per origin, Firefox at least 10% up to 10 GiB for best-effort storage. Chromium's private mode has a lower OPFS limit (PowerSync reports 100 MB with unexpected errors), so T1 measures the largest core demo business's real replica and flags anything over 60 MB.

Eviction removes an origin's storage as a whole, and persisted origins are skipped. Safari also deletes script-writable storage for a site that hasn't been used in seven days of browser use, unless the site is an installed web app, which has its own counter. Our offline access already requires a server check within seven days (`cb_verified_at`), so a Safari tab that's purged would have locked anyway. What it adds is loss of unsent working-hours edits after seven days without opening the app. The plan states this in `architecture.md` and doesn't add code for it.

A full device already has its own sync problem (`sync.problems.full`). T1 checks that OPFS quota errors reach that state the way IndexedDB's do.

### 5.7 Cleanup on sign-out

`disconnectAndClear()` empties the tables but leaves the file at full size. Sign-out should leave nothing behind.

- `ReplicaController` takes an optional `remove(filename)` alongside `open`. `discard()` calls `disconnectAndClear()`, `close()`, then `remove(filename)`. Mobile passes nothing for now, so its behaviour doesn't change.
- The web `remove` writes the filename to a `cb_replica_trash` list in `localStorage`, then removes `<name>`, `<name>-journal` and `<name>-wal` from the OPFS root. On success it drops the name from the list. If another tab still holds a handle (`NoModificationAllowedError`, or WebKit's equivalent), the name stays listed. If D1 keeps IndexedDB, `remove` deletes the IndexedDB database of that name when the page is on the fallback.
- At startup, before opening its own replica, the web app retries every name on the list except the one it's about to open, and deletes every IndexedDB database whose name starts with `clientbridge-`. The second step is the one-time cleanup of the old storage (see [8](#8-migration)). If D1 keeps IndexedDB, that step runs only when the probe granted OPFS, so a private window doesn't delete the replica it's about to open.
- Other tabs learn of the sign-out from the `cb_user` storage event and close their replica, so the retry on next start usually succeeds.
- Files of other accounts that never signed out on this device are kept. They may hold unsent edits for an account whose session expired, and the current rule is that only that account's sign-out discards them. Whether to sweep those is decision D3.
- The VFS's own `.ahp-*` temporary directories are cleaned by the VFS when it starts, under its locks.

### 5.8 Error states and copy

New copy needed. These are items for the user to approve. The wording here only states what each message has to say, and final text goes through the catalog (`en-CA.json`, `make gen-strings`). The two memory keys are needed only if D1 is memory.

| Key (proposed)                              | Where                                                    | What it has to say                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sync.memoryNotice`                         | a persistent strip in the shell when storage is `memory` | This window can't save data on the device, so the account loads again each time, and edits made offline are lost when the window closes. Suggest a regular window. |
| `sync.memoryUnsaved`                        | replaces `hours.savedLocally` in memory mode             | The hours are waiting to upload and will be lost if this window closes first.                                                                                      |
| `sync.openStuckTitle`, `sync.openStuckBody` | the watchdog's error state (5.3)                         | The account's saved data didn't open. Close other Clientbridge tabs; if it keeps happening, quit and reopen the browser. Unsent changes are still on the device.   |

The unload prompt in memory mode uses the browser's own `beforeunload` dialog, which shows no custom text, so it needs no copy. `sync.signOutBody` and `sync.offlineExpired` stay as they are, since they're still true for OPFS.

## 6. Web and mobile after the change

Mobile uses `@powersync/react-native` with `@op-engineering/op-sqlite`, which bundles SQLite and stores the replica as a file in the app's sandbox. After the change both apps run SQLite with PowerSync's same core extension and the same `ReplicaController`, schema and outbox, with a real file behind it:

|             | Web                                                              | Mobile                                      |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Engine      | SQLite compiled to wasm (wa-sqlite, synchronous build)           | native SQLite (op-sqlite)                   |
| Storage     | one OPFS file per account, rollback journal                      | one sandbox file per account                |
| Concurrency | one dedicated worker per tab, sharing the file through Web Locks | one process                                 |
| Fallback    | memory or IndexedDB (D1) where OPFS is refused                   | none needed                                 |
| Durability  | SQLite `synchronous=FULL` (PowerSync doesn't change it)          | op-sqlite's defaults                        |
| Sign-out    | clear, close, delete the file                                    | clear and close; the file stays (unchanged) |

The query semantics, transactions and the outbox behave the same way on both. The differences that remain are storage limits (browser quota and eviction against the device's disk) and the tab model. Deleting the file on mobile sign-out would be a separate change.

## 7. Measurement plan

Measure before the switch (the current split on `main`, after the `@powersync/web` upgrade) and after it, with the same tools and inputs.

**Tools**

- **The bench harness** (`vfs-bench`, decision D5 on where it lives). Local VFS costs on Chromium, Firefox and WebKit through Playwright, plus `safari.mjs` for real Safari through `safaridriver` (it needs "Allow remote automation" in Safari's Developer settings). Run with `--runs 10`, on the versions locked at the time, not the 2.0.6 of the first report.
- **The e2e lanes.** The first-sync time is the time from sign-in to Today with `hasSynced`, which the web suite already waits for. The suites record per-case seconds; T1 adds a test attachment with the first-sync time and the replica's size so lanes can be compared.
- **Manual device checks**, on staging, with the debug panel showing the VFS, `enableMultiTabs`, `persisted()`, the file size and lock holders.

**Cases and pass thresholds**

| Measure                                                       | Where                                                                                     | Pass                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| First sync of the largest core demo business (about 19k rows) | e2e lanes (Chromium, Firefox, WebKit); staging on each device                             | Not slower than the before-run on the same engine by more than 10% (median of 5)                                         |
| Local first checkpoint, 19k rows                              | harness, on-disk profile                                                                  | OPFS median at or below the IndexedDB median on Chromium and Firefox; on WebKit at or below today's OPFS median plus 10% |
| Private-window first sync and reload                          | e2e `XB-E2E-17`; harness ephemeral context                                                | Recorded for D1: memory resync time against IndexedDB reopen time, on WebKit                                             |
| Cold open (`db.init` to first query)                          | harness, e2e attachment                                                                   | Median under 300 ms on CI runners; no open over 10 s                                                                     |
| Reload and reopen                                             | harness, 20 reloads; e2e `XB-E2E-18`                                                      | No hang, rows intact, median under 300 ms, worst case under 2 s                                                          |
| Browser relaunch                                              | harness relaunch; `XB-E2E-18`                                                             | Rows and unsent outbox rows survive                                                                                      |
| Storage size                                                  | harness; debug panel on devices                                                           | File within 10% of SQLite's page count times page size; under 60 MB for the largest core business                        |
| After sign-out                                                | harness clear step; `XB-E2E-20`                                                           | No `clientbridge-*` file in OPFS or IndexedDB database; origin usage back within 1 MB of its baseline                    |
| Two and three tabs writing                                    | harness two-tab case (20 runs); `XB-E2E-19`; sync suite concurrent claim (20 runs)        | Every tab sees every row, `PRAGMA integrity_check` is `ok`, no hang                                                      |
| Chrome on Windows                                             | harness and a first-sync flow, 30 runs, on a `windows-latest` runner and a Windows device | No renderer crash (G2)                                                                                                   |
| Real Safari, macOS and iPadOS                                 | `safari.mjs`; device checklist (T3 and T12)                                               | Reload, navigation away and back, lock and unlock after an hour, and the installed web app all reopen the replica        |

## 8. Migration

There is no compatibility path. On the first load of the new build:

- **Chromium and Firefox.** The app probes, finds OPFS, and opens `clientbridge-<hash>.db` in OPFS. That file is new and empty, so the replica claims it and runs a first sync. Before opening, the startup sweep deletes every `clientbridge-*` IndexedDB database. Any working-hours edits that were unsent in the IndexedDB replica are deleted with it and never reach the server.
- **WebKit regular windows.** Nothing moves. They're already on OPFS, and the file name doesn't change. The sweep finds no IndexedDB replica unless the browser kept one from before the WebKit switch, and deletes it.
- **WebKit private windows.** With D1 as memory, a private window open across the deploy loses its IndexedDB replica on the next load and resyncs into memory. With IndexedDB, nothing changes.
- **A tab still running the old build** while another tab loads the new one keeps writing to IndexedDB until it reloads, and the new tab's sweep may delete that database under it. The app's existing open-replica refusal and the old tab's reload resolve this, at the cost of the same kind of loss.

**Data-loss risk, stated plainly.** Unsent working-hours edits sitting in a Chromium or Firefox IndexedDB replica when the new build first loads are lost. The app has no real users, so this affects staging and local testers only. The rollout (T12) asks every tester to open the app online, with the sync strip showing nothing pending, before the deploy. Copying outbox rows from IndexedDB to OPFS would avoid the loss, but it would be a migration bridge, which the no-compatibility rule excludes, whatever D1 decides.

The IndexedDB sweep stays in the code as part of the startup sweep. Once staging has run the new build for two weeks, remove the IndexedDB half (task T13), since by then no tester browser should still hold one. If the user would rather keep it until launch, that's part of decision D2. If D1 keeps IndexedDB, the probe-gated half stays as long as the fallback does.

## 9. Tests

### 9.1 Unit tests

- `packages/app-core/src/domain/sync.test.ts`: `replicaStorage` returns `opfs` when the probe grants access and the D1 fallback when it refuses, rejects or times out; it never reads a vendor. Replace the existing vendor cases.
- Web (`apps/web/src/lib/powersync.test.ts`, new): the sweep deletes listed names except the active one, keeps a name whose removal fails, deletes only `clientbridge-` IndexedDB databases (and, if D1 keeps IndexedDB, only when the probe granted OPFS), and `remove` deletes the three files and clears the list. Use fakes for the OPFS root and `indexedDB.databases()`, so the test doesn't need a browser.
- `ReplicaController`: `discard()` calls `remove` after `close()`; `close()` keeps the file and the next `activate` reopens it. The sync package has no unit tests today; add these to its Playwright suite (`packages/sync/e2e/lifecycle.e2e.ts`), which already drives `ReplicaController` in Chromium.
- The `offline-shell` precache filter (5.4).

### 9.2 Sync suite (`make test-sync`)

`packages/sync/e2e/database.ts` opens replicas with PowerSync's default VFS, which is IndexedDB. Switch it to `OPFSCoopSyncVFS`, so "tabs opening the same fresh replica at once both claim it" runs the concurrent-open path that wa-sqlite 341 is about, and add a `discard` case that checks the file is gone from OPFS.

### 9.3 E2e cases

All new web cases are tagged `@browsers`, so they run in the Chromium, Firefox and WebKit lanes, and each gets an ID in `BROWSER_CASES["web"]` in `backend/e2e/results.py` and its audit families in `.docs/executions/e2e/coverage.json`.

| ID                     | File             | Case                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XB-E2E-17` (reworded) | `offline.e2e.ts` | Today it checks that a plain Playwright context keeps the replica in IndexedDB and reopens it after a reload. After the change: where the browser refuses OPFS (Playwright's WebKit context), the replica opens on the D1 fallback. With memory, the shell shows the memory notice and no replica is left in OPFS or IndexedDB before or after a reload; with IndexedDB, the current checks stay. Where OPFS is granted (Playwright's Chromium and Firefox contexts), the replica is in OPFS. |
| `XB-E2E-18`            | `sync.e2e.ts`    | The replica survives ten reloads and a browser relaunch in an on-disk profile, in OPFS, with an unsent working-hours edit made offline still pending after the relaunch.                                                                                                                                                                                                                                                                                                                      |
| `XB-E2E-19`            | `sync.e2e.ts`    | Three tabs of one account: two save working hours, the third sees both, every tab reloads once, and no tab stays on the splash.                                                                                                                                                                                                                                                                                                                                                               |
| `XB-E2E-20`            | `sync.e2e.ts`    | Sign-out deletes the account's OPFS files and a pre-seeded `clientbridge-legacy.db` IndexedDB database, with a second tab open.                                                                                                                                                                                                                                                                                                                                                               |
| `XB-E2E-21`            | `sync.e2e.ts`    | A full-page navigation away (the Plans checkout redirect, stubbed to return) reopens the replica within the open budget, both when the redirect returns to the app and when the browser goes Back. It is the one CI check for WebKit 316904's path; Linux WebKit may not reproduce the bug, so the real check stays manual.                                                                                                                                                                   |

`XB-E2E-05` and `OFF-E2E-01` keep running in Chromium and Firefox; add an assertion that their replica is in OPFS. They keep `@no-webkit`: the exclusion is for Playwright's WebKit offline service-worker emulation, which this change doesn't touch. Re-check it with each Playwright upgrade.

### 9.4 Lanes and the WebKit profile

- The WebKit lane still needs an on-disk profile, since Playwright's WebKit contexts refuse OPFS. Without it, every WebKit case would run on the fallback and nothing would test WebKit's OPFS.
- Chromium and Firefox contexts accept OPFS, but Chromium's private OPFS was about 5.4 times slower for the checkpoint than on disk in the harness (4,097 ms against 754), and it isn't what a regular window uses. Decision D6 is whether the profile fixture applies to every engine. The recommendation is yes, which also removes the fixture's engine check, if T10 measures that a persistent context per test adds less than 10% to the Chromium lane.
- `test_harness.py` keeps checking `WEBKIT_EXCLUDED`. Add a check that `BROWSER_CASES["web"]` holds the four new IDs and that each appears in its file.
- The journeys and filings lanes run in Chromium only and need no change beyond running on OPFS.

## 10. Rollout and rollback

**Before production**

1. Every gate in section 3 is re-checked and recorded, and G2 has passed its Windows runs.
2. The e2e suite is green in all lanes, twice in a row.
3. Staging testers open the app online with nothing pending, then the build goes to staging.
4. Device checks on staging, each in a regular window and a private one, recorded in `progress.md` with the debug panel's values: Safari macOS (tab and installed web app), Safari iPadOS (tab and home-screen app, including locking the iPad for an hour while offline and reopening), Safari iPhone, Chrome macOS, Chrome Windows, Edge Windows, Firefox macOS, Firefox Windows, Chrome Android. Each check signs in, waits for the first sync, reloads five times, opens a second tab, saves working hours offline, reloads offline, reconnects, navigates to Plans and back, signs out, and confirms no file is left.
5. Staging runs for at least two weeks with the debug panel's open times and any watchdog reports reviewed.

**Rollback.** The change has no server or schema part, so rollback is reverting the merge and deploying. On the first load of the reverted build, Chromium and Firefox open an empty IndexedDB replica and resync; WebKit regular windows are unaffected, and WebKit private windows go back to IndexedDB. The OPFS files the new build created stay on disk until the next forward deploy's sweep, because the reverted build has no sweep. Unsent edits in those files are stranded, with the same tester instruction as section 8. If only Chrome on Windows misbehaves, there is no per-platform switch to flip, by design; rollback is the whole revert.

## 11. Tasks

Each task is one PR or one agent's work. Run `make check` before each is done, and the milestone audit after T8 and T13.

| #   | Task                                                                                                                                                                                                                                                                                                                  | Files                                                                                                                                                               | Done when                                                                                                                    | Depends on                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| T0  | Re-check gates G1 to G6 and get D1 decided                                                                                                                                                                                                                                                                            | this plan, `progress.md`                                                                                                                                            | Gate table re-dated; D1 recorded, and sections 5.1, 5.4, 5.7 and 9 trimmed to the chosen fallback                            | none                        |
| T1  | Land the measurement harness (per D5) and record the "before" numbers on the locked versions, including real Safari, the private-window cases for D1, the precache size on `main`, and the largest core business's replica size and first-sync time                                                                   | harness folder, a `workflow_dispatch` workflow, `progress.md`                                                                                                       | A run on Linux, macOS and Windows runners produces the tables in section 7                                                   | T0                          |
| T2  | Upgrade `@powersync/web` to 2.5.x, `@powersync/common` 2.4.0, `@powersync/react` 2.1.0, `@powersync/react-native` 2.3.3; keep the wa-sqlite 2.0.10 override, or remove it if the chosen `@powersync/web` pins 2.0.9 or later; drop the direct wa-sqlite dependency and its knip ignore if the build doesn't need them | `frontend/package.json`, app and package manifests, `knip.json`, `pnpm-lock.yaml`                                                                                   | Lockfile has one wa-sqlite at 2.0.9 or later; `make check` and all e2e lanes, including Android, green                       | T0                          |
| T3  | Gate run: Chrome on Windows (30 runs, harness and first sync), real Safari macOS and iPadOS reload and navigation on the T2 build with a branch that forces OPFS                                                                                                                                                      | `progress.md`                                                                                                                                                       | Results recorded; go or no-go written down for the user                                                                      | T1, T2                      |
| T4  | Storage selection: `replicaStorage(probe)`, probe timeout and unique file name, delete the vendor code, and the IndexedDB entry if D1 is memory                                                                                                                                                                       | `app-core/src/domain/sync.ts`, `sync.test.ts`, `apps/web/src/lib/powersync.ts`, `opfsProbe.ts`                                                                      | Unit tests in 9.1 pass; no `navigator.vendor` left in `apps/web/src` or app-core, and no `IDBBatchAtomicVFS` if D1 is memory | T3 go                       |
| T5  | File lifecycle: `ReplicaController.close()` and `remove`; web `remove`, trash list and startup sweep including old IndexedDB databases; other tabs close on sign-out                                                                                                                                                  | `packages/sync/src/lifecycle.ts`, `apps/web/src/lib/powersync.ts`, `App.tsx`, sync suite                                                                            | `XB-E2E-20` and the lifecycle cases pass in all engines                                                                      | T4                          |
| T6  | Navigation and locks: `leave()` for every programmatic navigation, `pagehide` close, 20-second open watchdog and its error state                                                                                                                                                                                      | `apps/web/src/lib/powersync.ts`, `pages/Plans.tsx`, `pages/Security.tsx`, `pages/Login.tsx`, `AdminLogin.tsx`, `app-core` sync hook, `DebugPanel.tsx`, catalog      | `XB-E2E-21` passes; no `location.assign`/`replace` left outside `leave()` in the shell                                       | T5, copy approved           |
| T7  | Fallback per D1. Memory: shell notice, outbox wording, `beforeunload` while the outbox has unsent rows. IndexedDB: no new UI; `XB-E2E-17` gains the OPFS assertion for Chromium and Firefox                                                                                                                           | `AppShell.tsx`, hours page, app-core sync hook, catalog, `offline.e2e.ts`                                                                                           | `XB-E2E-17` passes in all engines                                                                                            | T4, copy approved if memory |
| T8  | Service worker precache filter and its test; `persist()` change; debug panel fields (VFS, `enableMultiTabs`, `persisted()`, file size, lock holders)                                                                                                                                                                  | `vite.config.ts`, `DebugPanel.tsx`, `powersync.ts`                                                                                                                  | Precache test passes; `XB-E2E-05` asserts the cached wasm                                                                    | T4                          |
| T9  | Sync suite on OPFS (9.2)                                                                                                                                                                                                                                                                                              | `packages/sync/e2e/database.ts`, `lifecycle.e2e.ts`                                                                                                                 | 20 consecutive green runs of the concurrent-claim case                                                                       | T2                          |
| T10 | E2e: `XB-E2E-18` and `-19`, the OPFS assertions in `XB-E2E-05` and `OFF-E2E-01`, registry and harness test, profile fixture per D6                                                                                                                                                                                    | `apps/web/e2e/sync.e2e.ts`, `offline.e2e.ts`, `support/session.ts`, `backend/e2e/results.py`, `backend/tests/test_harness.py`, `coverage.json`, `case-seconds.json` | All lanes green twice; lane times within 10% of the before-run                                                               | T5 to T8                    |
| T11 | "After" measurements against section 7's thresholds                                                                                                                                                                                                                                                                   | `progress.md`                                                                                                                                                       | Every row passes, or the gap is written down for the user                                                                    | T10                         |
| T12 | Staging rollout and device checks (section 10)                                                                                                                                                                                                                                                                        | `progress.md`                                                                                                                                                       | Checklist complete; two weeks on staging                                                                                     | T11                         |
| T13 | Docs and cleanup: `architecture.md` (device storage, stack and driver tables), `decisions.md` (XB-E2E-03/04 and 17 entries), `engineering.md` if lanes changed; remove the IndexedDB half of the sweep (per D2); delete this folder                                                                                   | docs, `powersync.ts`                                                                                                                                                | Docs describe the storage as it ships; folder removed                                                                        | T12                         |

## 12. Decisions for the user

Each has a recommended answer.

- **D1. What a context that refuses OPFS uses.** Today: IndexedDB, chosen for #59 and covered by `XB-E2E-17`. Recommended: memory, with the notice and the unload prompt, because it removes the last WebKit IndexedDB path (reopens up to 1.8 s in a private context on one Mac, and a 30-second wait after a reload in one Linux CI run) and leaves one VFS and one wasm build. What it costs: unsent working-hours edits are lost if a private window closes or reloads before they upload, tabs in a WebKit private window don't share data, and every load resyncs. T1's private-window measurements inform it, and T0 records the answer.
- **D2. Old IndexedDB replicas.** Recommended: delete them on first load, accept the loss of unsent working-hours edits in them, and remove the sweep's IndexedDB half two weeks after staging. Alternative: keep that half until launch.
- **D3. Other accounts' files on a shared browser.** Recommended: keep them until that account signs out (current behaviour), and delete only files a sign-out failed to remove. Alternative: delete them when a different account signs in, losing any unsent edits of an expired session.
- **D4. `persist()` on Firefox**, where it prompts. Recommended: ask once per profile after the first sync and don't ask again once answered. Alternative: skip it on Firefox, which means detecting Firefox, the kind of engine check this plan removes.
- **D5. Where the harness lives.** Recommended: in the repo as a small workspace package with a manual workflow on Linux, macOS and Windows runners, outside the gate. Alternative: leave it in a scratchpad and run it by hand.
- **D6. On-disk profiles for every engine in e2e.** Recommended: yes, if T10 shows it costs under 10% of lane time, since regular windows are what we ship for.
- **D7. The copy in 5.8.** Needs wording and approval before T6, and before T7 if D1 is memory.

## 13. Risks and open questions

- **R1. Chrome on Windows crashes (G2).** If OPFS crashes Chrome on Windows for our access pattern, the switch waits. Our T3 runs may also miss it, as the reporter's minimal page did; that's why it gets device checks and two weeks of staging.
- **R2. WebKit lock bug (G3, G5).** Our mitigations narrow it; they can't remove it for user-initiated navigations. The watchdog makes it visible and recoverable by quitting the browser.
- **R3. The private-window fallback.** With memory, unsent edits are lost on reload or close in a private window if not uploaded, bounded to working-hours edits and guarded by the unload prompt. With IndexedDB, a private WebKit window can wait on a reload, as in the 30-second CI case.
- **R4. Unsent edits at migration.** Lost for testers who don't drain their outbox first (section 8).
- **R5. Safari's seven-day purge.** Unsent edits are lost after seven days without opening the app in a Safari tab. Installed web apps have their own counter.
- **Q1. Firefox private windows and OPFS.** Unknown; the probe handles either answer. Check on a device in T12.
- **Q2. Real replica size and first-sync time** for the largest core business. Measured in T1.
- **Q3. iPadOS with a desktop user agent.** Which `enableMultiTabs` PowerSync resolves there; read from the debug panel in T12.
- **Q4. Does `removeEntry` on WebKit fail or succeed** while another tab's worker holds the file? Measured in T5; the trash list covers either answer.
- **Q5. Does the harness's two-tab case reproduce 785 on Windows Chrome?** Measured in T3.
- **Q6. Do the harness numbers hold on wa-sqlite 2.0.10?** The first report ran on 2.0.6, before the override. Re-measured in T1.

## Sources

Checked 2026-10-27.

- powersync-js [issue 785](https://github.com/powersync-ja/powersync-js/issues/785), [issue 808](https://github.com/powersync-ja/powersync-js/issues/808), [PR 811](https://github.com/powersync-ja/powersync-js/pull/811), and the [web CHANGELOG](https://github.com/powersync-ja/powersync-js/blob/main/packages/web/CHANGELOG.md).
- wa-sqlite [issue 341](https://github.com/rhashimoto/wa-sqlite/issues/341); npm tarballs of `@journeyapps/wa-sqlite` 2.0.6 to 2.0.10 and `@powersync/web` 2.4.2 and 2.5.0 (`src/db/adapters/wa-sqlite/vfs.ts`, `resolveAndValidateOptions.ts`, `src/examples/OPFSCoopSyncVFS.js`).
- WebKit [316904](https://bugs.webkit.org/show_bug.cgi?id=316904), [309251](https://bugs.webkit.org/show_bug.cgi?id=309251) (duplicate of [304810](https://bugs.webkit.org/show_bug.cgi?id=304810), NEW).
- PowerSync, [JavaScript Web SDK reference](https://docs.powersync.com/client-sdks/reference/javascript-web) and [The Current State Of SQLite Persistence On The Web: May 2026 Update](https://powersync.com/blog/sqlite-persistence-on-the-web).
- MDN, [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); WebKit, [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/).
- The harness report, `vfs-bench/REPORT.md` and `vfs-bench/results/latest-tables.md` (run `2026-10-27T18-42-58-696Z`).
- `.docs/executions/e2e/decisions.md` (XB-E2E-03/04, XB-E2E-05/06) and the code paths named in section 2.
