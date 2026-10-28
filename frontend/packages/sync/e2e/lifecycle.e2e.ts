import { expect } from "@playwright/test";
import { test } from "./engines";
import { endpoint, fixture, token } from "./service";

test("reauthentication preserves edits and account/environment switches isolate replicas", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { ReplicaController, replicaDatabase, enqueueHours } = await import("./database");
        const manager = new ReplicaController(replicaDatabase);
        const connector = {
            fetchCredentials: () => Promise.resolve(null),
            uploadData: () => Promise.resolve(),
        };
        const first = {
            userId: "first",
            scope: "https://app.test",
        };
        const db = await manager.activate(first, connector);
        await db.execute("INSERT INTO device_prefs (id, value) VALUES ('note.a', 'private first')");
        const days = Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            available: false,
            start_time: null,
            end_time: null,
        }));
        await enqueueHours(db, "first-staff", "bz_a", 0, days, days);
        await manager.pause();
        const preserved = (await db.getAll("SELECT id FROM hours_outbox")).length;
        const other = await manager.activate({ ...first, userId: "second" }, connector);
        const otherRows = await other.getAll("SELECT id FROM device_prefs WHERE id LIKE 'note.%'");
        await other.execute(
            "INSERT INTO device_prefs (id, value) VALUES ('note.b', 'private second')",
        );
        await enqueueHours(other, "second-staff", "bz_b", 0, days, days);
        const original = await manager.activate(first, connector);
        const originalRows = await original.getAll<{ id: string }>(
            "SELECT id FROM device_prefs WHERE id LIKE 'note.%'",
        );
        const originalPending = (await original.getAll("SELECT id FROM hours_outbox")).length;
        const environment = await manager.activate(
            { ...first, scope: "https://other.test" },
            connector,
        );
        const environmentRows = await environment.getAll(
            "SELECT id FROM device_prefs WHERE id LIKE 'note.%'",
        );
        await manager.discard();
        await manager.activate(first, connector);
        await manager.discard();
        const secondAgain = await manager.activate({ ...first, userId: "second" }, connector);
        const secondPending = (await secondAgain.getAll("SELECT id FROM hours_outbox")).length;
        await manager.discard();
        const discarded = await manager.activate(first, connector);
        const discardedPending = await discarded.getAll("SELECT id FROM hours_outbox");
        await manager.discard();
        return {
            discardedPending,
            preserved,
            otherRows,
            originalRows,
            originalPending,
            environmentRows,
            secondPending,
        };
    });
    expect(result).toEqual({
        discardedPending: [],
        preserved: 1,
        otherRows: [],
        originalRows: [{ id: "note.a" }],
        originalPending: 1,
        environmentRows: [],
        secondPending: 1,
    });
});

test("initialization opens only the account-scoped replica", async ({ page }) => {
    await page.goto("/");
    const names = await page.evaluate(async () => {
        const { ReplicaController, replicaDatabase } = await import("./database");
        const opened: string[] = [];
        const manager = new ReplicaController((name) => {
            opened.push(name);
            return replicaDatabase(name);
        });
        await manager.activate(
            { userId: "current", scope: "https://app.test" },
            { fetchCredentials: () => Promise.resolve(null), uploadData: () => Promise.resolve() },
        );
        await manager.discard();
        return opened;
    });
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^clientbridge-[a-f0-9]+-[a-f0-9]+\.db$/);
});

test("tabs opening the same fresh replica at once both claim it", async ({ context }) => {
    const tabs = [await context.newPage(), await context.newPage()];
    for (const tab of tabs) await tab.goto("/");
    const userId = `tabs-${String(Date.now())}`;
    const results = await Promise.all(
        tabs.map((tab) =>
            tab.evaluate(async (user) => {
                const { ReplicaController, replicaDatabase } = await import("./database");
                const manager = new ReplicaController(replicaDatabase);
                try {
                    await manager.activate(
                        {
                            userId: user,
                            scope: "https://app.test",
                        },
                        {
                            fetchCredentials: () => Promise.resolve(null),
                            uploadData: () => Promise.resolve(),
                        },
                    );
                    await manager.pause();
                    return "claimed";
                } catch (e) {
                    return String(e);
                }
            }, userId),
        ),
    );
    expect(results).toEqual(["claimed", "claimed"]);
});

