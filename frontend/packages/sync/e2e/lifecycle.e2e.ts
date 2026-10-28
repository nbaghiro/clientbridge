import { expect, type Page } from "@playwright/test";
import { test } from "./engines";
import { backend, endpoint, fixture, token } from "./service";

interface TabWindow {
    manager: {
        pause: () => Promise<void>;
        close: () => Promise<void>;
        discard: (identity: { userId: string; scope: string }) => Promise<void>;
    };
    db: {
        getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
        execute: (sql: string, params?: unknown[]) => Promise<unknown>;
        currentStatus: { connected: boolean };
        database: { getConfiguration: () => { enableMultiTabs: boolean } };
    };
}

// a tab of the account's replica as the web app opens it, syncing as the owner and uploading hours
function openTab(tab: Page, userId: string): Promise<void> {
    return tab.evaluate(
        async ({ userId, endpoint, token }) => {
            const { replicaController, removeReplicaFiles, startHoursUploads } =
                await import("./database");
            const removed: boolean[] = [];
            const manager = replicaController(undefined, {
                list: () => undefined,
                remove: async (filename) => {
                    const deadline = Date.now() + 10_000;
                    let gone = await removeReplicaFiles(filename);
                    while (!gone && Date.now() < deadline) {
                        await new Promise((resolve) => setTimeout(resolve, 250));
                        gone = await removeReplicaFiles(filename);
                    }
                    removed.push(gone);
                },
            });
            const db = await manager.activate(
                { userId, scope: "https://app.test" },
                {
                    fetchCredentials: () => Promise.resolve({ endpoint, token }),
                    uploadData: () => Promise.resolve(),
                    startUploads: (db) => startHoursUploads(db, (path, init) => fetch(path, init)),
                },
            );
            await db.waitForFirstSync(AbortSignal.timeout(20_000));
            Object.assign(window, { manager, db, removed });
        },
        { userId, endpoint: endpoint(), token: token("owner") },
    );
}

function ownerName(tab: Page): Promise<string | null> {
    return tab.evaluate(async (owner) => {
        const { db } = window as unknown as TabWindow;
        const rows = await db.getAll<{ name: string | null }>(
            "SELECT name FROM users WHERE id = ?",
            [owner],
        );
        return rows[0]?.name ?? null;
    }, fixture("us_owner"));
}

function tabLocal(tab: Page): Promise<boolean> {
    return tab.evaluate(
        () => !(window as unknown as TabWindow).db.database.getConfiguration().enableMultiTabs,
    );
}