test(
    "close keeps the replica file and the next activation reopens it",
    { tag: "@opfs" },
    async ({ page }) => {
        await page.goto("/");
        const result = await page.evaluate(
            async (userId) => {
                const { ReplicaController, replicaDatabase, replicaFiles, enqueueHours } =
                    await import("./database");
                let name = "";
                const manager = new ReplicaController((filename) => {
                    name = filename;
                    return replicaDatabase(filename);
                });
                const identity = {
                    userId,
                    scope: "https://app.test",
                };
                const connector = {
                    fetchCredentials: () => Promise.resolve(null),
                    uploadData: () => Promise.resolve(),
                };
                const db = await manager.activate(identity, connector);
                await db.execute(
                    "INSERT INTO device_prefs (id, value) VALUES ('note.kept', 'kept')",
                );
                const days = Array.from({ length: 7 }, (_, weekday) => ({
                    weekday,
                    available: false,
                    start_time: null,
                    end_time: null,
                }));
                await enqueueHours(db, "kept-staff", "bz_kept", 0, days, days);
                await manager.close();
                const closed = db.closed;
                const files = await replicaFiles(name);
                const reopened = await manager.activate(identity, connector);
                const notes = await reopened.getAll(
                    "SELECT id FROM device_prefs WHERE id LIKE 'note.%'",
                );
                const pending = (await reopened.getAll("SELECT id FROM hours_outbox")).length;
                await manager.discard();
                return { name, closed, files, notes, pending, fresh: reopened !== db };
            },
            `close-${String(Date.now())}`,
        );
        expect(result).toEqual({
            name: result.name,
            closed: true,
            files: [result.name, `${result.name}-journal`, `${result.name}-wal`],
            notes: [{ id: "note.kept" }],
            pending: 1,
            fresh: true,
        });
    },
);

test(
    "discard with removeReplicaFiles leaves no file of the replica",
    { tag: "@opfs" },
    async ({ page }) => {
        await page.goto("/");
        const result = await page.evaluate(
            async (userId) => {
                const { ReplicaController, replicaDatabase, replicaFiles, removeReplicaFiles } =
                    await import("./database");
                let name = "";
                const removed: boolean[] = [];
                const manager = new ReplicaController(
                    (filename) => {
                        name = filename;
                        return replicaDatabase(filename);
                    },
                    {
                        list: () => undefined,
                        remove: async (filename) => {
                            removed.push(await removeReplicaFiles(filename));
                        },
                    },
                );
                const db = await manager.activate(
                    { userId, scope: "https://app.test" },
                    {
                        fetchCredentials: () => Promise.resolve(null),
                        uploadData: () => Promise.resolve(),
                    },
                );
                await db.execute(
                    "INSERT INTO device_prefs (id, value) VALUES ('note.gone', 'gone')",
                );
                const before = await replicaFiles(name);
                await manager.discard();
                return { before: before.length, removed, after: await replicaFiles(name) };
            },
            `discard-${String(Date.now())}`,
        );
        expect(result).toEqual({ before: 3, removed: [true], after: [] });
    },
);

test(
    "replica files are removed only once no page holds them",
    { tag: "@opfs" },
    async ({ context }) => {
        const [holder, remover] = [await context.newPage(), await context.newPage()];
        for (const tab of [holder, remover]) await tab.goto("/");
        const name = await holder.evaluate(
            async (userId) => {
                const { ReplicaController, replicaDatabase } = await import("./database");
                let opened = "";
                const manager = new ReplicaController((filename) => {
                    opened = filename;
                    return replicaDatabase(filename);
                });
                const db = await manager.activate(
                    { userId, scope: "https://app.test" },
                    {
                        fetchCredentials: () => Promise.resolve(null),
                        uploadData: () => Promise.resolve(),
                    },
                );
                await db.execute(
                    "INSERT INTO device_prefs (id, value) VALUES ('note.held', 'held')",
                );
                Object.assign(window, { closeHeld: () => manager.close() });
                return opened;
            },
            `held-${String(Date.now())}`,
        );
        const remove = () =>
            remover.evaluate(async (filename) => {
                const { removeReplicaFiles, replicaFiles } = await import("./database");
                const removed = await removeReplicaFiles(filename);
                return { removed, files: await replicaFiles(filename) };
            }, name);
        const files = [name, `${name}-journal`, `${name}-wal`];
        expect(await remove()).toEqual({ removed: false, files });
        await holder.evaluate(() =>
            (window as unknown as { closeHeld: () => Promise<void> }).closeHeld(),
        );
        expect(await remove()).toEqual({ removed: true, files: [] });
    },
);

test("SYN-E2E-20 a second connected tab opens the replica and takes over sync when the first closes", async ({
    context,
}) => {
    test.setTimeout(90_000);
    const [one, two] = [await context.newPage(), await context.newPage()];
    for (const tab of [one, two]) await tab.goto("/");
    const user = `tabs-${String(Date.now())}`;
    const open = (tab: typeof one) =>
        tab.evaluate(
            async ({ user, endpoint, token }) => {
                const { ReplicaController, replicaDatabase } = await import("./database");
                const manager = new ReplicaController(replicaDatabase);
                const started = performance.now();
                const db = await manager.activate(
                    { userId: user, scope: "https://app.test" },
                    {
                        fetchCredentials: () => Promise.resolve({ endpoint, token }),
                        uploadData: () => Promise.resolve(),
                    },
                );
                const opened = performance.now() - started;
                await db.waitForFirstSync(AbortSignal.timeout(20_000));
                Object.assign(window, { manager, db });
                const businesses = await db.getAll<{ id: string }>(
                    "SELECT id FROM businesses ORDER BY id",
                );
                return { opened, businesses: businesses.map((row) => row.id) };
            },
            { user, endpoint: endpoint(), token: token("owner") },
        );
    const [first, second] = [await open(one), await open(two)];
    expect(first.businesses).toEqual([fixture("bz_first")]);
    expect(second.businesses).toEqual(first.businesses);
    expect(second.opened).toBeLessThan(10_000);

    await one.evaluate(() =>
        (window as unknown as { manager: { close: () => Promise<void> } }).manager.close(),
    );
    const after = await two.evaluate(async () => {
        const { db } = window as unknown as {
            db: {
                getAll: (sql: string) => Promise<{ id: string }[]>;
                database: { getConfiguration: () => { enableMultiTabs: boolean } };
            };
        };
        const rows = await db.getAll("SELECT id FROM businesses ORDER BY id");
        return {
            businesses: rows.map((row) => row.id),
            tabLocal: !db.database.getConfiguration().enableMultiTabs,
        };
    });
    expect(after.businesses).toEqual(first.businesses);
    // a shared sync worker (Chromium, Firefox) stops for every tab when one disconnects
    if (!after.tabLocal) return;
    const connected = () =>
        two.evaluate(
            () =>
                (window as unknown as { db: { currentStatus: { connected: boolean } } }).db
                    .currentStatus.connected,
        );
    await expect.poll(connected, { timeout: 20_000 }).toBe(true);
});

test(
    "SYN-E2E-22 an open waiting on a held file is abandoned, and sign-out still lists and removes the file",
    { tag: "@opfs" },
    async ({ context }) => {
        const [holder, tab] = [await context.newPage(), await context.newPage()];
        for (const page of [holder, tab]) await page.goto("/");
        const identity = { userId: `held-open-${String(Date.now())}`, scope: "https://app.test" };
        const name = await holder.evaluate(async (identity) => {
            const { replicaFilename } = await import("./database");
            const name = replicaFilename(identity);
            // what a dead page that kept its lock looks like to the next open
            await new Promise<void>((held) => {
                navigator.locks
                    .request(`ahp:/${name}`, () => {
                        held();
                        return new Promise<void>((release) => {
                            Object.assign(window, { release });
                        });
                    })
                    .catch(() => undefined);
            });
            return name;
        }, identity);
        const result = await tab.evaluate(
            async ({ identity, name }) => {
                const { ReplicaController, replicaDatabase, removeReplicaFiles } =
                    await import("./database");
                const listed: string[] = [];
                const removed: boolean[] = [];
                const manager = new ReplicaController(replicaDatabase, {
                    list: (filename) => listed.push(filename),
                    remove: async (filename) => {
                        removed.push(await removeReplicaFiles(filename));
                    },
                });
                const connector = {
                    fetchCredentials: () => Promise.resolve(null),
                    uploadData: () => Promise.resolve(),
                };
                const open = manager.activate(identity, connector).then(
                    () => "opened",
                    (error: unknown) => String(error),
                );
                Object.assign(window, { open });
                const waited = await Promise.race([
                    open,
                    new Promise((resolve) => {
                        setTimeout(() => {
                            resolve("waiting");
                        }, 2_000);
                    }),
                ]);
                manager.abandon();
                const started = performance.now();
                await manager.pause();
                await manager.discard(identity);
                return {
                    waited,
                    afterAbandonMs: performance.now() - started,
                    listed: listed.includes(name),
                    removed,
                };
            },
            { identity, name },
        );
        expect(result.waited).toBe("waiting");
        expect(result.afterAbandonMs).toBeLessThan(10_000);
        expect(result.listed).toBe(true);
        expect(result.removed).toEqual([false]);

        await holder.evaluate(() => {
            (window as unknown as { release: () => void }).release();
        });
        expect(
            await tab.evaluate(() => (window as unknown as { open: Promise<string> }).open),
        ).toContain("superseded");
        await expect
            .poll(() =>
                tab.evaluate(async (name) => {
                    const { removeReplicaFiles } = await import("./database");
                    return removeReplicaFiles(name);
                }, name),
            )
            .toBe(true);
    },
);