test("reauthentication preserves edits and account/environment switches isolate replicas", async ({
    page,
}) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
        const { replicaController, enqueueHours } = await import("./database");
        const manager = replicaController();
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
        const { replicaController, replicaDatabase } = await import("./database");
        const opened: string[] = [];
        const manager = replicaController((name) => {
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
                const { replicaController } = await import("./database");
                const manager = replicaController();
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
                const { replicaController, replicaDatabase, replicaFiles, enqueueHours } =
                    await import("./database");
                let name = "";
                const manager = replicaController((filename) => {
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
                const { replicaController, replicaDatabase, replicaFiles, removeReplicaFiles } =
                    await import("./database");
                let name = "";
                const removed: boolean[] = [];
                const manager = replicaController(
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
                const { replicaController, replicaDatabase } = await import("./database");
                let opened = "";
                const manager = replicaController((filename) => {
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
                const { replicaController } = await import("./database");
                const manager = replicaController();
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
        const { db } = window as unknown as TabWindow;
        const rows = await db.getAll<{ id: string }>("SELECT id FROM businesses ORDER BY id");
        return rows.map((row) => row.id);
    });
    expect(after).toEqual(first.businesses);
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
                const { replicaController, replicaDatabase, removeReplicaFiles } =
                    await import("./database");
                const listed: string[] = [];
                const removed: boolean[] = [];
                const manager = replicaController(replicaDatabase, {
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
                const { replicaController, replicaDatabase, replicaFiles, removeReplicaFiles } =
                    await import("./database");
                const identity = { userId, scope: "https://app.test" };
                const files = {
                    list: () => undefined,
                    remove: async (filename: string) => {
                        await removeReplicaFiles(filename);
                    },
                };
                let name = "";
                const first = replicaController((filename) => {
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
                await replicaController(replicaDatabase, files).discard(identity);
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
                    const { replicaController } = await import("./database");
                    const manager = replicaController();
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

test("SYN-E2E-31 a tab that pauses or closes leaves the other tabs syncing, and the last one ends sync", async ({
    context,
}) => {
    test.setTimeout(120_000);
    const [one, two] = [await context.newPage(), await context.newPage()];
    for (const tab of [one, two]) await tab.goto("/");
    const user = `handoff-${String(Date.now())}`;
    try {
        await openTab(one, user);
        await openTab(two, user);
        expect(await ownerName(two)).toBe("owner");

        await one.evaluate(() => (window as unknown as TabWindow).manager.pause());
        await backend("mutate", "rename");
        await expect.poll(() => ownerName(two), { timeout: 20_000 }).toBe("renamed");

        await one.evaluate(() => (window as unknown as TabWindow).manager.close());
        await backend("mutate", "restore_name");
        await expect.poll(() => ownerName(two), { timeout: 20_000 }).toBe("owner");

        // one reopens and pauses, so two is the last tab syncing when it closes
        await openTab(one, user);
        await one.evaluate(() => (window as unknown as TabWindow).manager.pause());
        await two.evaluate(() => (window as unknown as TabWindow).manager.close());
        await backend("mutate", "rename");
        await one.waitForTimeout(5_000);
        expect(await ownerName(one)).toBe("owner");
        expect(
            await one.evaluate(() => (window as unknown as TabWindow).db.currentStatus.connected),
        ).toBe(false);
    } finally {
        await backend("mutate", "restore_name");
    }
});

test(
    "SYN-E2E-32 a tab reloading repeatedly while another writes leaves both current and syncing",
    { tag: "@stream-restarts" },
    async ({ context }) => {
        test.setTimeout(180_000);
        const [one, two] = [await context.newPage(), await context.newPage()];
        for (const tab of [one, two]) await tab.goto("/");
        const user = `reload-${String(Date.now())}`;
        try {
            await openTab(one, user);
            await openTab(two, user);
            const notes = (tab: Page) =>
                tab.evaluate(async () =>
                    (
                        await (window as unknown as TabWindow).db.getAll<{ id: string }>(
                            "SELECT id FROM device_prefs WHERE id LIKE 'note.%' ORDER BY id",
                        )
                    ).map((row) => row.id),
                );
            const written: string[] = [];
            for (let round = 0; round < 5; round++) {
                const id = `note.${String(round)}`;
                written.push(id);
                await Promise.all([
                    one.reload().then(() => openTab(one, user)),
                    two.evaluate(
                        (id) =>
                            (window as unknown as TabWindow).db.execute(
                                "INSERT INTO device_prefs (id, value) VALUES (?, 'written')",
                                [id],
                            ),
                        id,
                    ),
                ]);
                expect(await notes(one)).toEqual(written);
            }
            expect(await notes(two)).toEqual(written);
            await backend("mutate", "rename");
            await expect.poll(() => ownerName(two), { timeout: 20_000 }).toBe("renamed");
            await expect.poll(() => ownerName(one), { timeout: 20_000 }).toBe("renamed");
        } finally {
            await backend("mutate", "restore_name");
        }
    },
);

test(
    "SYN-E2E-33 sign-out in one tab stops sync for every tab and removes the file once both close",
    { tag: "@opfs" },
    async ({ context }) => {
        test.setTimeout(120_000);
        const [one, two] = [await context.newPage(), await context.newPage()];
        for (const tab of [one, two]) await tab.goto("/");
        const identity = { userId: `sign-out-${String(Date.now())}`, scope: "https://app.test" };
        await openTab(one, identity.userId);
        await openTab(two, identity.userId);
        const name = await one.evaluate(async (identity) => {
            const { replicaFilename } = await import("./database");
            return replicaFilename(identity);
        }, identity);
        const files = (tab: Page) =>
            tab.evaluate(async (name) => {
                const { replicaFiles } = await import("./database");
                return replicaFiles(name);
            }, name);

        await one.evaluate((identity) => {
            Object.assign(window, {
                signedOut: (window as unknown as TabWindow).manager.discard(identity),
            });
        }, identity);
        await expect
            .poll(() =>
                one.evaluate(() => (window as unknown as TabWindow).db.currentStatus.connected),
            )
            .toBe(false);
        if (!(await tabLocal(two)))
            await expect
                .poll(() =>
                    two.evaluate(() => (window as unknown as TabWindow).db.currentStatus.connected),
                )
                .toBe(false);
        expect(await files(two)).toEqual([name, `${name}-journal`, `${name}-wal`]);

        // what the session change makes the other tab do
        await two.evaluate(() => (window as unknown as TabWindow).manager.close());
        await one.evaluate(() => (window as unknown as { signedOut: Promise<void> }).signedOut);
        expect(
            await one.evaluate(() => (window as unknown as { removed: boolean[] }).removed),
        ).toEqual([true]);
        expect(await files(one)).toEqual([]);
    },
);

test("SYN-E2E-34 weeks queued in two tabs of one replica each upload exactly once", async ({
    context,
}) => {
    test.setTimeout(120_000);
    const posted: string[] = [];
    await context.route(`**/v1/hours/${fixture("st_owner")}/week`, async (route) => {
        if (route.request().method() !== "POST") {
            await route.fulfill({ status: 200, json: {} });
            return;
        }
        const body = route.request().postData() ?? "";
        posted.push(
            (JSON.parse(body) as { request: { operation_id: string } }).request.operation_id,
        );
        // a slow answer leaves both tabs' upload loops time to reach the same week
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        const result = JSON.parse(await backend("hours", body)) as { status: number; body: string };
        await route.fulfill({
            status: result.status,
            body: result.body,
            contentType: "application/json",
        });
    });
    const [one, two] = [await context.newPage(), await context.newPage()];
    for (const tab of [one, two]) await tab.goto("/");
    const user = `uploads-${String(Date.now())}`;
    const week = (start: string, end: string) =>
        Array.from({ length: 7 }, (_, weekday) => ({
            weekday,
            available: true,
            start_time: start,
            end_time: end,
        }));
    const enqueue = (tab: Page, days: ReturnType<typeof week>) =>
        tab.evaluate(
            async ({ days, staff, business }) => {
                const { enqueueHours } = await import("./database");
                const { db } = window as unknown as {
                    db: Parameters<typeof enqueueHours>[0];
                };
                const [staffRow] = await db.getAll<{ hours_revision: number }>(
                    "SELECT hours_revision FROM staff WHERE id = ?",
                    [staff],
                );
                const [previous] = await db.getAll<{ id: string; payload: string }>(
                    "SELECT id, payload FROM hours_outbox WHERE staff_id = ? ORDER BY sequence DESC LIMIT 1",
                    [staff],
                );
                return (
                    await enqueueHours(
                        db,
                        staff,
                        business,
                        staffRow?.hours_revision ?? 0,
                        days,
                        [],
                        false,
                        previous ?? null,
                    )
                ).id;
            },
            { days, staff: fixture("st_owner"), business: fixture("bz_first") },
        );
    const settled = (tab: Page) =>
        tab.evaluate(async (staff) => {
            const { db } = window as unknown as TabWindow;
            const [row] = await db.getAll<{ hours_revision: number }>(
                "SELECT hours_revision FROM staff WHERE id = ?",
                [staff],
            );
            const pending = await db.getAll("SELECT id FROM hours_outbox");
            return { revision: row?.hours_revision ?? null, pending: pending.length };
        }, fixture("st_owner"));
    await backend("hours", "reset");
    try {
        await openTab(one, user);
        await openTab(two, user);
        const first = await enqueue(one, week("10:00:00", "16:00:00"));
        await expect
            .poll(() => settled(two), { timeout: 30_000 })
            .toEqual({ revision: 1, pending: 0 });
        const second = await enqueue(two, week("11:00:00", "17:00:00"));
        for (const tab of [one, two])
            await expect
                .poll(() => settled(tab), { timeout: 30_000 })
                .toEqual({
                    revision: 2,
                    pending: 0,
                });
        expect(posted).toEqual([first, second]);
        const hours = await one.evaluate(async (staff) => {
            const { db } = window as unknown as TabWindow;
            return db.getAll<{ start_time: string }>(
                "SELECT DISTINCT start_time FROM hours WHERE staff_id = ?",
                [staff],
            );
        }, fixture("st_owner"));
        expect(hours).toEqual([{ start_time: "11:00:00" }]);
    } finally {
        await backend("hours", "reset");
    }
});