test(
    "SYN-E2E-23 sign-out with no replica open removes the account's file by name",
    { tag: "@opfs" },
    async ({ page }) => {
        await page.goto("/");
        const result = await page.evaluate(
            async (userId) => {
                const { ReplicaController, replicaDatabase, replicaFiles, removeReplicaFiles } =
                    await import("./database");
                const identity = { userId, scope: "https://app.test" };
                const files = {
                    list: () => undefined,
                    remove: async (filename: string) => {
                        await removeReplicaFiles(filename);
                    },
                };
                let name = "";
                const first = new ReplicaController((filename) => {
                    name = filename;
                    return replicaDatabase(filename);
                }, files);
                await first.activate(identity, {
                    fetchCredentials: () => Promise.resolve(null),
                    uploadData: () => Promise.resolve(),
                });
                await first.close();
                const before = await replicaFiles(name);
                // a page that never opened the replica, as on the verify-email screen
                await new ReplicaController(replicaDatabase, files).discard(identity);
                return { before: before.length, after: await replicaFiles(name) };
            },
            `unopened-${String(Date.now())}`,
        );
        expect(result).toEqual({ before: 3, after: [] });
    },
);

test(
    "SYN-E2E-27 an OPFS replica reopens with its unsent week while the sync service is unreachable",
    { tag: "@opfs" },
    async ({ page }) => {
        await page.goto("/");
        const userId = `offline-${String(Date.now())}`;
        const activate = (endpoint: string) =>
            page.evaluate(
                async ({ userId, endpoint, token }) => {
                    const { ReplicaController, replicaDatabase } = await import("./database");
                    const manager = new ReplicaController(replicaDatabase);
                    const db = await manager.activate(
                        { userId, scope: "https://app.test" },
                        {
                            fetchCredentials: () => Promise.resolve({ endpoint, token }),
                            uploadData: () => Promise.resolve(),
                        },
                    );
                    Object.assign(window, { manager, db });
                },
                { userId, endpoint, token: token("owner") },
            );
        await activate(endpoint());
        await page.evaluate(async () => {
            const { enqueueHours } = await import("./database");
            const { db, manager } = window as unknown as {
                db: Parameters<typeof enqueueHours>[0];
                manager: { close: () => Promise<void> };
            };
            await db.waitForFirstSync(AbortSignal.timeout(20_000));
            const days = Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                available: false,
                start_time: null,
                end_time: null,
            }));
            await enqueueHours(db, "offline-staff", "bz_offline", 0, days, days);
            await manager.close();
        });
        // nothing listens on port 9, so the reopen has no sync service to reach
        await activate("http://127.0.0.1:9");
        const reopened = await page.evaluate(async () => {
            const { db } = window as unknown as {
                db: {
                    getAll: (sql: string) => Promise<unknown[]>;
                    currentStatus: { connected: boolean };
                };
            };
            return {
                pending: (await db.getAll("SELECT id FROM hours_outbox")).length,
                businesses: (await db.getAll("SELECT id FROM businesses")).length,
                connected: db.currentStatus.connected,
            };
        });
        expect(reopened).toEqual({ pending: 1, businesses: 1, connected: false });
    },
);

test(
    "SYN-E2E-28 tabs loading together all get OPFS from the probe",
    { tag: "@opfs" },
    async ({ context }) => {
        const tabs = await Promise.all([1, 2, 3].map(() => context.newPage()));
        await Promise.all(tabs.map((tab) => tab.goto("/")));
        const answers = await Promise.all(
            tabs.map((tab) =>
                tab.evaluate(async () => {
                    const { opfsSyncAccess } = await import("./database");
                    return opfsSyncAccess();
                }),
            ),
        );
        expect(answers).toEqual([{ granted: true }, { granted: true }, { granted: true }]);
    },
);
